"""Telegram public channel and discussion collector adapter.

Collects public posts (channel_post) and their reply comments from Telegram channels.
Hermetically testable with synthetic HTTP responses and fixture data.
"""
import json
import re
from collections.abc import Iterator
from datetime import datetime, timezone
import httpx
from .protocol import Batch, Catalogue, CollectionError, RawComment


_HANDLE_REGEX = re.compile(r"^@?[a-zA-Z0-9_]{4,32}$")


class TelegramCollector:
    source = "telegram_mtproto"
    revision = "tg-adapter-v1"

    def __init__(
        self,
        channel_id: str | None = None,
        client: httpx.Client | None = None,
        bot_token: str | None = None,
        api_id: str | None = None,
        api_hash: str | None = None,
        fixture_data: dict | None = None,
    ):
        self.channel_id = channel_id
        self.client = client
        self.bot_token = bot_token
        self.api_id = api_id
        self.api_hash = api_hash
        self.fixture_data = fixture_data

    @staticmethod
    def _clean_handle(channel_id: str) -> str:
        if not _HANDLE_REGEX.match(channel_id):
            raise ValueError("invalid_channel_id")
        return channel_id.lstrip("@")

    def catalogue(self, channel_id: str | None = None) -> Catalogue:
        """List public channel posts.

        Each post becomes a video record with kind='channel_post'.
        """
        target = channel_id or self.channel_id
        if not target:
            raise ValueError("missing_channel_id")
        clean_handle = self._clean_handle(target)

        # 1. Fixture mode
        if self.fixture_data and "posts" in self.fixture_data:
            posts = self.fixture_data["posts"]
            videos = []
            for p in posts:
                videos.append({
                    "external_video_id": str(p["id"]),
                    "title": p.get("text", "")[:100] or f"Post {p['id']}",
                    "kind": "channel_post",
                    "published_at": p.get("date", datetime.now(timezone.utc).isoformat()),
                    "reported_comment_count": p.get("comments_count"),
                    "field_provenance": {"source": self.source, "channel": clean_handle},
                })
            return Catalogue(videos=videos, complete=True)

        # 2. HTTP client mode (public preview endpoint or test mock transport)
        if self.client:
            try:
                resp = self.client.get(
                    f"https://t.me/s/{clean_handle}",
                    timeout=20,
                    follow_redirects=False,
                )
            except httpx.HTTPError:
                raise CollectionError("network_failure", retryable=True) from None

            if resp.status_code == 404:
                raise CollectionError("channel_not_found", "blocked")
            if resp.status_code in (403, 429):
                raise CollectionError("rate_limited", "blocked")
            if resp.status_code >= 500:
                raise CollectionError("server_error", "failed", retryable=True)
            if resp.status_code != 200:
                raise CollectionError(f"http_{resp.status_code}", "failed")

            # Parse posts from response JSON (if mocked API) or HTML
            if "application/json" in resp.headers.get("content-type", ""):
                data = resp.json()
                items = data.get("items", [])
                videos = []
                for item in items:
                    videos.append({
                        "external_video_id": str(item["id"]),
                        "title": (item.get("text") or item.get("title") or f"Post {item['id']}")[:100],
                        "kind": "channel_post",
                        "published_at": item.get("date"),
                        "reported_comment_count": item.get("replies_count"),
                        "field_provenance": {"source": self.source, "channel": clean_handle},
                    })
                return Catalogue(videos=videos, complete=True)

            # HTML fallback: extracts message ids from public t.me/s/ previews
            # Pattern matches message post divs: data-post="handle/123"
            matches = re.findall(rf'data-post="{re.escape(clean_handle)}/(\d+)"', resp.text)
            videos = []
            seen = set()
            for msg_id in matches:
                if msg_id not in seen:
                    seen.add(msg_id)
                    videos.append({
                        "external_video_id": msg_id,
                        "title": f"منشور {msg_id}",
                        "kind": "channel_post",
                        "published_at": datetime.now(timezone.utc).isoformat(),
                        "reported_comment_count": None,
                        "field_provenance": {"source": self.source, "channel": clean_handle},
                    })
            return Catalogue(videos=videos, complete=True)

        # 3. No client or credentials configured
        raise CollectionError("telegram_credentials_missing", "blocked")

    def batches(self, video_id: str, checkpoint: str | None) -> Iterator[Batch]:
        """Fetch replies / discussion comments for a specific channel post."""
        if not video_id or not str(video_id).isalnum():
            raise ValueError("invalid_video_id")

        # 1. Fixture mode
        if self.fixture_data and "comments" in self.fixture_data:
            all_comments = self.fixture_data["comments"].get(str(video_id), [])
            if not all_comments:
                yield Batch(comments=[], checkpoint=None, outcome="exhausted")
                return

            offset = 0
            if checkpoint:
                try:
                    cp = json.loads(checkpoint)
                    offset = cp.get("offset", 0)
                except (json.JSONDecodeError, TypeError, KeyError):
                    offset = 0

            page_size = 20
            page = all_comments[offset:offset + page_size]
            has_more = (offset + page_size) < len(all_comments)

            raw_comments = []
            for c in page:
                raw_comments.append(RawComment(
                    id=str(c["id"]),
                    video_id=str(video_id),
                    text=c["text"],
                    parent_id=str(c["parent_id"]) if c.get("parent_id") else None,
                    is_reply=bool(c.get("parent_id") or c.get("is_reply")),
                    parent_source="api",
                    published_at=c.get("published_at", datetime.now(timezone.utc).isoformat()),
                    timestamp_precision="second",
                    author_channel_id=str(c.get("author_id", "tg_unknown")),
                    author_name=c.get("author_name", "مستخدم تليجرام"),
                    likes_value=c.get("reactions_count", 0),
                    likes_raw=str(c.get("reactions_count", 0)),
                    source=self.source,
                    platform="telegram",
                    field_provenance={"adapter": self.source},
                ))

            next_cp = json.dumps({"offset": offset + page_size}) if has_more else None
            outcome = "partial" if has_more else "exhausted"
            yield Batch(comments=raw_comments, checkpoint=next_cp, outcome=outcome)
            return

        # 2. HTTP client mode
        if self.client:
            try:
                resp = self.client.get(
                    f"https://t.me/api/discussion/{video_id}",
                    params={"checkpoint": checkpoint} if checkpoint else {},
                    timeout=20,
                )
            except httpx.HTTPError:
                raise CollectionError("network_failure", retryable=True) from None

            if resp.status_code == 404:
                yield Batch(comments=[], checkpoint=None, outcome="unavailable")
                return
            if resp.status_code in (403, 429):
                raise CollectionError("rate_limited", "blocked")
            if resp.status_code >= 500:
                raise CollectionError("server_error", "failed", retryable=True)

            try:
                data = resp.json()
            except Exception:
                raise CollectionError("invalid_response") from None

            if data.get("comments_disabled"):
                yield Batch(comments=[], checkpoint=None, outcome="explicitly_disabled")
                return

            items = data.get("items", [])
            raw_comments = []
            for item in items:
                raw_comments.append(RawComment(
                    id=str(item["id"]),
                    video_id=str(video_id),
                    text=item["text"],
                    parent_id=str(item["parent_id"]) if item.get("parent_id") else None,
                    is_reply=bool(item.get("parent_id")),
                    parent_source="api",
                    published_at=item.get("date"),
                    timestamp_precision="second",
                    author_channel_id=str(item.get("author_id", "tg_user")),
                    author_name=item.get("author_name", ""),
                    likes_value=item.get("reactions_count"),
                    likes_raw=str(item.get("reactions_count")) if item.get("reactions_count") is not None else None,
                    source=self.source,
                    platform="telegram",
                    field_provenance={"adapter": self.source},
                ))

            next_token = data.get("next_checkpoint")
            outcome = "partial" if next_token else "exhausted"
            yield Batch(comments=raw_comments, checkpoint=next_token, outcome=outcome)
            return

        # 3. No client or credentials configured
        raise CollectionError("telegram_credentials_missing", "blocked")
