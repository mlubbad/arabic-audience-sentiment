"""Unit tests for Apify scraping client."""

import json
import httpx
import pytest
from collectors.protocol import CollectionError
from collectors.scrapers.apify import ApifyClient


def test_apify_client_initialization():
    with pytest.raises(ValueError, match="missing_apify_token"):
        ApifyClient(token="")

    client = ApifyClient(token="apify_api_test123", x_actor="custom/x-actor")
    assert client._normalize_actor_id("custom/x-actor") == "custom~x-actor"
    assert client.token == "apify_api_test123"


def test_apify_scrape_x_profile():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "api.apify.com/v2/acts/apidojo~tweet-scraper/run-sync-get-dataset-items" in str(request.url)
        assert request.headers.get("authorization") == "Bearer test_token"
        return httpx.Response(
            200,
            json=[
                {
                    "id_str": "19001",
                    "full_text": "تقرير حول الرأي العام العربي ومستجدات التقنية",
                    "createdAt": "2026-09-21T02:00:00Z",
                    "replyCount": 14,
                    "author": {"userName": "arab_pulse", "name": "Arab Pulse"},
                },
                {
                    "id": "19002",
                    "text": "تغريدة سريعة للمتابعين",
                    "createdAt": "2026-09-21T03:00:00Z",
                    "reply_count": 0,
                    "author": {"userName": "arab_pulse"},
                },
            ],
        )

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    apify = ApifyClient(token="test_token", client=mock_client)
    videos = apify.scrape_x_profile("@arab_pulse")

    assert len(videos) == 2
    assert videos[0]["external_video_id"] == "19001"
    assert videos[0]["title"] == "تقرير حول الرأي العام العربي ومستجدات التقنية"
    assert videos[0]["kind"] == "tweet"
    assert videos[0]["reported_comment_count"] == 14
    assert videos[0]["field_provenance"]["source"] == "apify"
    assert videos[1]["external_video_id"] == "19002"


def test_apify_scrape_x_replies():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                # Root tweet included by some actors, should be skipped
                {"id_str": "19001", "full_text": "التغريدة الأصلية"},
                # Real replies
                {
                    "id_str": "19001_rep1",
                    "full_text": "مقال ممتاز جداً ومفيد",
                    "inReplyToStatusId": "19001",
                    "createdAt": "2026-09-21T02:30:00Z",
                    "likeCount": 5,
                    "author": {"name": "أحمد", "id": "u100"},
                },
            ],
        )

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    apify = ApifyClient(token="test_token", client=mock_client)
    replies = apify.scrape_x_replies("19001")

    assert len(replies) == 1
    assert replies[0]["id"] == "19001_rep1"
    assert replies[0]["video_id"] == "19001"
    assert replies[0]["text"] == "مقال ممتاز جداً ومفيد"
    assert replies[0]["parent_id"] == "19001"
    assert replies[0]["is_reply"] is True
    assert replies[0]["author_name"] == "أحمد"
    assert replies[0]["likes_value"] == 5


def test_apify_scrape_tiktok_profile_and_comments():
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        assert "clockworks~tiktok-scraper" in url
        req_json = json.loads(request.content.decode("utf-8"))
        if "profiles" in req_json:
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "71100223344",
                        "desc": "مقطع تحليلي في تيك توك",
                        "createTime": 1758412800,
                        "stats": {"commentCount": 8},
                        "video": {"cover": "https://cdn.example.com/cover.jpg"},
                    }
                ],
            )
        # Comments request
        return httpx.Response(
            200,
            json=[
                {
                    "id": "c_9988",
                    "text": "فيديو رائع أبدعتم",
                    "createTime": 1758413000,
                    "diggCount": 20,
                    "user": {"nickname": "خالد", "uniqueId": "khaled_99"},
                }
            ],
        )

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    apify = ApifyClient(token="test_token", client=mock_client)

    videos = apify.scrape_tiktok_profile("tiktok_arabic")
    assert len(videos) == 1
    assert videos[0]["external_video_id"] == "71100223344"
    assert videos[0]["title"] == "مقطع تحليلي في تيك توك"
    assert videos[0]["kind"] == "video"
    assert videos[0]["reported_comment_count"] == 8
    assert videos[0]["thumbnail_url"] == "https://cdn.example.com/cover.jpg"

    comments = apify.scrape_tiktok_comments("71100223344", handle="tiktok_arabic")
    assert len(comments) == 1
    assert comments[0]["id"] == "c_9988"
    assert comments[0]["text"] == "فيديو رائع أبدعتم"
    assert comments[0]["author_name"] == "خالد"
    assert comments[0]["likes_value"] == 20


def test_apify_error_handling():
    def make_handler(status_code: int):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(status_code, json={"error": "test"})

        return handler

    # 401
    c401 = ApifyClient(token="test", client=httpx.Client(transport=httpx.MockTransport(make_handler(401))))
    with pytest.raises(CollectionError) as exc401:
        c401.scrape_x_profile("channel")
    assert exc401.value.code == "invalid_credentials"
    assert exc401.value.outcome == "blocked"

    # 404
    c404 = ApifyClient(token="test", client=httpx.Client(transport=httpx.MockTransport(make_handler(404))))
    with pytest.raises(CollectionError) as exc404:
        c404.scrape_x_profile("channel")
    assert exc404.value.code == "channel_not_found"

    # 429
    c429 = ApifyClient(token="test", client=httpx.Client(transport=httpx.MockTransport(make_handler(429))))
    with pytest.raises(CollectionError) as exc429:
        c429.scrape_x_profile("channel")
    assert exc429.value.code == "rate_limit_exceeded"
    assert exc429.value.retryable is True
