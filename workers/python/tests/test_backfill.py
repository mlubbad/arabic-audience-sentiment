"""Walking a channel's videos as one resumable job.

The interesting behaviour is all in resumption: a backfill that restarts at the
top of the channel would still be correct — commits are idempotent — and would
still spend the entire quota proving it.
"""
import json

import httpx
import pytest

from collectors.protocol import Batch, CollectionError, RawComment
from server.gateway import ControlPlane, ControlPlaneError
from server.runner import run_backfill


def comment(cid: str, video_id: str = "v1") -> RawComment:
    return RawComment(
        id=cid, video_id=video_id, text=f"نص {cid}", parent_source="api",
        author_channel_id="a", author_name="كاتب", source="test",
    )


class Plan:
    """A collector whose pages are declared per video."""

    def __init__(self, pages: dict[str, list[Batch]]):
        self.pages, self.asked = pages, []

    def batches(self, video_id, checkpoint):
        self.asked.append((video_id, checkpoint))
        yield from self.pages.get(video_id, [])


def drive(pages, videos, checkpoint=None, access_token="ya29.ok"):
    """Run a backfill against a synthetic control plane; return what it sent."""
    sent = {"commits": [], "finish": None, "error_code": None, "video_finished": []}

    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j1", "lease_token": "t1", "type": "collect",
                "checkpoint": checkpoint,
                # None leaves the key out altogether, as a gateway that
                # predates due lists would.
                **({"videos": videos} if videos is not None else {}),
                **({"access_token": access_token} if access_token else {}),
            })
        if path == "commit-batch":
            body = json.loads(request.content)["payload"]
            sent["commits"].append(
                (body["external_video_id"], body["video_title"], body["checkpoint"])
            )
        if path == "video-finished":
            body = json.loads(request.content)
            sent["video_finished"].append((body["video_id"], body["outcome"], body["error_code"]))
        if path == "finish":
            body = json.loads(request.content)
            sent["finish"], sent["error_code"] = body["outcome"], body["error_code"]
        return httpx.Response(200, json={})

    collector = Plan(pages)
    plane = ControlPlane("https://c.invalid", "cred",
                         httpx.Client(transport=httpx.MockTransport(handler)))
    worked = run_backfill(plane, lambda token: collector)
    return worked, sent, collector


def test_walks_every_video_and_ends_exhausted():
    worked, sent, collector = drive(
        {
            "v1": [Batch([comment("c1")], None, "exhausted")],
            "v2": [Batch([comment("c2")], None, "exhausted")],
        },
        [{"video_id": "v1", "external_video_id": "v1", "title": "الأولى"},
         {"video_id": "v2", "external_video_id": "v2", "title": "الثانية"}],
    )
    assert worked is True
    assert [c[0] for c in sent["commits"]] == ["v1", "v2"]
    assert [c[1] for c in sent["commits"]] == ["الأولى", "الثانية"]
    assert sent["finish"] == "succeeded"


def test_a_finished_video_is_recorded_and_never_read_again():
    _, sent, collector = drive(
        {"v1": [Batch([comment("c1")], None, "exhausted")],
         "v2": [Batch([comment("c2")], None, "exhausted")]},
        [{"video_id": "v1", "external_video_id": "v1"},
         {"video_id": "v2", "external_video_id": "v2"}],
        checkpoint={"done": ["v1"], "video": None},
    )
    # v1 is behind us: the source is never asked about it.
    assert [v for v, _ in collector.asked] == ["v2"]
    # And the checkpoint it writes still carries v1, or a third attempt would
    # read it again.
    assert sent["commits"][0][2]["done"] == ["v1"]


def test_the_cursor_belongs_to_one_video_and_is_not_reused():
    _, _, collector = drive(
        {"v1": [Batch([comment("c1")], None, "exhausted")],
         "v2": [Batch([comment("c2")], None, "exhausted")]},
        [{"video_id": "v1", "external_video_id": "v1"},
         {"video_id": "v2", "external_video_id": "v2"}],
        checkpoint={"cursor": "page-7", "video": "v2", "done": []},
    )
    # v1 starts from nothing; only v2 continues from the held page. Handing a
    # page token to a different video asks the source to continue a sequence it
    # never issued.
    assert collector.asked == [("v1", None), ("v2", "page-7")]


def test_a_video_that_stops_early_stops_the_run_and_holds_its_place():
    _, sent, collector = drive(
        {"v1": [Batch([comment("c1")], "page-2", "partial")],
         "v2": [Batch([comment("c2")], None, "exhausted")]},
        [{"video_id": "v1", "external_video_id": "v1"},
         {"video_id": "v2", "external_video_id": "v2"}],
    )
    # The run does not skip ahead to v2: the channel has been read only as far
    # as v1's second page, and saying otherwise would claim coverage it lacks.
    assert [v for v, _ in collector.asked] == ["v1"]
    assert sent["finish"] == "partial"
    assert sent["commits"][-1][2] == {"video": "v1", "done": [], "cursor": "page-2"}


def test_a_channel_nobody_connected_is_blocked_not_failed():
    worked, sent, _ = drive(
        {}, [{"video_id": "v1", "external_video_id": "v1"}], access_token=None
    )
    assert worked is True
    assert (sent["finish"], sent["error_code"]) == ("blocked", "channel_not_connected")


def test_reports_each_exhausted_video_and_an_empty_due_list_is_a_success():
    pages = {"a": [Batch([comment("c1", "a")], None, "exhausted")]}
    worked, sent, _ = drive(pages, [{"video_id": "ua", "external_video_id": "a", "title": "أ"}])
    assert worked is True
    assert sent["video_finished"] == [("ua", "exhausted", None)]
    assert sent["finish"] == "succeeded"

    worked, sent, collector = drive({}, [])
    assert worked is True and sent["finish"] == "succeeded" and collector.asked == []


def test_a_lease_with_no_due_list_at_all_is_blocked_not_an_empty_success():
    # An explicit [] is a channel with nothing due. A lease that carries no
    # list is a gateway that never computed one; finishing that as succeeded
    # would record a collection that read nothing as a collection.
    worked, sent, collector = drive({}, None)
    assert worked is True
    assert (sent["finish"], sent["error_code"]) == ("blocked", "no_due_list")
    assert collector.asked == [] and sent["commits"] == []


def test_a_disabled_video_is_reported_and_skipped_not_the_whole_run():
    class Refusing(Plan):
        def batches(self, video_id, checkpoint):
            if video_id == "off":
                raise CollectionError("comments_disabled", "explicitly_disabled")
            yield from super().batches(video_id, checkpoint)

    sent = {"video_finished": [], "finish": None}

    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j", "lease_token": "t", "type": "collect", "checkpoint": None,
                "access_token": "tok",
                "videos": [{"video_id": "u-off", "external_video_id": "off", "title": None},
                           {"video_id": "u-on", "external_video_id": "on", "title": None}]})
        if path == "video-finished":
            b = json.loads(request.content)
            sent["video_finished"].append((b["video_id"], b["outcome"], b["error_code"]))
        if path == "finish":
            sent["finish"] = json.loads(request.content)["outcome"]
        return httpx.Response(200, json={})

    collector = Refusing({"on": [Batch([comment("c", "on")], None, "exhausted")]})
    plane = ControlPlane("https://c.invalid", "cred", httpx.Client(transport=httpx.MockTransport(handler)))
    assert run_backfill(plane, lambda token: collector) is True
    assert sent["video_finished"] == [("u-off", "blocked", "comments_disabled"), ("u-on", "exhausted", None)]
    assert sent["finish"] == "succeeded"


def test_a_plan_refusal_ends_the_job_blocked_rather_than_dropping_the_lease():
    """The night of 2026-09-15: the pilot's analysis units ran out mid-run,
    commit_batch answered 429 quota_exceeded, the runner let it escape, the
    lease lapsed, the job was reclaimed and refused again — twenty times."""
    sent = {"finish": None, "error_code": None, "commits": 0}

    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j", "lease_token": "t", "type": "collect", "checkpoint": None,
                "access_token": "tok",
                "videos": [{"video_id": "u1", "external_video_id": "v1", "title": None}]})
        if path == "commit-batch":
            sent["commits"] += 1
            return httpx.Response(429, json={"code": "quota_exceeded"})
        if path == "finish":
            body = json.loads(request.content)
            sent["finish"], sent["error_code"] = body["outcome"], body["error_code"]
        return httpx.Response(200, json={})

    collector = Plan({"v1": [Batch([comment("c1")], None, "exhausted")]})
    plane = ControlPlane("https://c.invalid", "cred",
                         httpx.Client(transport=httpx.MockTransport(handler)))
    assert run_backfill(plane, lambda token: collector) is True
    assert sent["commits"] == 1
    assert (sent["finish"], sent["error_code"]) == ("blocked", "quota_exceeded")


def test_a_transient_control_plane_failure_still_escapes():
    """A 5xx is the server's problem, not a verdict on the job: the lease is
    left to lapse and the next claim retries, as before."""
    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j", "lease_token": "t", "type": "collect", "checkpoint": None,
                "access_token": "tok",
                "videos": [{"video_id": "u1", "external_video_id": "v1", "title": None}]})
        if path == "commit-batch":
            return httpx.Response(503, json={"code": "control_plane_error"})
        return httpx.Response(200, json={})

    collector = Plan({"v1": [Batch([comment("c1")], None, "exhausted")]})
    plane = ControlPlane("https://c.invalid", "cred",
                         httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ControlPlaneError):
        run_backfill(plane, lambda token: collector)


class Counting(Plan):
    """A collector that can also answer the cheap question."""

    def __init__(self, pages, counts=None, fail=None):
        super().__init__(pages)
        self.counts, self.fail, self.count_calls = counts or {}, fail, []

    def comment_counts(self, video_ids):
        self.count_calls.append(list(video_ids))
        if self.fail is not None:
            raise self.fail
        return {v: self.counts.get(v) for v in video_ids}


def drive_counts(collector, videos, counts_response=None, counts_status=200):
    """Run a backfill whose control plane answers /worker/video-counts as told."""
    sent = {"counts": [], "commits": [], "video_finished": [], "finish": None, "error_code": None}

    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content) if request.content else {}
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j1", "lease_token": "t1", "type": "collect", "checkpoint": None,
                "access_token": "ya29.ok", "videos": videos})
        if path == "video-counts":
            sent["counts"].append(body["payload"])
            return httpx.Response(counts_status, json=counts_response if counts_response is not None else {})
        if path == "commit-batch":
            sent["commits"].append(body["payload"]["external_video_id"])
        if path == "video-finished":
            sent["video_finished"].append((body["video_id"], body["outcome"], body["error_code"]))
        if path == "finish":
            sent["finish"], sent["error_code"] = body["outcome"], body["error_code"]
        return httpx.Response(200, json={})

    plane = ControlPlane("https://c.invalid", "cred",
                         httpx.Client(transport=httpx.MockTransport(handler)))
    worked = run_backfill(plane, lambda token: collector)
    return worked, sent


THREE = [{"video_id": "u1", "external_video_id": "v1", "title": "١"},
         {"video_id": "u2", "external_video_id": "v2", "title": "٢"},
         {"video_id": "u3", "external_video_id": "v3", "title": "٣"}]
PAGES = {"v1": [Batch([comment("c1", "v1")], None, "exhausted")],
         "v2": [Batch([comment("c2", "v2")], None, "exhausted")],
         "v3": [Batch([comment("c3", "v3")], None, "exhausted")]}


def test_the_counts_are_asked_first_and_only_what_the_server_says_is_read():
    collector = Counting(PAGES, counts={"v1": 10, "v2": 21, "v3": None})
    worked, sent = drive_counts(collector, THREE,
                                counts_response={"read": ["v3", "v2"], "unchanged": 1, "updated": 3})
    assert worked is True
    # One question for all three, before any video is read.
    assert collector.count_calls == [["v1", "v2", "v3"]]
    assert sent["counts"] == [[
        {"external_video_id": "v1", "comment_count": 10},
        {"external_video_id": "v2", "comment_count": 21},
        {"external_video_id": "v3", "comment_count": None},
    ]]
    # v1 was unchanged: never asked of the source, never finished by this run.
    # The lease's order is kept, not the server's answer order.
    assert [v for v, _ in collector.asked] == ["v2", "v3"]
    assert sent["commits"] == ["v2", "v3"]
    assert sent["video_finished"] == [("u2", "exhausted", None), ("u3", "exhausted", None)]
    assert sent["finish"] == "succeeded"


def test_every_video_unchanged_is_a_run_that_read_nothing_and_succeeded():
    collector = Counting(PAGES, counts={"v1": 10, "v2": 20, "v3": 30})
    worked, sent = drive_counts(collector, THREE,
                                counts_response={"read": [], "unchanged": 3, "updated": 3})
    assert worked is True
    assert collector.asked == [] and sent["commits"] == []
    assert sent["finish"] == "succeeded"


def test_a_failed_count_lookup_falls_back_to_reading_every_due_video():
    # The optimisation degrades to the old behaviour; it never fails the job
    # and never narrows the list on its own.
    collector = Counting(PAGES, fail=CollectionError("statistics_lookup_failed", retryable=True))
    worked, sent = drive_counts(collector, THREE)
    assert worked is True
    assert sent["counts"] == []
    assert [v for v, _ in collector.asked] == ["v1", "v2", "v3"]
    assert sent["finish"] == "succeeded"


@pytest.mark.parametrize("status,body", [
    (404, {"code": "not_found"}),
    (400, {"code": "invalid_counts"}),
    (503, {"code": "control_plane_error"}),
])
def test_a_control_plane_that_cannot_take_the_counts_falls_back_too(status, body):
    # An older gateway (404), a refused payload (400) or an outage (503) on
    # the counts step: every due video is read, as before this step existed.
    collector = Counting(PAGES, counts={"v1": 10, "v2": 20, "v3": 30})
    worked, sent = drive_counts(collector, THREE, counts_response=body, counts_status=status)
    assert worked is True
    assert len(sent["counts"]) == 1
    assert [v for v, _ in collector.asked] == ["v1", "v2", "v3"]
    assert sent["finish"] == "succeeded"


def test_an_answer_without_a_read_list_is_not_an_instruction_to_read_nothing():
    collector = Counting(PAGES, counts={"v1": 10, "v2": 20, "v3": 30})
    worked, sent = drive_counts(collector, THREE, counts_response={"unchanged": 0})
    assert [v for v, _ in collector.asked] == ["v1", "v2", "v3"]
    assert sent["finish"] == "succeeded"


def test_a_collector_without_counts_reads_every_due_video_as_before():
    collector = Plan(PAGES)
    worked, sent = drive_counts(collector, THREE)
    assert sent["counts"] == []
    assert [v for v, _ in collector.asked] == ["v1", "v2", "v3"]
    assert sent["finish"] == "succeeded"


def test_an_empty_due_list_asks_no_counts():
    collector = Counting(PAGES)
    worked, sent = drive_counts(collector, [])
    assert collector.count_calls == [] and sent["counts"] == []
    assert sent["finish"] == "succeeded"


def test_a_lost_lease_on_the_counts_step_still_escapes():
    # Someone else holds the job. That is not a counts failure to fall back
    # from: reading on would write over their result.
    from server.gateway import LeaseLost

    collector = Counting(PAGES, counts={"v1": 10})
    with pytest.raises(LeaseLost):
        drive_counts(collector, THREE, counts_response={"code": "lease_lost"}, counts_status=409)
    assert collector.asked == []
