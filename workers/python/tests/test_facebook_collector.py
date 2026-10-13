"""FacebookCollector: Graph for the owner's page, scrapers for a public one."""

import json
import httpx
import pytest
from collectors.facebook_collector import FacebookCollector
from collectors.protocol import CollectionError
from collectors.scrapers.apify import ApifyClient
from collectors.scrapers.brightdata import BrightDataClient


def test_facebook_collector_validates_handle_and_post_id():
    clean = FacebookCollector._clean_handle
    assert clean("https://www.facebook.com/aljazeera/") == "aljazeera"
    assert clean("m.facebook.com/aljazeera?ref=x") == "aljazeera"
    assert clean("https://www.facebook.com/profile.php?id=123456") == "123456"
    assert clean("https://facebook.com/pages/Al-Jazeera/456789") == "456789"
    assert clean("aljazeera.english") == "aljazeera.english"
    for bad in ("", "al jazeera", "https://www.facebook.com/groups/abc", "a/b"):
        with pytest.raises(ValueError, match="invalid_channel_id"):
            clean(bad)

    post = FacebookCollector._clean_post_id
    assert post("1122334455") == "1122334455"
    assert post("10001_1122334455") == "10001_1122334455"
    assert post("https://www.facebook.com/aljazeera/posts/pfbid0AbCdEfGhIjKlMnOpQrStUvWxYz") == (
        "pfbid0AbCdEfGhIjKlMnOpQrStUvWxYz"
    )
    with pytest.raises(ValueError, match="invalid_video_id"):
        post("not a post")

    with pytest.raises(ValueError, match="missing_channel_id"):
        FacebookCollector().catalogue(None)


def test_facebook_fixture_catalogue_and_batches():
    fixture = {
        "posts": [
            {"id": "900", "message": "منشور تجريبي", "created_time": "2026-09-20T12:00:00+0000", "comment_count": 2}
        ],
        "comments": {
            "900": [
                {"id": "c1", "message": "تعليق أول", "created_time": "2026-09-20T12:10:00+0000", "like_count": 1},
                {"id": "c2", "message": "رد", "parent_id": "c1", "created_time": "2026-09-20T12:11:00+0000"},
            ]
        },
    }
    c = FacebookCollector(channel_id="aljazeera", fixture_data=fixture)
    cat = c.catalogue()
    assert cat.complete is True
    assert cat.videos[0]["external_video_id"] == "900"
    assert cat.videos[0]["kind"] == "channel_post"
    assert cat.videos[0]["published_at"] == "2026-09-20T12:00:00+00:00"
    assert cat.videos[0]["reported_comment_count"] == 2
    batches = list(c.batches("900"))
    assert batches[0].outcome == "exhausted"
    first, second = batches[0].comments
    assert first.platform == "facebook" and first.likes_value == 1 and first.timestamp_precision == "second"
    assert second.is_reply is True and second.parent_id == "c1" and second.likes_value is None


def _graph_handler(pages: dict, comments_pages: list, me: dict | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("authorization") == "Bearer page-token"
        path = request.url.path
        if path.endswith("/me"):
            return httpx.Response(200, json=me or {"id": "10001", "name": "الجزيرة", "username": "aljazeera"})
        if path.endswith("/posts"):
            return httpx.Response(200, json=pages)
        if path.endswith("/comments"):
            after = request.url.params.get("after")
            assert request.url.params.get("filter") == "stream"
            return httpx.Response(200, json=comments_pages[1 if after == "cur2" else 0])
        return httpx.Response(404, json={"error": {"code": 803}})

    return handler


def test_facebook_graph_catalogue_and_paged_comments():
    posts = {
        "data": [
            {
                "id": "10001_777",
                "message": "فيديو جديد",
                "created_time": "2026-09-21T08:00:00+0000",
                "permalink_url": "https://www.facebook.com/aljazeera/posts/777",
                "full_picture": "https://cdn.example.com/777.jpg",
                "attachments": {"data": [{"media_type": "video"}]},
                "comments": {"summary": {"total_count": 2}},
            },
            {"id": "10001_778", "story": "حدّثت الصفحة صورتها"},
        ]
    }
    comments = [
        {
            "data": [
                {
                    "id": "c_a",
                    "message": "ممتاز",
                    "created_time": "2026-09-21T09:00:00+0000",
                    "from": {"id": "u1", "name": "هدى"},
                    "like_count": 3,
                }
            ],
            "paging": {"cursors": {"after": "cur2"}, "next": "https://graph.facebook.com/next"},
        },
        {
            "data": [
                {"id": "c_b", "message": "رد", "created_time": "2026-09-21T09:05:00+0000", "parent": {"id": "c_a"}}
            ],
            "paging": {"cursors": {"after": "cur3"}},
        },
    ]
    c = FacebookCollector(
        client=httpx.Client(transport=httpx.MockTransport(_graph_handler(posts, comments))),
        access_token="page-token",
    )
    cat = c.catalogue()
    assert cat.complete is True
    assert [v["external_video_id"] for v in cat.videos] == ["777", "778"]
    assert cat.videos[0]["kind"] == "video" and cat.videos[1]["kind"] == "channel_post"
    assert cat.videos[0]["published_at"] == "2026-09-21T08:00:00+00:00"
    assert cat.videos[0]["reported_comment_count"] == 2
    assert cat.videos[1]["reported_comment_count"] is None and cat.videos[1]["published_at"] is None
    assert cat.videos[0]["field_provenance"]["source"] == "facebook_graph_api"

    batches = list(c.batches("777", None))
    assert len(batches) == 2
    assert batches[0].outcome == "partial" and batches[0].checkpoint == "cur2"
    assert batches[1].outcome == "exhausted" and batches[1].checkpoint is None
    a = batches[0].comments[0]
    assert (a.id, a.author_name, a.author_channel_id, a.likes_value) == ("c_a", "هدى", "u1", 3)
    assert a.published_at == "2026-09-21T09:00:00+00:00" and a.source == "facebook_graph_api"
    b = batches[1].comments[0]
    assert b.is_reply is True and b.parent_id == "c_a" and b.likes_value is None and b.author_name == ""

    # Resuming from the checkpoint reads only the second page.
    resumed = list(c.batches("777", "cur2"))
    assert len(resumed) == 1 and resumed[0].comments[0].id == "c_b"


def test_facebook_graph_190_is_blocked_invalid_credentials():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"code": 190, "message": "Error validating access token"}})

    c = FacebookCollector(client=httpx.Client(transport=httpx.MockTransport(handler)), access_token="page-token")
    with pytest.raises(CollectionError) as exc:
        c.catalogue()
    assert (exc.value.code, exc.value.outcome) == ("invalid_credentials", "blocked")
    with pytest.raises(CollectionError) as exc:
        list(c.batches("777"))
    assert exc.value.code == "invalid_credentials"


def test_facebook_public_cascade_apify_then_brightdata():
    calls = []

    def apify_handler(request: httpx.Request) -> httpx.Response:
        calls.append("apify")
        return httpx.Response(402, json={"error": {"type": "platform-limit", "message": "quota"}})

    def bd_handler(request: httpx.Request) -> httpx.Response:
        calls.append("brightdata")
        body = json.loads(request.content.decode())
        if "/posts/" in body[0]["url"]:
            return httpx.Response(200, json=[{"comment_id": "bd1", "comment_text": "جميل", "num_likes": 2}])
        return httpx.Response(200, json=[{"post_id": "55", "content": "منشور", "num_comments": 1}])

    c = FacebookCollector(
        channel_id="aljazeera",
        apify_client=ApifyClient(token="t", client=httpx.Client(transport=httpx.MockTransport(apify_handler))),
        brightdata_client=BrightDataClient(api_key="k", client=httpx.Client(transport=httpx.MockTransport(bd_handler))),
    )
    cat = c.catalogue()
    assert [v["external_video_id"] for v in cat.videos] == ["55"]
    assert calls == ["apify", "brightdata"]
    batches = list(c.batches("55"))
    assert batches[0].outcome == "exhausted"
    assert batches[0].comments[0].source == "facebook_brightdata"
    assert batches[0].comments[0].platform == "facebook"
    assert batches[0].comments[0].published_at is None and batches[0].comments[0].timestamp_precision == "unknown"


def test_facebook_public_without_scrapers_is_blocked():
    c = FacebookCollector(channel_id="aljazeera", client=httpx.Client())
    with pytest.raises(CollectionError) as exc:
        c.catalogue()
    assert exc.value.outcome in ("blocked", "failed")
    with pytest.raises(CollectionError) as exc:
        list(c.batches("55"))
    assert (exc.value.code, exc.value.outcome) == ("comments_scraper_not_configured", "blocked")


def test_facebook_public_every_scraper_failing_raises_not_empty():
    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "slow down"})

    c = FacebookCollector(
        channel_id="aljazeera",
        apify_client=ApifyClient(token="t", client=httpx.Client(transport=httpx.MockTransport(failing))),
    )
    with pytest.raises(CollectionError) as exc:
        list(c.batches("55"))
    assert exc.value.code == "rate_limit_exceeded" and exc.value.retryable is True
