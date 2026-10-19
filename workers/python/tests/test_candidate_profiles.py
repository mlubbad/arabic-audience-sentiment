"""Candidate profile batch collection and the worker wire envelope."""

import json
from pathlib import Path

import httpx

from collectors.protocol import Catalogue, CollectionError
from collectors.youtube_api import YouTubeAPI
from server.gateway import ControlPlane
from server.runner import run_discover

CHANNEL = f"UC{'x' * 22}"
CANDIDATE = f"UC{'c' * 22}"
GOLDEN = Path(__file__).parent / "fixtures" / "golden_candidates.json"


def test_one_bounded_profile_request_builds_the_strict_wire_fixture():
    calls = []

    def source(request):
        calls.append(dict(request.url.params))
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": CANDIDATE,
                        "snippet": {"country": "TR", "defaultLanguage": "ar", "description": "drop"},
                        "statistics": {"subscriberCount": "12", "viewCount": "44", "videoCount": "3"},
                        "topicDetails": {"topicCategories": ["topic"]},
                    }
                ]
            },
        )

    api = YouTubeAPI("key", httpx.Client(transport=httpx.MockTransport(source)))
    ids = [CANDIDATE] + [f"UC{i:022d}" for i in range(49)]
    profiles = api.channel_profiles(ids)
    assert len(calls) == 1
    assert {key: calls[0][key] for key in ("part", "id")} == {
        "part": "snippet,statistics,topicDetails",
        "id": ",".join(ids),
    }
    assert profiles == [
        {
            "external_channel_id": CANDIDATE,
            "subscriber_count": 12,
            "view_count": 44,
            "video_count": 3,
            "country": "TR",
            "default_language": "ar",
            "topic_categories": ["topic"],
            "subscriber_count_hidden": None,
        }
    ]

    captured = {}

    def gateway(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"updated": 1})

    control = ControlPlane(
        "https://control.invalid", "cred", httpx.Client(transport=httpx.MockTransport(gateway))
    )
    control.commit_candidate_profiles(
        {
            "job_id": "20000000-0000-4000-8000-000000000001",
            "lease_token": "30000000-0000-4000-8000-000000000001",
        },
        profiles,
    )
    GOLDEN.write_text(
        json.dumps(captured, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


class CandidateLister:
    def catalogue(self, channel_id=None):
        return Catalogue([], True, channel={"external_channel_id": CHANNEL})

    def featured_channels(self, channel_id):
        return []

    def channel_profiles(self, ids):
        return [{"external_channel_id": CANDIDATE, "subscriber_count": 1}]


def discover_control(sent, due, failure=None):
    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(
                200,
                json={
                    "job_id": "j",
                    "lease_token": "t",
                    "type": "discover",
                    "access_token": "tok",
                    "platform": "youtube",
                },
            )
        if path == "featured-due":
            return httpx.Response(200, json={"due": False})
        if path == "candidates-due":
            if failure == "due":
                return httpx.Response(500, json={"code": "source_unavailable"})
            return httpx.Response(200, json=due)
        if path == "commit-candidate-profiles":
            if failure == "commit":
                return httpx.Response(400, json={"code": "invalid_candidate_profiles"})
            sent["profiles"] = json.loads(request.content)["profiles"]
        if path == "finish":
            body = json.loads(request.content)
            sent["finish"] = (body["outcome"], body["error_code"])
        return httpx.Response(200, json={})

    return ControlPlane(
        "https://control.invalid", "cred", httpx.Client(transport=httpx.MockTransport(handler))
    )


def test_discover_skips_fetch_when_no_candidates_are_due():
    sent = {}

    class NoFetch(CandidateLister):
        def channel_profiles(self, ids):
            raise AssertionError("unexpected channels.list")

    run_discover(discover_control(sent, []), lambda *a, **k: NoFetch())
    assert "profiles" not in sent and sent["finish"] == ("succeeded", None)


def test_discover_commits_deleted_ids_as_unknown_and_failures_as_partial():
    sent = {}
    run_discover(discover_control(sent, [CANDIDATE, f"UC{'d' * 22}"]), lambda *a, **k: CandidateLister())
    assert sent["profiles"] == [
        {"external_channel_id": CANDIDATE, "subscriber_count": 1},
        {
            "external_channel_id": f"UC{'d' * 22}",
            "subscriber_count": None,
            "view_count": None,
            "video_count": None,
        },
    ]
    assert sent["finish"] == ("succeeded", None)
    for failure in ("due", "commit"):
        failed = {}
        run_discover(discover_control(failed, [CANDIDATE], failure), lambda *a, **k: CandidateLister())
        assert failed["finish"] == ("partial", "candidate_profiles_failed")

    class FetchFailure(CandidateLister):
        def channel_profiles(self, ids):
            raise CollectionError("source_unavailable")

    failed = {}
    run_discover(discover_control(failed, [CANDIDATE]), lambda *a, **k: FetchFailure())
    assert failed["finish"] == ("partial", "candidate_profiles_failed")
