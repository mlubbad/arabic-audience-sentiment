"""TikTok collector adapter.

Collects public videos (kind='video' or 'short') and comments from TikTok profiles.
Supports hermetic fixture testing, Display API access token mode, and public web profile fallback.
"""

import json
import re
from collections.abc import Iterator
from datetime import datetime, timezone
import httpx
from .protocol import Batch, Catalogue, CollectionError, RawComment


_HANDLE_REGEX = re.compile(r"^[A-Za-z0-9_.-]{2,30}$")
_VIDEO_ID_REGEX = re.compile(r"^[0-9]{1,30}$")


class TikTokCollector:
    source = "tiktok_display_api"
    revision = "tiktok-adapter-v1"

    def __init__(
        self,
        channel_id: str | None = None,
        client: httpx.Client | None = None,
        access_token: str | None = None,
        fixture_data: dict | None = None,
    ):
        self.channel_id = channel_id
        self.client = client
        self.access_token = access_token
        self.fixture_data = fixture_data

    @staticmethod
    def _clean_handle(channel_id: str) -> str:
        s = channel_id.strip()
        s = re.sub(r"^https?://(www\.)?tiktok\.com/@?", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^tiktok\.com/@?", "", s, flags=re.IGNORECASE)
        s = s.lstrip("@").strip()
        s = s.split("/")[0].split("?")[0]
        if not _HANDLE_REGEX.match(s):
            raise ValueError("invalid_channel_id")
        return s

    @staticmethod
    def _clean_video_id(video_id: str) -> str:
        s = video_id.strip()
        s = s.split("/")[-1].split("?")[0]
        if not _VIDEO_ID_REGEX.match(s):
            raise ValueError("invalid_video_id")
        return s

    def catalogue(self, channel_id: str | None = None) -> Catalogue:
        """List user videos. Each video becomes a record with kind='video'."""
        target = channel_id or self.channel_id
        if not target:
            raise ValueError("missing_channel_id")
        clean_handle = self._clean_handle(target)

        # 1. Fixture mode
        if self.fixture_data and "videos" in self.fixture_data:
            videos_raw = self.fixture_data["videos"]
            videos = []
            for v in videos_raw:
                videos.append(
                    {
                        "external_video_id": str(v["id"]),
                        "title": v.get("desc", "")[:100] or v.get("title", f"Video {v['id']}"),
                        "kind": v.get("kind", "video"),
                        "published_at": v.get("create_time", datetime.now(timezone.utc).isoformat()),
                        "reported_comment_count": v.get("comment_count"),
                        "thumbnail_url": v.get("cover_image_url"),
                        "field_provenance": {"source": self.source, "handle": clean_handle},
                    }
                )
            return Catalogue(videos=videos, complete=True)

        # 2. Access token mode (TikTok Display API v2)
        if self.access_token and self.client:
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
            }
            try:
                resp = self.client.post(
                    "https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,comment_count,cover_image_url",
                    headers=headers,
                    json={"max_count": 20},
                    timeout=20,
                )
            except httpx.HTTPError:
                raise CollectionError("network_failure", retryable=True) from None

            if resp.status_code == 401:
                raise CollectionError("invalid_credentials", "blocked")
            if resp.status_code == 429:
                raise CollectionError("rate_limit_exceeded", "failed", retryable=True)
            if resp.is_error:
                raise CollectionError("api_error", "failed")

            data = resp.json().get("data", {})
            videos_list = data.get("videos", [])
            videos = []
            for v in videos_list:
                videos.append(
                    {
                        "external_video_id": str(v["id"]),
                        "title": v.get("video_description", "")[:100] or v.get("title", f"Video {v['id']}"),
                        "kind": "video",
                        "published_at": (
                            datetime.fromtimestamp(v["create_time"], tz=timezone.utc).isoformat()
                            if isinstance(v.get("create_time"), (int, float))
                            else v.get("create_time")
                        ),
                        "reported_comment_count": v.get("comment_count"),
                        "thumbnail_url": v.get("cover_image_url"),
                        "field_provenance": {"source": self.source, "handle": clean_handle},
                    }
                )
            return Catalogue(videos=videos, complete=True)

        # 3. Public web profile fallback (Zero-key mode)
        if self.client:
            headers = {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "ar,en;q=0.9",
            }
            try:
                resp = self.client.get(
                    f"https://www.tiktok.com/@{clean_handle}",
                    headers=headers,
                    timeout=20,
                    follow_redirects=True,
                )
            except httpx.HTTPError:
                raise CollectionError("network_failure", retryable=True) from None

            if resp.status_code == 404:
                raise CollectionError("channel_not_found", "failed")
            if resp.status_code == 429:
                raise CollectionError("rate_limit_exceeded", "failed", retryable=True)
            if resp.status_code >= 400:
                raise CollectionError(f"http_{resp.status_code}", "failed")

            body = resp.text
            if "private account" in body.lower() or 'isprivate":true' in body.lower():
                raise CollectionError("channel_not_public", "blocked")

            videos = []
            # Extract JSON from __UNIVERSAL_DATA_FOR_REHYDRATION__ or SIGI_STATE
            rehydrate_match = re.search(
                r'<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"\s+type="application/json">(.*?)</script>',
                body,
                re.DOTALL,
            )
            if rehydrate_match:
                try:
                    data = json.loads(rehydrate_match.group(1))
                    user_scope = data.get("__DEFAULT_SCOPE__", {}).get("webapp.user-detail", {})
                    item_list = user_scope.get("itemList", [])
                    item_modules = (
                        data.get("__DEFAULT_SCOPE__", {}).get("webapp.user-detail", {}).get("ItemModule", {})
                    )
                    for item_id in item_list:
                        item = item_modules.get(item_id, {})
                        if not item:
                            continue
                        stats = item.get("stats", {})
                        videos.append(
                            {
                                "external_video_id": str(item_id),
                                "title": item.get("desc", "")[:100] or f"TikTok {item_id}",
                                "kind": "video",
                                "published_at": (
                                    datetime.fromtimestamp(
                                        int(item["createTime"]), tz=timezone.utc
                                    ).isoformat()
                                    if item.get("createTime")
                                    else None
                                ),
                                "reported_comment_count": stats.get("commentCount"),
                                "thumbnail_url": item.get("video", {}).get("cover"),
                                "field_provenance": {"source": self.source, "handle": clean_handle},
                            }
                        )
                except (json.JSONDecodeError, KeyError, ValueError):
                    pass

            # Fallback regex for video links in profile HTML
            if not videos:
                vid_matches = re.finditer(
                    rf'href="https://www\.tiktok\.com/@{re.escape(clean_handle)}/video/([0-9]+)"',
                    body,
                )
                seen_ids = set()
                for m in vid_matches:
                    vid = m.group(1)
                    if vid in seen_ids:
                        continue
                    seen_ids.add(vid)
                    videos.append(
                        {
                            "external_video_id": vid,
                            "title": f"TikTok video {vid}",
                            "kind": "video",
                            "published_at": datetime.now(timezone.utc).isoformat(),
                            "reported_comment_count": None,
                            "thumbnail_url": None,
                            "field_provenance": {"source": self.source, "handle": clean_handle},
                        }
                    )

            return Catalogue(videos=videos, complete=True)

        raise CollectionError("no_transport_configured", "failed")

    def batches(self, video_id: str, checkpoint: str | None = None) -> Iterator[Batch]:
        """Collect comments for a TikTok video."""
        clean_id = self._clean_video_id(video_id)

        # 1. Fixture mode
        if self.fixture_data and "comments" in self.fixture_data:
            raw_comments = self.fixture_data["comments"].get(clean_id, [])
            comments = []
            for c in raw_comments:
                comments.append(
                    RawComment(
                        id=str(c["id"]),
                        video_id=clean_id,
                        text=c.get("text", ""),
                        parent_id=str(c["parent_id"]) if c.get("parent_id") else None,
                        is_reply=bool(c.get("parent_id")),
                        parent_source="tiktok_reply" if c.get("parent_id") else "root",
                        published_at=c.get("create_time", datetime.now(timezone.utc).isoformat()),
                        author_name=c.get("user", {}).get("nickname") or c.get("author_name", ""),
                        author_channel_id=c.get("user", {}).get("unique_id") or c.get("author_id"),
                        likes_value=c.get("digg_count", c.get("likes_count", 0)),
                        source=self.source,
                        platform="tiktok",
                    )
                )
            yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
            return

        # 2. Access token mode (TikTok Display API)
        if self.access_token and self.client:
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
            }
            params = {
                "video_id": clean_id,
                "max_count": 50,
            }
            if checkpoint:
                params["cursor"] = checkpoint

            try:
                resp = self.client.post(
                    "https://open.tiktokapis.com/v2/comment/list/?fields=id,text,create_time,likes_count,parent_comment_id",
                    headers=headers,
                    json=params,
                    timeout=20,
                )
            except httpx.HTTPError:
                raise CollectionError("network_failure", retryable=True) from None

            if resp.status_code == 429:
                raise CollectionError("rate_limit_exceeded", "failed", retryable=True)
            if resp.is_error:
                raise CollectionError("api_error", "failed")

            data = resp.json().get("data", {})
            raw_comments = data.get("comments", [])
            cursor = data.get("cursor")
            has_more = data.get("has_more", False)

            comments = []
            for c in raw_comments:
                comments.append(
                    RawComment(
                        id=str(c["id"]),
                        video_id=clean_id,
                        text=c.get("text", ""),
                        parent_id=str(c["parent_comment_id"]) if c.get("parent_comment_id") else None,
                        is_reply=bool(c.get("parent_comment_id")),
                        parent_source="tiktok_reply" if c.get("parent_comment_id") else "root",
                        published_at=(
                            datetime.fromtimestamp(c["create_time"], tz=timezone.utc).isoformat()
                            if isinstance(c.get("create_time"), (int, float))
                            else c.get("create_time")
                        ),
                        author_name=c.get("author_name", ""),
                        likes_value=c.get("likes_count", 0),
                        source=self.source,
                        platform="tiktok",
                    )
                )
            outcome = "partial" if has_more else "exhausted"
            next_checkpoint = str(cursor) if has_more and cursor is not None else None
            yield Batch(comments=comments, checkpoint=next_checkpoint, outcome=outcome)
            return

        # 3. Public fallback: yields exhausted empty batch
        yield Batch(comments=[], checkpoint=None, outcome="exhausted")
