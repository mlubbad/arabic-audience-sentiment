"""A public channel is collected by id with the project's API key.

The OAuth path infers the channel from the grant; the public path has no
grant and must be told which channel a job is for. These tests pin the two
things that make that safe: an id-carrying catalogue reads with the key and
records public provenance, and a lease that names a public channel but meets
a worker without a key ends blocked with the code that names the gap.
"""
import json

import httpx
import pytest

from collectors.protocol import Batch, Catalogue, CollectionError
from collectors.youtube_api import YouTubeAPI
from server.gateway import ControlPlane
from server.loop import build_collector
from server.runner import run_backfill, run_discover

CHANNEL_ID = "UCTPIL6f7yNpK8yc-H3cEtFg"


def _youtube_handler(seen):
    """The four calls one public catalogue costs, recorded."""
    def handler(request):
        seen.append(request)
        path = request.url.path
        if path.endswith("/channels"):
            return httpx.Response(200, json={"items": [{
                "contentDetails": {"relatedPlaylists": {"uploads": "UUbase123"}}}]})
        if path.endswith("/playlistItems"):
            return httpx.Response(200, json={"items": [
                {"contentDetails": {"videoId": "abcdefghijk"}}]})
        if path.endswith("/videos"):
            return httpx.Response(200, json={"items": [{
                "id": "abcdefghijk",
                "snippet": {"title": "t", "publishedAt": "2026-09-01T00:00:00Z"},
                "statistics": {"commentCount": "5"},
                "contentDetails": {"duration": "PT1M"}}]})
        return httpx.Response(404)
    return handler


def test_catalogue_by_id_reads_with_the_key_and_records_public_provenance():
    seen = []
    with httpx.Client(transport=httpx.MockTransport(_youtube_handler(seen))) as client:
        adapter = YouTubeAPI("fixture-key", client)
        result = adapter.catalogue(channel_id=CHANNEL_ID)
    # The channel is named in the request, and the credential is the key:
    # this adapter has no grant to infer the channel from.
    assert seen[0].url.params.get("id") == CHANNEL_ID
    assert seen[0].url.params.get("key") == "fixture-key"
    assert "authorization" not in seen[0].headers
    assert [v["external_video_id"] for v in result.videos] == ["abcdefghijk"]
    assert result.videos[0]["field_provenance"]["source"] == "youtube_data_api_public"
    assert result.complete is True


def test_catalogue_by_id_refuses_an_id_it_would_not_read():
    with httpx.Client() as client:
        with pytest.raises(ValueError):
            YouTubeAPI("fixture-key", client).catalogue(channel_id="not-an-id")


def test_catalogue_by_id_is_not_the_oauth_path():
    # A token is bound to the channel its grant names; taking an id on that
    # path would read a channel the token was never granted for.
    with httpx.Client() as client:
        with pytest.raises(ValueError):
            YouTubeAPI(None, client, access_token="tok").catalogue(channel_id=CHANNEL_ID)


def test_an_id_that_names_no_channel_is_blocked_not_empty():
    with httpx.Client(transport=httpx.MockTransport(
            lambda r: httpx.Response(200, json={"items": []}))) as client:
        with pytest.raises(CollectionError) as e:
            YouTubeAPI("fixture-key", client).catalogue(channel_id=CHANNEL_ID)
        assert (e.value.code, e.value.outcome) == ("channel_not_found", "blocked")


class Lister:
    def __init__(self):
        self.asked = []

    def catalogue(self, channel_id=None):
        self.asked.append(channel_id)
        return Catalogue([{
            "external_video_id": "abcdefghijk", "title": "t", "kind": "video",
            "reported_comment_count": 3}], True)

    def batches(self, video_id, checkpoint=None):
        # One empty read is enough for the run to finish its single due video.
        yield Batch([], None, "exhausted")


def plane(sent, token=None, external=None):
    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json={
                "job_id": "j", "lease_token": "t", "type": "discover",
                "checkpoint": None, "videos": [],
                **({"access_token": token} if token else {}),
                **({"external_channel_id": external} if external else {})})
        if path == "commit-catalogue":
            sent["catalogue"] = json.loads(request.content)["payload"]
            return httpx.Response(200, json={"videos": len(sent["catalogue"])})
        if path == "commit-batch":
            sent["batch"] = json.loads(request.content)["payload"]
            return httpx.Response(200, json={})
        if path == "finish":
            b = json.loads(request.content)
            sent["finish"], sent["error_code"] = b["outcome"], b["error_code"]
        return httpx.Response(200, json={})
    return ControlPlane("https://c.invalid", "cred",
                        httpx.Client(transport=httpx.MockTransport(handler)))


def test_a_public_discover_job_lists_by_id():
    sent, lister = {}, Lister()
    assert run_discover(
        plane(sent, external=CHANNEL_ID),
        lambda tok, expires_at=None, renew=None, channel_id=None:
        lister if channel_id else None,
    ) is True
    assert lister.asked == [CHANNEL_ID]
    assert sent["finish"] == "succeeded"


def test_a_public_discover_job_without_a_key_names_the_gap():
    sent = {}
    run_discover(
        plane(sent, external=CHANNEL_ID),
        lambda tok, expires_at=None, renew=None, channel_id=None: None,
    )
    assert (sent["finish"], sent["error_code"]) == (
        "blocked", "public_collection_not_configured")


def test_a_lease_without_token_or_id_stays_channel_not_connected():
    sent = {}
    run_discover(
        plane(sent),
        lambda tok, expires_at=None, renew=None, channel_id=None:
        (_ for _ in ()).throw(AssertionError("built")),
    )
    assert (sent["finish"], sent["error_code"]) == (
        "blocked", "channel_not_connected")


def test_a_public_collect_job_reads_the_due_list():
    sent, lister = {}, Lister()
    control = plane(sent, external=CHANNEL_ID)
    original_claim = control.claim

    def claim(job_types=None):
        lease = original_claim(job_types)
        if lease is not None:
            lease["videos"] = [{"external_video_id": "abcdefghijk",
                                "video_id": "v-1", "title": "t"}]
        return lease

    control.claim = claim  # type: ignore[method-assign]
    assert run_backfill(
        control,
        lambda tok, expires_at=None, renew=None, channel_id=None:
        lister if channel_id else None,
    ) is True
    # A collect job never lists the channel — the due list came on the lease —
    # so what this pins is that the public lease got a collector built by id
    # and carried its single due video to an explicit, successful end.
    assert lister.asked == []
    assert sent["finish"] == "succeeded"


def test_the_loop_builds_a_public_collector_only_with_a_key():
    with httpx.Client() as client:
        build = build_collector(client)
        assert build(None, None, None, channel_id=CHANNEL_ID) is None
        # A token never needed the key, and still does not.
        assert build("tok").source == "youtube_oauth"
        keyed = build_collector(client, "fixture-key")
        collector = keyed(None, None, None, channel_id=CHANNEL_ID)
        assert collector.source == "youtube_data_api_public"
