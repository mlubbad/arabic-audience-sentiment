"""InstagramCollector: Graph for the owner's account, scrapers for a public one."""

import json
import httpx
import pytest
from collectors.instagram_collector import InstagramCollector
from collectors.protocol import CollectionError
from collectors.scrapers.apify import ApifyClient
from collectors.scrapers.brightdata import BrightDataClient


def test_instagram_handle_refuses_post_links():
    clean = InstagramCollector._clean_handle
    assert clean("https://www.instagram.com/natgeo/") == "natgeo"
    assert clean("instagram.com/natgeo/reels/?hl=ar") == "natgeo"
    assert clean("@nat.geo_1") == "nat.geo_1"
    for bad in ("https://www.instagram.com/p/DLNsnpUTdVS/", "instagram.com/reel/abc", "explore/tags/x", "", "a b"):
        with pytest.raises(ValueError, match="invalid_channel_id"):
            clean(bad)
    media = InstagramCollector._clean_media_id
    assert media("17900001") == "17900001"
    assert media("https://www.instagram.com/p/DLNsnpUTdVS/") == "DLNsnpUTdVS"
    with pytest.raises(ValueError, match="invalid_video_id"):
        media("x")


def test_instagram_fixture_catalogue_and_batches():
    fixture = {
        "media": [
            {"id": "90001", "caption": "ريل", "media_type": "VIDEO", "media_product_type": "REELS",
             "timestamp": "2026-09-20T12:00:00+0000", "comments_count": 1}
        ],
        "comments": {"90001": [{"id": "c1", "text": "رائع", "timestamp": "2026-09-20T12:10:00+0000", "like_count": 2}]},
    }
    c = InstagramCollector(channel_id="natgeo", fixture_data=fixture)
    cat = c.catalogue()
    assert cat.videos[0]["kind"] == "short" and cat.videos[0]["reported_comment_count"] == 1
    batches = list(c.batches("90001"))
    assert batches[0].outcome == "exhausted" and batches[0].comments[0].platform == "instagram"


def _graph_handler(media_pages: list, comment_pages: list):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("authorization") == "Bearer ig-token"
        assert request.url.host == "graph.instagram.com"
        path = request.url.path
        if path.endswith("/me"):
            return httpx.Response(200, json={"user_id": "17841400000", "username": "natgeo", "name": "Nat Geo"})
        if path.endswith("/me/media"):
            return httpx.Response(200, json=media_pages[1 if request.url.params.get("after") == "m2" else 0])
        if path.endswith("/comments"):
            return httpx.Response(200, json=comment_pages[1 if request.url.params.get("after") == "k2" else 0])
        return httpx.Response(404, json={"error": {"code": 803}})

    return handler


def test_instagram_graph_catalogue_pages_and_replies_are_flattened():
    media_pages = [
        {
            "data": [
                {"id": "10001", "caption": "صورة", "media_type": "IMAGE", "timestamp": "2026-09-21T08:00:00+0000",
                 "permalink": "https://www.instagram.com/p/AAA/", "media_url": "https://cdn.example.com/1.jpg",
                 "comments_count": 3},
                {"id": "10002", "media_type": "VIDEO", "media_product_type": "REELS", "thumbnail_url": "https://cdn.example.com/2.jpg"},
            ],
            "paging": {"cursors": {"after": "m2"}, "next": "https://graph.instagram.com/next"},
        },
        {"data": [{"id": "10003", "media_type": "VIDEO", "media_product_type": "FEED"}], "paging": {"cursors": {"after": "m3"}}},
    ]
    comment_pages = [
        {
            "data": [
                {
                    "id": "c1", "text": "جميل", "timestamp": "2026-09-21T09:00:00+0000", "username": "huda", "like_count": 4,
                    "replies": {"data": [{"id": "r1", "text": "شكرًا", "timestamp": "2026-09-21T09:01:00+0000", "username": "natgeo"}]},
                }
            ],
            "paging": {"cursors": {"after": "k2"}, "next": "https://graph.instagram.com/next"},
        },
        {"data": [{"id": "c2", "text": "ثاني", "username": "ali"}], "paging": {"cursors": {"after": "k3"}}},
    ]
    c = InstagramCollector(
        client=httpx.Client(transport=httpx.MockTransport(_graph_handler(media_pages, comment_pages))),
        access_token="ig-token",
    )
    cat = c.catalogue()
    assert cat.complete is True
    assert [(v["external_video_id"], v["kind"]) for v in cat.videos] == [("10001", "channel_post"), ("10002", "short"), ("10003", "video")]
    assert cat.videos[0]["thumbnail_url"] == "https://cdn.example.com/1.jpg"
    assert cat.videos[1]["thumbnail_url"] == "https://cdn.example.com/2.jpg"
    assert cat.videos[1]["published_at"] is None and cat.videos[1]["reported_comment_count"] is None
    assert cat.videos[0]["field_provenance"]["source"] == "instagram_graph_api"

    batches = list(c.batches("10001"))
    assert [b.outcome for b in batches] == ["partial", "exhausted"]
    assert batches[0].checkpoint == "k2" and batches[1].checkpoint is None
    first = batches[0].comments
    assert [(x.id, x.is_reply, x.parent_id) for x in first] == [("c1", False, None), ("r1", True, "c1")]
    assert first[0].author_name == "huda" and first[0].likes_value == 4 and first[0].source == "instagram_graph_api"
    assert first[1].parent_source == "instagram_reply" and first[1].likes_value is None
    assert batches[1].comments[0].published_at is None and batches[1].comments[0].timestamp_precision == "unknown"


def test_instagram_graph_190_is_blocked_invalid_credentials():
    handler = lambda r: httpx.Response(400, json={"error": {"code": 190, "message": "expired"}})  # noqa: E731
    c = InstagramCollector(client=httpx.Client(transport=httpx.MockTransport(handler)), access_token="ig-token")
    with pytest.raises(CollectionError) as exc:
        c.catalogue()
    assert (exc.value.code, exc.value.outcome) == ("invalid_credentials", "blocked")
    with pytest.raises(CollectionError) as exc:
        list(c.batches("10001"))
    assert exc.value.code == "invalid_credentials"


def test_instagram_public_cascade_prefers_configured_scraper():
    calls = []

    def apify_handler(request: httpx.Request) -> httpx.Response:
        calls.append("apify")
        body = json.loads(request.content.decode())
        if "directUrls" in body:
            return httpx.Response(200, json=[{"id": "ac1", "text": "واو", "ownerUsername": "x", "likesCount": 1}])
        return httpx.Response(200, json=[{"shortCode": "DLN1x", "type": "Image", "caption": "صورة"}])

    def bd_handler(request: httpx.Request) -> httpx.Response:
        calls.append("brightdata")
        return httpx.Response(200, json=[])

    c = InstagramCollector(
        channel_id="natgeo",
        apify_client=ApifyClient(token="t", client=httpx.Client(transport=httpx.MockTransport(apify_handler))),
        brightdata_client=BrightDataClient(api_key="k", client=httpx.Client(transport=httpx.MockTransport(bd_handler))),
        preferred_scraper="brightdata",
    )
    cat = c.catalogue()
    assert calls == ["brightdata", "apify"]  # preferred first; an empty answer moves on
    assert cat.videos[0]["external_video_id"] == "DLN1x" and cat.videos[0]["kind"] == "channel_post"
    batches = list(c.batches("DLN1x"))
    assert batches[0].comments[0].source == "instagram_apify" and batches[0].comments[0].platform == "instagram"


def test_instagram_public_without_scrapers_is_blocked():
    c = InstagramCollector(channel_id="natgeo", client=httpx.Client())
    with pytest.raises(CollectionError):
        c.catalogue()
    with pytest.raises(CollectionError) as exc:
        list(c.batches("DLN1x"))
    assert (exc.value.code, exc.value.outcome) == ("comments_scraper_not_configured", "blocked")
