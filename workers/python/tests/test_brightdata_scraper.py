"""Unit tests for Bright Data scraping client."""

import json
import httpx
import pytest
from collectors.protocol import CollectionError
from collectors.scrapers.brightdata import BrightDataClient


def test_brightdata_client_initialization():
    with pytest.raises(ValueError, match="need_brightdata_api_key_or_proxy_url"):
        BrightDataClient()

    client = BrightDataClient(api_key="bd_key_123")
    assert client.api_key == "bd_key_123"
    assert client.get_proxy_client() is None

    proxy_client = BrightDataClient(proxy_url="http://user:pass@brd.superproxy.io:22225")
    assert proxy_client.proxy_url == "http://user:pass@brd.superproxy.io:22225"
    pc = proxy_client.get_proxy_client()
    assert pc is not None


def test_brightdata_scrape_x_profile():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "api.brightdata.com/datasets/v3/scrape" in str(request.url)
        assert request.headers.get("authorization") == "Bearer bd_key_123"
        return httpx.Response(
            200,
            json=[
                {
                    "profile_image_link": "https://pbs.twimg.com/avatar.jpg",
                    "posts": [
                        {
                            "id": "tweet_bd_1",
                            "text": "تحليل أسبوعي للمشاعر في العالم العربي",
                            "date_posted": "2026-09-21T05:00:00Z",
                            "replies": 10,
                            "photos": ["https://pbs.twimg.com/media1.jpg"],
                        },
                        {
                            "post_id": "tweet_bd_2",
                            "description": "منشور إخباري سريع",
                            "date_posted": "2026-09-21T06:00:00Z",
                            "comments": 3,
                        },
                    ],
                }
            ],
        )

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    bd = BrightDataClient(api_key="bd_key_123", client=mock_client)
    videos = bd.scrape_x_profile("aljazeera")

    assert len(videos) == 2
    assert videos[0]["external_video_id"] == "tweet_bd_1"
    assert videos[0]["title"] == "تحليل أسبوعي للمشاعر في العالم العربي"
    assert videos[0]["kind"] == "tweet"
    assert videos[0]["reported_comment_count"] == 10
    assert videos[0]["thumbnail_url"] == "https://pbs.twimg.com/media1.jpg"
    assert videos[0]["field_provenance"]["source"] == "brightdata"
    assert videos[1]["external_video_id"] == "tweet_bd_2"
    assert videos[1]["reported_comment_count"] == 3
    assert videos[1]["thumbnail_url"] == "https://pbs.twimg.com/avatar.jpg"


def test_brightdata_scrape_x_replies():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {"id": "tweet_bd_1", "text": "skip root"},
                {
                    "id": "rep_101",
                    "text": "قراءة دقيقة للواقع",
                    "date_posted": "2026-09-21T05:15:00Z",
                    "user_name": "سامي",
                    "likes": 8,
                },
            ],
        )

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    bd = BrightDataClient(api_key="bd_key_123", client=mock_client)
    replies = bd.scrape_x_replies("tweet_bd_1", handle="aljazeera")

    assert len(replies) == 1
    assert replies[0]["id"] == "rep_101"
    assert replies[0]["video_id"] == "tweet_bd_1"
    assert replies[0]["text"] == "قراءة دقيقة للواقع"
    assert replies[0]["parent_id"] == "tweet_bd_1"
    assert replies[0]["is_reply"] is True
    assert replies[0]["author_name"] == "سامي"
    assert replies[0]["likes_value"] == 8


def test_brightdata_scrape_tiktok_profile_and_comments():
    def handler(request: httpx.Request) -> httpx.Response:
        req_json = json.loads(request.content.decode("utf-8"))
        target_url = req_json[0]["url"]
        if "/video/" in target_url:
            return httpx.Response(
                200,
                json=[
                    {
                        "comment_id": "c_bd_55",
                        "comment": "محتوى عربي ملهم وجميل",
                        "create_time": 1758414000,
                        "likes": 15,
                        "user": {"nickname": "ماجد"},
                    }
                ],
            )
        return httpx.Response(
            200,
            json=[
                {
                    "video_id": "vid_bd_99",
                    "description": "تقرير مرئي من قلب الحدث",
                    "create_time": 1758413500,
                    "comments": 25,
                    "thumbnail": "https://cdn.example.com/tiktok_bd.jpg",
                }
            ],
        )

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    bd = BrightDataClient(api_key="bd_key_123", client=mock_client)

    videos = bd.scrape_tiktok_profile("news_channel")
    assert len(videos) == 1
    assert videos[0]["external_video_id"] == "vid_bd_99"
    assert videos[0]["title"] == "تقرير مرئي من قلب الحدث"
    assert videos[0]["reported_comment_count"] == 25
    assert videos[0]["thumbnail_url"] == "https://cdn.example.com/tiktok_bd.jpg"

    comments = bd.scrape_tiktok_comments("vid_bd_99", handle="news_channel")
    assert len(comments) == 1
    assert comments[0]["id"] == "c_bd_55"
    assert comments[0]["text"] == "محتوى عربي ملهم وجميل"
    assert comments[0]["author_name"] == "ماجد"
    assert comments[0]["likes_value"] == 15


def test_brightdata_error_handling():
    def make_handler(status_code: int):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(status_code, json={"error": "test"})

        return handler

    # 401
    c401 = BrightDataClient(api_key="bad", client=httpx.Client(transport=httpx.MockTransport(make_handler(401))))
    with pytest.raises(CollectionError) as exc401:
        c401.scrape_x_profile("channel")
    assert exc401.value.code == "invalid_credentials"
    assert exc401.value.outcome == "blocked"

    # 404
    c404 = BrightDataClient(api_key="test", client=httpx.Client(transport=httpx.MockTransport(make_handler(404))))
    with pytest.raises(CollectionError) as exc404:
        c404.scrape_x_profile("channel")
    assert exc404.value.code == "channel_not_found"

    # 429
    c429 = BrightDataClient(api_key="test", client=httpx.Client(transport=httpx.MockTransport(make_handler(429))))
    with pytest.raises(CollectionError) as exc429:
        c429.scrape_x_profile("channel")
    assert exc429.value.code == "rate_limit_exceeded"
    assert exc429.value.retryable is True


def test_brightdata_scrape_x_profile_nested_posts():
    """Verify Bright Data parses profile responses containing a nested 'posts' list."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "skynewsarabia",
                "profile_name": "سكاي نيوز عربية",
                "posts": [
                    {
                        "post_id": "2101908962300002373",
                        "description": "بعد 25 سنة من الانتظار.. كوفنتري يتذوق الفوز",
                        "date_posted": "2026-09-21T05:38:42.000Z",
                        "replies": 15,
                    },
                    {
                        "post_id": "2101909767610589578",
                        "description": "استهداف مراكز لوجستية ومستودعات",
                        "date_posted": "2026-09-21T05:41:54.000Z",
                        "replies": 4,
                    },
                ],
            },
        )

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    bd = BrightDataClient(api_key="bd_key_123", client=mock_client)
    videos = bd.scrape_x_profile("skynewsarabia")

    assert len(videos) == 2
    assert videos[0]["external_video_id"] == "2101908962300002373"
    assert "كوفنتري" in videos[0]["title"]
    assert videos[0]["reported_comment_count"] == 15
    assert videos[1]["external_video_id"] == "2101909767610589578"


def test_brightdata_scraping_browser_initialization_and_status():
    client_ws = BrightDataClient(browser_ws="wss://user:pass@brd.superproxy.io:9222")
    assert client_ws.browser_ws == "wss://user:pass@brd.superproxy.io:9222"
    assert client_ws.check_webdriver_status() == {"ready": False, "error": "webdriver_url_not_configured"}

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://brd.superproxy.io:9515/status"
        return httpx.Response(200, json={"value": {"ready": True, "message": "WebDriver ready"}})

    mock_client = httpx.Client(transport=httpx.MockTransport(handler))
    client_wb = BrightDataClient(
        webdriver_url="https://brd.superproxy.io:9515",
        client=mock_client,
    )
    status = client_wb.check_webdriver_status()
    assert status.get("ready") is True


def test_check_brightdata_diagnostics():
    from collectors.diagnostics import check_brightdata

    # Not configured
    res_none = check_brightdata(None, None)
    assert res_none["status"] == "NOT_CONFIGURED"

    # Both configured and healthy
    res_healthy = check_brightdata(
        key="07cbaeac-c954-4e47-a6d7-474cd27ce4be",
        webdriver_url="https://brd-customer-hl_41bb0e8e-zone-scraping_browser1:3oo1wdj909uz@brd.superproxy.io:9515",
    )
    assert res_healthy["status"] == "HEALTHY"
    assert "Datasets API: Authenticated successfully" in res_healthy["details"]
    assert "Scraping Browser: Ready" in res_healthy["details"]

