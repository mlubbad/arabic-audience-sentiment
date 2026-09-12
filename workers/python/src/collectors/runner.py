from .protocol import Collector, CollectionError
from .store import Store, LeaseLost


def collect(store: Store, workspace: str, collector: Collector):
    """One bounded job. Caller schedules future retries; exceptions never imply exhaustion."""
    lease = store.claim(workspace)
    if lease is None:
        return False
    try:
        for batch in collector.batches(lease.video, lease.checkpoint):
            store.heartbeat(lease)
            store.commit(lease, batch)
            if batch.outcome != "partial":
                return True
        store.fail(lease, "source_ended_without_completion", "partial")
    except CollectionError as exc:
        status = exc.outcome if exc.outcome in ("blocked", "partial", "failed") else "blocked"
        store.fail(lease, exc.code, status, exc.retryable)
    except LeaseLost:
        raise
    except Exception:
        store.fail(lease, "unexpected_collector_failure", "failed")
        raise
    return True
