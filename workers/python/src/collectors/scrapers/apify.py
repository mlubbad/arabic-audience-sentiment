"""Apify scraping client for social media platforms (X/Twitter, TikTok, Facebook, Instagram).

Invokes Apify actors via the Apify REST API (run-sync-get-dataset-items).
"""

from datetime import datetime, timezone
import httpx
from ..meta_graph import parse_graph_time
from ..protocol import CollectionError


class ApifyClient:
    def __init__(
        self,
        token: str,
        client: httpx.Client | None = None,
        x_actor: str = "apidojo/tweet-scraper",
        tiktok_actor: str = "clockworks/tiktok-scraper",
        timeout: float = 90.0,
        facebook_posts_actor: str = "apify/facebook-posts-scraper",
        facebook_comments_actor: str = "apify/facebook-comments-scraper",
        instagram_posts_actor: str = "apify/instagram-post-scraper",
        instagram_comments_actor: str = "apify/instagram-comment-scraper",
    ):
        if not token:
            raise ValueError("missing_apify_token")
        self.token = token
        self.client = client or httpx.Client()
        self.x_actor = x_actor
        self.tiktok_actor = tiktok_actor
        self.timeout = timeout
        self.facebook_posts_actor = facebook_posts_actor
        self.facebook_comments_actor = facebook_comments_actor
        self.instagram_posts_actor = instagram_posts_actor
        self.instagram_comments_actor = instagram_comments_actor

    @staticmethod
    def _normalize_actor_id(actor: str) -> str:
        """Apify API URL paths use '~' instead of '/' (e.g. apidojo~tweet-scraper)."""
        return actor.replace("/", "~")

    def _run_actor(self, actor: str, run_input: dict) -> list[dict]:
        actor_path = self._normalize_actor_id(actor)
        url = f"https://api.apify.com/v2/acts/{actor_path}/run-sync-get-dataset-items"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        params = {"timeout": int(self.timeout)}

        try:
            resp = self.client.post(url, headers=headers, json=run_input, params=params, timeout=self.timeout + 15)
        except httpx.HTTPError:
            raise CollectionError("network_failure", retryable=True) from None

        if resp.status_code in (401, 403):
            raise CollectionError("invalid_credentials", "blocked")
        if resp.status_code == 402:
            raise CollectionError("apify_quota_depleted", "failed", retryable=False)
        if resp.status_code == 404:
            raise CollectionError("channel_not_found", "failed")
        if resp.status_code == 429:
            raise CollectionError("rate_limit_exceeded", "failed", retryable=True)
        if resp.status_code in (502, 504):
            raise CollectionError("scraper_timeout", "failed", retryable=True)
        if resp.is_error:
            try:
                err_json = resp.json()
                err_type = str(err_json.get("error", {}).get("type", "")).lower() if isinstance(err_json, dict) else ""
                err_msg = str(err_json.get("error", {}).get("message", "")).lower() if isinstance(err_json, dict) else ""
                if any(x in err_type or x in err_msg for x in ("usage", "credit", "payment", "quota", "plan-limit")):
                    raise CollectionError("apify_quota_depleted", "failed", retryable=False)
            except CollectionError:
                raise
            except (ValueError, KeyError, TypeError):
                pass
            raise CollectionError(f"apify_error_{resp.status_code}", "failed", retryable=True)

        try:
            data = resp.json()
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "items" in data:
                return data["items"]
            return []
        except (ValueError, KeyError, TypeError):
            raise CollectionError("invalid_response_format", "failed") from None

    def scrape_x_profile(self, handle: str, max_items: int = 25) -> list[dict]:
        """Scrape tweets from an X (Twitter) profile."""
        clean_handle = handle.lstrip("@").strip()
        run_input = {
            "twitterHandles": [clean_handle],
            "maxItems": max_items,
            "sort": "Latest",
        }
        raw_items = self._run_actor(self.x_actor, run_input)
        videos = []
        for item in raw_items:
            # Apify actors return varied field names across actors (full_text vs text, id vs id_str)
            tweet_id = str(item.get("id_str") or item.get("id") or item.get("tweet_id") or "")
            if not tweet_id:
                continue
            text = item.get("full_text") or item.get("text") or ""
            author_info = item.get("author") or item.get("user") or {}
            created_at = item.get("createdAt") or item.get("created_at")
            if not created_at:
                created_at = datetime.now(timezone.utc).isoformat()
            comment_count = item.get("replyCount") or item.get("reply_count") or item.get("replies")

            media = item.get("media") or item.get("extendedEntities", {}).get("media") or []
            photos = item.get("photos") or []
            profile_image = author_info.get("profilePicture") or author_info.get("profile_image_url_https")
            thumbnail = None
            if photos and isinstance(photos, list):
                first_photo = photos[0]
                thumbnail = first_photo if isinstance(first_photo, str) else (first_photo.get("url") if isinstance(first_photo, dict) else None)
            elif media and isinstance(media, list):
                first_m = media[0]
                thumbnail = first_m.get("media_url_https") or first_m.get("url") if isinstance(first_m, dict) else None
            if not thumbnail:
                thumbnail = profile_image

            videos.append(
                {
                    "external_video_id": tweet_id,
                    "title": text[:100] or f"Tweet {tweet_id}",
                    "kind": "tweet",
                    "published_at": created_at,
                    "thumbnail_url": thumbnail,
                    "reported_comment_count": comment_count,
                    "field_provenance": {
                        "source": "apify",
                        "actor": self.x_actor,
                        "handle": clean_handle,
                        "author": author_info.get("userName") or clean_handle,
                    },
                }
            )
        return videos

    def scrape_x_replies(self, tweet_id: str, max_items: int = 50) -> list[dict]:
        """Scrape replies to a specific tweet."""
        run_input = {
            "conversationIds": [tweet_id],
            "maxItems": max_items,
        }
        raw_items = self._run_actor(self.x_actor, run_input)
        comments = []
        for item in raw_items:
            item_id = str(item.get("id_str") or item.get("id") or item.get("tweet_id") or "")
            # Skip the root tweet itself if the actor includes it in the conversation thread
            if item_id == tweet_id:
                continue
            if not item_id:
                continue
            text = item.get("full_text") or item.get("text") or ""
            author_info = item.get("author") or item.get("user") or {}
            created_at = item.get("createdAt") or item.get("created_at")
            if not created_at:
                created_at = datetime.now(timezone.utc).isoformat()
            likes = item.get("likeCount") or item.get("like_count") or item.get("likes") or 0
            comments.append(
                {
                    "id": item_id,
                    "video_id": tweet_id,
                    "text": text,
                    "parent_id": str(item.get("inReplyToStatusId") or tweet_id),
                    "is_reply": True,
                    "published_at": created_at,
                    "author_name": author_info.get("name") or author_info.get("userName") or "",
                    "author_channel_id": str(author_info.get("id") or ""),
                    "likes_value": int(likes) if isinstance(likes, (int, float)) else 0,
                }
            )
        return comments

    def scrape_tiktok_profile(self, handle: str, max_items: int = 25) -> list[dict]:
        """Scrape videos from a TikTok profile."""
        clean_handle = handle.lstrip("@").strip()
        run_input = {
            "profiles": [clean_handle],
            "resultsPerPage": max_items,
        }
        raw_items = self._run_actor(self.tiktok_actor, run_input)
        videos = []
        for item in raw_items:
            video_id = str(item.get("id") or item.get("videoId") or "")
            if not video_id:
                continue
            text = item.get("text") or item.get("desc") or item.get("title") or ""
            created_at = item.get("createTimeISO") or item.get("createTime")
            if isinstance(created_at, (int, float)):
                created_at = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()
            elif not created_at:
                created_at = datetime.now(timezone.utc).isoformat()

            stats = item.get("stats") or {}
            comment_count = item.get("commentCount") or stats.get("commentCount")
            video_meta = item.get("video") or {}
            cover = item.get("cover") or video_meta.get("cover")
            videos.append(
                {
                    "external_video_id": video_id,
                    "title": text[:100] or f"Video {video_id}",
                    "kind": "video",
                    "published_at": created_at,
                    "reported_comment_count": comment_count,
                    "thumbnail_url": cover,
                    "field_provenance": {
                        "source": "apify",
                        "actor": self.tiktok_actor,
                        "handle": clean_handle,
                    },
                }
            )
        return videos

    def scrape_tiktok_comments(
        self, video_id: str, handle: str | None = None, max_items: int = 50
    ) -> list[dict]:
        """Scrape comments for a TikTok video."""
        video_url = f"https://www.tiktok.com/@{handle or 'user'}/video/{video_id}"
        run_input = {
            "postURLs": [video_url],
            "commentsPerPost": max_items,
        }
        raw_items = self._run_actor(self.tiktok_actor, run_input)
        comments = []
        for item in raw_items:
            cid = str(item.get("id") or item.get("cid") or "")
            if not cid:
                continue
            text = item.get("text") or item.get("comment") or ""
            created_at = item.get("createTimeISO") or item.get("createTime")
            if isinstance(created_at, (int, float)):
                created_at = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()
            elif not created_at:
                created_at = datetime.now(timezone.utc).isoformat()

            author = item.get("user") or item.get("author") or {}
            likes = item.get("diggCount") or item.get("likes") or 0
            comments.append(
                {
                    "id": cid,
                    "video_id": video_id,
                    "text": text,
                    "parent_id": str(item["replyToReplyId"]) if item.get("replyToReplyId") else None,
                    "is_reply": bool(item.get("replyToReplyId")),
                    "published_at": created_at,
                    "author_name": author.get("nickname") or author.get("uniqueId") or "",
                    "author_channel_id": str(author.get("id") or author.get("uid") or ""),
                    "likes_value": int(likes) if isinstance(likes, (int, float)) else 0,
                }
            )
        return comments

    # ----- Facebook and Instagram -------------------------------------------
    # These four keep every unknown unknown: a missing count is None, a
    # missing date is None, a missing like count is None. Nothing is now().

    def scrape_facebook_posts(self, handle: str, max_items: int = 25) -> list[dict]:
        """Posts of a public Facebook page, newest first as the actor lists them."""
        clean_handle = handle.strip().strip("/")
        run_input = {
            "startUrls": [{"url": f"https://www.facebook.com/{clean_handle}/"}],
            "resultsLimit": max_items,
        }
        videos = []
        for item in self._run_actor(self.facebook_posts_actor, run_input):
            url = item.get("url") if isinstance(item.get("url"), str) else ""
            post_id = str(item.get("postId") or "") or _last_path_segment(url)
            if not post_id:
                continue
            text = item.get("text") if isinstance(item.get("text"), str) else ""
            media = item.get("media") if isinstance(item.get("media"), list) else []
            is_video = any(isinstance(m, dict) and m.get("__typename") == "Video" for m in media)
            published_at, _ = parse_graph_time(item.get("time") or item.get("timestamp"))
            videos.append(
                {
                    "external_video_id": post_id,
                    "title": text[:100] or f"Post {post_id}",
                    "kind": "video" if is_video else "channel_post",
                    "published_at": published_at,
                    "reported_comment_count": _int_or_none(item.get("comments")),
                    "thumbnail_url": _first_media_image(media),
                    "field_provenance": {
                        "source": "apify",
                        "actor": self.facebook_posts_actor,
                        "handle": clean_handle,
                        "url": url or None,
                    },
                }
            )
        return videos

    def scrape_facebook_comments(
        self, post_id: str, handle: str | None = None, max_items: int = 50
    ) -> list[dict]:
        """Comments and replies of one Facebook post."""
        post_url = f"https://www.facebook.com/{(handle or 'facebook').strip('/')}/posts/{post_id}"
        run_input = {
            "startUrls": [{"url": post_url}],
            "resultsLimit": max_items,
            "includeNestedComments": True,
        }
        comments = []
        for item in self._run_actor(self.facebook_comments_actor, run_input):
            cid = str(item.get("commentId") or item.get("id") or "")
            if not cid:
                continue
            parent = item.get("parentComment") if isinstance(item.get("parentComment"), dict) else {}
            parent_id = str(item.get("replyToCommentId") or parent.get("id") or "") or None
            published_at, _ = parse_graph_time(item.get("date"))
            comments.append(
                {
                    "id": cid,
                    "video_id": post_id,
                    "text": item.get("text") if isinstance(item.get("text"), str) else "",
                    "parent_id": parent_id,
                    "is_reply": parent_id is not None,
                    "published_at": published_at,
                    "author_name": item.get("profileName") if isinstance(item.get("profileName"), str) else "",
                    "author_channel_id": str(item.get("profileId")) if item.get("profileId") else None,
                    "likes_value": _int_or_none(item.get("likesCount")),
                }
            )
        return comments

    def scrape_instagram_posts(self, handle: str, max_items: int = 25) -> list[dict]:
        """Posts and reels of a public Instagram account; the shortcode is the id."""
        clean_handle = handle.lstrip("@").strip().strip("/")
        run_input = {"username": [clean_handle], "resultsLimit": max_items, "dataDetailLevel": "basicData"}
        videos = []
        for item in self._run_actor(self.instagram_posts_actor, run_input):
            shortcode = str(item.get("shortCode") or item.get("id") or "")
            if not shortcode:
                continue
            caption = item.get("caption") if isinstance(item.get("caption"), str) else ""
            published_at, _ = parse_graph_time(item.get("timestamp"))
            videos.append(
                {
                    "external_video_id": shortcode,
                    "title": caption[:100] or f"Post {shortcode}",
                    "kind": _instagram_kind(item.get("type"), item.get("productType")),
                    "published_at": published_at,
                    "reported_comment_count": _int_or_none(item.get("commentsCount")),
                    "thumbnail_url": item.get("displayUrl") if isinstance(item.get("displayUrl"), str) else None,
                    "field_provenance": {
                        "source": "apify",
                        "actor": self.instagram_posts_actor,
                        "handle": clean_handle,
                        "media_id": str(item.get("id")) if item.get("id") else None,
                        "url": item.get("url") if isinstance(item.get("url"), str) else None,
                    },
                }
            )
        return videos

    def scrape_instagram_comments(self, shortcode: str, max_items: int = 50) -> list[dict]:
        """Comments of one Instagram post or reel, by its shortcode."""
        run_input = {
            "directUrls": [f"https://www.instagram.com/p/{shortcode}/"],
            "resultsLimit": max_items,
        }
        comments = []
        for item in self._run_actor(self.instagram_comments_actor, run_input):
            cid = str(item.get("id") or "")
            if not cid:
                continue
            owner = item.get("owner") if isinstance(item.get("owner"), dict) else {}
            parent_id = str(item.get("parentCommentId") or "") or None
            published_at, _ = parse_graph_time(item.get("timestamp"))
            comments.append(
                {
                    "id": cid,
                    "video_id": shortcode,
                    "text": item.get("text") if isinstance(item.get("text"), str) else "",
                    "parent_id": parent_id,
                    "is_reply": parent_id is not None,
                    "published_at": published_at,
                    "author_name": item.get("ownerUsername") if isinstance(item.get("ownerUsername"), str) else "",
                    "author_channel_id": str(owner.get("id")) if owner.get("id") else None,
                    "likes_value": _int_or_none(item.get("likesCount")),
                }
            )
        return comments


def _int_or_none(value: object) -> int | None:
    """An integer the source stated, or None. Never 0 for an absent value."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _last_path_segment(url: str) -> str:
    return url.split("?")[0].rstrip("/").rsplit("/", 1)[-1] if url else ""


def _first_media_image(media: list) -> str | None:
    for m in media:
        if not isinstance(m, dict):
            continue
        for key in ("thumbnail", "url"):
            if isinstance(m.get(key), str) and m[key]:
                return m[key]
        for nested in ("photo_image", "image"):
            inner = m.get(nested)
            if isinstance(inner, dict) and isinstance(inner.get("uri"), str) and inner["uri"]:
                return inner["uri"]
    return None


def _instagram_kind(media_type: object, product_type: object) -> str:
    if media_type == "Video":
        return "short" if product_type == "clips" else "video"
    return "channel_post"
