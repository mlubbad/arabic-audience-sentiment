"""Lease arithmetic and runner control flow.

Deliberately scoped to the local spool's queue semantics rather than collector
transport or model identity, which are assigned elsewhere. A new file, so it
cannot conflict with edits to the existing worker tests.
"""
import pytest

from collectors.protocol import Batch, CollectionError, RawComment
from collectors.runner import collect
from collectors.store import LeaseLost, Store


def row(identifier="c1", video="video", text="تعليق"):
    return RawComment(identifier, video, text)


def spool(tmp_path, workspace="w", video="video"):
    store = Store(tmp_path / "s.sqlite")
    store.enqueue(workspace, video)
    return store


class Collector:
    """Yields whatever it is given, so the runner's branches can be driven."""

    source = "test"
    revision = "test"

    def __init__(self, *batches, raises=None):
        self.batches_out, self.raises = list(batches), raises
        self.calls = 0

    def batches(self, video_id, checkpoint):
        self.calls += 1
        for b in self.batches_out:
            yield b
        if self.raises:
            raise self.raises


def test_a_lease_must_have_a_bounded_duration(tmp_path):
    # An unbounded or zero lease is a fencing hole: it either never expires or
    # expires instantly, and in both cases two workers can hold the same job.
    with spool(tmp_path) as store:
        for bad in (0, -1, 301):
            with pytest.raises(ValueError, match="invalid_lease_duration"):
                store.claim("w", ttl=bad)
        lease = store.claim("w", now=100, ttl=60)
        for bad in (0, -1, 301):
            with pytest.raises(ValueError, match="invalid_lease_duration"):
                store.heartbeat(lease, now=110, ttl=bad)


def test_an_oversized_batch_is_refused_before_anything_is_written(tmp_path):
    with spool(tmp_path) as store:
        lease = store.claim("w", now=100)
        huge = Batch([row(f"c{i}") for i in range(501)], "next", "partial")
        with pytest.raises(ValueError, match="batch_too_large"):
            store.commit(lease, huge, now=101)
        # Nothing partially written, and the checkpoint did not move.
        assert store.count("w") == 0
        assert store.db.execute("select checkpoint from jobs").fetchone()[0] is None
        # The boundary itself is allowed.
        store.commit(lease, Batch([row(f"c{i}") for i in range(500)], "next", "partial"), now=102)
        assert store.count("w") == 500


def test_a_retryable_failure_requeues_and_waits_out_its_backoff(tmp_path):
    with spool(tmp_path) as store:
        lease = store.claim("w", now=100)
        store.fail(lease, "network_failure", retryable=True, now=100)
        # Requeued rather than failed, because attempts remain.
        assert store.status("w", "video") == "queued"
        # attempt is 1, so the job is held for 2 seconds. Claiming before that
        # would defeat the backoff and hammer a source that just failed.
        assert store.claim("w", now=101) is None
        resumed = store.claim("w", now=102)
        assert resumed is not None and resumed.token != lease.token


def test_attempts_are_finite_and_exhaustion_is_recorded(tmp_path):
    with spool(tmp_path) as store:
        now = 100.0
        for _ in range(3):
            lease = store.claim("w", now=now)
            assert lease is not None
            store.fail(lease, "network_failure", retryable=True, now=now)
            now += 100
        # A fourth claim finds the job spent rather than retrying for ever.
        assert store.claim("w", now=now) is None
        assert store.status("w", "video") == "failed"
        # The last real cause is kept, not overwritten with "retry_exhausted".
        # Knowing the network failed is more useful to an operator than knowing
        # we stopped trying, which the status already says.
        assert (
            store.db.execute("select error_code from jobs").fetchone()[0]
            == "network_failure"
        )


def test_a_job_abandoned_mid_run_is_eventually_marked_exhausted(tmp_path):
    # The other path to terminal: a worker that died without reporting, so the
    # job sits "running" with an expired lease and nobody ever called fail().
    with spool(tmp_path) as store:
        now = 100.0
        for _ in range(3):
            assert store.claim("w", now=now, ttl=10) is not None
            now += 100  # lease lapses; the worker never came back
        assert store.claim("w", now=now) is None
        assert store.status("w", "video") == "failed"
        assert (
            store.db.execute("select error_code from jobs").fetchone()[0]
            == "retry_exhausted"
        )


def test_an_unavailable_source_is_blocked_not_failed(tmp_path):
    with spool(tmp_path) as store:
        lease = store.claim("w", now=100)
        # "explicitly_disabled" and "unavailable" describe the source, not a
        # fault of ours, and must not read as a successful empty collection.
        store.commit(lease, Batch([], None, "explicitly_disabled"), now=101)
        assert store.status("w", "video") == "blocked"
        assert store.count("w") == 0


def test_the_runner_reports_when_there_is_nothing_to_do(tmp_path):
    with Store(tmp_path / "s.sqlite") as store:
        assert collect(store, "w", Collector()) is False


def test_the_runner_lets_a_lost_lease_surface_rather_than_failing_the_job(
    tmp_path, monkeypatch
):
    with spool(tmp_path) as store:
        def stolen(*args, **kwargs):
            raise LeaseLost("lease_lost")

        monkeypatch.setattr(store, "heartbeat", stolen)
        with pytest.raises(LeaseLost):
            collect(store, "w", Collector(Batch([row()], None, "exhausted")))
        # The job belongs to whoever holds the lease now, so this worker must
        # not record a failure on their behalf.
        assert store.status("w", "video") == "running"


def test_an_unexpected_collector_error_is_recorded_and_re_raised(tmp_path):
    with spool(tmp_path) as store:
        collector = Collector(raises=RuntimeError("boom"))
        # Recorded so the job is not left running, and re-raised so a bug is
        # never mistaken for an ordinary collection failure.
        with pytest.raises(RuntimeError):
            collect(store, "w", collector)
        assert store.status("w", "video") == "failed"
        assert (
            store.db.execute("select error_code from jobs").fetchone()[0]
            == "unexpected_collector_failure"
        )


def test_a_declared_collection_error_keeps_its_own_outcome(tmp_path):
    with spool(tmp_path) as store:
        collector = Collector(raises=CollectionError("source_access_denied", "blocked"))
        assert collect(store, "w", collector) is True
        assert store.status("w", "video") == "blocked"
        assert (
            store.db.execute("select error_code from jobs").fetchone()[0]
            == "source_access_denied"
        )
