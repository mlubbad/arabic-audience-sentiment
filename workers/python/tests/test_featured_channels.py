"""Featured-channel discovery, with every YouTube and gateway call mocked."""
import json
from pathlib import Path

import httpx

from collectors.protocol import Catalogue, CollectionError
from collectors.youtube_api import YouTubeAPI
from server.gateway import ControlPlane
from server.runner import run_discover


CHANNEL = f"UC{'x' * 22}"
GOLDEN = Path(__file__).parent / "fixtures" / "golden_featured.json"


def youtube(featured: list[str], snippets: dict[str, dict] | None = None):
    calls = []

    def handler(request):
        calls.append((request.url.path, dict(request.url.params)))
        if request.url.path.endswith("/channelSections"):
            return httpx.Response(200, json={"items": [
                {"contentDetails": {"channels": featured}}
            ]})
        if request.url.path.endswith("/channels"):
            ids = request.url.params["id"].split(",")
            return httpx.Response(200, json={"items": [
                {"id": channel_id, "snippet": (snippets or {}).get(channel_id, {})}
                for channel_id in ids
            ]})
        raise AssertionError(f"unexpected request: {request.url.path}")

    api = YouTubeAPI("key", httpx.Client(transport=httpx.MockTransport(handler)))
    return api, calls


def test_deduplicates_drops_self_and_writes_the_real_gateway_envelope():
    a, b = f"UC{'a' * 22}", f"UC{'b' * 22}"
    api, calls = youtube(
        [a, CHANNEL, a, b],
        {a: {"title": "ألف", "customUrl": "@a"}, b: {}},
    )
    candidates = api.featured_channels(CHANNEL)
    assert candidates == [
        {"candidate_external_id": a, "title": "ألف", "handle": "@a"},
        {"candidate_external_id": b, "title": None, "handle": None},
    ]
    assert len(calls) == 2

    captured = {}

    def gateway(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"replayed": False, "stored": 2})

    plane = ControlPlane(
        "https://control.invalid",
        "credential",
        httpx.Client(transport=httpx.MockTransport(gateway)),
    )
    plane.commit_featured(
        {
            "job_id": "20000000-0000-4000-8000-000000000001",
            "lease_token": "30000000-0000-4000-8000-000000000001",
        },
        candidates,
    )
    GOLDEN.write_text(
        json.dumps(captured, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def test_batches_51_to_100_ids_into_two_snippet_calls():
    ids = [f"UC{i:022d}" for i in range(51)]
    api, calls = youtube(ids)
    assert len(api.featured_channels(CHANNEL)) == 51
    assert len(calls) == 3
    assert [len(query["id"].split(",")) for path, query in calls if path.endswith("/channels")] == [50, 1]


class Lister:
    def __init__(self, failure: Exception | None = None):
        self.failure = failure
        self.featured_calls = 0

    def catalogue(self, channel_id=None):
        return Catalogue([], True, channel={"external_channel_id": CHANNEL})

    def featured_channels(self, channel_id):
        self.featured_calls += 1
        if self.failure:
            raise self.failure
        return []


def discover_plane(
    sent: dict,
    due: bool,
    commit_failure: bool = False,
    due_failure: bool = False,
):
    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j", "lease_token": "t", "type": "discover",
                "checkpoint": None, "access_token": "tok", "platform": "youtube",
            })
        if path == "featured-due":
            if due_failure:
                return httpx.Response(500, json={"code": "source_unavailable"})
            return httpx.Response(200, json={"due": due})
        if path == "commit-featured" and commit_failure:
            return httpx.Response(500, json={"code": "source_unavailable"})
        if path == "commit-featured":
            sent["featured"] = json.loads(request.content)["candidates"]
        if path == "finish":
            body = json.loads(request.content)
            sent["finish"] = (body["outcome"], body["error_code"])
        return httpx.Response(200, json={})

    return ControlPlane(
        "https://control.invalid", "credential",
        httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_runner_makes_no_featured_request_when_not_due():
    sent, lister = {}, Lister()
    run_discover(discover_plane(sent, False), lambda *args, **kwargs: lister)
    assert lister.featured_calls == 0
    assert sent["finish"] == ("succeeded", None)


def test_runner_reports_fetch_or_commit_failure_as_partial():
    for lister, commit_failure, due_failure in [
        (Lister(CollectionError("source_unavailable", retryable=True)), False, False),
        (Lister(), True, False),
        (Lister(), False, True),
    ]:
        sent = {}
        run_discover(
            discover_plane(sent, True, commit_failure, due_failure),
            lambda *args, _lister=lister, **kwargs: _lister,
        )
        assert sent["finish"] == ("partial", "featured_channels_failed")
