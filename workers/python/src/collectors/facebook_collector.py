"""Facebook page collector: Graph for the owner's page, scrapers for a public one.

A connected row carries the page's access token and no handle; the page is
whatever `/me` says it is. A public row carries the page's handle and no
token; it is read through the managed scrapers (Apify, Bright Data) because
Meta answers no comment read without a credential. There is no
unauthenticated web fallback on purpose: a silent empty answer from a login
wall would violate "failure never becomes success".
"""

import re
from collections.abc import Callable, Iterator

import httpx

from .meta_graph import GRAPH_FACEBOOK, MetaGraphClient, parse_graph_time
from .protocol import Batch, Catalogue, CollectionError, RawComment
from .scrapers.apify import ApifyClient
from .scrapers.brightdata import BrightDataClient

_VANITY = re.compile(r"^[A-Za-z0-9.]{1,80}$")
_NUMERIC = re.compile(r"^[0-9]{1,64}$")
_POST_ID = re.compile(r"^([0-9]{1,30}(_[0-9]{1,30})?|reel_[0-9]{1,30}|pfbid[A-Za-z0-9]{10,120})$")
_RESERVED = {"groups", "events", "marketplace", "watch", "gaming", "pages", "profile.php", "posts"}
_CATALOGUE_CAP = 200
_POST_FIELDS = (
    "id,message,story,created_time,permalink_url,full_picture,"
    "attachments{media_type},comments.summary(true).limit(0)"
)
_COMMENT_FIELDS = "id,message,created_time,from,like_count,parent{id}"


class FacebookCollector:
    source = "facebook_graph_api"
    revision = "facebook-adapter-v1"

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
        self._page_id: str | None = None

    # ----- identity ---------------------------------------------------------

    @staticmethod
    def _clean_handle(channel_id: str) -> str:
        s = (channel_id or "").strip()
        s = re.sub(r"^https?://", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^(www\.|m\.|web\.|mbasic\.)?facebook\.com/", "", s, flags=re.IGNORECASE)
        s = s.lstrip("/")
        m = re.match(r"^profile\.php\?id=([0-9]{1,64})", s)
        if m:
            return m.group(1)
        m = re.match(r"^pages/[^/]+/([0-9]{1,64})", s)
        if m:
            return m.group(1)
        s = s.split("?")[0].split("#")[0].rstrip("/")
        if "/" in s or not s or s in _RESERVED:
            raise ValueError("invalid_channel_id")
        if not (_VANITY.match(s) or _NUMERIC.match(s)):
            raise ValueError("invalid_channel_id")
        return s

    @staticmethod
    def _clean_post_id(video_id: str) -> str:
        raw = (video_id or "").strip().split("?")[0].rstrip("/")
        if "/reel/" in raw:
            seg = raw.rsplit("/", 1)[-1]
            if seg.isdigit():
                s = f"reel_{seg}"
            else:
                s = seg
        else:
            s = raw.rsplit("/", 1)[-1]
        if not _POST_ID.match(s):
            raise ValueError("invalid_video_id")
        return s

    def _graph(self) -> MetaGraphClient:
        if not self.access_token or not self.client:
            raise CollectionError("official_api_not_configured", "failed")
        return MetaGraphClient(self.client, self.access_token, GRAPH_FACEBOOK)

    def _own_page_id(self, graph: MetaGraphClient) -> str:
        if self._page_id is None:
            me = graph.get("/me", {"fields": "id,name,username"})
            page_id = me.get("id")
            if not isinstance(page_id, str) or not page_id:
                raise CollectionError("channel_not_found", "failed")
            self._page_id = page_id
        return self._page_id

    # ----- catalogue --------------------------------------------------------

    def _catalogue_fixture(self, clean_handle: str | None) -> Catalogue:
        videos = []
        for p in self.fixture_data.get("posts", []):
            published_at, _ = parse_graph_time(p.get("created_time"))
            videos.append(
                {
                    "external_video_id": str(p["id"]),
                    "title": (p.get("message") or "")[:100] or f"Post {p['id']}",
                    "kind": p.get("kind", "channel_post"),
                    "published_at": published_at,
                    "reported_comment_count": p.get("comment_count"),
                    "thumbnail_url": p.get("full_picture"),
                    "field_provenance": {"source": "sanitized_fixture", "handle": clean_handle},
                }
            )
        return Catalogue(videos=videos, complete=True)

    def _catalogue_graph(self) -> Catalogue:
        graph = self._graph()
        page_id = self._own_page_id(graph)
        videos: list[dict] = []
        after: str | None = None
        while True:
            rows, after = graph.page(f"/{page_id}/posts", {"fields": _POST_FIELDS, "limit": "50"}, after)
            for row in rows:
                video = self._graph_post(row)
                if video:
                    videos.append(video)
            if not after:
                return Catalogue(videos=videos, complete=True)
            if len(videos) >= _CATALOGUE_CAP:
                return Catalogue(videos=videos, complete=False, reason="catalogue_capped")

    def _graph_post(self, row: dict) -> dict | None:
        raw_id = row.get("id")
        if not isinstance(raw_id, str) or not raw_id:
            return None
        post_id = raw_id.split("_", 1)[1] if "_" in raw_id else raw_id
        text = row.get("message") if isinstance(row.get("message"), str) else ""
        if not text and isinstance(row.get("story"), str):
            text = row["story"]
        attachments = row.get("attachments", {})
        media = attachments.get("data", []) if isinstance(attachments, dict) else []
        is_video = any(isinstance(m, dict) and m.get("media_type") == "video" for m in media)
        summary = row.get("comments", {}).get("summary", {}) if isinstance(row.get("comments"), dict) else {}
        count = summary.get("total_count") if isinstance(summary, dict) else None
        published_at, _ = parse_graph_time(row.get("created_time"))
        return {
            "external_video_id": post_id,
            "title": text[:100] or f"Post {post_id}",
            "kind": "video" if is_video else "channel_post",
            "published_at": published_at,
            "reported_comment_count": count if isinstance(count, int) and not isinstance(count, bool) else None,
            "thumbnail_url": row.get("full_picture") if isinstance(row.get("full_picture"), str) else None,
            "field_provenance": {
                "source": self.source,
                "graph_id": raw_id,
                "url": row.get("permalink_url") if isinstance(row.get("permalink_url"), str) else None,
            },
        }

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
        """List the page's posts. A connected row names no handle: the token names the page."""
        target = channel_id or self.channel_id
        clean_handle = self._clean_handle(target) if target else None
        if self.fixture_data and "posts" in self.fixture_data:
            return self._catalogue_fixture(clean_handle)
        if self.access_token:
            return self._catalogue_graph()
        if not clean_handle:
            raise ValueError("missing_channel_id")

        cascade = self._scraper_cascade(
            lambda: self.apify_client.scrape_facebook_posts(clean_handle),
            lambda: self.brightdata_client.scrape_facebook_posts(clean_handle),
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

    def _fixture_batches(self, post_id: str) -> Iterator[Batch]:
        comments = []
        for c in self.fixture_data.get("comments", {}).get(post_id, []):
            published_at, precision = parse_graph_time(c.get("created_time"))
            parent = str(c["parent_id"]) if c.get("parent_id") else None
            comments.append(
                RawComment(
                    id=str(c["id"]),
                    video_id=post_id,
                    text=c.get("message", ""),
                    parent_id=parent,
                    is_reply=parent is not None,
                    parent_source="facebook_reply" if parent else "root",
                    published_at=published_at,
                    timestamp_precision=precision,
                    author_name=c.get("from", {}).get("name", "") if isinstance(c.get("from"), dict) else "",
                    author_channel_id=c.get("from", {}).get("id") if isinstance(c.get("from"), dict) else None,
                    likes_value=c.get("like_count"),
                    source="sanitized_fixture",
                    platform="facebook",
                )
            )
        yield Batch(comments=comments, checkpoint=None, outcome="exhausted")

    def _graph_batches(self, post_id: str, checkpoint: str | None) -> Iterator[Batch]:
        graph = self._graph()
        page_id = self._own_page_id(graph)
        graph_post_id = post_id if "_" in post_id else f"{page_id}_{post_id}"
        after = checkpoint
        while True:
            rows, after = graph.page(
                f"/{graph_post_id}/comments",
                {"fields": _COMMENT_FIELDS, "filter": "stream", "limit": "100"},
                after,
            )
            comments = []
            for row in rows:
                cid = row.get("id")
                if not isinstance(cid, str) or not cid:
                    continue
                author = row.get("from") if isinstance(row.get("from"), dict) else {}
                parent = row.get("parent") if isinstance(row.get("parent"), dict) else {}
                parent_id = str(parent.get("id")) if parent.get("id") else None
                published_at, precision = parse_graph_time(row.get("created_time"))
                likes = row.get("like_count")
                comments.append(
                    RawComment(
                        id=cid,
                        video_id=post_id,
                        text=row.get("message") if isinstance(row.get("message"), str) else "",
                        parent_id=parent_id,
                        is_reply=parent_id is not None,
                        parent_source="facebook_reply" if parent_id else "root",
                        published_at=published_at,
                        timestamp_precision=precision,
                        author_name=author.get("name") if isinstance(author.get("name"), str) else "",
                        author_channel_id=str(author["id"]) if author.get("id") else None,
                        likes_value=likes if isinstance(likes, int) and not isinstance(likes, bool) else None,
                        source=self.source,
                        platform="facebook",
                    )
                )
            if after:
                yield Batch(comments=comments, checkpoint=after, outcome="partial")
            else:
                yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
                return

    def _scraped_batches(self, post_id: str) -> Iterator[Batch]:
        cascade = self._scraper_cascade(
            lambda: self.apify_client.scrape_facebook_comments(post_id, handle=self.channel_id),
            lambda: self.brightdata_client.scrape_facebook_comments(post_id, handle=self.channel_id),
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
                        video_id=post_id,
                        text=c.get("text", ""),
                        parent_id=c.get("parent_id"),
                        is_reply=bool(c.get("is_reply")),
                        parent_source=f"{name}_comment",
                        published_at=published_at,
                        timestamp_precision=precision,
                        author_name=c.get("author_name", ""),
                        author_channel_id=c.get("author_channel_id"),
                        likes_value=c.get("likes_value"),
                        source=f"facebook_{name}",
                        platform="facebook",
                    )
                )
            yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
            return
        if last_error:
            raise last_error
        if answered_empty:
            # A scraper answered and said "no comments": that is the source's word, not a failure.
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
        post_id = self._clean_post_id(video_id)
        if self.fixture_data and "comments" in self.fixture_data:
            yield from self._fixture_batches(post_id)
        elif self.access_token:
            yield from self._graph_batches(post_id, checkpoint)
        else:
            yield from self._scraped_batches(post_id)
