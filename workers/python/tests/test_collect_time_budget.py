"""A collect stands down at its time budget so an overdue discover can run.

Production, 2026-10-19/20 (read-only): the single Oracle worker sat in one
collect from 22:39 to 01:54 UTC, and that run ended only because a commit hit
57014. 94 refresh discovers, overdue from 01:16-01:24, waited 31-44 minutes
behind it; their candidate-profile pass (WO-25) filled nothing until 01:55.
Nothing in the runner bounded a run's length except checkpoint `max_items`.

The budget is checked between batches, never inside one: the run commits the
batch it has, then finishes `partial` with `time_budget`, and the checkpoint
that commit wrote is the one the next claim resumes from. A yield is never a
success.
"""
import json

import httpx

from collectors.protocol import Batch, RawComment
from server.gateway import ControlPlane
from server.runner import run_backfill, run_job


def comment(cid: str, video_id: str) -> RawComment:
    return RawComment(
        id=cid, video_id=video_id, text=f"نص {cid}", parent_source="api",
        author_channel_id="a", author_name="كاتب", source="test",
    )


class Clock:
    """Monotonic time the collector moves forward as it reads."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class Paced:
    """Pages declared per video; each page read costs `minutes` of clock."""

    def __init__(self, pages, clock, minutes):
        self.pages, self.clock, self.minutes, self.asked = pages, clock, minutes, []

    def batches(self, video_id, checkpoint, since=None, **kwargs):
        self.asked.append((video_id, checkpoint))
        pages = self.pages.get(video_id, [])
        # Continue after the page whose cursor was handed back, as a source does.
        start = 0
        if checkpoint is not None:
            start = next(i for i, b in enumerate(pages) if b.checkpoint == checkpoint) + 1
        for batch in pages[start:]:
            self.clock.now += self.minutes * 60
            yield batch


class Server:
    """The parts of the control plane a collect's resumption depends on.

    One collect job. Its checkpoint is what the last commit wrote; a video
    reported exhausted leaves the due list (next_check_at moves forward); a
    finish other than a final one puts the job back in the queue.
    """

    def __init__(self, videos):
        self.videos = list(videos)
        self.checkpoint = None
        self.status = "queued"
        self.commits, self.finishes, self.video_finished = [], [], []

    def handler(self, request):
        path = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content) if request.content else {}
        if path == "claim":
            if self.status != "queued":
                return httpx.Response(204)
            self.status = "running"
            return httpx.Response(200, json={
                "job_id": "j1", "lease_token": "t1", "type": "collect",
                "checkpoint": self.checkpoint, "access_token": "ya29.ok",
                "videos": [dict(v) for v in self.videos],
            })
        if path == "commit-batch":
            payload = body["payload"]
            self.checkpoint = payload["checkpoint"]
            self.commits.append((payload["external_video_id"], payload["checkpoint"],
                                 [c["external_comment_id"] for c in payload["comments"]]))
        if path == "video-finished":
            self.video_finished.append((body["video_id"], body["outcome"], body["error_code"]))
            if body["outcome"] == "exhausted":
                self.videos = [v for v in self.videos if v["video_id"] != body["video_id"]]
        if path == "finish":
            self.finishes.append((body["outcome"], body["error_code"]))
            self.status = "queued" if body["outcome"] == "partial" else body["outcome"]
        return httpx.Response(200, json={})

    def plane(self):
        return ControlPlane("https://c.invalid", "cred",
                            httpx.Client(transport=httpx.MockTransport(self.handler)))


VIDEOS = [{"video_id": "u1", "external_video_id": "v1", "title": "الأولى"},
          {"video_id": "u2", "external_video_id": "v2", "title": "الثانية"}]


def build(collector):
    return lambda token, expires_at=None, renew=None: collector


def test_a_collect_over_budget_yields_partial_with_its_checkpoint_intact():
    clock = Clock()
    pages = {"v1": [Batch([comment("c1", "v1")], "page-2", "partial"),
                    Batch([comment("c2", "v1")], "page-3", "partial"),
                    Batch([comment("c3", "v1")], None, "exhausted")]}
    collector = Paced(pages, clock, minutes=20)
    server = Server(VIDEOS[:1])

    assert run_backfill(server.plane(), build(collector), budget_seconds=30 * 60,
                        clock=clock) is True

    # 20 minutes in, under budget: read on. 40 minutes in, over it: the page in
    # hand is committed and the run stands down; the third page is not read.
    assert [c[2] for c in server.commits] == [["c1"], ["c2"]]
    assert server.finishes == [("partial", "time_budget")]
    # The checkpoint names the video and the page after the last one stored.
    assert server.checkpoint == {"video": "v1", "done": [], "cursor": "page-3"}
    # The video is reported unfinished, so it stays due.
    assert server.video_finished == [("u1", "partial", None)]


def test_the_next_claim_resumes_the_yielded_collect_where_it_stood():
    clock = Clock()
    pages = {"v1": [Batch([comment("c1", "v1")], "page-2", "partial"),
                    Batch([comment("c2", "v1")], "page-3", "partial"),
                    Batch([comment("c3", "v1")], None, "exhausted")]}
    collector = Paced(pages, clock, minutes=20)
    server = Server(VIDEOS[:1])

    run_backfill(server.plane(), build(collector), budget_seconds=30 * 60, clock=clock)
    assert run_backfill(server.plane(), build(collector), budget_seconds=30 * 60,
                        clock=clock) is True

    # The second run continues from the held page, reads only what is left,
    # and only then is the job a success.
    assert collector.asked == [("v1", None), ("v1", "page-3")]
    assert [c[2] for c in server.commits] == [["c1"], ["c2"], ["c3"]]
    assert server.finishes == [("partial", "time_budget"), ("succeeded", None)]


def test_a_collect_over_budget_between_videos_yields_before_the_next_one():
    # Videos that each fit in one page never leave a partial batch to stop at.
    clock = Clock()
    pages = {"v1": [Batch([comment("c1", "v1")], None, "exhausted")],
             "v2": [Batch([comment("c2", "v2")], None, "exhausted")]}
    collector = Paced(pages, clock, minutes=40)
    server = Server(VIDEOS)

    run_backfill(server.plane(), build(collector), budget_seconds=30 * 60, clock=clock)
    assert collector.asked == [("v1", None)]
    assert server.video_finished == [("u1", "exhausted", None)]
    assert server.finishes == [("partial", "time_budget")]

    # Resumed: v1 has left the due list, v2 is read, the job succeeds.
    run_backfill(server.plane(), build(collector), budget_seconds=30 * 60, clock=clock)
    assert collector.asked == [("v1", None), ("v2", None)]
    assert server.finishes == [("partial", "time_budget"), ("succeeded", None)]


def test_a_run_that_reads_everything_past_its_budget_is_a_success_not_a_yield():
    # The budget ran out on the last page there was. Standing down then would
    # record a partial run, and a reclaim, for nothing left to read.
    clock = Clock()
    pages = {"v1": [Batch([comment("c1", "v1")], "page-2", "partial"),
                    Batch([comment("c2", "v1")], None, "exhausted")]}
    collector = Paced(pages, clock, minutes=20)
    server = Server(VIDEOS[:1])

    run_backfill(server.plane(), build(collector), budget_seconds=30 * 60, clock=clock)
    assert server.finishes == [("succeeded", None)]


def test_a_collect_under_budget_runs_to_the_end():
    clock = Clock()
    pages = {"v1": [Batch([comment("c1", "v1")], "page-2", "partial"),
                    Batch([comment("c2", "v1")], None, "exhausted")],
             "v2": [Batch([comment("c3", "v2")], None, "exhausted")]}
    collector = Paced(pages, clock, minutes=5)
    server = Server(VIDEOS)

    run_backfill(server.plane(), build(collector), budget_seconds=30 * 60, clock=clock)
    assert [v for v, _ in collector.asked] == ["v1", "v2"]
    assert server.finishes == [("succeeded", None)]


def test_the_worker_loop_runs_collects_under_a_thirty_minute_budget():
    # run_job is what serve() calls. The default is the budget, not unlimited.
    def run_for(minutes):
        clock = Clock()
        pages = {"v1": [Batch([comment("c1", "v1")], "page-2", "partial"),
                        Batch([comment("c2", "v1")], None, "exhausted")]}
        server = Server(VIDEOS[:1])
        run_job(server.plane(), build(Paced(pages, clock, minutes)), clock=clock)
        return server.finishes

    assert run_for(29) == [("succeeded", None)]
    assert run_for(31) == [("partial", "time_budget")]
