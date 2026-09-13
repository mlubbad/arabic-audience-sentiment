"""Walking a channel's videos as one resumable job.

The interesting behaviour is all in resumption: a backfill that restarts at the
top of the channel would still be correct — commits are idempotent — and would
still spend the entire quota proving it.
"""
import json

import httpx

from collectors.protocol import Batch, RawComment
from server.gateway import ControlPlane
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
    sent = {"commits": [], "finish": None, "error_code": None}

    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j1", "lease_token": "t1",
                "checkpoint": checkpoint,
                **({"access_token": access_token} if access_token else {}),
            })
        if path == "commit-batch":
            body = json.loads(request.content)["payload"]
            sent["commits"].append(
                (body["external_video_id"], body["video_title"], body["checkpoint"])
            )
        if path == "finish":
            body = json.loads(request.content)
            sent["finish"], sent["error_code"] = body["outcome"], body["error_code"]
        return httpx.Response(200, json={})

    collector = Plan(pages)
    plane = ControlPlane("https://c.invalid", "cred",
                         httpx.Client(transport=httpx.MockTransport(handler)))
    worked = run_backfill(plane, lambda token: (collector, videos))
    return worked, sent, collector


def test_walks_every_video_and_ends_exhausted():
    worked, sent, collector = drive(
        {
            "v1": [Batch([comment("c1")], None, "exhausted")],
            "v2": [Batch([comment("c2")], None, "exhausted")],
        },
        [{"video_id": "v1", "title": "الأولى"}, {"video_id": "v2", "title": "الثانية"}],
    )
    assert worked is True
    assert [c[0] for c in sent["commits"]] == ["v1", "v2"]
    assert [c[1] for c in sent["commits"]] == ["الأولى", "الثانية"]
    assert sent["finish"] == "succeeded"


def test_a_finished_video_is_recorded_and_never_read_again():
    _, sent, collector = drive(
        {"v1": [Batch([comment("c1")], None, "exhausted")],
         "v2": [Batch([comment("c2")], None, "exhausted")]},
        [{"video_id": "v1"}, {"video_id": "v2"}],
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
        [{"video_id": "v1"}, {"video_id": "v2"}],
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
        [{"video_id": "v1"}, {"video_id": "v2"}],
    )
    # The run does not skip ahead to v2: the channel has been read only as far
    # as v1's second page, and saying otherwise would claim coverage it lacks.
    assert [v for v, _ in collector.asked] == ["v1"]
    assert sent["finish"] == "partial"
    assert sent["commits"][-1][2] == {"video": "v1", "done": [], "cursor": "page-2"}


def test_a_channel_nobody_connected_is_blocked_not_failed():
    worked, sent, _ = drive({}, [{"video_id": "v1"}], access_token=None)
    assert worked is True
    assert (sent["finish"], sent["error_code"]) == ("blocked", "channel_not_connected")


def test_an_empty_plan_says_why_rather_than_reporting_success():
    sent = {}

    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j1", "lease_token": "t1", "checkpoint": None,
                "access_token": "ya29.ok",
            })
        if path == "finish":
            body = json.loads(request.content)
            sent["outcome"], sent["error_code"] = body["outcome"], body["error_code"]
        return httpx.Response(200, json={})

    plane = ControlPlane("https://c.invalid", "cred",
                         httpx.Client(transport=httpx.MockTransport(handler)))

    def plan(token):
        plan.reason = "no_upload_has_comments:12_checked_0_disabled"
        return None, []

    assert run_backfill(plane, plan) is True
    assert sent["outcome"] == "blocked"
    assert sent["error_code"] == "no_upload_has_comments:12_checked_0_disabled"
