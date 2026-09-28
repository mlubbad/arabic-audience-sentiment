"""Unit tests for TikTokCollector adapter."""

import json
import httpx
import pytest
from collectors.protocol import CollectionError
from collectors.tiktok_collector import TikTokCollector


def test_tiktok_collector_validates_handle():
    c = TikTokCollector()
    with pytest.raises(ValueError, match="missing_channel_id"):
        c.catalogue(None)

    with pytest.raises(ValueError, match="invalid_channel_id"):
        c.catalogue("bad!channel@123")

    with pytest.raises(ValueError, match="invalid_video_id"):
        list(c.batches("bad!id", None))

    assert TikTokCollector._clean_handle("https://www.tiktok.com/@khaby.lame") == "khaby.lame"
    assert TikTokCollector._clean_handle("https://tiktok.com/@khaby.lame") == "khaby.lame"
    assert TikTokCollector._clean_handle("@khaby.lame") == "khaby.lame"
    assert TikTokCollector._clean_handle("khaby.lame") == "khaby.lame"


def test_tiktok_collector_fixture_catalogue_and_batches():
    fixture = {
        "videos": [
            {
                "id": 7384950192837465,
                "desc": "مقطع فيديو تيك توك تحليلي للمشاعر والآراء",
                "create_time": "2026-09-20T12:00:00Z",
                "comment_count": 3,
                "cover_image_url": "https://example.com/cover1.jpg",
            },
            {
                "id": 7384950192837466,
                "desc": "مقطع فيديو قصير ثانٍ",
                "create_time": "2026-09-20T13:00:00Z",
                "comment_count": 0,
            },
        ],
        "comments": {
            "7384950192837465": [
                {
                    "id": 9182736450,
                    "text": "محتوى ممتاز وطرح قيم جداً",
                    "create_time": "2026-09-20T12:10:00Z",
                    "digg_count": 15,
                    "user": {"unique_id": "user_arab_1", "nickname": "فاطمة"},
                },
                {
                    "id": 9182736451,
                    "text": "شكراً لمشاركة هذه التفاصيل",
                    "parent_id": 9182736450,
                    "create_time": "2026-09-20T12:15:00Z",
                    "digg_count": 2,
                    "user": {"unique_id": "user_arab_2", "nickname": "عمر"},
                },
            ]
        },
    }

    collector = TikTokCollector(channel_id="@aljazeera", fixture_data=fixture)
    cat = collector.catalogue()
    assert cat.complete is True
    assert len(cat.videos) == 2
    assert cat.videos[0]["external_video_id"] == "7384950192837465"
    assert cat.videos[0]["kind"] == "video"
    assert cat.videos[0]["reported_comment_count"] == 3
    assert cat.videos[0]["thumbnail_url"] == "https://example.com/cover1.jpg"
    assert cat.videos[0]["field_provenance"]["handle"] == "aljazeera"

    batches = list(collector.batches("7384950192837465"))
    assert len(batches) == 1
    assert batches[0].outcome == "exhausted"
    comments = batches[0].comments
    assert len(comments) == 2
    assert comments[0].text == "محتوى ممتاز وطرح قيم جداً"
    assert comments[0].platform == "tiktok"
    assert comments[0].source == "tiktok_display_api"
    assert comments[0].is_reply is False
    assert comments[1].is_reply is True
    assert comments[1].parent_id == "9182736450"


def test_tiktok_collector_access_token_mode():
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        assert request.headers.get("authorization") == "Bearer test_tiktok_token"
        if "video/list" in url:
            return httpx.Response(
                200,
                json={
                    "data": {
                        "videos": [
                            {
                                "id": "1122334455",
                                "title": "عنوان المقطع عبر API",
                                "video_description": "وصف الفيديو الرسمي من تيك توك",
                                "create_time": 1726830000,
                                "comment_count": 8,
                                "cover_image_url": "https://example.com/api_cover.jpg",
                            }
                        ]
                    }
                },
            )
        if "comment/list" in url:
            return httpx.Response(
                200,
                json={
                    "data": {
                        "comments": [
                            {
                                "id": "998811",
                                "text": "تعليق عبر واجهة تيك توك المعتمدة",
                                "author_name": "متابع_1",
                                "create_time": 1726830500,
                                "likes_count": 9,
                                "parent_comment_id": None,
                            }
                        ],
                        "cursor": None,
                        "has_more": False,
                    }
                },
            )
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    collector = TikTokCollector(
        channel_id="arab_creator",
        client=client,
        access_token="test_tiktok_token",
    )

    cat = collector.catalogue()
    assert len(cat.videos) == 1
    assert cat.videos[0]["external_video_id"] == "1122334455"
    assert cat.videos[0]["reported_comment_count"] == 8

    batches = list(collector.batches("1122334455"))
    assert len(batches) == 1
    assert len(batches[0].comments) == 1
    assert batches[0].comments[0].text == "تعليق عبر واجهة تيك توك المعتمدة"


def test_tiktok_collector_public_web_fallback():
    rehydration_data = {
        "__DEFAULT_SCOPE__": {
            "webapp.user-detail": {
                "itemList": ["7001002003004005"],
                "ItemModule": {
                    "7001002003004005": {
                        "desc": "فيديو تيك توك مستخرج من صفحة الويب العامة",
                        "createTime": 1726830000,
                        "stats": {"commentCount": 14},
                        "video": {"cover": "https://example.com/web_cover.jpg"},
                    }
                },
            }
        }
    }
    html_body = f"""
    <!DOCTYPE html>
    <html>
      <head>
        <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
          {json.dumps(rehydration_data)}
        </script>
      </head>
      <body></body>
    </html>
    """

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/@aljazeera" in url:
            return httpx.Response(200, text=html_body)
        if "/@private_account" in url:
            return httpx.Response(200, text="<html><body>Private Account</body></html>")
        if "/@not_found_account" in url:
            return httpx.Response(404)
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    # Success public profile extraction
    col = TikTokCollector(channel_id="@aljazeera", client=client)
    cat = col.catalogue()
    assert len(cat.videos) == 1
    assert cat.videos[0]["external_video_id"] == "7001002003004005"
    assert cat.videos[0]["title"] == "فيديو تيك توك مستخرج من صفحة الويب العامة"
    assert cat.videos[0]["reported_comment_count"] == 14

    # Private account
    col_priv = TikTokCollector(channel_id="@private_account", client=client)
    with pytest.raises(CollectionError) as exc_priv:
        col_priv.catalogue()
    assert exc_priv.value.code == "channel_not_public"

    # Not found
    col_nf = TikTokCollector(channel_id="@not_found_account", client=client)
    with pytest.raises(CollectionError) as exc_nf:
        col_nf.catalogue()
    assert exc_nf.value.code == "channel_not_found"


def test_tiktok_collector_apify_and_brightdata_integration():
    from collectors.scrapers.apify import ApifyClient
    from collectors.scrapers.brightdata import BrightDataClient

    def apify_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "run-sync-get-dataset-items" in url:
            content = json.loads(request.content.decode("utf-8"))
            if "profiles" in content:
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": "7112233445566778899",
                            "desc": "فيديو تيك توك عبر أبيفاي",
                            "createTime": 1758410000,
                            "stats": {"commentCount": 12},
                        }
                    ],
                )
            if "postURLs" in content:
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": "c_apify_tiktok_1",
                            "text": "تعليق تيك توك عبر أبيفاي",
                            "createTime": 1758410100,
                            "diggCount": 6,
                            "user": {"nickname": "عمر"},
                        }
                    ],
                )
        return httpx.Response(404)

    def bd_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "datasets/v3/scrape" in url:
            req_json = json.loads(request.content.decode("utf-8"))
            target_url = req_json[0]["url"]
            if "/video/" in target_url:
                return httpx.Response(
                    200,
                    json=[
                        {
                            "comment_id": "c_bd_tiktok_1",
                            "comment": "تعليق تيك توك عبر برايت داتا",
                            "create_time": 1758410200,
                            "likes": 9,
                            "user": {"nickname": "ياسمين"},
                        }
                    ],
                )
            return httpx.Response(
                200,
                json=[
                    {
                        "video_id": "7112233445566778898",
                        "description": "فيديو تيك توك عبر برايت داتا",
                        "create_time": 1758410000,
                        "comments": 15,
                    }
                ],
            )
        return httpx.Response(404)

    apify_c = ApifyClient(token="token_ap", client=httpx.Client(transport=httpx.MockTransport(apify_handler)))
    bd_c = BrightDataClient(api_key="key_bd", client=httpx.Client(transport=httpx.MockTransport(bd_handler)))

    # Test default cascade: Apify runs first
    col_apify = TikTokCollector(channel_id="@aljazeera", apify_client=apify_c, brightdata_client=bd_c)
    cat_ap = col_apify.catalogue()
    assert len(cat_ap.videos) == 1
    assert cat_ap.videos[0]["external_video_id"] == "7112233445566778899"
    batches_ap = list(col_apify.batches("7112233445566778899"))
    assert len(batches_ap[0].comments) == 1
    assert batches_ap[0].comments[0].id == "c_apify_tiktok_1"
    assert batches_ap[0].comments[0].source == "apify"

    # Test preferred scraper = brightdata
    col_bd = TikTokCollector(
        channel_id="@aljazeera",
        apify_client=apify_c,
        brightdata_client=bd_c,
        preferred_scraper="brightdata",
    )
    cat_bd = col_bd.catalogue()
    assert len(cat_bd.videos) == 1
    assert cat_bd.videos[0]["external_video_id"] == "7112233445566778898"
    batches_bd = list(col_bd.batches("7112233445566778898"))
    assert len(batches_bd[0].comments) == 1
    assert batches_bd[0].comments[0].id == "c_bd_tiktok_1"
    assert batches_bd[0].comments[0].source == "brightdata"


def test_tiktok_collector_batches_falls_back_to_brightdata_on_apify_empty_or_quota():
    """Verify that batches() falls back to Bright Data if Apify returns [] or encounters quota exhaustion."""
    from collectors.scrapers.apify import ApifyClient
    from collectors.scrapers.brightdata import BrightDataClient

    # 1. Apify returns empty comments []
    def apify_empty_comments(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    def bd_comments(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "comment_id": "c_bd_fallback_99",
                    "comment": "تعليق تيك توك تم جلبه عبر برايت داتا كاحتياطي",
                    "create_time": 1758410200,
                    "likes": 12,
                    "user": {"nickname": "ريم"},
                }
            ],
        )

    apify_c1 = ApifyClient(token="token_ap", client=httpx.Client(transport=httpx.MockTransport(apify_empty_comments)))
    bd_c1 = BrightDataClient(api_key="key_bd", client=httpx.Client(transport=httpx.MockTransport(bd_comments)))

    col1 = TikTokCollector(channel_id="@aljazeera", apify_client=apify_c1, brightdata_client=bd_c1)
    batches1 = list(col1.batches("7112233445566778899"))

    assert len(batches1) == 1
    assert len(batches1[0].comments) == 1
    assert batches1[0].comments[0].id == "c_bd_fallback_99"
    assert batches1[0].comments[0].source == "brightdata"
    assert batches1[0].comments[0].text == "تعليق تيك توك تم جلبه عبر برايت داتا كاحتياطي"

    # 2. Apify returns 402 quota depleted
    def apify_quota_depleted(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": "Payment required, compute units exhausted"})

    apify_c2 = ApifyClient(token="token_ap", client=httpx.Client(transport=httpx.MockTransport(apify_quota_depleted)))
    bd_c2 = BrightDataClient(api_key="key_bd", client=httpx.Client(transport=httpx.MockTransport(bd_comments)))

    col2 = TikTokCollector(channel_id="@aljazeera", apify_client=apify_c2, brightdata_client=bd_c2)
    batches2 = list(col2.batches("7112233445566778899"))

    assert len(batches2) == 1
    assert len(batches2[0].comments) == 1
    assert batches2[0].comments[0].id == "c_bd_fallback_99"
    assert batches2[0].comments[0].source == "brightdata"


def test_tiktok_collector_batches_raises_when_cascade_fails_even_if_one_was_empty():
    """WO-3 Invariant 2: Failure never becomes success.
    If Apify returns [] but Bright Data fails with CollectionError, batches() MUST NOT
    silently yield Batch([], None, 'exhausted'). It must raise the CollectionError.
    """
    from collectors.scrapers.apify import ApifyClient
    from collectors.scrapers.brightdata import BrightDataClient

    def apify_empty(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    def bd_error(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": "BrightData account quota depleted"})

    apify_c = ApifyClient(token="tok", client=httpx.Client(transport=httpx.MockTransport(apify_empty)))
    bd_c = BrightDataClient(api_key="key", client=httpx.Client(transport=httpx.MockTransport(bd_error)))

    col = TikTokCollector(channel_id="@aljazeera", apify_client=apify_c, brightdata_client=bd_c)
    with pytest.raises(CollectionError) as exc_info:
        list(col.batches("7112233445566778899"))
    assert exc_info.value.code == "brightdata_error_402"



def test_tiktok_collector_batches_falls_back_to_display_api_when_scrapers_empty():
    """WO-3 Invariant 2: Scrapers returning [] must NOT short-circuit and bypass official Display API mode."""
    from collectors.scrapers.apify import ApifyClient
    from collectors.scrapers.brightdata import BrightDataClient

    def apify_empty(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    def bd_empty(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    def tiktok_api(request: httpx.Request) -> httpx.Response:
        if "comment/list" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "data": {
                        "comments": [
                            {
                                "id": "tt_api_comment_1",
                                "text": "تعليق رسمي عبر واجهة تيك توك",
                                "create_time": 1758410200,
                                "like_count": 15,
                            }
                        ],
                        "has_more": False,
                    },
                    "error": {"code": "ok", "message": ""},
                },
            )
        return httpx.Response(404)

    apify_c = ApifyClient(token="tok", client=httpx.Client(transport=httpx.MockTransport(apify_empty)))
    bd_c = BrightDataClient(api_key="key", client=httpx.Client(transport=httpx.MockTransport(bd_empty)))
    tt_client = httpx.Client(transport=httpx.MockTransport(tiktok_api))

    col = TikTokCollector(
        channel_id="@aljazeera",
        access_token="mock_access_token",
        client=tt_client,
        apify_client=apify_c,
        brightdata_client=bd_c,
    )
    batches = list(col.batches("7112233445566778899"))
    assert len(batches) == 1
    assert len(batches[0].comments) == 1
    assert batches[0].comments[0].id == "tt_api_comment_1"
    assert batches[0].comments[0].text == "تعليق رسمي عبر واجهة تيك توك"



