"""End-to-end integration test suite for Omnichannel (X, TikTok, Telegram) ingestion pipeline.

Verifies the complete flow across all three platforms:
1. Handle normalization and channel registration.
2. Discovery / catalogue generation.
3. Reply / comment batch collection and pagination.
4. Sentiment analysis integration (DeterministicTestAnalyzer).
5. Gateway / ControlPlane commit semantics (catalogue, batch, finish).
6. Failure handling: WAF challenge, 401 Unauthorized, rate-limits, and missing scrapers
   MUST be marked partial/blocked/failed, NEVER silently yielded as empty exhausted datasets.
7. Multi-tenant single database principle: cross-workspace deduplication and shared sentiment.
"""

import json
import httpx
import pytest

from collectors.protocol import CollectionError, RawComment
from collectors.telegram_collector import TelegramCollector
from collectors.tiktok_collector import TikTokCollector
from collectors.x_collector import XCollector
from sentiment.deterministic import DeterministicTestAnalyzer
from server.gateway import ControlPlane
from server.runner import _discover, _backfill


class MockControlPlaneRecorder:
    """Mock ControlPlane recording all server-side commits and finish calls."""

    def __init__(self, lease: dict):
        self.lease = lease
        self.calls = []
        self.committed_catalogues = []
        self.committed_batches = []
        self.finished_outcome = None
        self.finished_reason = None
        self.heartbeats = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.rsplit("/", 1)[-1]
        self.calls.append(path)
        body = json.loads(request.content) if request.content else {}

        if path == "claim":
            return httpx.Response(200, json=self.lease)
        if path == "heartbeat":
            self.heartbeats += 1
            return httpx.Response(200, json={})
        if path == "commit-catalogue":
            self.committed_catalogues.append(body.get("payload", []))
            return httpx.Response(200, json={"videos": len(body.get("payload", []))})
        if path == "commit-batch":
            payload = body.get("payload", {})
            self.committed_batches.append(payload)
            return httpx.Response(200, json={"stored": len(payload.get("comments", []))})
        if path == "finish":
            self.finished_outcome = body.get("outcome")
            self.finished_reason = body.get("error_code")
            return httpx.Response(200, json={})
        return httpx.Response(200, json={})

    def plane(self) -> ControlPlane:
        return ControlPlane(
            "https://control.sentiment.internal",
            "mock_scoped_credential_123",
            httpx.Client(transport=httpx.MockTransport(self.handler)),
        )


def make_builder(collector_cls, **init_kwargs):
    """Factory helper matching runner._collector_for builder shape."""
    def _build(tok=None, exp=None, ren=None, channel_id=None, platform=None, **kwargs):
        return collector_cls(channel_id=channel_id, **init_kwargs)
    return _build


# ============================================================================
# 1. TWITTER / X E2E PIPELINE TESTS
# ============================================================================

def test_e2e_x_pipeline_success():
    """Verify X/Twitter full lifecycle: handle -> catalogue -> batch replies -> sentiment -> commit."""
    handle = "@aljazeera"
    cleaned = XCollector._clean_handle(handle)
    assert cleaned == "aljazeera"

    fixture = {
        "tweets": [
            {
                "id": "189900112233445566",
                "text": "تغطية مباشرة: تفاعل الرأي العام العربي مع الأحداث الجارية",
                "created_at": "2026-09-21T10:00:00Z",
                "reply_count": 2,
            }
        ],
        "comments": {
            "189900112233445566": [
                {
                    "id": "189900112233445599",
                    "text": "﹢ تحليل رائع وموضوعي جداً",
                    "author_id": "u_ar_1",
                    "author_name": "سامي",
                    "likes_count": 8,
                },
                {
                    "id": "189900112233445600",
                    "text": "﹣ للأسف تغطية غير موفقة وسيئة",
                    "parent_id": "189900112233445599",
                    "author_id": "u_ar_2",
                    "author_name": "طارق",
                    "likes_count": 1,
                },
            ]
        },
    }

    # Step A: Discover Phase
    discover_lease = {
        "job_id": "job_x_disc_1",
        "lease_token": "token_x_1",
        "external_channel_id": cleaned,
        "platform": "x",
        "mode": "discover",
    }
    rec_disc = MockControlPlaneRecorder(discover_lease)
    builder_fn = make_builder(XCollector, fixture_data=fixture)

    disc_result = _discover(rec_disc.plane(), discover_lease, builder_fn)
    assert disc_result is True
    assert len(rec_disc.committed_catalogues) == 1
    assert len(rec_disc.committed_catalogues[0]) == 1
    tweet_record = rec_disc.committed_catalogues[0][0]
    assert tweet_record["external_video_id"] == "189900112233445566"
    assert tweet_record["kind"] == "tweet"
    assert tweet_record["reported_comment_count"] == 2
    assert rec_disc.finished_outcome == "succeeded"

    # Step B: Backfill & Sentiment Analysis Phase
    backfill_lease = {
        "job_id": "job_x_back_1",
        "lease_token": "token_x_2",
        "external_channel_id": cleaned,
        "platform": "x",
        "mode": "backfill",
        "videos": [
            {
                "video_id": "v_db_id_101",
                "external_video_id": "189900112233445566",
                "title": "تغطية مباشرة: تفاعل الرأي العام العربي مع الأحداث الجارية",
            }
        ],
    }
    rec_back = MockControlPlaneRecorder(backfill_lease)
    analyzer = DeterministicTestAnalyzer()

    back_result = _backfill(rec_back.plane(), backfill_lease, builder_fn, analyzer=analyzer)
    assert back_result is True
    assert len(rec_back.committed_batches) == 1
    committed = rec_back.committed_batches[0]
    assert committed["external_video_id"] == "189900112233445566"
    assert len(committed["comments"]) == 2
    assert len(committed["predictions"]) == 2

    # Check sentiment analysis results
    pred1, pred2 = committed["predictions"]
    assert pred1["external_comment_id"] == "189900112233445599"
    assert pred1["label"] == "positive"
    assert pred2["external_comment_id"] == "189900112233445600"
    assert pred2["label"] == "negative"
    assert rec_back.finished_outcome == "succeeded"


def test_e2e_x_missing_scrapers_blocked():
    """Verify XCollector raises comments_scraper_not_configured and finishes as blocked, never empty exhausted."""
    collector = XCollector(channel_id="aljazeera", client=httpx.Client())
    with pytest.raises(CollectionError) as exc:
        list(collector.batches("189900112233445566"))
    assert exc.value.code == "comments_scraper_not_configured"
    assert exc.value.outcome == "blocked"

    backfill_lease = {
        "job_id": "job_x_back_err",
        "lease_token": "token_x_err",
        "external_channel_id": "aljazeera",
        "platform": "x",
        "mode": "backfill",
        "videos": [{"video_id": "v_1", "external_video_id": "189900112233445566", "title": "Tweet"}],
    }
    rec = MockControlPlaneRecorder(backfill_lease)
    builder_fn = make_builder(XCollector, client=httpx.Client())

    _backfill(rec.plane(), backfill_lease, builder_fn)
    assert rec.finished_outcome == "blocked"
    assert rec.finished_reason == "comments_scraper_not_configured"
    assert len(rec.committed_batches) == 0


# ============================================================================
# 2. TIKTOK E2E PIPELINE TESTS
# ============================================================================

def test_e2e_tiktok_pipeline_success():
    """Verify TikTok full lifecycle: handle -> catalogue -> batch comments -> sentiment -> commit."""
    handle = "https://www.tiktok.com/@aljazeera"
    cleaned = TikTokCollector._clean_handle(handle)
    assert cleaned == "aljazeera"

    fixture = {
        "videos": [
            {
                "id": 7455667788990011,
                "desc": "تقرير خاص ومميز حول الذكاء الاصطناعي في الإعلام العربي",
                "create_time": "2026-09-21T11:00:00Z",
                "comment_count": 2,
                "cover_image_url": "https://p16.tiktokcdn.com/cover1.jpg",
            }
        ],
        "comments": {
            "7455667788990011": [
                {
                    "id": 9988776655,
                    "text": "﹢ تقرير ممتاز ومفيد جداً، شكراً لكم",
                    "create_time": "2026-09-21T11:15:00Z",
                    "digg_count": 25,
                    "user": {"unique_id": "usr_10", "nickname": "منى"},
                },
                {
                    "id": 9988776656,
                    "text": "﹦ تقرير عادي جداً ومكرر",
                    "create_time": "2026-09-21T11:20:00Z",
                    "digg_count": 0,
                    "user": {"unique_id": "usr_11", "nickname": "خالد"},
                },
            ]
        },
    }

    # Step A: Discover Phase
    discover_lease = {
        "job_id": "job_tt_disc_1",
        "lease_token": "token_tt_1",
        "external_channel_id": cleaned,
        "platform": "tiktok",
        "mode": "discover",
    }
    rec_disc = MockControlPlaneRecorder(discover_lease)
    builder_fn = make_builder(TikTokCollector, fixture_data=fixture)

    disc_result = _discover(rec_disc.plane(), discover_lease, builder_fn)
    assert disc_result is True
    assert len(rec_disc.committed_catalogues) == 1
    assert len(rec_disc.committed_catalogues[0]) == 1
    video_record = rec_disc.committed_catalogues[0][0]
    assert video_record["external_video_id"] == "7455667788990011"
    assert video_record["kind"] == "video"
    assert video_record["reported_comment_count"] == 2
    assert video_record["thumbnail_url"] == "https://p16.tiktokcdn.com/cover1.jpg"
    assert rec_disc.finished_outcome == "succeeded"

    # Step B: Backfill & Sentiment Analysis Phase
    backfill_lease = {
        "job_id": "job_tt_back_1",
        "lease_token": "token_tt_2",
        "external_channel_id": cleaned,
        "platform": "tiktok",
        "mode": "backfill",
        "videos": [
            {
                "video_id": "v_db_id_201",
                "external_video_id": "7455667788990011",
                "title": "تقرير خاص ومميز حول الذكاء الاصطناعي",
            }
        ],
    }
    rec_back = MockControlPlaneRecorder(backfill_lease)
    analyzer = DeterministicTestAnalyzer()

    back_result = _backfill(rec_back.plane(), backfill_lease, builder_fn, analyzer=analyzer)
    assert back_result is True
    assert len(rec_back.committed_batches) == 1
    committed = rec_back.committed_batches[0]
    assert committed["external_video_id"] == "7455667788990011"
    assert len(committed["comments"]) == 2
    assert len(committed["predictions"]) == 2

    pred1, pred2 = committed["predictions"]
    assert pred1["label"] == "positive"
    assert pred2["label"] == "neutral"
    assert rec_back.finished_outcome == "succeeded"


def test_e2e_tiktok_waf_challenge_detected():
    """Verify TikTok WAF challenge raises CollectionError and marks discovery as blocked, NEVER complete empty."""
    waf_html = """
    <!DOCTYPE html>
    <html>
    <head><title>TikTok Security Check</title></head>
    <body>
      <div id="slardarClient"></div>
      <p id="wci">wafchallengeid: 99128374</p>
    </body>
    </html>
    """
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, text=waf_html)))
    collector = TikTokCollector(channel_id="aljazeera", client=client)

    with pytest.raises(CollectionError) as exc:
        collector.catalogue()
    assert exc.value.code == "tiktok_waf_challenge"
    assert exc.value.outcome == "blocked"
    assert exc.value.retryable is True

    # When runner attempts discover:
    discover_lease = {
        "job_id": "job_tt_waf_disc",
        "lease_token": "token_tt_waf",
        "external_channel_id": "aljazeera",
        "platform": "tiktok",
        "mode": "discover",
    }
    rec = MockControlPlaneRecorder(discover_lease)
    builder_fn = make_builder(TikTokCollector, client=client)

    _discover(rec.plane(), discover_lease, builder_fn)
    assert rec.finished_outcome == "blocked"
    assert rec.finished_reason == "tiktok_waf_challenge"
    assert len(rec.committed_catalogues) == 0


def test_e2e_tiktok_missing_scrapers_blocked():
    """Verify TikTokCollector batches raises comments_scraper_not_configured when unconfigured."""
    collector = TikTokCollector(channel_id="aljazeera", client=httpx.Client())
    with pytest.raises(CollectionError) as exc:
        list(collector.batches("7455667788990011"))
    assert exc.value.code == "comments_scraper_not_configured"
    assert exc.value.outcome == "blocked"


# ============================================================================
# 3. TELEGRAM E2E PIPELINE TESTS
# ============================================================================

def test_e2e_telegram_pipeline_success():
    """Verify Telegram full lifecycle: handle -> HTML catalogue with Arabic counts -> batch replies -> sentiment."""
    handle = "https://t.me/aljazeera"
    cleaned = TelegramCollector._clean_handle(handle)
    assert cleaned == "aljazeera"

    html_content = """
    <div class="tgme_widget_message" data-post="aljazeera/44556">
      <div class="tgme_widget_message_text">عاجل: مؤتمر صحفي هام لمناقشة التطورات الأخيرة في المنطقة</div>
      <time datetime="2026-09-21T12:00:00Z"></time>
      <div class="tgme_widget_message_subtext">45 تعليق</div>
    </div>
    """

    discussion_json = {
        "items": [
            {
                "id": "c_tg_101",
                "text": "﹢ تغطية ممتازة وموفقة دائماً",
                "author_id": "tg_u1",
                "author_name": "سعد",
                "reactions_count": 14,
                "date": "2026-09-21T12:05:00Z",
            },
            {
                "id": "c_tg_102",
                "text": "﹣ خبر صادم ومؤسف جداً",
                "author_id": "tg_u2",
                "author_name": "ريم",
                "reactions_count": 3,
                "date": "2026-09-21T12:10:00Z",
            },
        ],
        "next_checkpoint": None,
    }

    def tg_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/s/aljazeera" in url:
            return httpx.Response(200, text=html_content)
        if "/api/discussion/44556" in url:
            return httpx.Response(200, json=discussion_json)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(tg_handler))

    # Step A: Discover Phase
    discover_lease = {
        "job_id": "job_tg_disc_1",
        "lease_token": "token_tg_1",
        "external_channel_id": cleaned,
        "platform": "telegram",
        "mode": "discover",
    }
    rec_disc = MockControlPlaneRecorder(discover_lease)
    builder_fn = make_builder(TelegramCollector, client=client)

    disc_result = _discover(rec_disc.plane(), discover_lease, builder_fn)
    assert disc_result is True
    assert len(rec_disc.committed_catalogues) == 1
    post_record = rec_disc.committed_catalogues[0][0]
    assert post_record["external_video_id"] == "44556"
    assert post_record["kind"] == "channel_post"
    assert post_record["reported_comment_count"] == 45
    assert "عاجل: مؤتمر صحفي هام" in post_record["title"]
    assert rec_disc.finished_outcome == "succeeded"

    # Step B: Backfill & Sentiment Analysis Phase
    backfill_lease = {
        "job_id": "job_tg_back_1",
        "lease_token": "token_tg_2",
        "external_channel_id": cleaned,
        "platform": "telegram",
        "mode": "backfill",
        "videos": [
            {
                "video_id": "v_db_id_301",
                "external_video_id": "44556",
                "title": "عاجل: مؤتمر صحفي هام",
            }
        ],
    }
    rec_back = MockControlPlaneRecorder(backfill_lease)
    analyzer = DeterministicTestAnalyzer()

    back_result = _backfill(rec_back.plane(), backfill_lease, builder_fn, analyzer=analyzer)
    assert back_result is True
    assert len(rec_back.committed_batches) == 1
    committed = rec_back.committed_batches[0]
    assert committed["external_video_id"] == "44556"
    assert len(committed["comments"]) == 2
    assert len(committed["predictions"]) == 2

    p1, p2 = committed["predictions"]
    assert p1["label"] == "positive"
    assert p2["label"] == "negative"
    assert rec_back.finished_outcome == "succeeded"


def test_e2e_telegram_401_auth_blocked():
    """Verify Telegram discussion returning 401 Unauthorized raises CollectionError and marks run as blocked."""
    def tg_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "UNAUTHORIZED"})

    client = httpx.Client(transport=httpx.MockTransport(tg_handler))
    collector = TelegramCollector(channel_id="aljazeera", client=client)

    with pytest.raises(CollectionError) as exc:
        list(collector.batches("44556", None))
    assert exc.value.code == "telegram_discussion_requires_auth"
    assert exc.value.outcome == "blocked"

    backfill_lease = {
        "job_id": "job_tg_401",
        "lease_token": "token_tg_401",
        "external_channel_id": "aljazeera",
        "platform": "telegram",
        "mode": "backfill",
        "videos": [{"video_id": "v_tg_1", "external_video_id": "44556", "title": "Post"}],
    }
    rec = MockControlPlaneRecorder(backfill_lease)
    builder_fn = make_builder(TelegramCollector, client=client)

    _backfill(rec.plane(), backfill_lease, builder_fn)
    assert rec.finished_outcome == "blocked"
    assert rec.finished_reason == "telegram_discussion_requires_auth"
    assert len(rec.committed_batches) == 0


# ============================================================================
# 4. CROSS-WORKSPACE SINGLE-DATABASE DEDUPLICATION MODEL
# ============================================================================

def test_e2e_cross_workspace_single_database_model():
    """Verify single-database principle: channels, videos, comments, and sentiment are shared across workspaces."""
    channel_handle = "@aljazeera"
    tweet_id = "189900112233445566"

    # Shared canonical storage simulating Postgres unique constraints:
    db_channels = {}
    db_videos = {}
    db_comments = {}
    db_predictions = {}
    workspace_channels = set()  # (workspace_id, channel_id)

    def register_channel(workspace_id: str, platform: str, handle: str) -> str:
        clean_id = XCollector._clean_handle(handle)
        key = (platform, clean_id)
        if key not in db_channels:
            db_channels[key] = f"chan_{platform}_{clean_id}"
        cid = db_channels[key]
        workspace_channels.add((workspace_id, cid))
        return cid

    def commit_video(platform: str, channel_id: str, ext_video_id: str, title: str) -> str:
        key = (platform, ext_video_id)
        if key not in db_videos:
            db_videos[key] = {
                "id": f"vid_{platform}_{ext_video_id}",
                "channel_id": channel_id,
                "title": title,
            }
        return db_videos[key]["id"]

    def commit_comments_and_sentiment(platform: str, vid: str, raw_comments: list[RawComment], analyzer):
        from server.runner import analyse
        predictions = analyse(analyzer, raw_comments)
        for c, p in zip(raw_comments, predictions):
            key = (platform, c.id)
            if key not in db_comments:
                db_comments[key] = {
                    "id": c.id,
                    "video_id": vid,
                    "text": c.text,
                }
                db_predictions[key] = p["label"]

    # 1. Workspace A registers channel_handle
    cid_a = register_channel("ws_alpha", "x", channel_handle)
    vid_a = commit_video("x", cid_a, tweet_id, "تغريدة تحليلية موحدة")
    raw = [
        RawComment(id="c_101", video_id=tweet_id, text="﹢ ممتاز جداً", platform="x"),
        RawComment(id="c_102", video_id=tweet_id, text="﹣ سيء وغير دقيق", platform="x"),
    ]
    analyzer = DeterministicTestAnalyzer()
    commit_comments_and_sentiment("x", vid_a, raw, analyzer)

    assert len(db_channels) == 1
    assert len(db_videos) == 1
    assert len(db_comments) == 2
    assert db_predictions[("x", "c_101")] == "positive"
    assert db_predictions[("x", "c_102")] == "negative"

    # 2. Workspace B registers the same channel
    cid_b = register_channel("ws_beta", "x", channel_handle)
    assert cid_b == cid_a  # Same canonical channel

    vid_b = commit_video("x", cid_b, tweet_id, "تغريدة تحليلية موحدة")
    assert vid_b == vid_a  # Same canonical video

    # Re-committing comments from Workspace B produces zero new rows
    commit_comments_and_sentiment("x", vid_b, raw, analyzer)
    assert len(db_comments) == 2
    assert len(db_predictions) == 2

    # Both workspaces have access to the exact same sentiment data
    assert ("ws_alpha", cid_a) in workspace_channels
    assert ("ws_beta", cid_a) in workspace_channels
