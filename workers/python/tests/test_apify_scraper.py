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
                    "photos": ["https://pbs.twimg.com/media1.jpg"],
                    "author": {"userName": "arab_pulse", "name": "Arab Pulse"},
                },
                {
                    "id": "19002",
                    "text": "تغريدة سريعة للمتابعين",
                    "createdAt": "2026-09-21T03:00:00Z",
                    "reply_count": 0,
                    "author": {"userName": "arab_pulse", "profilePicture": "https://pbs.twimg.com/avatar.jpg"},
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
    assert videos[0]["thumbnail_url"] == "https://pbs.twimg.com/media1.jpg"
    assert videos[0]["field_provenance"]["source"] == "apify"
    assert videos[1]["external_video_id"] == "19002"
    assert videos[1]["thumbnail_url"] == "https://pbs.twimg.com/avatar.jpg"


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

    # 402 Payment Required / Quota Depleted
    c402 = ApifyClient(token="test", client=httpx.Client(transport=httpx.MockTransport(make_handler(402))))
    with pytest.raises(CollectionError) as exc402:
        c402.scrape_x_profile("channel")
    assert exc402.value.code == "apify_quota_depleted"
    assert exc402.value.outcome == "failed"
    assert exc402.value.retryable is False

    # 400 with usage exceeded message
    def usage_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": {"type": "monthly-usage-exceeded", "message": "Monthly usage limit reached"}})

    c_usage = ApifyClient(token="test", client=httpx.Client(transport=httpx.MockTransport(usage_handler)))
    with pytest.raises(CollectionError) as exc_usage:
        c_usage.scrape_x_profile("channel")
    assert exc_usage.value.code == "apify_quota_depleted"
    assert exc_usage.value.retryable is False

    # 403 with platform-feature-disabled / Monthly usage hard limit exceeded
    def hard_limit_403_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"error": {"type": "platform-feature-disabled", "message": "Monthly usage hard limit exceeded"}},
        )

    c_limit403 = ApifyClient(token="test", client=httpx.Client(transport=httpx.MockTransport(hard_limit_403_handler)))
    with pytest.raises(CollectionError) as exc_limit403:
        c_limit403.scrape_facebook_posts("NagdyWP")
    assert exc_limit403.value.code == "apify_quota_depleted"
    assert exc_limit403.value.outcome == "failed"
    assert exc_limit403.value.retryable is False


def test_apify_scrape_facebook_posts_and_comments():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        body = json.loads(request.content.decode("utf-8"))
        seen.append((url, body))
        if "facebook-posts-scraper" in url:
            return httpx.Response(
                200,
                json=[
                    {
                        "postId": "1122334455",
                        "url": "https://www.facebook.com/aljazeera/posts/1122334455",
                        "text": "تغطية مباشرة للأحداث",
                        "time": "2026-09-21T08:00:00.000Z",
                        "comments": 42,
                        "media": [{"__typename": "Video", "thumbnail": "https://cdn.example.com/fb.jpg"}],
                    },
                    {
                        "url": "https://www.facebook.com/aljazeera/posts/pfbid0AbCdEfGhIjKlMnOpQrStUvWxYz",
                        "text": "منشور نصي بلا عدّاد",
                        "media": [],
                    },
                ],
            )
        assert "facebook-comments-scraper" in url
        return httpx.Response(
            200,
            json=[
                {
                    "commentId": "c_1",
                    "text": "تحليل موفق",
                    "date": "2026-09-21T09:00:00.000Z",
                    "likesCount": "7",
                    "profileName": "سارة",
                    "profileId": "u_1",
                },
                {
                    "id": "c_2",
                    "text": "رد على التحليل",
                    "replyToCommentId": "c_1",
                    "profileName": "علي",
                },
            ],
        )

    apify = ApifyClient(token="t", client=httpx.Client(transport=httpx.MockTransport(handler)))
    posts = apify.scrape_facebook_posts("aljazeera", max_items=10)
    assert seen[0][0].startswith("https://api.apify.com/v2/acts/apify~facebook-posts-scraper/")
    assert seen[0][1] == {"startUrls": [{"url": "https://www.facebook.com/aljazeera/"}], "resultsLimit": 10}
    assert [p["external_video_id"] for p in posts] == ["1122334455", "pfbid0AbCdEfGhIjKlMnOpQrStUvWxYz"]
    assert posts[0]["kind"] == "video" and posts[1]["kind"] == "channel_post"
    assert posts[0]["published_at"] == "2026-09-21T08:00:00+00:00"
    assert posts[0]["reported_comment_count"] == 42
    assert posts[0]["thumbnail_url"] == "https://cdn.example.com/fb.jpg"
    assert posts[0]["field_provenance"]["url"] == "https://www.facebook.com/aljazeera/posts/1122334455"
    # Unknown stays unknown: no count, no date, no face.
    assert posts[1]["published_at"] is None
    assert posts[1]["reported_comment_count"] is None
    assert posts[1]["thumbnail_url"] is None

    comments = apify.scrape_facebook_comments("1122334455", handle="aljazeera", max_items=20)
    assert seen[1][1] == {
        "startUrls": [{"url": "https://www.facebook.com/aljazeera/posts/1122334455"}],
        "resultsLimit": 20,
        "includeNestedComments": True,
    }
    assert comments[0] == {
        "id": "c_1",
        "video_id": "1122334455",
        "text": "تحليل موفق",
        "parent_id": None,
        "is_reply": False,
        "published_at": "2026-09-21T09:00:00+00:00",
        "author_name": "سارة",
        "author_channel_id": "u_1",
        "likes_value": 7,
    }
    assert comments[1]["parent_id"] == "c_1" and comments[1]["is_reply"] is True
    assert comments[1]["likes_value"] is None and comments[1]["published_at"] is None


def test_apify_scrape_instagram_posts_and_comments():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        body = json.loads(request.content.decode("utf-8"))
        seen.append((url, body))
        if "instagram-post-scraper" in url:
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "3300011122",
                        "shortCode": "DLNsnpUTdVS",
                        "type": "Video",
                        "productType": "clips",
                        "caption": "ريل قصير عن الذكاء الاصطناعي",
                        "timestamp": "2026-09-22T10:00:00.000Z",
                        "commentsCount": 5,
                        "displayUrl": "https://cdn.example.com/ig.jpg",
                    },
                    {"id": "3300011123", "shortCode": "DLNsAAAAAAA", "type": "Sidecar", "caption": "ألبوم"},
                ],
            )
        assert "instagram-comment-scraper" in url
        return httpx.Response(
            200,
            json=[
                {
                    "id": "17900001",
                    "text": "مفيد جدًا",
                    "timestamp": "2026-09-22T11:00:00.000Z",
                    "likesCount": 3,
                    "ownerUsername": "noura",
                    "owner": {"id": "4411"},
                }
            ],
        )

    apify = ApifyClient(token="t", client=httpx.Client(transport=httpx.MockTransport(handler)))
    posts = apify.scrape_instagram_posts("natgeo", max_items=7)
    assert seen[0][1] == {"username": ["natgeo"], "resultsLimit": 7, "dataDetailLevel": "basicData"}
    assert posts[0]["external_video_id"] == "DLNsnpUTdVS"
    assert posts[0]["kind"] == "short" and posts[1]["kind"] == "channel_post"
    assert posts[0]["reported_comment_count"] == 5 and posts[1]["reported_comment_count"] is None
    assert posts[0]["field_provenance"]["media_id"] == "3300011122"
    assert posts[1]["published_at"] is None

    comments = apify.scrape_instagram_comments("DLNsnpUTdVS", max_items=9)
    assert seen[1][1] == {"directUrls": ["https://www.instagram.com/p/DLNsnpUTdVS/"], "resultsLimit": 9}
    assert comments[0]["id"] == "17900001"
    assert comments[0]["author_name"] == "noura" and comments[0]["author_channel_id"] == "4411"
    assert comments[0]["likes_value"] == 3 and comments[0]["parent_id"] is None
    assert comments[0]["video_id"] == "DLNsnpUTdVS"
