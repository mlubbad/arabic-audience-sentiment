import pytest
from collectors.store import Store, LeaseLost
from collectors.protocol import Batch, CollectionError, RawComment
from collectors.runner import collect
from sentiment.protocol import Prediction


def row(identifier="c1", text="تعليق اصطناعي"):
    return RawComment(identifier, "video", text, parent_id=None, is_reply=False)


def test_restart_replay_and_changed_text(tmp_path):
    path = tmp_path / "spool.sqlite"
    with Store(path) as store:
        store.enqueue("workspace", "video")
        lease = store.claim("workspace", now=100, ttl=10)
        store.commit(lease, Batch([row()], "next", "partial"), now=101)
    with Store(path) as store:
        resumed = store.claim("workspace", now=111, ttl=10)
        assert resumed.checkpoint == "next"
        store.commit(resumed, Batch([row()], "next", "partial"), now=112)
        assert store.count("workspace") == 1
        store.commit(resumed, Batch([row(text="نص تغير")], None, "exhausted"), now=113)
        assert store.count("workspace") == 1
        assert store.version_count() == 2
        assert store.status("workspace", "video") == "succeeded"


def test_leases_are_exclusive_scoped_and_fenced(tmp_path):
    with Store(tmp_path / "s.sqlite") as s:
        s.enqueue("a", "video")
        assert s.claim("b", now=1) is None
        old = s.claim("a", now=1, ttl=5)
        assert s.claim("a", now=2) is None
        fresh = s.claim("a", now=6)
        with pytest.raises(LeaseLost):
            s.commit(old, Batch([row()], None, "exhausted"), now=7)
        with pytest.raises(ValueError):
            s.commit(fresh, Batch([RawComment("x", "other", "x")], None, "exhausted"), now=7)
        assert s.count("a") == 0


def test_interruption_keeps_committed_batch_and_error_not_empty_success(tmp_path):
    class Broken:
        source = "sanitized_fixture"
        revision = "test-v1"
        def batches(self, video_id, checkpoint):
            yield Batch([row()], "next", "partial")
            raise CollectionError("rate_limited", "blocked", retryable=False)
    with Store(tmp_path / "s.sqlite") as s:
        s.enqueue("a", "video")
        collect(s, "a", Broken())
        assert s.count("a") == 1
        assert s.status("a", "video") == "blocked"


def test_silent_generator_end_is_partial_not_success(tmp_path):
    class Truncated:
        source = "sanitized_fixture"
        revision = "test-v1"
        def batches(self, video_id, checkpoint):
            yield Batch([row()], "next", "partial")
    with Store(tmp_path / "s.sqlite") as s:
        s.enqueue("a", "video")
        collect(s, "a", Truncated())
        assert s.status("a", "video") == "partial"


def test_retry_limit(tmp_path):
    with Store(tmp_path / "s.sqlite") as s:
        s.enqueue("a", "video")
        for now in [1, 20, 50]:
            lease = s.claim("a", now=now, ttl=1)
            assert lease is not None
        assert s.claim("a", now=100) is None
        assert s.status("a", "video") == "failed"


def test_prediction_failures_cannot_be_neutral():
    with pytest.raises(ValueError):
        Prediction(status="failed", label="neutral", scores={}, model_id="test", revision="test")
    assert Prediction(status="skipped", label=None, scores={}, model_id="test", revision="test").label is None


def test_two_connections_compete_atomically(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    path = tmp_path / "s.sqlite"
    with Store(path) as s:
        s.enqueue("a", "video")
    def claim():
        with Store(path) as s:
            return s.claim("a", now=1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(lambda _: claim(), range(2)))
    assert sum(c is not None for c in claims) == 1


def test_batch_rolls_back_rows_and_checkpoint_on_invalid_scope(tmp_path):
    with Store(tmp_path / "s.sqlite") as s:
        s.enqueue("a", "video")
        lease = s.claim("a", now=1)
        with pytest.raises(ValueError):
            s.commit(lease, Batch([row(), RawComment("bad", "other", "x")], "bad-page", "partial"), now=2)
        assert s.count("a") == 0
        assert s.db.execute("select checkpoint from jobs").fetchone()[0] is None
