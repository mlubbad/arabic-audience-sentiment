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
