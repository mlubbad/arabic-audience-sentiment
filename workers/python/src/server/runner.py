"""One server-backed job, end to end.

The local spool runner in `collectors.runner` drives a SQLite queue on the
worker's own machine. This is its counterpart against the control plane: it
resumes from the checkpoint the server is holding, so an interrupted worker
picks up where it stopped rather than starting the video again.
"""
from collectors.protocol import CollectionError

from .analysis import AnalysisError, analyse
from .gateway import ControlPlane, LeaseLost

# Outcomes a worker may declare. Anything else is reported as a failure rather
# than guessed at.
_DECLARABLE = {"partial", "exhausted", "blocked", "failed"}


def _resume_cursor(lease: dict) -> str | None:
    """Unwrap the stored checkpoint.

    The server keeps a JSON object; the collector takes the bare cursor it
    issued. Passing the object through would look like a corrupt continuation
    and restart the video from the beginning.
    """
    checkpoint = lease.get("checkpoint") or {}
    cursor = checkpoint.get("cursor") if isinstance(checkpoint, dict) else None
    return cursor if isinstance(cursor, str) and cursor else None


def _resume_progress(lease: dict) -> tuple[set[str], str | None]:
    """Which videos this job has already finished, and which it was inside.

    A channel-wide collection is one job over many videos. Resuming from the
    cursor alone would restart the channel at its first video and re-read
    everything already read — correct in the end, because commits are
    idempotent, but it would spend the whole quota doing it.
    """
    checkpoint = lease.get("checkpoint") or {}
    if not isinstance(checkpoint, dict):
        return set(), None
    done = checkpoint.get("done")
    current = checkpoint.get("video")
    return (
        {v for v in done if isinstance(v, str)} if isinstance(done, list) else set(),
        current if isinstance(current, str) and current else None,
    )


def run_once(
    control: ControlPlane,
    collector,
    video_id: str,
    video_title: str | None = None,
    analyzer=None,
    build_collector=None,
) -> bool:
    """Claim one job and carry it to an explicit end. False means no work.

    With an analyzer, each batch is labelled before it is committed, so rows and
    the verdicts about them land in the same transaction. Without one the job is
    collection only, which is a legitimate job type and the previous behaviour.
    """
    lease = control.claim()
    if lease is None:
        return False

    # The server hands down a short-lived access token for the claimed job's
    # channel. A job whose channel nobody has connected arrives without one:
    # that is blocked, not failed — nothing is wrong, there is simply nothing to
    # collect with until somebody authorises it.
    if build_collector is not None:
        token = lease.get("access_token")
        if not token:
            control.finish(lease, "blocked", "channel_not_connected")
            return True
        # The callback returns both, because which video to collect can only
        # be answered with the token: the channel's uploads are not public
        # knowledge to the worker until it has one.
        collector, video_id = build_collector(token)
        # The builder is the only thing that knows which video it chose, so it
        # is also the only thing that knows the title. Without this the server
        # stored the platform id as the title — correct as a fallback, wrong
        # when the name was in hand all along.
        video_title = getattr(build_collector, "video_title", None) or video_title
        if collector is None:
            # The builder may say *why* it found nothing. "No video to collect"
            # is true both of a channel whose uploads have comments switched
            # off and of one that is simply quiet, and the operator has to do
            # different things about those two.
            reason = getattr(build_collector, "reason", None)
            control.finish(lease, "blocked", reason or "no_video_to_collect")
            return True

    outcome = "partial"
    # An analysis failure never stops the run and never ends it as a success:
    # the rows are real and worth keeping, but the coverage they claim is not.
    analysis_failed = False
    try:
        for batch in collector.batches(video_id, _resume_cursor(lease)):
            predictions: list = []
            if analyzer is not None:
                try:
                    predictions = analyse(analyzer, batch.comments)
                except AnalysisError:
                    analysis_failed = True
            # Heartbeat before the commit, so a long batch does not let the
            # lease lapse underneath the write that follows it.
            control.heartbeat(lease)
            control.commit_batch(lease, video_id, video_title, batch, predictions)
            outcome = batch.outcome if batch.outcome in _DECLARABLE else "failed"
            if batch.outcome != "partial":
                break
        else:
            # The generator ended without saying it had exhausted the source, so
            # coverage is partial. Silence is not completion.
            outcome = "partial"
        if analysis_failed and outcome == "exhausted":
            # The source was read to its end but not everything in it was
            # labelled, so this is not a complete result.
            outcome = "partial"
        control.finish(lease, outcome)
    except LeaseLost:
        # Someone else holds this job now. Declaring anything would overwrite
        # their result, so the failure propagates untouched.
        raise
    except CollectionError as exc:
        control.finish(
            lease, exc.outcome if exc.outcome in _DECLARABLE else "blocked", exc.code
        )
    return True


def _discover(control: ControlPlane, lease: dict, build_collector) -> bool:
    """List the channel's videos and commit the list. The lease is already claimed.

    An incomplete listing is partial: the videos it did find are real, the
    claim that this is the whole channel is not.
    """
    token = lease.get("access_token")
    if not token:
        control.finish(lease, "blocked", "channel_not_connected")
        return True
    try:
        collector = build_collector(token)
        result = collector.catalogue()
        control.heartbeat(lease)
        control.commit_catalogue(lease, result.videos)
        control.finish(lease, "exhausted" if result.complete else "partial",
                       None if result.complete else result.reason)
    except LeaseLost:
        raise
    except CollectionError as exc:
        control.finish(
            lease, exc.outcome if exc.outcome in _DECLARABLE else "blocked", exc.code
        )
    return True


def run_discover(control: ControlPlane, build_collector) -> bool:
    """Claim one discover job: list the channel's videos and commit the list."""
    lease = control.claim()
    if lease is None:
        return False
    return _discover(control, lease, build_collector)


def _backfill(control: ControlPlane, lease: dict, build_collector, analyzer=None) -> bool:
    """Walk the videos the server handed on the lease. The lease is already claimed.

    The whole channel is one job, not one job per video: the queue refuses a
    second outstanding collection per channel. Which videos to read is the
    server's decision (the selection table, filtered to what is due), carried
    on the lease; the worker cannot widen it. Progress lives in the job's
    checkpoint, so an interrupted run resumes at the video it was inside.

    A video read to its end is reported finished and not read again this run.
    A video whose comments are switched off is reported and skipped; anything
    else that stops early leaves the run partial with the cursor held.
    """
    token = lease.get("access_token")
    if not token:
        control.finish(lease, "blocked", "channel_not_connected")
        return True
    # An explicit empty list is a channel with nothing due. No list at all is a
    # gateway that never computed one, and a run that read nothing because it
    # was handed nothing must not be recorded as a collection that succeeded.
    if "videos" not in lease:
        control.finish(lease, "blocked", "no_due_list")
        return True
    collector = build_collector(token)
    videos = [v for v in (lease.get("videos") or []) if isinstance(v, dict)]

    done, current = _resume_progress(lease)
    cursor = _resume_cursor(lease)
    analysis_failed = False
    outcome = "exhausted"

    try:
        for video in videos:
            vid = video["external_video_id"]
            if vid in done:
                continue
            # The held cursor belongs to one video. Starting another video from
            # it would ask the source to continue a page sequence it never
            # issued.
            start = cursor if vid == current else None
            video_outcome = "partial"
            try:
                for batch in collector.batches(vid, start):
                    predictions: list = []
                    if analyzer is not None:
                        try:
                            predictions = analyse(analyzer, batch.comments)
                        except AnalysisError:
                            analysis_failed = True
                    control.heartbeat(lease)
                    control.commit_batch(
                        lease, vid, video.get("title"), batch, predictions,
                        progress={"video": vid, "done": sorted(done)},
                    )
                    video_outcome = (
                        batch.outcome if batch.outcome in _DECLARABLE else "failed"
                    )
                    if batch.outcome != "partial":
                        break
            except CollectionError as exc:
                if exc.code != "comments_disabled":
                    raise
                # A property of the video, not of the run. Learned back into
                # the catalogue and the next video is read.
                control.video_finished(lease, video["video_id"], "blocked", exc.code)
                done.add(vid)
                continue
            if video_outcome != "exhausted":
                # Stop the run here. The checkpoint names this video and the
                # ones behind it, so the next attempt continues rather than
                # repeating the channel.
                control.video_finished(lease, video["video_id"], video_outcome)
                outcome = video_outcome
                break
            control.video_finished(lease, video["video_id"], "exhausted")
            done.add(vid)
        if analysis_failed and outcome == "exhausted":
            outcome = "partial"
        control.finish(lease, outcome)
    except LeaseLost:
        raise
    except CollectionError as exc:
        control.finish(
            lease, exc.outcome if exc.outcome in _DECLARABLE else "blocked", exc.code
        )
    return True


def run_backfill(control: ControlPlane, build_collector, analyzer=None) -> bool:
    """Claim one collect job and walk the videos the server handed it. False means no work."""
    lease = control.claim()
    if lease is None:
        return False
    return _backfill(control, lease, build_collector, analyzer)


def run_job(control: ControlPlane, build_collector, analyzer=None) -> bool:
    """Claim whatever is next and run it by its type. False means no work.

    The claim is consumed here; the lease is handed down rather than claiming
    twice — a job must never be claimed twice.
    """
    lease = control.claim()
    if lease is None:
        return False
    if lease.get("type") == "discover":
        return _discover(control, lease, build_collector)
    return _backfill(control, lease, build_collector, analyzer)
