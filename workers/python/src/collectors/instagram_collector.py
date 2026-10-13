"""Instagram account collector: Graph for the owner, scrapers for a public account.

Two ids live side by side: a connected account's media are Graph media ids
(numeric), a public account's posts are shortcodes (the part of the URL
after /p/ or /reel/), because that is what the scrapers take. Both are
accepted as a video id; which one a row holds depends on the door it came
through.
"""

import re
from collections.abc import Callable, Iterator

import httpx

from .meta_graph import GRAPH_INSTAGRAM, MetaGraphClient, parse_graph_time
from .protocol import Batch, Catalogue, CollectionError, RawComment
from .scrapers.apify import ApifyClient
from .scrapers.brightdata import BrightDataClient

_HANDLE = re.compile(r"^[A-Za-z0-9_.]{1,30}$")
_MEDIA_ID = re.compile(r"^[0-9]{5,30}$")
_SHORTCODE = re.compile(r"^[A-Za-z0-9_-]{5,40}$")
_RESERVED = {"p", "reel", "reels", "explore", "stories", "accounts", "direct", "tv"}
_CATALOGUE_CAP = 200
_MEDIA_FIELDS = (
    "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,comments_count"
)
_COMMENT_FIELDS = "id,text,timestamp,username,like_count,replies{id,text,timestamp,username,like_count}"


class InstagramCollector:
    source = "instagram_graph_api"
    revision = "instagram-adapter-v1"

    def __init__(
        self,
        channel_id: str | None = None,
        client: httpx.Client | None = None,
        access_token: str | None = None,
        apify_client: ApifyClient | None = None,
        brightdata_client: BrightDataClient | None = None,
        fixture_data: dict | None = None,
        preferred_scraper: str | None = None,
    ):
        self.channel_id = channel_id
        self.client = client
        self.access_token = access_token
        self.apify_client = apify_client
        self.brightdata_client = brightdata_client
        self.fixture_data = fixture_data
        self.preferred_scraper = (preferred_scraper or "").lower() or None

    # ----- identity ---------------------------------------------------------

    @staticmethod
    def _clean_handle(channel_id: str) -> str:
        s = (channel_id or "").strip()
        s = re.sub(r"^https?://", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^(www\.)?instagram\.com/", "", s, flags=re.IGNORECASE)
        s = s.lstrip("/").lstrip("@")
        s = s.split("?")[0].split("#")[0]
        first = s.split("/")[0]
        if not first or first in _RESERVED or not _HANDLE.match(first):
            raise ValueError("invalid_channel_id")
        return first

    @staticmethod
    def _clean_media_id(video_id: str) -> str:
        s = (video_id or "").strip().split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        if not (_MEDIA_ID.match(s) or _SHORTCODE.match(s)):
            raise ValueError("invalid_video_id")
        return s

    def _graph(self) -> MetaGraphClient:
        if not self.access_token or not self.client:
            raise CollectionError("official_api_not_configured", "failed")
        return MetaGraphClient(self.client, self.access_token, GRAPH_INSTAGRAM)

    @staticmethod
    def _kind(media_type: object, product_type: object) -> str:
        if product_type == "REELS":
            return "short"
        if media_type == "VIDEO":
            return "video"
        return "channel_post"

    # ----- catalogue --------------------------------------------------------

    def _catalogue_fixture(self, clean_handle: str | None) -> Catalogue:
        videos = []
        for m in self.fixture_data.get("media", []):
            published_at, _ = parse_graph_time(m.get("timestamp"))
            videos.append(
                {
                    "external_video_id": str(m["id"]),
                    "title": (m.get("caption") or "")[:100] or f"Post {m['id']}",
                    "kind": self._kind(m.get("media_type"), m.get("media_product_type")),
                    "published_at": published_at,
                    "reported_comment_count": m.get("comments_count"),
                    "thumbnail_url": m.get("thumbnail_url") or m.get("media_url"),
                    "field_provenance": {"source": "sanitized_fixture", "handle": clean_handle},
                }
            )
        return Catalogue(videos=videos, complete=True)

    def _catalogue_graph(self) -> Catalogue:
        graph = self._graph()
        me = graph.get("/me", {"fields": "user_id,username,name"})
        if not me.get("user_id") and not me.get("id"):
            raise CollectionError("channel_not_found", "failed")
        videos: list[dict] = []
        after: str | None = None
        while True:
            rows, after = graph.page("/me/media", {"fields": _MEDIA_FIELDS, "limit": "50"}, after)
            for row in rows:
                media_id = row.get("id")
                if not isinstance(media_id, str) or not media_id:
                    continue
                caption = row.get("caption") if isinstance(row.get("caption"), str) else ""
                count = row.get("comments_count")
                published_at, _ = parse_graph_time(row.get("timestamp"))
                thumb = row.get("thumbnail_url") or row.get("media_url")
                videos.append(
                    {
                        "external_video_id": media_id,
                        "title": caption[:100] or f"Post {media_id}",
                        "kind": self._kind(row.get("media_type"), row.get("media_product_type")),
                        "published_at": published_at,
                        "reported_comment_count": (
                            count if isinstance(count, int) and not isinstance(count, bool) else None
                        ),
                        "thumbnail_url": thumb if isinstance(thumb, str) and thumb else None,
                        "field_provenance": {
                            "source": self.source,
                            "username": me.get("username"),
                            "url": row.get("permalink") if isinstance(row.get("permalink"), str) else None,
                        },
                    }
                )
            if not after:
                return Catalogue(videos=videos, complete=True)
            if len(videos) >= _CATALOGUE_CAP:
                return Catalogue(videos=videos, complete=False, reason="catalogue_capped")

    def _scraper_cascade(self, apify_fn: Callable, bd_fn: Callable) -> list[tuple[str, Callable]]:
        cascade: list[tuple[str, Callable]] = []
        if self.apify_client:
            cascade.append(("apify", apify_fn))
        if self.brightdata_client and self.brightdata_client.api_key:
            cascade.append(("brightdata", bd_fn))
        if self.preferred_scraper:
            cascade.sort(key=lambda entry: entry[0] != self.preferred_scraper)
        return cascade

    def catalogue(self, channel_id: str | None = None) -> Catalogue:
        target = channel_id or self.channel_id
        clean_handle = self._clean_handle(target) if target else None
        if self.fixture_data and "media" in self.fixture_data:
            return self._catalogue_fixture(clean_handle)
        if self.access_token:
            return self._catalogue_graph()
        if not clean_handle:
            raise ValueError("missing_channel_id")

        cascade = self._scraper_cascade(
            lambda: self.apify_client.scrape_instagram_posts(clean_handle),
            lambda: self.brightdata_client.scrape_instagram_posts(clean_handle),
        )
        if not cascade:
            raise CollectionError("no_transport_configured", "failed")
        last_error: CollectionError | None = None
        for _name, fn in cascade:
            try:
                videos = fn()
            except CollectionError as exc:
                last_error = exc
                continue
            if videos:
                return Catalogue(videos=videos, complete=True)
        if last_error:
            raise last_error
        return Catalogue(videos=[], complete=False, reason="no_public_posts_found")

    # ----- comments ---------------------------------------------------------

    def _fixture_batches(self, media_id: str) -> Iterator[Batch]:
        comments = []
        for c in self.fixture_data.get("comments", {}).get(media_id, []):
            published_at, precision = parse_graph_time(c.get("timestamp"))
            parent = str(c["parent_id"]) if c.get("parent_id") else None
            comments.append(
                RawComment(
                    id=str(c["id"]),
                    video_id=media_id,
                    text=c.get("text", ""),
                    parent_id=parent,
                    is_reply=parent is not None,
                    parent_source="instagram_reply" if parent else "root",
                    published_at=published_at,
                    timestamp_precision=precision,
                    author_name=c.get("username", ""),
                    likes_value=c.get("like_count"),
                    source="sanitized_fixture",
                    platform="instagram",
                )
            )
        yield Batch(comments=comments, checkpoint=None, outcome="exhausted")

    def _graph_comment(self, row: dict, media_id: str, parent_id: str | None) -> RawComment | None:
        cid = row.get("id")
        if not isinstance(cid, str) or not cid:
            return None
        published_at, precision = parse_graph_time(row.get("timestamp"))
        likes = row.get("like_count")
        return RawComment(
            id=cid,
            video_id=media_id,
            text=row.get("text") if isinstance(row.get("text"), str) else "",
            parent_id=parent_id,
            is_reply=parent_id is not None,
            parent_source="instagram_reply" if parent_id else "root",
            published_at=published_at,
            timestamp_precision=precision,
            author_name=row.get("username") if isinstance(row.get("username"), str) else "",
            author_channel_id=None,
            likes_value=likes if isinstance(likes, int) and not isinstance(likes, bool) else None,
            source=self.source,
            platform="instagram",
        )

    def _graph_batches(self, media_id: str, checkpoint: str | None) -> Iterator[Batch]:
        graph = self._graph()
        after = checkpoint
        while True:
            rows, after = graph.page(f"/{media_id}/comments", {"fields": _COMMENT_FIELDS, "limit": "50"}, after)
            comments = []
            for row in rows:
                top = self._graph_comment(row, media_id, None)
                if top is None:
                    continue
                comments.append(top)
                replies = row.get("replies", {})
                for reply in replies.get("data", []) if isinstance(replies, dict) else []:
                    if isinstance(reply, dict):
                        flat = self._graph_comment(reply, media_id, top.id)
                        if flat:
                            comments.append(flat)
            if after:
                yield Batch(comments=comments, checkpoint=after, outcome="partial")
            else:
                yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
                return

    def _scraped_batches(self, shortcode: str) -> Iterator[Batch]:
        cascade = self._scraper_cascade(
            lambda: self.apify_client.scrape_instagram_comments(shortcode),
            lambda: self.brightdata_client.scrape_instagram_comments(shortcode),
        )
        if not cascade:
            raise CollectionError("comments_scraper_not_configured", "blocked")
        last_error: CollectionError | None = None
        answered_empty = False
        for name, fn in cascade:
            try:
                raw = fn()
            except CollectionError as exc:
                last_error = exc
                continue
            if not raw:
                answered_empty = True
                continue
            comments = []
            for c in raw:
                published_at, precision = parse_graph_time(c.get("published_at"))
                comments.append(
                    RawComment(
                        id=c["id"],
                        video_id=shortcode,
                        text=c.get("text", ""),
                        parent_id=c.get("parent_id"),
                        is_reply=bool(c.get("is_reply")),
                        parent_source=f"{name}_comment",
                        published_at=published_at,
                        timestamp_precision=precision,
                        author_name=c.get("author_name", ""),
                        author_channel_id=c.get("author_channel_id"),
                        likes_value=c.get("likes_value"),
                        source=f"instagram_{name}",
                        platform="instagram",
                    )
                )
            yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
            return
        if last_error:
            raise last_error
        if answered_empty:
            yield Batch(comments=[], checkpoint=None, outcome="exhausted")
            return
        raise CollectionError("comments_scraper_not_configured", "blocked")

    def batches(
        self,
        video_id: str,
        checkpoint: str | None = None,
        since: str | None = None,
        max_items: int | None = None,
        **kwargs,
    ) -> Iterator[Batch]:
        media_id = self._clean_media_id(video_id)
        if self.fixture_data and "comments" in self.fixture_data:
            yield from self._fixture_batches(media_id)
        elif self.access_token:
            yield from self._graph_batches(media_id, checkpoint)
        else:
            yield from self._scraped_batches(media_id)
