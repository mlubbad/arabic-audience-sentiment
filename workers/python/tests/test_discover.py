"""A discover job commits the catalogue and ends honestly."""
import json

import httpx

from collectors.protocol import Catalogue, CollectionError
from server.gateway import ControlPlane
from server.runner import run_discover, run_job


class Lister:
    def __init__(self, result):
        self.result = result

    def catalogue(self):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def plane(sent, lease_type="discover", token="tok"):
    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j", "lease_token": "t", "type": lease_type, "checkpoint": None,
                "videos": [], **({"access_token": token} if token else {})})
        if path == "commit-catalogue":
            sent["catalogue"] = json.loads(request.content)["payload"]
            return httpx.Response(200, json={"videos": len(sent["catalogue"])})
        if path == "finish":
            b = json.loads(request.content)
            sent["finish"], sent["error_code"] = b["outcome"], b["error_code"]
        if path == "tick":
            sent["ticked"] = True
            return httpx.Response(200, json={"discover": 0, "collect": 0})
        return httpx.Response(200, json={})
    return ControlPlane("https://c.invalid", "cred", httpx.Client(transport=httpx.MockTransport(handler)))


def test_commits_the_catalogue_and_succeeds_when_complete():
    sent = {}
    videos = [{"external_video_id": "a" * 11, "title": "x", "kind": "video", "reported_comment_count": 3}]
    assert run_discover(plane(sent), lambda tok: Lister(Catalogue(videos, True))) is True
    assert sent["catalogue"] == videos
    assert sent["finish"] == "succeeded"


def test_an_incomplete_catalogue_is_partial():
    sent = {}
    assert run_discover(plane(sent), lambda tok: Lister(Catalogue([], False, "uploads_lookup_failed"))) is True
    assert (sent["finish"], sent["error_code"]) == ("partial", "uploads_lookup_failed")


def test_a_refusal_is_blocked_with_its_code():
    sent = {}
    run_discover(plane(sent), lambda tok: Lister(CollectionError("source_access_denied:x", "blocked")))
    assert (sent["finish"], sent["error_code"]) == ("blocked", "source_access_denied:x")


def test_no_token_is_blocked_before_any_listing():
    sent = {}
    run_discover(plane(sent, token=None), lambda tok: (_ for _ in ()).throw(AssertionError("built")))
    assert (sent["finish"], sent["error_code"]) == ("blocked", "channel_not_connected")


def test_run_job_dispatches_on_the_lease_type():
    sent = {}
    assert run_job(plane(sent), lambda tok: Lister(Catalogue([], True))) is True
    assert sent["finish"] == "succeeded" and "catalogue" in sent
