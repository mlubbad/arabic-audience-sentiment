"""The server-backed lifecycle, over a synthetic transport.

Nothing tied a collector to the control plane before this, so an interrupted
worker could not resume from the server — the M1 durability guarantee.
"""
import json

import httpx
import pytest

from collectors.protocol import Batch, CollectionError, RawComment
from server.gateway import ControlPlane, LeaseLost
from server.runner import run_once


def comment(identifier):
    return RawComment(identifier, "abcdefghijk", f"نص {identifier}", author_name="مؤلف")


class Recorder:
    """A control plane that answers from a script and records what it was told."""

    def __init__(self, checkpoint=None, fail_on=None):
        self.checkpoint, self.fail_on = checkpoint, fail_on
        self.calls, self.committed, self.finished = [], [], None

    def handler(self, request):
        path = request.url.path.rsplit("/", 1)[-1]
        self.calls.append(path)
        if path == "claim":
            if self.checkpoint is False:
                return httpx.Response(204)
            return httpx.Response(200, json={
                "job_id": "j1", "lease_token": "t1", "checkpoint": self.checkpoint,
            })
        body = json.loads(request.content)
        if path == "commit-batch":
            self.committed.append(body["payload"])
            if self.fail_on == "commit":
                return httpx.Response(429, json={"code": "quota_exceeded"})
        if path == "finish":
            self.finished = body["outcome"]
        return httpx.Response(200, json={})

    def plane(self):
        return ControlPlane(
            "https://c.invalid", "cred",
            httpx.Client(transport=httpx.MockTransport(self.handler)),
        )


class Collector:
    source = revision = "test"

    def __init__(self, *batches):
        self.batches_out, self.seen_checkpoint = list(batches), "<unset>"

    def batches(self, video_id, checkpoint):
        self.seen_checkpoint = checkpoint
        yield from self.batches_out


def test_resumes_from_the_checkpoint_the_server_is_holding():
    # The server stores {"cursor": ...}; the collector takes the bare string.
    rec = Recorder(checkpoint={"cursor": "page-2"})
    collector = Collector(Batch([comment("c1")], None, "exhausted"))
    assert run_once(rec.plane(), collector, "abcdefghijk") is True
    assert collector.seen_checkpoint == "page-2"
    assert rec.calls == ["claim", "heartbeat", "commit-batch", "finish"]
    assert rec.finished == "succeeded"


def test_a_fresh_job_starts_with_no_checkpoint():
    rec = Recorder(checkpoint=None)
    collector = Collector(Batch([comment("c1")], "next", "partial"))
    run_once(rec.plane(), collector, "abcdefghijk")
    assert collector.seen_checkpoint is None
    # The source did not end, so the run is partial rather than complete.
    assert rec.finished == "partial"


def test_no_work_is_reported_without_touching_the_collector():
    rec = Recorder(checkpoint=False)
    collector = Collector(Batch([comment("c1")], None, "exhausted"))
    assert run_once(rec.plane(), collector, "abcdefghijk") is False
    assert collector.seen_checkpoint == "<unset>"
    assert rec.calls == ["claim"]


def test_every_batch_is_committed_and_heartbeated_in_order():
    rec = Recorder()
    collector = Collector(
        Batch([comment("c1")], "p2", "partial"),
        Batch([comment("c2")], None, "exhausted"),
    )
    run_once(rec.plane(), collector, "abcdefghijk", video_title="حلقة")
    assert rec.calls == [
        "claim", "heartbeat", "commit-batch", "heartbeat", "commit-batch", "finish",
    ]
    assert [len(p["comments"]) for p in rec.committed] == [1, 1]
    assert rec.committed[0]["checkpoint"] == {"cursor": "p2"}
    assert rec.committed[0]["video_title"] == "حلقة"
    assert rec.finished == "succeeded"


def test_a_source_refusal_is_declared_as_itself_not_as_success():
    rec = Recorder()
    collector = Collector()
    collector.batches_out = []

    def raising(video_id, checkpoint):
        yield Batch([comment("c1")], "p2", "partial")
        raise CollectionError("source_access_denied", "blocked")

    collector.batches = raising
    assert run_once(rec.plane(), collector, "abcdefghijk") is True
    # The committed work stands, and the job ends blocked rather than succeeded.
    assert len(rec.committed) == 1
    assert rec.finished == "blocked"


def test_a_server_refusal_on_commit_is_not_finished_as_success():
    rec = Recorder(fail_on="commit")
    collector = Collector(Batch([comment("c1")], None, "exhausted"))
    with pytest.raises(Exception):
        run_once(rec.plane(), collector, "abcdefghijk")
    # Quota is the server's decision; the worker must not declare success.
    assert rec.finished != "succeeded"


def test_a_lost_lease_stops_the_run_rather_than_finishing_it():
    rec = Recorder()

    def steal(request):
        path = request.url.path.rsplit("/", 1)[-1]
        rec.calls.append(path)
        if path == "claim":
            return httpx.Response(200, json={"job_id": "j1", "lease_token": "t1", "checkpoint": None})
        return httpx.Response(409, json={"code": "lease_lost"})

    plane = ControlPlane("https://c.invalid", "cred", httpx.Client(transport=httpx.MockTransport(steal)))
    with pytest.raises(LeaseLost):
        run_once(plane, Collector(Batch([comment("c1")], None, "exhausted")), "abcdefghijk")
    # The job belongs to whoever holds the lease now; this worker declares nothing.
    assert "finish" not in rec.calls
