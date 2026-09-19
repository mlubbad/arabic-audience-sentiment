"""One server-backed job, end to end.

The local spool runner in `collectors.runner` drives a SQLite queue on the
worker's own machine. This is its counterpart against the control plane: it
resumes from the checkpoint the server is holding, so an interrupted worker
picks up where it stopped rather than starting the video again.
"""
import hashlib
import time

from collectors.protocol import CollectionError
from topics.analysis import classify
from topics.protocol import TopicError

from .analysis import AnalysisError, analyse
from .gateway import ControlPlane, ControlPlaneError, LeaseLost

# Outcomes a worker may declare. Anything else is reported as a failure rather
# than guessed at.
_DECLARABLE = {"partial", "exhausted", "blocked", "failed"}


def _log(message: str) -> None:
    # Unbuffered and timestamped: the service log is read while it runs.
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S%z')} {message}", flush=True)


def _still_to_read(control: ControlPlane, collector, lease: dict, videos: list[dict]) -> list[dict]:
    """The due list narrowed to the videos whose comment count moved.

    One videos.list(part=statistics) call answers fifty counts for one quota
    unit; reading a video costs one unit per page whether or not anything
    was written. The server compares each count with the one at the video's
    last exhausted read and defers the unchanged ones. Any failure of this
    step — the source, the gateway, an older gateway without the route —
    degrades to the old behaviour: every due video is read. It never fails
    the job and never narrows the list on its own. A collector that cannot
    answer the question (the fixture ones) is the old behaviour too.
    """
    if not videos or not hasattr(collector, "comment_counts"):
        return videos
    try:
        counts = collector.comment_counts([v["external_video_id"] for v in videos])
        answer = control.video_counts(lease, counts)
    except LeaseLost:
        # Someone else holds the job; reading on would write over their result.
        raise
    except (CollectionError, ControlPlaneError) as exc:
        _log(f"comment counts unavailable ({exc.code}), reading every due video")
        return videos
    read = answer.get("read")
    if not isinstance(read, list):
        _log("comment counts answered without a read list, reading every due video")
        return videos
    wanted = {v for v in read if isinstance(v, str)}
    kept = [v for v in videos if v["external_video_id"] in wanted]
    _log(f"comment counts: {len(videos) - len(kept)} unchanged, {len(kept)} to read")
    return kept


def _renew_for(control: ControlPlane, lease: dict):
    """The renewal the collector may ask for, narrowed to what it may learn.

    A control-plane refusal — an older gateway without the route, a blip —
    becomes "no renewal", which ends the run as the retryable credential
    lapse it would have been anyway. A lost lease is not narrowed: someone
    else holds the job, and ending quietly would write over their result.
    """
    def renew():
        try:
            return control.renew_token(lease)
        except LeaseLost:
            raise
        except ControlPlaneError:
            return None
    return renew


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
        collector, video_id = build_collector(
            token, lease.get("access_token_expires_at"), _renew_for(control, lease)
        )
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


def _collector_for(control: ControlPlane, lease: dict, build_collector):
    """The collector the lease can support, or a reason it cannot be built.

    A token names the OAuth path, as it always has. A lease without one but
    with an `external_channel_id` is a public channel: the builder decides
    with the project API key whether this worker can read public data, and
    None there is a configuration gap on the worker, not a fault in the
    channel. Neither token nor id is the old answer, unchanged: nobody has
    connected this channel.
    """
    token = lease.get("access_token")
    if token:
        return build_collector(
            token, lease.get("access_token_expires_at"), _renew_for(control, lease)
        ), None, None
    channel_id = lease.get("external_channel_id")
    if not channel_id:
        return None, "channel_not_connected", None
    collector = build_collector(None, None, None, channel_id=channel_id)
    if collector is None:
        return None, "public_collection_not_configured", None
    return collector, None, channel_id


def _discover(control: ControlPlane, lease: dict, build_collector) -> bool:
    """List the channel's videos and commit the list. The lease is already claimed.

    An incomplete listing is partial: the videos it did find are real, the
    claim that this is the whole channel is not.
    """
    collector, reason, channel_id = _collector_for(control, lease, build_collector)
    if collector is None:
        control.finish(lease, "blocked", reason)
        return True
    try:
        # The OAuth collector reads the channel its grant names; the public
        # collector is told which id it was built for.
        result = collector.catalogue(channel_id)
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
    lease = control.claim(["discover"])
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
    collector, reason, _ = _collector_for(control, lease, build_collector)
    if collector is None:
        control.finish(lease, "blocked", reason)
        return True
    # An explicit empty list is a channel with nothing due. No list at all is a
    # gateway that never computed one, and a run that read nothing because it
    # was handed nothing must not be recorded as a collection that succeeded.
    if "videos" not in lease:
        control.finish(lease, "blocked", "no_due_list")
        return True
    videos = [v for v in (lease.get("videos") or []) if isinstance(v, dict)]

    done, current = _resume_progress(lease)
    cursor = _resume_cursor(lease)
    analysis_failed = False
    outcome = "exhausted"

    try:
        videos = _still_to_read(control, collector, lease, videos)
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
    except ControlPlaneError as exc:
        # A refusal is a verdict on the job, not a blip: the plan is spent, the
        # batch was malformed, the workspace has no plan. Letting it escape
        # left the lease to lapse and the job to be reclaimed and refused again
        # — twenty times on the night the pilot's units ran out. The job ends
        # blocked with the server's own code and its checkpoint intact; the
        # scheduler's backoff decides when to try again. A 5xx is still the
        # server's problem and still escapes.
        if exc.retryable:
            raise
        control.finish(lease, "blocked", exc.code)
    return True


def run_backfill(control: ControlPlane, build_collector, analyzer=None) -> bool:
    """Claim one collect job and walk the videos the server handed it. False means no work.

    The claim is scoped to collect deliberately. A run that meant to collect
    once claimed whatever was oldest, and an operator's backfill consumed a
    queued topics job that way, finishing it succeeded with nothing classified
    — recorded as work done that no one had done.
    """
    lease = control.claim(["collect"])
    if lease is None:
        return False
    return _backfill(control, lease, build_collector, analyzer)


# How many due lists one analyse job will work through before standing down.
# 50 × 200 rows is ten thousand verdicts; a list that never shrinks is a bug,
# not a backlog, and the job says partial rather than spinning on it.
_TOPIC_ROUNDS = 50
# Rows classified and committed together. One Gemini chunk, one commit: a
# failure late in a due list does not discard the verdicts already paid for
# earlier in it, and a retry re-sends one chunk, not two hundred rows. Sized
# to the adapter's CHUNK so one slice is one request.
_TOPIC_SLICE = 100
_FINAL = {"succeeded", "skipped", "unsupported"}


def _topic_batch_key(lease: dict, rounds: int, start: int, records: list[dict]) -> str:
    """Names the lease, the round, the slice and the sorted ids.

    The ids alone would make a second attempt at the same rows — after an
    outage, in a later round — collide with the first as batch_conflict, since
    the verdicts differ. The round and the offset make it a new batch within a
    lease; the lease token makes a re-claimed job (whose round 1 repeats the
    first attempt's round 1 with different verdicts) start afresh. A replay of
    the very same slice under the same lease (a lost 200 after a stored
    commit) still replays.
    """
    ids = ",".join(sorted(r["external_comment_id"] for r in records))
    salt = f"{lease['lease_token']}:{rounds}:{start}:{ids}"
    return hashlib.sha256(salt.encode()).hexdigest()[:32]


def run_topics(control: ControlPlane, lease: dict, classifier) -> bool:
    """Classify what the server says lacks a topic, until it says nothing does.

    Each round asks for up to 200 rows under the key the server assigns for
    this classifier, classifies and commits them in slices of 25, and asks
    again. Gemini's own failures arrive as failed verdicts and make the job
    partial; a round that stores nothing final ends the job there, because
    nothing stored can shrink the list and asking again would only re-send
    the same rows. The control plane's refusals end it blocked.
    """
    if classifier is None:
        control.finish(lease, "blocked", "no_topic_classifier")
        return True
    first_failure: str | None = None
    rounds = 0
    try:
        while True:
            due = control.topics_due(lease, classifier.model_id, classifier.prompt_version)
            if not due.get("active", False):
                control.finish(lease, "blocked", "topic_model_not_active")
                return True
            # The server saw rows to classify and no allowance to pay for
            # them. Said before the model is called, not learned at commit.
            blocked = due.get("blocked")
            if isinstance(blocked, str) and blocked:
                control.finish(lease, "blocked", blocked)
                return True
            rows = [r for r in due.get("rows") or [] if isinstance(r, dict)]
            if not rows:
                break
            rounds += 1
            if rounds > _TOPIC_ROUNDS:
                first_failure = first_failure or "topics_due_list_not_shrinking"
                break
            taxonomy = due.get("taxonomy") or []
            any_final = False
            stopped = False
            for start in range(0, len(rows), _TOPIC_SLICE):
                control.heartbeat(lease)
                try:
                    records = classify(classifier, taxonomy, due["classification_key"],
                                       rows[start:start + _TOPIC_SLICE])
                except TopicError as exc:
                    first_failure = first_failure or exc.code
                    stopped = True
                    break
                for r in records:
                    if r["status"] in _FINAL:
                        any_final = True
                    elif first_failure is None:
                        first_failure = r["error_code"] or "classification_failed"
                control.commit_topics(lease, _topic_batch_key(lease, rounds, start, records), records)
            if stopped or not any_final:
                first_failure = first_failure or "classification_failed"
                break
        control.finish(lease, "partial" if first_failure else "exhausted", first_failure)
    except LeaseLost:
        raise
    except ControlPlaneError as exc:
        if exc.retryable:
            raise
        control.finish(lease, "blocked", exc.code)
    return True


def run_job(control: ControlPlane, build_collector, analyzer=None, classifier=None) -> bool:
    """Claim whatever is next and run it by its type. False means no work.

    The claim is consumed here; the lease is handed down rather than claiming
    twice — a job must never be claimed twice.
    """
    # The loop can run what it is configured to run, and says so. A worker
    # without a topic classifier claiming unscoped would take a topics job,
    # hold its lease, and finish it blocked — five minutes the queue waited
    # for nothing. Scope the claim to what can actually be dispatched.
    job_types = None if classifier is not None else ["collect", "discover"]
    lease = control.claim(job_types)
    if lease is None:
        return False
    if lease.get("type") == "discover":
        return _discover(control, lease, build_collector)
    if lease.get("type") == "analyse":
        return run_topics(control, lease, classifier)
    return _backfill(control, lease, build_collector, analyzer)
