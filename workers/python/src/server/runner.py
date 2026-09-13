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


def run_once(
    control: ControlPlane,
    collector,
    video_id: str,
    video_title: str | None = None,
    analyzer=None,
) -> bool:
    """Claim one job and carry it to an explicit end. False means no work.

    With an analyzer, each batch is labelled before it is committed, so rows and
    the verdicts about them land in the same transaction. Without one the job is
    collection only, which is a legitimate job type and the previous behaviour.
    """
    lease = control.claim()
    if lease is None:
        return False

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
