"""TikTok collector adapter.

Collects public videos (kind='video' or 'short') and comments from TikTok profiles.
Supports hermetic fixture testing, Display API access token mode, Apify actors,
Bright Data web scraper/proxy, and public web profile fallback.
"""

import json
import re
from collections.abc import Iterator
from datetime import datetime, timezone
import httpx
from .identity import stable_author_id
from .protocol import Batch, Catalogue, CollectionError, RawComment
from .scrapers.apify import ApifyClient
from .scrapers.brightdata import BrightDataClient


_HANDLE_REGEX = re.compile(r"^[A-Za-z0-9_.-]{2,30}$")
_VIDEO_ID_REGEX = re.compile(r"^[0-9]{1,30}$")


class TikTokCollector:
    source = "tiktok_display_api"
    revision = "tiktok-adapter-v2"

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

    def _catalogue_apify(self, clean_handle: str) -> Catalogue:
        if not self.apify_client:
            raise CollectionError("apify_not_configured", "failed")
        videos = self.apify_client.scrape_tiktok_profile(clean_handle)
        return Catalogue(videos=videos, complete=bool(videos))

    def _catalogue_brightdata(self, clean_handle: str) -> Catalogue:
        if not self.brightdata_client or not self.brightdata_client.api_key:
            raise CollectionError("brightdata_not_configured", "failed")
        videos = self.brightdata_client.scrape_tiktok_profile(clean_handle)
        return Catalogue(videos=videos, complete=bool(videos))

    def _catalogue_official(self, clean_handle: str) -> Catalogue:
        if not self.access_token or not self.client:
            raise CollectionError("official_api_not_configured", "failed")
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

    def _catalogue_public(self, clean_handle: str) -> Catalogue:
        client = (
            self.brightdata_client.get_proxy_client()
            if self.brightdata_client and self.brightdata_client.proxy_url
            else self.client
        )
        if not client:
            raise CollectionError("no_transport_configured", "failed")

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "ar,en;q=0.9",
        }
        try:
            resp = client.get(
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
        if "slardar" in body.lower() or "wafchallenge" in body.lower() or "verify-bar" in body.lower():
            raise CollectionError("tiktok_waf_challenge", "blocked", retryable=True)

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
                                if "createTime" in item
                                else datetime.now(timezone.utc).isoformat()
                            ),
                            "reported_comment_count": stats.get("commentCount"),
                            "thumbnail_url": item.get("video", {}).get("cover"),
                            "field_provenance": {"source": self.source, "handle": clean_handle},
                        }
                    )
            except (json.JSONDecodeError, KeyError):
                pass

        if not videos:
            sigi_match = re.search(
                r'<script\s+id="SIGI_STATE"\s+type="application/json">(.*?)</script>',
                body,
                re.DOTALL,
            )
            if sigi_match:
                try:
                    data = json.loads(sigi_match.group(1))
                    item_module = data.get("ItemModule", {})
                    for vid, item in item_module.items():
                        stats = item.get("stats", {})
                        videos.append(
                            {
                                "external_video_id": str(vid),
                                "title": item.get("desc", "")[:100] or f"TikTok {vid}",
                                "kind": "video",
                                "published_at": (
                                    datetime.fromtimestamp(
                                        int(item["createTime"]), tz=timezone.utc
                                    ).isoformat()
                                    if "createTime" in item
                                    else datetime.now(timezone.utc).isoformat()
                                ),
                                "reported_comment_count": stats.get("commentCount"),
                                "thumbnail_url": item.get("video", {}).get("cover"),
                                "field_provenance": {"source": self.source, "handle": clean_handle},
                            }
                        )
                except (json.JSONDecodeError, KeyError):
                    pass

        if not videos:
            if "slardar" in body.lower() or "wafchallenge" in body.lower() or "verify-bar" in body.lower():
                raise CollectionError("tiktok_waf_challenge", "blocked", retryable=True)
            if "<html" in body.lower() and len(body) < 5000:
                raise CollectionError("tiktok_antibot_challenge", "blocked", retryable=True)
            return Catalogue(videos=[], complete=False, reason="no_public_videos_found")

        return Catalogue(videos=videos, complete=True)

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

        # 2. Build cascade respecting preferred_scraper if configured
        cascade = []
        if self.preferred_scraper == "brightdata":
            cascade.append(("brightdata", lambda: self._catalogue_brightdata(clean_handle)))
        elif self.preferred_scraper == "apify":
            cascade.append(("apify", lambda: self._catalogue_apify(clean_handle)))
        elif self.preferred_scraper == "official":
            cascade.append(("official", lambda: self._catalogue_official(clean_handle)))
        elif self.preferred_scraper == "public":
            cascade.append(("public", lambda: self._catalogue_public(clean_handle)))

        # Default fallback cascade: Apify -> Bright Data -> Display API -> Public Fallback
        if self.apify_client and self.preferred_scraper != "apify":
            cascade.append(("apify", lambda: self._catalogue_apify(clean_handle)))
        if self.brightdata_client and self.brightdata_client.api_key and self.preferred_scraper != "brightdata":
            cascade.append(("brightdata", lambda: self._catalogue_brightdata(clean_handle)))
        if self.access_token and self.client and self.preferred_scraper != "official":
            cascade.append(("official", lambda: self._catalogue_official(clean_handle)))
        if (self.client or (self.brightdata_client and self.brightdata_client.proxy_url)) and self.preferred_scraper != "public":
            cascade.append(("public", lambda: self._catalogue_public(clean_handle)))

        if not cascade:
            raise CollectionError("no_transport_configured", "failed")

        last_error = None
        for name, fn in cascade:
            try:
                cat = fn()
                if cat.videos:
                    return cat
            except CollectionError as exc:
                last_error = exc
                continue

        if last_error:
            raise last_error
        return Catalogue(videos=[], complete=False, reason="no_videos_found")

    def batches(
        self,
        video_id: str,
        checkpoint: str | None = None,
        since: str | None = None,
        max_items: int | None = None,
        **kwargs,
    ) -> Iterator[Batch]:
        """Collect comments for a TikTok video."""
        clean_id = self._clean_video_id(video_id)

        # 1. Fixture mode
        if self.fixture_data and "comments" in self.fixture_data:
            raw_comments = self.fixture_data["comments"].get(clean_id, [])
            comments = []
            for c in raw_comments:
                user = c.get("user", {})
                author_id = (
                    stable_author_id(c.get("author_id"))
                    or stable_author_id(user.get("id"))
                    or stable_author_id(user.get("uid"))
                )
                comments.append(
                    RawComment(
                        id=str(c["id"]),
                        video_id=clean_id,
                        text=c.get("text", ""),
                        parent_id=str(c["parent_id"]) if c.get("parent_id") else None,
                        is_reply=bool(c.get("parent_id")),
                        parent_source="tiktok_reply" if c.get("parent_id") else "root",
                        published_at=c.get("create_time", datetime.now(timezone.utc).isoformat()),
                        author_name=user.get("nickname") or c.get("author_name", ""),
                        author_channel_id=author_id,
                        likes_value=c.get("digg_count", c.get("likes_count", 0)),
                        source=self.source,
                        platform="tiktok",
                    )
                )
            yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
            return

        # 2. Build cascade for comments respecting preferred_scraper
        cascade_comments = []
        if self.preferred_scraper == "brightdata" and self.brightdata_client and self.brightdata_client.api_key:
            cascade_comments.append(("brightdata", lambda: self.brightdata_client.scrape_tiktok_comments(clean_id, handle=self.channel_id)))
        elif self.preferred_scraper == "apify" and self.apify_client:
            cascade_comments.append(("apify", lambda: self.apify_client.scrape_tiktok_comments(clean_id, handle=self.channel_id)))

        if self.apify_client and self.preferred_scraper != "apify":
            cascade_comments.append(("apify", lambda: self.apify_client.scrape_tiktok_comments(clean_id, handle=self.channel_id)))
        if self.brightdata_client and self.brightdata_client.api_key and self.preferred_scraper != "brightdata":
            cascade_comments.append(("brightdata", lambda: self.brightdata_client.scrape_tiktok_comments(clean_id, handle=self.channel_id)))

        last_error = None
        has_empty_scraper_result = False
        for source_name, fn in cascade_comments:
            try:
                raw_comments = fn()
                if isinstance(raw_comments, list):
                    if raw_comments:
                        comments = [
                            RawComment(
                                id=c["id"],
                                video_id=clean_id,
                                text=c["text"],
                                parent_id=c.get("parent_id"),
                                is_reply=c.get("is_reply", False),
                                parent_source=f"{source_name}_comment",
                                published_at=c.get("published_at"),
                                author_name=c.get("author_name", ""),
                                author_channel_id=c.get("author_channel_id"),
                                likes_value=c.get("likes_value", 0),
                                source=source_name,
                                platform="tiktok",
                            )
                            for c in raw_comments
                        ]
                        yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
                        return
                    else:
                        has_empty_scraper_result = True
                        continue
            except CollectionError as exc:
                last_error = exc
                continue


        # 4. Access token mode (TikTok Display API)
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

        if last_error:
            raise last_error

        if has_empty_scraper_result:
            yield Batch(comments=[], checkpoint=None, outcome="exhausted")
            return

        raise CollectionError("comments_scraper_not_configured", "blocked")
