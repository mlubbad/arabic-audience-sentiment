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
        dataset_tiktok: str | None = None,
    ):
        if not api_key and not proxy_url:
            raise ValueError("need_brightdata_api_key_or_proxy_url")
        self.api_key = api_key
        self.proxy_url = proxy_url
        self.client = client or httpx.Client()
        self.timeout = timeout
        self.dataset_x = dataset_x or "gd_l1viktl72bvl7bjuj0"  # default Bright Data Twitter dataset id
        self.dataset_tiktok = dataset_tiktok or "gd_l1viktl72bvl7bjtik"  # default Bright Data TikTok dataset id

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
            if isinstance(data, dict) and "data" in data:
                return data["data"]
            return []
        except Exception:
            raise CollectionError("invalid_response_format", "failed") from None

    def scrape_x_profile(self, handle: str, max_items: int = 25) -> list[dict]:
        """Scrape tweets from an X (Twitter) profile using Bright Data."""
        clean_handle = handle.lstrip("@").strip()
        target_url = f"https://x.com/{clean_handle}"
        raw_items = self._scrape_dataset(self.dataset_x, [{"url": target_url}])
        videos = []
        for item in raw_items[:max_items]:
            tweet_id = str(item.get("id") or item.get("tweet_id") or item.get("post_id") or "")
            if not tweet_id:
                continue
            text = item.get("text") or item.get("content") or item.get("description") or ""
            created_at = item.get("date_posted") or item.get("created_at")
            if not created_at:
                created_at = datetime.now(timezone.utc).isoformat()
            comment_count = item.get("replies") or item.get("comments") or item.get("reply_count")
            videos.append(
                {
                    "external_video_id": tweet_id,
                    "title": text[:100] or f"Tweet {tweet_id}",
                    "kind": "tweet",
                    "published_at": created_at,
                    "reported_comment_count": comment_count,
                    "field_provenance": {
                        "source": "brightdata",
                        "dataset": self.dataset_x,
                        "handle": clean_handle,
                    },
                }
            )
        return videos

    def scrape_x_replies(self, tweet_id: str, handle: str | None = None, max_items: int = 50) -> list[dict]:
        """Scrape replies for a tweet using Bright Data."""
        user = handle or "user"
        target_url = f"https://x.com/{user}/status/{tweet_id}"
        raw_items = self._scrape_dataset(self.dataset_x, [{"url": target_url}])
        comments = []
        for item in raw_items[:max_items]:
            cid = str(item.get("id") or item.get("comment_id") or item.get("reply_id") or "")
            if cid == tweet_id or not cid:
                continue
            text = item.get("text") or item.get("comment") or ""
            created_at = item.get("date_posted") or item.get("created_at") or datetime.now(timezone.utc).isoformat()
            author_name = item.get("user_name") or item.get("author") or ""
            likes = item.get("likes") or item.get("like_count") or 0
            comments.append(
                {
                    "id": cid,
                    "video_id": tweet_id,
                    "text": text,
                    "parent_id": tweet_id,
                    "is_reply": True,
                    "published_at": created_at,
                    "author_name": author_name,
                    "author_channel_id": str(item.get("user_id") or ""),
                    "likes_value": int(likes) if isinstance(likes, (int, float)) else 0,
                }
            )
        return comments

    def scrape_tiktok_profile(self, handle: str, max_items: int = 25) -> list[dict]:
        """Scrape videos from a TikTok profile using Bright Data."""
        clean_handle = handle.lstrip("@").strip()
        target_url = f"https://www.tiktok.com/@{clean_handle}"
        raw_items = self._scrape_dataset(self.dataset_tiktok, [{"url": target_url}])
        videos = []
        for item in raw_items[:max_items]:
            video_id = str(item.get("id") or item.get("video_id") or "")
            if not video_id:
                continue
            text = item.get("description") or item.get("title") or item.get("desc") or ""
            created_at = item.get("create_time") or item.get("created_at")
            if isinstance(created_at, (int, float)):
                created_at = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()
            elif not created_at:
                created_at = datetime.now(timezone.utc).isoformat()

            comment_count = item.get("comments") or item.get("comment_count")
            cover = item.get("cover") or item.get("thumbnail")
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
        return videos

    def scrape_tiktok_comments(
        self, video_id: str, handle: str | None = None, max_items: int = 50
    ) -> list[dict]:
        """Scrape comments for a TikTok video using Bright Data."""
        target_url = f"https://www.tiktok.com/@{handle or 'user'}/video/{video_id}"
        raw_items = self._scrape_dataset(self.dataset_tiktok, [{"url": target_url}])
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
