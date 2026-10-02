"""Unit tests for XCollector adapter."""

import json
import httpx
import pytest
from collectors.protocol import CollectionError
from collectors.x_collector import XCollector


def test_x_collector_validates_handle():
    c = XCollector()
    with pytest.raises(ValueError, match="missing_channel_id"):
        c.catalogue(None)

    with pytest.raises(ValueError, match="invalid_channel_id"):
        c.catalogue("bad!channel@1234567890")

    with pytest.raises(ValueError, match="invalid_channel_id"):
        # Twitter handles cannot exceed 15 chars
        c.catalogue("this_handle_is_way_too_long_for_twitter")

    with pytest.raises(ValueError, match="invalid_video_id"):
        list(c.batches("bad!id", None))

    assert XCollector._clean_handle("https://x.com/aljazeera") == "aljazeera"
    assert XCollector._clean_handle("https://twitter.com/aljazeera") == "aljazeera"
    assert XCollector._clean_handle("@aljazeera") == "aljazeera"
    assert XCollector._clean_handle("aljazeera") == "aljazeera"


def test_x_collector_fixture_catalogue_and_batches():
    fixture = {
        "tweets": [
            {
                "id": 1834567890123456789,
                "text": "تغريدة تحليلية حول التفاعل الجماهيري العربي",
                "created_at": "2026-09-20T12:00:00Z",
                "reply_count": 2,
            },
            {
                "id": 1834567890123456790,
                "text": "تغريدة ثانية بدون ردود",
                "created_at": "2026-09-20T13:00:00Z",
                "reply_count": 0,
            },
        ],
        "comments": {
            "1834567890123456789": [
                {
                    "id": 1834567890123456801,
                    "text": "تحليل دقيق ومهم جداً",
                    "author_id": "u_991",
                    "author_name": "عبدالله",
                    "likes_count": 12,
                },
                {
                    "id": 1834567890123456802,
                    "text": "أتفق تماماً مع هذا الطرح",
                    "parent_id": 1834567890123456801,
                    "author_id": "u_992",
                    "author_name": "سارة",
                    "likes_count": 4,
                },
            ]
        },
    }

    collector = XCollector(channel_id="@aljazeera", fixture_data=fixture)
    cat = collector.catalogue()
    assert cat.complete is True
    assert len(cat.videos) == 2
    assert cat.videos[0]["external_video_id"] == "1834567890123456789"
    assert cat.videos[0]["kind"] == "tweet"
    assert cat.videos[0]["reported_comment_count"] == 2
    assert cat.videos[0]["field_provenance"]["handle"] == "aljazeera"

    batches = list(collector.batches("1834567890123456789"))
    assert len(batches) == 1
    assert batches[0].outcome == "exhausted"
    comments = batches[0].comments
    assert len(comments) == 2
    assert comments[0].text == "تحليل دقيق ومهم جداً"
    assert comments[0].platform == "x"
    assert comments[0].source == "x_api"
    assert comments[0].is_reply is False
    assert comments[1].is_reply is True
    assert comments[1].parent_id == "1834567890123456801"


def test_x_collector_bearer_token_mode():
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        assert request.headers.get("authorization") == "Bearer test_bearer_token"
        if "users/by/username/arab_pulse" in url:
            return httpx.Response(
                200,
                json={"data": {"id": "12345", "name": "Arab Pulse", "username": "arab_pulse"}},
            )
        if "users/12345/tweets" in url:
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "998877",
                            "text": "تغريدة رسمية عبر واجهة برمجة تويتر",
                            "created_at": "2026-09-20T10:00:00Z",
                            "public_metrics": {"reply_count": 5},
                        }
                    ]
                },
            )
        if "tweets/search/recent" in url:
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "112233",
                            "text": "رد رسمي عبر API",
                            "author_id": "887766",
                            "created_at": "2026-09-20T10:05:00Z",
                            "public_metrics": {"like_count": 3},
                        }
                    ],
                    "meta": {"next_token": None},
                },
            )
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    collector = XCollector(
        channel_id="arab_pulse",
        client=client,
        bearer_token="test_bearer_token",
    )

    cat = collector.catalogue()
    assert len(cat.videos) == 1
    assert cat.videos[0]["external_video_id"] == "998877"
    assert cat.videos[0]["reported_comment_count"] == 5

    batches = list(collector.batches("998877"))
    assert len(batches) == 1
    assert len(batches[0].comments) == 1
    assert batches[0].comments[0].text == "رد رسمي عبر API"


def test_x_collector_syndication_public_fallback():
    next_data_payload = {
        "props": {
            "pageProps": {
                "timeline": {
                    "entries": [
                        {
                            "content": {
                                "tweet": {
                                    "id_str": "5544332211",
                                    "full_text": "تغريدة من منصة إكس عبر خلاصة التزامن العامة",
                                    "created_at": "2026-09-20T15:00:00Z",
                                    "reply_count": 7,
                                }
                            }
                        }
                    ]
                }
            }
        }
    }
    html_body = f"""
    <!DOCTYPE html>
    <html>
      <head>
        <script id="__NEXT_DATA__" type="application/json">
          {json.dumps(next_data_payload)}
        </script>
      </head>
      <body></body>
    </html>
    """

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "screen-name/aljazeera" in url:
            return httpx.Response(200, text=html_body)
        if "screen-name/private_user" in url:
            return httpx.Response(200, text="<html><body>This account is protected</body></html>")
        if "screen-name/not_found_user" in url:
            return httpx.Response(404)
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handler))

    # Success syndication extraction
    col = XCollector(channel_id="@aljazeera", client=client)
    cat = col.catalogue()
    assert len(cat.videos) == 1
    assert cat.videos[0]["external_video_id"] == "5544332211"
    assert cat.videos[0]["title"] == "تغريدة من منصة إكس عبر خلاصة التزامن العامة"
    assert cat.videos[0]["reported_comment_count"] == 7

    # Protected account
    col_priv = XCollector(channel_id="@private_user", client=client)
    with pytest.raises(CollectionError) as exc_priv:
        col_priv.catalogue()
    assert exc_priv.value.code == "channel_not_public"

    # Not found
    col_nf = XCollector(channel_id="@not_found_user", client=client)
    with pytest.raises(CollectionError) as exc_nf:
        col_nf.catalogue()
    assert exc_nf.value.code == "channel_not_found"


def test_x_collector_apify_and_brightdata_integration():
    from collectors.scrapers.apify import ApifyClient
    from collectors.scrapers.brightdata import BrightDataClient

    def apify_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "run-sync-get-dataset-items" in url:
            content = json.loads(request.content.decode("utf-8"))
            if "twitterHandles" in content:
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id_str": "1922334455667788990",
                            "full_text": "تغريدة من مشغل أبيفاي",
                            "replyCount": 4,
                            "createdAt": "2026-09-21T01:00:00Z",
                        }
                    ],
                )
            if "conversationIds" in content:
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id_str": "1922334455667788999",
                            "full_text": "رد عبر أبيفاي",
                            "likeCount": 3,
                            "createdAt": "2026-09-21T01:10:00Z",
                        }
                    ],
                )
        return httpx.Response(404)

    def bd_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "datasets/v3/scrape" in url:
            req_json = json.loads(request.content.decode("utf-8"))
            target_url = req_json[0]["url"]
            if "/status/" in target_url:
                return httpx.Response(
                    200,
                    json=[
                        {
                            "id": "1922334455667788998",
                            "text": "رد عبر برايت داتا",
                            "likes": 7,
                            "date_posted": "2026-09-21T01:20:00Z",
                        }
                    ],
                )
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "1922334455667788991",
                        "text": "تغريدة عبر برايت داتا",
                        "replies": 5,
                        "date_posted": "2026-09-21T01:00:00Z",
                    }
                ],
            )
        return httpx.Response(404)

    apify_c = ApifyClient(token="token_ap", client=httpx.Client(transport=httpx.MockTransport(apify_handler)))
    bd_c = BrightDataClient(api_key="key_bd", client=httpx.Client(transport=httpx.MockTransport(bd_handler)))

    # Test default cascade: Apify runs first
    col_apify = XCollector(channel_id="@aljazeera", apify_client=apify_c, brightdata_client=bd_c)
    cat_ap = col_apify.catalogue()
    assert len(cat_ap.videos) == 1
    assert cat_ap.videos[0]["external_video_id"] == "1922334455667788990"
    batches_ap = list(col_apify.batches("1922334455667788990"))
    assert len(batches_ap[0].comments) == 1
    assert batches_ap[0].comments[0].id == "1922334455667788999"
    assert batches_ap[0].comments[0].source == "apify"

    # Test preferred scraper = brightdata
    col_bd = XCollector(
        channel_id="@aljazeera",
        apify_client=apify_c,
        brightdata_client=bd_c,
        preferred_scraper="brightdata",
    )
    cat_bd = col_bd.catalogue()
    assert len(cat_bd.videos) == 1
    assert cat_bd.videos[0]["external_video_id"] == "1922334455667788991"
    batches_bd = list(col_bd.batches("1922334455667788991"))
    assert len(batches_bd[0].comments) == 1
    assert batches_bd[0].comments[0].id == "1922334455667788998"
    assert batches_bd[0].comments[0].source == "brightdata"


def test_x_collector_apify_empty_falls_back_to_brightdata():
    """Verify that when Apify returns 0 results (e.g. free tier limit), XCollector falls back to Bright Data."""
    from collectors.scrapers.apify import ApifyClient
    from collectors.scrapers.brightdata import BrightDataClient

    def apify_empty_handler(request: httpx.Request) -> httpx.Response:
        # Returns empty list (or noResults object)
        return httpx.Response(200, json=[{"noResults": True}])

    def bd_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "post_id": "tweet_bd_fallback_1",
                    "description": "تغريدة تم جلبها عبر برايت داتا بعد تعذر أبيفاي",
                    "replies": 3,
                    "date_posted": "2026-09-21T06:00:00Z",
                }
            ],
        )

    apify_c = ApifyClient(token="token_ap", client=httpx.Client(transport=httpx.MockTransport(apify_empty_handler)))
    bd_c = BrightDataClient(api_key="key_bd", client=httpx.Client(transport=httpx.MockTransport(bd_handler)))

    col = XCollector(channel_id="@skynewsarabia", apify_client=apify_c, brightdata_client=bd_c)
    cat = col.catalogue()

    # Successfully fell back to Bright Data instead of returning an empty catalogue!
    assert len(cat.videos) == 1
    assert cat.videos[0]["external_video_id"] == "tweet_bd_fallback_1"
    assert cat.videos[0]["field_provenance"]["source"] == "brightdata"
    assert cat.complete is True


def test_x_collector_batches_falls_back_to_brightdata_on_apify_empty_or_quota():
    """Verify that batches() falls back to Bright Data if Apify returns [] or encounters quota exhaustion."""
    from collectors.scrapers.apify import ApifyClient
    from collectors.scrapers.brightdata import BrightDataClient

    # 1. Apify returns empty replies []
    def apify_empty_replies(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    def bd_replies(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "comment_id": "bd_reply_99",
                    "comment": "رد بديل تم استخراجه بنجاح عبر برايت داتا",
                    "user": "ahmed",
                    "likes": 5,
                    "date": "2026-09-21T06:30:00Z",
                }
            ],
        )

    apify_c1 = ApifyClient(token="token_ap", client=httpx.Client(transport=httpx.MockTransport(apify_empty_replies)))
    bd_c1 = BrightDataClient(api_key="key_bd", client=httpx.Client(transport=httpx.MockTransport(bd_replies)))

    col1 = XCollector(channel_id="@skynewsarabia", apify_client=apify_c1, brightdata_client=bd_c1)
    batches1 = list(col1.batches("1922334455667788990"))

    assert len(batches1) == 1
    assert len(batches1[0].comments) == 1
    assert batches1[0].comments[0].id == "bd_reply_99"
    assert batches1[0].comments[0].source == "brightdata"
    assert batches1[0].comments[0].text == "رد بديل تم استخراجه بنجاح عبر برايت داتا"

    # 2. Apify returns 402 quota depleted
    def apify_quota_depleted(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": "Payment required, credits exhausted"})

    apify_c2 = ApifyClient(token="token_ap", client=httpx.Client(transport=httpx.MockTransport(apify_quota_depleted)))
    bd_c2 = BrightDataClient(api_key="key_bd", client=httpx.Client(transport=httpx.MockTransport(bd_replies)))

    col2 = XCollector(channel_id="@skynewsarabia", apify_client=apify_c2, brightdata_client=bd_c2)
    batches2 = list(col2.batches("1922334455667788990"))

    assert len(batches2) == 1
    assert len(batches2[0].comments) == 1
    assert batches2[0].comments[0].id == "bd_reply_99"
    assert batches2[0].comments[0].source == "brightdata"


def test_x_collector_batches_raises_when_cascade_fails_even_if_one_was_empty():
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

    col = XCollector(channel_id="@skynewsarabia", apify_client=apify_c, brightdata_client=bd_c)
    with pytest.raises(CollectionError) as exc_info:
        list(col.batches("1922334455667788990"))
    assert exc_info.value.code == "brightdata_error_402"



def test_x_collector_batches_falls_back_to_bearer_token_when_scrapers_empty():
    """WO-3 Invariant 2: Scrapers returning [] must NOT short-circuit and bypass official Bearer token mode."""
    from collectors.scrapers.apify import ApifyClient
    from collectors.scrapers.brightdata import BrightDataClient

    def apify_empty(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    def bd_empty(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    def twitter_api_v2(request: httpx.Request) -> httpx.Response:
        if "tweets/search/recent" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "id": "tweet_api_reply_1",
                            "text": "رد رسمي عبر واجهة برمجة تويتر",
                            "conversation_id": "1922334455667788990",
                            "author_id": "user_123",
                            "created_at": "2026-09-21T07:00:00Z",
                            "public_metrics": {"like_count": 8},
                        }
                    ],
                    "meta": {"result_count": 1},
                },
            )
        return httpx.Response(404)

    apify_c = ApifyClient(token="tok", client=httpx.Client(transport=httpx.MockTransport(apify_empty)))
    bd_c = BrightDataClient(api_key="key", client=httpx.Client(transport=httpx.MockTransport(bd_empty)))
    tw_client = httpx.Client(transport=httpx.MockTransport(twitter_api_v2))

    col = XCollector(
        channel_id="@skynewsarabia",
        bearer_token="mock_bearer_token",
        client=tw_client,
        apify_client=apify_c,
        brightdata_client=bd_c,
    )
    batches = list(col.batches("1922334455667788990"))
    assert len(batches) == 1
    assert len(batches[0].comments) == 1
    assert batches[0].comments[0].id == "tweet_api_reply_1"
    assert batches[0].comments[0].text == "رد رسمي عبر واجهة برمجة تويتر"




