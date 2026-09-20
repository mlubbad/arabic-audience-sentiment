"""Unit tests for TelegramCollector adapter."""
import json
import httpx
import pytest
from collectors.protocol import CollectionError
from collectors.telegram_collector import TelegramCollector


def test_telegram_collector_validates_handle():
    c = TelegramCollector()
    with pytest.raises(ValueError, match="missing_channel_id"):
        c.catalogue(None)

    with pytest.raises(ValueError, match="invalid_channel_id"):
        c.catalogue("bad!channel@")

    with pytest.raises(ValueError, match="invalid_video_id"):
        list(c.batches("bad!id", None))


def test_telegram_collector_fixture_catalogue_and_batches():
    fixture = {
        "posts": [
            {
                "id": 101,
                "text": "المنشور الأول على قناة التليجرام التجريبية",
                "date": "2026-09-20T12:00:00Z",
                "comments_count": 2,
            },
            {
                "id": 102,
                "text": "المنشور الثاني",
                "date": "2026-09-20T13:00:00Z",
                "comments_count": 0,
            },
        ],
        "comments": {
            "101": [
                {
                    "id": 501,
                    "text": "تعليق رائع ومفيد جداً",
                    "author_id": "u_1",
                    "author_name": "سعد",
                    "reactions_count": 3,
                },
                {
                    "id": 502,
                    "text": "شكراً جزيلاً لكم",
                    "parent_id": 501,
                    "author_id": "u_2",
                    "author_name": "مريم",
                    "reactions_count": 1,
                },
            ]
        },
    }

    collector = TelegramCollector(channel_id="@aljazeera", fixture_data=fixture)
    cat = collector.catalogue()
    assert cat.complete is True
    assert len(cat.videos) == 2
    assert cat.videos[0]["external_video_id"] == "101"
    assert cat.videos[0]["kind"] == "channel_post"
    assert cat.videos[0]["field_provenance"]["channel"] == "aljazeera"

    batches = list(collector.batches("101", None))
    assert len(batches) == 1
    b = batches[0]
    assert b.outcome == "exhausted"
    assert len(b.comments) == 2
    c1, c2 = b.comments
    assert c1.id == "501"
    assert c1.video_id == "101"
    assert c1.platform == "telegram"
    assert c1.likes_value == 3
    assert c2.is_reply is True
    assert c2.parent_id == "501"


def test_telegram_collector_http_mock_catalogue():
    def handler(request: httpx.Request):
        if request.url.path == "/s/arabic_news":
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                json={
                    "items": [
                        {"id": 201, "title": "عاجل: تحديث إخباري", "replies_count": 5},
                        {"id": 202, "title": "مقال رأي", "replies_count": 0},
                    ]
                },
            )
        if request.url.path == "/s/non_existent":
            return httpx.Response(404)
        if request.url.path == "/s/limited":
            return httpx.Response(429)
        if request.url.path == "/s/broken":
            return httpx.Response(500)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    col = TelegramCollector(client=client)

    cat = col.catalogue("arabic_news")
    assert len(cat.videos) == 2
    assert cat.videos[0]["external_video_id"] == "201"
    assert cat.videos[0]["kind"] == "channel_post"

    with pytest.raises(CollectionError) as exc_404:
        col.catalogue("non_existent")
    assert exc_404.value.code == "channel_not_found"

    with pytest.raises(CollectionError) as exc_429:
        col.catalogue("limited")
    assert exc_429.value.code == "rate_limited"

    with pytest.raises(CollectionError) as exc_500:
        col.catalogue("broken")
    assert exc_500.value.code == "server_error"
    assert exc_500.value.retryable is True


def test_telegram_collector_http_mock_batches():
    def handler(request: httpx.Request):
        if request.url.path == "/api/discussion/201":
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "c_1",
                            "text": "تغطية ممتازة",
                            "author_name": "أحمد",
                            "reactions_count": 10,
                        }
                    ],
                    "next_checkpoint": None,
                },
            )
        if request.url.path == "/api/discussion/disabled":
            return httpx.Response(200, json={"comments_disabled": True})
        if request.url.path == "/api/discussion/404":
            return httpx.Response(404)
        return httpx.Response(500)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    col = TelegramCollector(client=client)

    batches = list(col.batches("201", None))
    assert len(batches) == 1
    assert batches[0].outcome == "exhausted"
    assert batches[0].comments[0].platform == "telegram"
    assert batches[0].comments[0].text == "تغطية ممتازة"

    disabled_batch = list(col.batches("disabled", None))
    assert len(disabled_batch) == 1
    assert disabled_batch[0].outcome == "explicitly_disabled"

    unavailable_batch = list(col.batches("404", None))
    assert len(unavailable_batch) == 1
    assert unavailable_batch[0].outcome == "unavailable"


def test_telegram_runner_discover_and_backfill():
    from server.runner import run_job
    from server.gateway import ControlPlane

    fixture = {
        "posts": [
            {
                "id": 888,
                "text": "منشور تليجرام رسمي",
                "date": "2026-09-20T14:00:00Z",
                "comments_count": 1,
            }
        ],
        "comments": {
            "888": [
                {
                    "id": 9991,
                    "text": "تعليق تليجرام اختباري",
                    "author_name": "فاطمة",
                    "reactions_count": 2,
                }
            ]
        },
    }

    sent = {}

    def handler(request: httpx.Request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(200, json=sent["claim_response"])
        if path == "commit-catalogue":
            sent["committed_catalogue"] = json.loads(request.content)["payload"]
            return httpx.Response(200, json={"videos": 1})
        if path == "commit-batch":
            sent["committed_batch"] = json.loads(request.content)
            return httpx.Response(200, json={"stored": 1})
        if path == "finish":
            sent["finish"] = json.loads(request.content)
            return httpx.Response(200, json={})
        if path == "heartbeat":
            return httpx.Response(200, json={})
        return httpx.Response(200, json={})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    plane = ControlPlane("https://c.invalid", "cred", client)

    # 1. Discover
    sent["claim_response"] = {
        "job_id": "job_tg_1",
        "lease_token": "lease_tg_1",
        "type": "discover",
        "platform": "telegram",
        "external_channel_id": "@aljazeera",
        "checkpoint": None,
        "videos": [],
    }

    collector = TelegramCollector(channel_id="@aljazeera", fixture_data=fixture)

    def build_col(tok, exp=None, ren=None, channel_id=None, platform="youtube"):
        return collector if platform == "telegram" else None

    ran = run_job(plane, build_col)
    assert ran is True
    assert sent["finish"]["outcome"] == "succeeded"
    assert len(sent["committed_catalogue"]) == 1
    assert sent["committed_catalogue"][0]["external_video_id"] == "888"
    assert sent["committed_catalogue"][0]["kind"] == "channel_post"

    # 2. Backfill
    sent["claim_response"] = {
        "job_id": "job_tg_2",
        "lease_token": "lease_tg_2",
        "type": "backfill",
        "platform": "telegram",
        "external_channel_id": "@aljazeera",
        "checkpoint": None,
        "videos": [{"video_id": "vid_uuid_1", "external_video_id": "888", "title": "منشور تليجرام رسمي"}],
    }

    ran = run_job(plane, build_col)
    assert ran is True
    assert sent["finish"]["outcome"] == "succeeded"
    batch_payload = sent["committed_batch"]["payload"]
    assert len(batch_payload["comments"]) == 1
    cmt = batch_payload["comments"][0]
    assert cmt["external_comment_id"] == "9991"
    assert cmt["text_raw"] == "تعليق تليجرام اختباري"


def test_telegram_collector_contact_redirect_raises_channel_not_public():
    def handler(request: httpx.Request):
        return httpx.Response(
            200,
            text="""<!DOCTYPE html>
<html><head><title>Telegram: Contact @private_or_user</title></head>
<body><div class="tgme_page_action"><a href="tg://resolve?domain=private_or_user">Send Message</a></div></body>
</html>""",
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    col = TelegramCollector(client=client)
    with pytest.raises(CollectionError) as exc:
        col.catalogue("private_or_user")
    assert exc.value.code == "channel_not_public"
    assert exc.value.outcome == "blocked"


def test_telegram_collector_html_blocks_parsing():
    html_content = """
    <div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message js-widget_message" data-post="news_channel/100">
        <div class="tgme_widget_message_bubble">
          <div class="tgme_widget_message_text">خبر عاجل: &quot;تطورات جديدة في المنطقة&quot; &amp; تفاصيل إضافية</div>
          <div class="tgme_widget_message_footer">
            <time datetime="2026-09-20T18:00:00+00:00">18:00</time>
          </div>
          <div class="tgme_widget_message_subtext">42 comments</div>
        </div>
      </div>
      <div class="tgme_widget_message js-widget_message" data-post="news_channel/101">
        <div class="tgme_widget_message_bubble">
          <div class="tgme_widget_message_text">منشور ثانٍ بدون تعليقات</div>
          <div class="tgme_widget_message_footer">
            <time datetime="2026-09-20T19:00:00+00:00">19:00</time>
          </div>
        </div>
      </div>
    </div>
    """

    def handler(request: httpx.Request):
        return httpx.Response(200, text=html_content)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    col = TelegramCollector(client=client)
    cat = col.catalogue("news_channel")
    assert cat.complete is True
    assert len(cat.videos) == 2
    v1, v2 = cat.videos
    assert v1["external_video_id"] == "100"
    assert v1["title"] == 'خبر عاجل: "تطورات جديدة في المنطقة" & تفاصيل إضافية'
    assert v1["published_at"] == "2026-09-20T18:00:00+00:00"
    assert v1["reported_comment_count"] == 42

    assert v2["external_video_id"] == "101"
    assert v2["title"] == "منشور ثانٍ بدون تعليقات"
    assert v2["reported_comment_count"] is None


