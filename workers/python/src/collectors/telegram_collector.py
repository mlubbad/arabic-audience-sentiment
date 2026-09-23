"""Telegram public channel and discussion collector adapter.

Collects public posts (channel_post) and their reply comments from Telegram channels.
Hermetically testable with synthetic HTTP responses and fixture data.
"""
import html
import json
import re
import uuid
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
        s = channel_id.strip()
        s = re.sub(r"^https?://(www\.)?t\.me/(s/)?", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^t\.me/(s/)?", "", s, flags=re.IGNORECASE)
        s = s.lstrip("@").strip()
        s = s.split("/")[0].split("?")[0]
        if not _HANDLE_REGEX.match(s):
            raise ValueError("invalid_channel_id")
        return s

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
                    "thumbnail_url": p.get("thumbnail_url") or p.get("photo"),
                    "reported_comment_count": p.get("comments_count"),
                    "comments_state": p.get("comments_state", "open"),
                    "field_provenance": {"source": self.source, "channel": clean_handle},
                })
            return Catalogue(videos=videos, complete=True)

        # 2. HTTP client mode (public preview endpoint or test mock transport)
        if self.client:
            try:
                resp = self.client.get(
                    f"https://t.me/s/{clean_handle}",
                    timeout=20,
                    follow_redirects=True,
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

            # Check if Telegram redirected to a user profile or private channel join page
            if "<title>Telegram: Contact @" in resp.text:
                raise CollectionError("channel_not_public", "blocked")

            # Parse posts from response JSON (if mocked API) or HTML
            if "application/json" in resp.headers.get("content-type", ""):
                data = resp.json()
                items = data.get("items", [])
                videos = []
                for item in items:
                    videos.append({
                        "external_video_id": str(item["id"]),
                        "title": (item.get("text") or item.get("title") or f"Post {item['id']}")[:120],
                        "kind": "channel_post",
                        "published_at": item.get("date"),
                        "reported_comment_count": item.get("replies_count"),
                        "comments_state": item.get("comments_state", "open"),
                        "field_provenance": {"source": self.source, "channel": clean_handle},
                    })
                return Catalogue(videos=videos, complete=True)

            # HTML fallback: extracts message divs from public t.me/s/ previews
            # Pattern matches message post divs: data-post="handle/123"
            blocks = re.findall(
                r'(<div class="tgme_widget_message\b[^"]*"[^>]*data-post="[^"]+/(\d+)".*?)(?=<div class="tgme_widget_message\b|\Z)',
                resp.text,
                re.DOTALL,
            )
            videos = []
            seen = set()
            for block, msg_id in blocks:
                if msg_id not in seen:
                    seen.add(msg_id)
                    text_m = re.search(
                        r'class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>',
                        block,
                        re.DOTALL,
                    )
                    raw_text = text_m.group(1) if text_m else ""
                    clean_text = re.sub(r'<[^>]+>', ' ', raw_text).strip()
                    clean_text = html.unescape(clean_text)
                    title = clean_text[:120].strip() if clean_text else f"منشور {msg_id}"

                    time_m = re.search(r'<time datetime="([^"]+)"', block)
                    pub_time = time_m.group(1) if time_m else datetime.now(timezone.utc).isoformat()

                    replies_m = re.search(
                        r'class="tgme_widget_message_subtext"[^>]*>(\d+)\s*(?:comment|repl|تعليق|رد|مناقشة)',
                        block,
                        re.IGNORECASE,
                    )
                    count = int(replies_m.group(1)) if replies_m else None

                    thumb_m = re.search(
                        r'(?:tgme_widget_message_photo_wrap|tgme_widget_message_video_thumb)[^>]*style="[^"]*background-image:url\(\x27([^\x27]+)\x27\)',
                        block,
                    )
                    thumbnail_url = thumb_m.group(1) if thumb_m else None

                    videos.append({
                        "external_video_id": msg_id,
                        "title": title,
                        "kind": "channel_post",
                        "published_at": pub_time,
                        "thumbnail_url": thumbnail_url,
                        "reported_comment_count": count,
                        "comments_state": "open",
                        "field_provenance": {"source": self.source, "channel": clean_handle},
                    })

            # If block parsing yielded nothing but data-post is present (minimal HTML)
            if not videos:
                matches = re.findall(rf'data-post="{re.escape(clean_handle)}/(\d+)"', resp.text)
                for msg_id in matches:
                    if msg_id not in seen:
                        seen.add(msg_id)
                        videos.append({
                            "external_video_id": msg_id,
                            "title": f"منشور {msg_id}",
                            "kind": "channel_post",
                            "published_at": datetime.now(timezone.utc).isoformat(),
                            "reported_comment_count": None,
                            "comments_state": "open",
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
            urls = []
            if self.channel_id:
                try:
                    clean_ch = self._clean_handle(self.channel_id)
                except ValueError:
                    clean_ch = self.channel_id.lstrip("@").strip()
                urls.append(f"https://t.me/{clean_ch}/{video_id}?embed=1&discussion=1")
            urls.append(f"https://t.me/api/discussion/{video_id}")

            resp = None
            for u in urls:
                try:
                    resp = self.client.get(
                        u,
                        params={"checkpoint": checkpoint} if checkpoint else None,
                        timeout=20,
                    )
                except httpx.HTTPError:
                    raise CollectionError("network_failure", retryable=True) from None
                if resp.status_code != 404:
                    break

            if resp is None:
                raise CollectionError("network_failure", retryable=True)

            if resp.status_code == 401:
                raise CollectionError("telegram_discussion_requires_auth", "blocked")
            if resp.status_code == 404:
                yield Batch(comments=[], checkpoint=None, outcome="unavailable")
                return
            if resp.status_code in (403, 429):
                raise CollectionError("rate_limited", "blocked")
            if resp.status_code >= 500:
                raise CollectionError("server_error", "failed", retryable=True)
            if resp.status_code != 200:
                raise CollectionError(f"http_{resp.status_code}", "failed")

            # Check if JSON response (e.g. mock API transport)
            is_json = "application/json" in resp.headers.get("content-type", "") or resp.text.strip().startswith("{")
            if is_json:
                try:
                    data = resp.json()
                except Exception:
                    data = None

                if data is not None:
                    if data.get("error") == "UNAUTHORIZED":
                        raise CollectionError("telegram_discussion_requires_auth", "blocked")

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

            # HTML discussion embed response
            if "Discussion is not available at the moment" in resp.text:
                yield Batch(comments=[], checkpoint=None, outcome="explicitly_disabled")
                return

            if "Please open Telegram to view this discussion" in resp.text:
                raise CollectionError("telegram_discussion_requires_auth", "blocked")

            comment_wraps = re.findall(
                r'(<div class="tgme_widget_message_wrap\b[^"]*"[^>]*>.*?)(?=<div class="tgme_widget_message_wrap\b|\Z)',
                resp.text,
                re.DOTALL,
            )
            raw_comments = []
            for b in comment_wraps:
                author_m = re.search(r'class="tgme_widget_message_author_name"[^>]*>(.*?)</span>', b)
                text_m = re.search(r'class="tgme_widget_message_text\b[^"]*"[^>]*>(.*?)</div>', b, re.DOTALL)
                time_m = re.search(r'<time[^>]*datetime="([^"]+)"', b)
                id_m = re.search(r'data-post-id="(\d+)"', b) or re.search(r'data-post="[^"]+/(\d+)"', b)

                if text_m:
                    author = re.sub(r'<[^>]+>', '', author_m.group(1)).strip() if author_m else "مستخدم تليجرام"
                    clean_text = html.unescape(re.sub(r'<br\s*/?>', '\n', text_m.group(1)))
                    clean_text = re.sub(r'<[^>]+>', '', clean_text).strip()
                    cmt_id = id_m.group(1) if id_m else str(uuid.uuid4())
                    pub_at = time_m.group(1) if time_m else datetime.now(timezone.utc).isoformat()
                    raw_comments.append(RawComment(
                        id=cmt_id,
                        video_id=str(video_id),
                        text=clean_text,
                        parent_id=None,
                        is_reply=False,
                        parent_source="api",
                        published_at=pub_at,
                        timestamp_precision="second",
                        author_channel_id="tg_user",
                        author_name=author,
                        likes_value=0,
                        likes_raw="0",
                        source=self.source,
                        platform="telegram",
                        field_provenance={"adapter": self.source},
                    ))

            yield Batch(comments=raw_comments, checkpoint=None, outcome="exhausted")
            return

        # 3. No client or credentials configured
        raise CollectionError("telegram_credentials_missing", "blocked")
