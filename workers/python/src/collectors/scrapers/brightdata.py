"""Bright Data scraping client for social media platforms (X/Twitter and TikTok).

Supports Bright Data Datasets/Scraping API and Web Unlocker Proxy.
"""

from datetime import datetime, timezone
import httpx
from ..protocol import CollectionError


class BrightDataClient:
    def __init__(
        self,
        api_key: str | None = None,
        proxy_url: str | None = None,
        client: httpx.Client | None = None,
        timeout: float = 60.0,
        dataset_x: str | None = None,
        dataset_x_posts: str | None = None,
        dataset_tiktok: str | None = None,
        dataset_tiktok_posts: str | None = None,
        dataset_tiktok_comments: str | None = None,
    ):
        if not api_key and not proxy_url:
            raise ValueError("need_brightdata_api_key_or_proxy_url")
        self.api_key = api_key
        self.proxy_url = proxy_url
        self.client = client or httpx.Client()
        self.timeout = timeout
        self.dataset_x = dataset_x or "gd_lwxmeb2u1cniijd7t4"  # Bright Data Twitter Profiles dataset
        self.dataset_x_posts = dataset_x_posts or "gd_lwxkxvnf1cynvib9co"  # Bright Data Twitter Posts/Replies dataset
        self.dataset_tiktok = dataset_tiktok or "gd_l1villgoiiidt09ci"  # Bright Data TikTok Profiles dataset
        self.dataset_tiktok_posts = dataset_tiktok_posts or "gd_lu702nij2f790tmv9h"  # Bright Data TikTok Posts dataset
        self.dataset_tiktok_comments = dataset_tiktok_comments or "gd_lkf2st302ap89utw5k"  # Bright Data TikTok Comments dataset

    def get_proxy_client(self) -> httpx.Client | None:
        """Return an httpx.Client configured with Bright Data Web Unlocker proxy, if configured."""
        if not self.proxy_url:
            return None
        return httpx.Client(proxy=self.proxy_url, timeout=self.timeout)

    def _scrape_dataset(self, dataset_id: str, urls: list[dict | str]) -> list[dict]:
        """Call Bright Data Datasets Scrape API."""
        if not self.api_key:
            raise CollectionError("missing_brightdata_api_key", "failed")

        url = f"https://api.brightdata.com/datasets/v3/scrape?dataset_id={dataset_id}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        # Format payload: list of objects containing 'url'
        payload = [{"url": u if isinstance(u, str) else u.get("url")} for u in urls]

        try:
            resp = self.client.post(url, headers=headers, json=payload, timeout=self.timeout + 10)
        except httpx.HTTPError:
            raise CollectionError("network_failure", retryable=True) from None

        if resp.status_code == 401 or resp.status_code == 403:
            raise CollectionError("invalid_credentials", "blocked")
        if resp.status_code == 404:
            raise CollectionError("channel_not_found", "failed")
        if resp.status_code == 429:
            raise CollectionError("rate_limit_exceeded", "failed", retryable=True)
        if resp.is_error:
            raise CollectionError(f"brightdata_error_{resp.status_code}", "failed", retryable=True)

        try:
            data = resp.json()
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                if "data" in data and isinstance(data["data"], list):
                    return data["data"]
                return [data]
            return []
        except Exception:
            raise CollectionError("invalid_response_format", "failed") from None

    def scrape_x_profile(self, handle: str, max_items: int = 25) -> list[dict]:
        """Scrape tweets from an X (Twitter) profile using Bright Data."""
        clean_handle = handle.lstrip("@").strip()
        target_url = f"https://x.com/{clean_handle}"
        raw_items = self._scrape_dataset(self.dataset_x, [{"url": target_url}])
        videos = []
        for item in raw_items:
            profile_image = (
                item.get("profile_image_link")
                or item.get("profile_image")
                or item.get("avatar")
                or item.get("profile_picture")
            )
            posts = item.get("posts") if isinstance(item.get("posts"), list) else [item]
            for p in posts:
                tweet_id = str(p.get("post_id") or p.get("id") or p.get("tweet_id") or "")
                if not tweet_id:
                    continue
                text = p.get("description") or p.get("text") or p.get("content") or ""
                created_at = p.get("date_posted") or p.get("created_at")
                if not created_at:
                    created_at = datetime.now(timezone.utc).isoformat()
                comment_count = p.get("replies") or p.get("comments") or p.get("reply_count") or 0

                # Extract thumbnail: post media if available, fallback to profile avatar
                photos = p.get("photos")
                thumbnail = None
                if isinstance(photos, list) and photos:
                    first_p = photos[0]
                    thumbnail = first_p if isinstance(first_p, str) else (first_p.get("url") or first_p.get("src") if isinstance(first_p, dict) else None)
                elif isinstance(photos, str):
                    thumbnail = photos

                if not thumbnail:
                    videos_media = p.get("videos")
                    if isinstance(videos_media, list) and videos_media:
                        first_v = videos_media[0]
                        thumbnail = first_v if isinstance(first_v, str) else (first_v.get("thumbnail") or first_v.get("cover") or first_v.get("url") if isinstance(first_v, dict) else None)

                if not thumbnail:
                    thumbnail = p.get("thumbnail") or p.get("cover") or profile_image

                videos.append(
                    {
                        "external_video_id": tweet_id,
                        "title": text[:100] or f"Tweet {tweet_id}",
                        "kind": "tweet",
                        "published_at": created_at,
                        "thumbnail_url": thumbnail,
                        "reported_comment_count": comment_count,
                        "field_provenance": {
                            "source": "brightdata",
                            "dataset": self.dataset_x,
                            "handle": clean_handle,
                        },
                    }
                )
                if len(videos) >= max_items:
                    break
            if len(videos) >= max_items:
                break
        return videos

    def scrape_x_replies(self, tweet_id: str, handle: str | None = None, max_items: int = 50) -> list[dict]:
        """Scrape replies for a tweet using Bright Data."""
        user = handle or "user"
        target_url = f"https://x.com/{user}/status/{tweet_id}"
        raw_items = self._scrape_dataset(self.dataset_x_posts, [{"url": target_url}])
        comments = []
        for item in raw_items:
            replies = item.get("replies_data") or item.get("replies") if isinstance(item.get("replies"), list) else [item]
            for r in replies:
                cid = str(r.get("id") or r.get("comment_id") or r.get("reply_id") or r.get("post_id") or "")
                if cid == tweet_id or not cid:
                    continue
                text = r.get("text") or r.get("description") or r.get("comment") or ""
                created_at = r.get("date_posted") or r.get("created_at") or datetime.now(timezone.utc).isoformat()
                author_name = r.get("user_name") or r.get("name") or r.get("author") or ""
                likes = r.get("likes") or r.get("like_count") or 0
                comments.append(
                    {
                        "id": cid,
                        "video_id": tweet_id,
                        "text": text,
                        "parent_id": tweet_id,
                        "is_reply": True,
                        "published_at": created_at,
                        "author_name": author_name,
                        "author_channel_id": str(r.get("user_id") or r.get("user_posted") or ""),
                        "likes_value": int(likes) if isinstance(likes, (int, float)) else 0,
                    }
                )
                if len(comments) >= max_items:
                    break
            if len(comments) >= max_items:
                break
        return comments

    def scrape_tiktok_profile(self, handle: str, max_items: int = 25) -> list[dict]:
        """Scrape videos from a TikTok profile using Bright Data."""
        clean_handle = handle.lstrip("@").strip()
        target_url = f"https://www.tiktok.com/@{clean_handle}"
        raw_items = self._scrape_dataset(self.dataset_tiktok, [{"url": target_url}])
        videos = []
        for item in raw_items:
            profile_image = item.get("avatar") or item.get("profile_image") or item.get("avatar_larger")
            posts = item.get("posts") or item.get("videos") if isinstance(item.get("posts") or item.get("videos"), list) else [item]
            for p in posts:
                video_id = str(p.get("id") or p.get("video_id") or p.get("item_id") or "")
                if not video_id:
                    continue
                text = p.get("description") or p.get("title") or p.get("desc") or ""
                created_at = p.get("create_time") or p.get("created_at")
                if isinstance(created_at, (int, float)):
                    created_at = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()
                elif not created_at:
                    created_at = datetime.now(timezone.utc).isoformat()

                comment_count = p.get("comments") or p.get("comment_count")
                cover = p.get("cover") or p.get("thumbnail") or p.get("dynamic_cover") or profile_image
                videos.append(
                    {
                        "external_video_id": video_id,
                        "title": text[:100] or f"Video {video_id}",
                        "kind": "video",
                        "published_at": created_at,
                        "reported_comment_count": comment_count,
                        "thumbnail_url": cover,
                        "field_provenance": {
                            "source": "brightdata",
                            "dataset": self.dataset_tiktok,
                            "handle": clean_handle,
                        },
                    }
                )
                if len(videos) >= max_items:
                    break
            if len(videos) >= max_items:
                break
        return videos

    def scrape_tiktok_comments(
        self, video_id: str, handle: str | None = None, max_items: int = 50
    ) -> list[dict]:
        """Scrape comments for a TikTok video using Bright Data."""
        target_url = f"https://www.tiktok.com/@{handle or 'user'}/video/{video_id}"
        raw_items = self._scrape_dataset(self.dataset_tiktok_comments, [{"url": target_url}])
        comments = []
        for item in raw_items[:max_items]:
            cid = str(item.get("id") or item.get("comment_id") or "")
            if not cid:
                continue
            text = item.get("comment") or item.get("text") or ""
            created_at = item.get("create_time") or item.get("created_at")
            if isinstance(created_at, (int, float)):
                created_at = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()
            elif not created_at:
                created_at = datetime.now(timezone.utc).isoformat()

            author = item.get("user") or item.get("author") or {}
            author_name = author.get("nickname") or author.get("uniqueId") or item.get("user_name") or ""
            likes = item.get("likes") or item.get("digg_count") or 0
            comments.append(
                {
                    "id": cid,
                    "video_id": video_id,
                    "text": text,
                    "parent_id": None,
                    "is_reply": False,
                    "published_at": created_at,
                    "author_name": author_name,
                    "author_channel_id": str(item.get("user_id") or ""),
                    "likes_value": int(likes) if isinstance(likes, (int, float)) else 0,
                }
            )
        return comments
