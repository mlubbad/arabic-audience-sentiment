"""Bright Data scraping client for social media platforms (X/Twitter, TikTok, Facebook, Instagram).

Supports Bright Data Datasets/Scraping API and Web Unlocker Proxy.
"""

from datetime import datetime, timezone
import json
import time
import httpx
from ..identity import stable_author_id
from ..meta_graph import parse_graph_time
from ..protocol import CollectionError


class BrightDataClient:
    def __init__(
        self,
        api_key: str | None = None,
        proxy_url: str | None = None,
        browser_ws: str | None = None,
        webdriver_url: str | None = None,
        client: httpx.Client | None = None,
        timeout: float = 60.0,
        dataset_x: str | None = None,
        dataset_x_posts: str | None = None,
        dataset_tiktok: str | None = None,
        dataset_tiktok_posts: str | None = None,
        dataset_tiktok_comments: str | None = None,
        dataset_facebook_posts: str | None = None,
        dataset_facebook_comments: str | None = None,
        dataset_instagram_posts: str | None = None,
        dataset_instagram_comments: str | None = None,
    ):
        if not api_key and not proxy_url and not browser_ws and not webdriver_url:
            raise ValueError("need_brightdata_api_key_or_proxy_url")
        self.api_key = api_key
        self.proxy_url = proxy_url
        self.browser_ws = browser_ws
        self.webdriver_url = webdriver_url
        self.client = client or httpx.Client()
        self.timeout = timeout
        self.dataset_x = dataset_x or "gd_lwxmeb2u1cniijd7t4"  # Bright Data Twitter Profiles dataset
        self.dataset_x_posts = dataset_x_posts or "gd_lwxkxvnf1cynvib9co"  # Bright Data Twitter Posts/Replies dataset
        self.dataset_tiktok = dataset_tiktok or "gd_l1villgoiiidt09ci"  # Bright Data TikTok Profiles dataset
        self.dataset_tiktok_posts = dataset_tiktok_posts or "gd_lu702nij2f790tmv9h"  # Bright Data TikTok Posts dataset
        self.dataset_tiktok_comments = dataset_tiktok_comments or "gd_lkf2st302ap89utw5k"  # Bright Data TikTok Comments dataset
        self.dataset_facebook_posts = dataset_facebook_posts or "gd_lkaxegm826bjpoo9m5"  # Facebook Posts (by page URL)
        self.dataset_facebook_comments = dataset_facebook_comments or "gd_lkay758p1eanlolqw8"  # Facebook Comments
        self.dataset_instagram_posts = dataset_instagram_posts or "gd_lk5ns7kz21pck8jpis"  # Instagram Posts
        self.dataset_instagram_comments = dataset_instagram_comments or "gd_ltppn085pokosxh13"  # Instagram Comments
        self.poll_interval = 3.0
        self.max_wait = 180.0

    def get_proxy_client(self) -> httpx.Client | None:
        """Return an httpx.Client configured with Bright Data Web Unlocker proxy, if configured."""
        if not self.proxy_url:
            return None
        return httpx.Client(proxy=self.proxy_url, timeout=self.timeout)

    def check_webdriver_status(self) -> dict:
        """Query Bright Data Scraping Browser WebDriver endpoint status."""
        if not self.webdriver_url:
            return {"ready": False, "error": "webdriver_url_not_configured"}
        try:
            status_url = f"{self.webdriver_url.rstrip('/')}/status"
            resp = self.client.get(status_url, timeout=self.timeout)
            if resp.status_code == 200:
                return resp.json().get("value", {"ready": True})
            return {"ready": False, "status_code": resp.status_code}
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            return {"ready": False, "error": str(exc)}

    @staticmethod
    def _parse_response_items(resp: httpx.Response) -> list[dict]:
        """Parse JSON array, single JSON object, or NDJSON (JSONL) response."""
        try:
            data = resp.json()
            if isinstance(data, list):
                return [x for x in data if isinstance(x, dict)]
            if isinstance(data, dict):
                if "data" in data and isinstance(data["data"], list):
                    return [x for x in data["data"] if isinstance(x, dict)]
                return [data]
            return []
        except (ValueError, KeyError, TypeError):
            text = (resp.text or "").strip()
            if not text:
                return []
            items: list[dict] = []
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except ValueError:
                    raise CollectionError("invalid_response_format", "failed") from None
                if isinstance(parsed, dict):
                    items.append(parsed)
                elif isinstance(parsed, list):
                    items.extend(x for x in parsed if isinstance(x, dict))
            if not items:
                raise CollectionError("invalid_response_format", "failed")
            return items

    def _poll_snapshot(self, snapshot_id: str, poll_interval: float | None = None, max_wait: float | None = None) -> list[dict]:
        """Poll Bright Data async snapshot until ready and download its JSON records."""
        interval = self.poll_interval if poll_interval is None else poll_interval
        wait_budget = self.max_wait if max_wait is None else max_wait
        headers = {"Authorization": f"Bearer {self.api_key}"}
        progress_url = f"https://api.brightdata.com/datasets/v3/progress/{snapshot_id}"
        snapshot_url = f"https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}?format=json"
        deadline = time.monotonic() + wait_budget
        while time.monotonic() < deadline:
            try:
                prog_resp = self.client.get(progress_url, headers=headers, timeout=30.0)
            except httpx.HTTPError:
                time.sleep(interval)
                continue
            if prog_resp.status_code in (401, 403):
                raise CollectionError("invalid_credentials", "blocked")
            if prog_resp.status_code == 200:
                try:
                    prog_data = prog_resp.json()
                except ValueError:
                    prog_data = {}
                status = str(prog_data.get("status") or "").lower()
                if status == "ready":
                    break
                if status in ("failed", "canceled", "cancelled"):
                    raise CollectionError("brightdata_snapshot_failed", "failed", retryable=True)
            time.sleep(interval)
        else:
            raise CollectionError("scraper_timeout", "failed", retryable=True)

        for _ in range(5):
            try:
                snap_resp = self.client.get(snapshot_url, headers=headers, timeout=self.timeout + 15)
            except httpx.HTTPError:
                raise CollectionError("network_failure", retryable=True) from None
            if snap_resp.status_code == 202:
                time.sleep(interval)
                continue
            if snap_resp.is_error:
                raise CollectionError(f"brightdata_error_{snap_resp.status_code}", "failed", retryable=True)
            return self._parse_response_items(snap_resp)
        raise CollectionError("scraper_timeout", "failed", retryable=True)

    def _scrape_dataset(self, dataset_id: str, urls: list[dict | str]) -> list[dict]:
        """Call Bright Data Datasets Scrape API (with automatic 202 snapshot polling and NDJSON support)."""
        if not self.api_key:
            raise CollectionError("missing_brightdata_api_key", "failed")

        url = f"https://api.brightdata.com/datasets/v3/scrape?dataset_id={dataset_id}"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = [
            {"url": u} if isinstance(u, str) else {k: v for k, v in u.items() if v is not None}
            for u in urls
        ]

        try:
            resp = self.client.post(url, headers=headers, json=payload, timeout=self.timeout + 15)
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

        items = self._parse_response_items(resp)
        if (
            len(items) == 1
            and isinstance(items[0].get("snapshot_id"), str)
            and items[0]["snapshot_id"]
            and not any(k in items[0] for k in ("post_id", "id", "comment_id", "shortcode", "video_id", "tweet_id", "posts", "videos"))
        ):
            return self._poll_snapshot(items[0]["snapshot_id"])
        return items

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
                created_at = p.get("date_posted") or p.get("created_at") or None
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
                created_at = r.get("date_posted") or r.get("created_at") or None
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
                        "author_channel_id": stable_author_id(r.get("user_id")),
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
                    created_at = None

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
                created_at = None

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
                    "author_channel_id": stable_author_id(item.get("user_id")),
                    "likes_value": int(likes) if isinstance(likes, (int, float)) else 0,
                }
            )
        return comments

    # ----- Facebook and Instagram -------------------------------------------
    # Field names differ between dataset versions, so each read tolerates the
    # names seen so far. Unknown stays None.

    def scrape_facebook_posts(self, handle: str, max_items: int = 25) -> list[dict]:
        clean_handle = handle.strip().strip("/")
        raw_items = self._scrape_dataset(
            self.dataset_facebook_posts,
            [{"url": f"https://www.facebook.com/{clean_handle}/", "num_of_posts": max_items}],
        )
        videos = []
        for item in raw_items[:max_items]:
            raw_url = item.get("url")
            url: str = raw_url if isinstance(raw_url, str) else ""
            url_seg = _bd_last_segment(url)
            post_type = str(item.get("post_type") or "").lower()
            is_reel = "/reel/" in url or post_type == "reel"
            if is_reel and url_seg.isdigit():
                post_id = f"reel_{url_seg}"
            elif url_seg.startswith("pfbid"):
                post_id = url_seg
            else:
                post_id = str(item.get("post_id") or item.get("id") or "") or url_seg
            if not post_id:
                continue
            text = _bd_text(item, ("content", "description", "text"))
            raw_attachments = item.get("attachments")
            attachments: list = raw_attachments if isinstance(raw_attachments, list) else []
            is_video = any(isinstance(a, dict) and str(a.get("type", "")).lower() == "video" for a in attachments)
            published_at, _ = parse_graph_time(item.get("date_posted") or item.get("created_at"))
            thumb = (
                _bd_attachment_image(attachments)
                or _bd_text(item, ("thumbnail", "post_external_image", "avatar_image_url", "page_logo"))
                or None
            )
            videos.append(
                {
                    "external_video_id": post_id,
                    "title": text[:100] or f"Post {post_id}",
                    "kind": "short" if is_reel else ("video" if is_video else "channel_post"),
                    "published_at": published_at,
                    "reported_comment_count": _bd_int(item.get("num_comments", item.get("comments"))),
                    "thumbnail_url": thumb,
                    "field_provenance": {
                        "source": "brightdata",
                        "dataset": self.dataset_facebook_posts,
                        "handle": clean_handle,
                        "url": url or None,
                    },
                }
            )
        return videos

    def scrape_facebook_comments(
        self, post_id: str, handle: str | None = None, max_items: int = 50
    ) -> list[dict]:
        if post_id.startswith("reel_"):
            post_url = f"https://www.facebook.com/reel/{post_id.removeprefix('reel_')}/"
        else:
            post_url = f"https://www.facebook.com/{(handle or 'facebook').strip('/')}/posts/{post_id}"
        raw_items = self._scrape_dataset(self.dataset_facebook_comments, [{"url": post_url}])
        return _bd_comments(raw_items[:max_items], post_id)

    def scrape_instagram_posts(self, handle: str, max_items: int = 25) -> list[dict]:
        clean_handle = handle.lstrip("@").strip().strip("/")
        raw_items = self._scrape_dataset(
            self.dataset_instagram_posts, [{"url": f"https://www.instagram.com/{clean_handle}/"}]
        )
        videos = []
        for item in raw_items[:max_items]:
            shortcode = str(item.get("shortcode") or "") or _bd_last_segment(
                item.get("url") if isinstance(item.get("url"), str) else ""
            )
            if not shortcode:
                continue
            text = _bd_text(item, ("description", "caption", "content"))
            content_type = str(item.get("content_type") or item.get("product_type") or "").lower()
            published_at, _ = parse_graph_time(item.get("date_posted") or item.get("created_at"))
            videos.append(
                {
                    "external_video_id": shortcode,
                    "title": text[:100] or f"Post {shortcode}",
                    "kind": "short" if "reel" in content_type or "clips" in content_type
                    else ("video" if "video" in content_type else "channel_post"),
                    "published_at": published_at,
                    "reported_comment_count": _bd_int(item.get("num_comments", item.get("comments"))),
                    "thumbnail_url": _bd_text(item, ("thumbnail", "display_url", "image")) or None,
                    "field_provenance": {
                        "source": "brightdata",
                        "dataset": self.dataset_instagram_posts,
                        "handle": clean_handle,
                        "media_id": str(item.get("post_id")) if item.get("post_id") else None,
                    },
                }
            )
        return videos

    def scrape_instagram_comments(self, shortcode: str, max_items: int = 50) -> list[dict]:
        raw_items = self._scrape_dataset(
            self.dataset_instagram_comments, [{"url": f"https://www.instagram.com/p/{shortcode}/"}]
        )
        return _bd_comments(raw_items[:max_items], shortcode)


def _bd_text(item: dict, keys: tuple) -> str:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _bd_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _bd_last_segment(url: str) -> str:
    return url.split("?")[0].rstrip("/").rsplit("/", 1)[-1] if url else ""


def _bd_attachment_image(attachments: list) -> str | None:
    for a in attachments:
        if isinstance(a, dict):
            for key in ("thumbnail", "url", "image"):
                if isinstance(a.get(key), str) and a[key]:
                    return a[key]
    return None


def _bd_comments(raw_items: list, video_id: str) -> list[dict]:
    comments = []
    seen_cids: set[str] = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("comment_id") or item.get("id") or "")
        if not cid or cid in seen_cids:
            continue
        seen_cids.add(cid)
        parent_id = str(item.get("parent_comment_id") or item.get("reply_to_comment_id") or "") or None
        published_at, _ = parse_graph_time(
            item.get("date_created") or item.get("comment_date") or item.get("created_at")
        )
        comments.append(
            {
                "id": cid,
                "video_id": video_id,
                "text": _bd_text(item, ("comment_text", "comment", "text")),
                "parent_id": parent_id,
                "is_reply": parent_id is not None,
                "published_at": published_at,
                "author_name": _bd_text(item, ("user_name", "comment_user", "name", "author")),
                "author_channel_id": str(item.get("user_id")) if item.get("user_id") else None,
                "likes_value": _bd_int(item.get("num_likes", item.get("likes_number", item.get("likes")))),
            }
        )
    return comments
