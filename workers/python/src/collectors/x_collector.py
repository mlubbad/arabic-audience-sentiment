"""X (Twitter) collector adapter.

Collects public tweets (kind='tweet') and their replies from X accounts.
Supports hermetic fixture testing, bearer token API v2, Apify actors,
Bright Data web scraper/proxy, and public syndication fallback.
"""

import html
import json
import re
from collections.abc import Iterator
from datetime import datetime, timezone
import httpx
from .protocol import Batch, Catalogue, CollectionError, RawComment
from .scrapers.apify import ApifyClient
from .scrapers.brightdata import BrightDataClient


_HANDLE_REGEX = re.compile(r"^[A-Za-z0-9_]{1,15}$")
_TWEET_ID_REGEX = re.compile(r"^[0-9]{1,30}$")


class XCollector:
    source = "x_api"
    revision = "x-adapter-v2"

    def __init__(
        self,
        channel_id: str | None = None,
        client: httpx.Client | None = None,
        bearer_token: str | None = None,
        apify_client: ApifyClient | None = None,
        brightdata_client: BrightDataClient | None = None,
        fixture_data: dict | None = None,
        preferred_scraper: str | None = None,
    ):
        self.channel_id = channel_id
        self.client = client
        self.bearer_token = bearer_token
        self.apify_client = apify_client
        self.brightdata_client = brightdata_client
        self.fixture_data = fixture_data
        self.preferred_scraper = (preferred_scraper or "").lower() or None

    @staticmethod
    def _clean_handle(channel_id: str) -> str:
        s = channel_id.strip()
        s = re.sub(r"^https?://(www\.)?(twitter|x)\.com/", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^(twitter|x)\.com/", "", s, flags=re.IGNORECASE)
        s = s.lstrip("@").strip()
        s = s.split("/")[0].split("?")[0]
        if not _HANDLE_REGEX.match(s):
            raise ValueError("invalid_channel_id")
        return s

    @staticmethod
    def _clean_tweet_id(video_id: str) -> str:
        s = video_id.strip()
        s = s.split("/")[-1].split("?")[0]
        if not _TWEET_ID_REGEX.match(s):
            raise ValueError("invalid_video_id")
        return s

    def _catalogue_apify(self, clean_handle: str) -> Catalogue:
        if not self.apify_client:
            raise CollectionError("apify_not_configured", "failed")
        videos = self.apify_client.scrape_x_profile(clean_handle)
        return Catalogue(videos=videos, complete=bool(videos))

    def _catalogue_brightdata(self, clean_handle: str) -> Catalogue:
        if not self.brightdata_client or not self.brightdata_client.api_key:
            raise CollectionError("brightdata_not_configured", "failed")
        videos = self.brightdata_client.scrape_x_profile(clean_handle)
        return Catalogue(videos=videos, complete=bool(videos))

    def _catalogue_official(self, clean_handle: str) -> Catalogue:
        if not self.bearer_token or not self.client:
            raise CollectionError("official_api_not_configured", "failed")
        headers = {"Authorization": f"Bearer {self.bearer_token}"}
        try:
            user_resp = self.client.get(
                f"https://api.twitter.com/2/users/by/username/{clean_handle}",
                headers=headers,
                timeout=20,
            )
        except httpx.HTTPError:
            raise CollectionError("network_failure", retryable=True) from None

        if user_resp.status_code == 404:
            raise CollectionError("channel_not_found", "failed")
        if user_resp.status_code == 401:
            raise CollectionError("invalid_credentials", "blocked")
        if user_resp.status_code == 429:
            raise CollectionError("rate_limit_exceeded", "blocked", retryable=True)
        if user_resp.is_error:
            raise CollectionError("api_error", "failed")

        user_data = user_resp.json().get("data")
        if not user_data or "id" not in user_data:
            raise CollectionError("channel_not_found", "failed")

        user_id = user_data["id"]
        try:
            tweets_resp = self.client.get(
                f"https://api.twitter.com/2/users/{user_id}/tweets",
                params={
                    "max_results": 25,
                    "tweet.fields": "created_at,public_metrics",
                },
                headers=headers,
                timeout=20,
            )
        except httpx.HTTPError:
            raise CollectionError("network_failure", retryable=True) from None

        if tweets_resp.status_code == 429:
            raise CollectionError("rate_limit_exceeded", "blocked", retryable=True)
        if tweets_resp.is_error:
            raise CollectionError("api_error", "failed")

        raw_tweets = tweets_resp.json().get("data", [])
        videos = []
        for t in raw_tweets:
            metrics = t.get("public_metrics", {})
            videos.append(
                {
                    "external_video_id": str(t["id"]),
                    "title": t.get("text", "")[:100] or f"Tweet {t['id']}",
                    "kind": "tweet",
                    "published_at": t.get("created_at"),
                    "reported_comment_count": metrics.get("reply_count"),
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
                f"https://syndication.twitter.com/srv/timeline-profile/screen-name/{clean_handle}",
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
        if "protected" in body.lower() and "account" in body.lower():
            raise CollectionError("channel_not_public", "blocked")

        videos = []
        next_data_match = re.search(
            r'<script\s+id="__NEXT_DATA__"\s+type="application/json">(.*?)</script>',
            body,
            re.DOTALL,
        )
        if next_data_match:
            try:
                data = json.loads(next_data_match.group(1))
                entries = (
                    data.get("props", {}).get("pageProps", {}).get("timeline", {}).get("entries", [])
                )
                for entry in entries:
                    tweet = entry.get("content", {}).get("tweet")
                    if not tweet:
                        continue
                    tweet_id = str(tweet.get("id_str") or tweet.get("id"))
                    text = tweet.get("full_text") or tweet.get("text", "")
                    videos.append(
                        {
                            "external_video_id": tweet_id,
                            "title": text[:100] or f"Tweet {tweet_id}",
                            "kind": "tweet",
                            "published_at": tweet.get("created_at"),
                            "reported_comment_count": tweet.get("reply_count"),
                            "field_provenance": {"source": self.source, "handle": clean_handle},
                        }
                    )
            except (json.JSONDecodeError, KeyError):
                pass

        if not videos:
            tweet_matches = re.finditer(
                r'data-tweet-id="([0-9]+)"[^>]*>.*?<p[^>]*class="[^"]*tweet-text[^"]*"[^>]*>(.*?)</p>',
                body,
                re.DOTALL,
            )
            for m in tweet_matches:
                tid, raw_text = m.group(1), m.group(2)
                clean_text = html.unescape(re.sub(r"<[^>]+>", "", raw_text)).strip()
                videos.append(
                    {
                        "external_video_id": tid,
                        "title": clean_text[:100] or f"Tweet {tid}",
                        "kind": "tweet",
                        "published_at": datetime.now(timezone.utc).isoformat(),
                        "reported_comment_count": None,
                        "field_provenance": {"source": self.source, "handle": clean_handle},
                    }
                )

        return Catalogue(videos=videos, complete=True)

    def catalogue(self, channel_id: str | None = None) -> Catalogue:
        """List user tweets. Each tweet becomes a video record with kind='tweet'."""
        target = channel_id or self.channel_id
        if not target:
            raise ValueError("missing_channel_id")
        clean_handle = self._clean_handle(target)

        # 1. Fixture mode
        if self.fixture_data and "tweets" in self.fixture_data:
            tweets = self.fixture_data["tweets"]
            videos = []
            for t in tweets:
                videos.append(
                    {
                        "external_video_id": str(t["id"]),
                        "title": t.get("text", "")[:100] or f"Tweet {t['id']}",
                        "kind": "tweet",
                        "published_at": t.get("created_at", datetime.now(timezone.utc).isoformat()),
                        "reported_comment_count": t.get("reply_count", t.get("comments_count")),
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

        # Default fallback cascade: Apify -> Bright Data -> Official API -> Public Syndication
        if self.apify_client and self.preferred_scraper != "apify":
            cascade.append(("apify", lambda: self._catalogue_apify(clean_handle)))
        if self.brightdata_client and self.brightdata_client.api_key and self.preferred_scraper != "brightdata":
            cascade.append(("brightdata", lambda: self._catalogue_brightdata(clean_handle)))
        if self.bearer_token and self.client and self.preferred_scraper != "official":
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
        """Collect replies for a given tweet."""
        clean_id = self._clean_tweet_id(video_id)

        # 1. Fixture mode
        if self.fixture_data and "comments" in self.fixture_data:
            raw_replies = self.fixture_data["comments"].get(clean_id, [])
            comments = []
            for r in raw_replies:
                comments.append(
                    RawComment(
                        id=str(r["id"]),
                        video_id=clean_id,
                        text=r.get("text", ""),
                        parent_id=str(r["parent_id"]) if r.get("parent_id") else None,
                        is_reply=bool(r.get("parent_id")),
                        parent_source="x_reply",
                        published_at=r.get("created_at", datetime.now(timezone.utc).isoformat()),
                        author_name=r.get("author_name", ""),
                        author_channel_id=r.get("author_id"),
                        likes_value=r.get("likes_count", 0),
                        source=self.source,
                        platform="x",
                    )
                )
            yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
            return

        # 2. Build cascade for replies respecting preferred_scraper
        cascade_replies = []
        if self.preferred_scraper == "brightdata" and self.brightdata_client and self.brightdata_client.api_key:
            cascade_replies.append(("brightdata", lambda: self.brightdata_client.scrape_x_replies(clean_id, handle=self.channel_id)))
        elif self.preferred_scraper == "apify" and self.apify_client:
            cascade_replies.append(("apify", lambda: self.apify_client.scrape_x_replies(clean_id)))

        if self.apify_client and self.preferred_scraper != "apify":
            cascade_replies.append(("apify", lambda: self.apify_client.scrape_x_replies(clean_id)))
        if self.brightdata_client and self.brightdata_client.api_key and self.preferred_scraper != "brightdata":
            cascade_replies.append(("brightdata", lambda: self.brightdata_client.scrape_x_replies(clean_id, handle=self.channel_id)))

        last_error = None
        has_empty_scraper_result = False
        for source_name, fn in cascade_replies:
            try:
                raw_replies = fn()
                if isinstance(raw_replies, list):
                    if raw_replies:
                        comments = [
                            RawComment(
                                id=r["id"],
                                video_id=clean_id,
                                text=r["text"],
                                parent_id=r.get("parent_id"),
                                is_reply=r.get("is_reply", True),
                                parent_source=f"{source_name}_reply",
                                published_at=r.get("published_at"),
                                author_name=r.get("author_name", ""),
                                author_channel_id=r.get("author_channel_id"),
                                likes_value=r.get("likes_value", 0),
                                source=source_name,
                                platform="x",
                            )
                            for r in raw_replies
                        ]
                        yield Batch(comments=comments, checkpoint=None, outcome="exhausted")
                        return
                    else:
                        has_empty_scraper_result = True
                        continue
            except CollectionError as exc:
                last_error = exc
                continue


        # 4. Bearer token mode (Twitter API v2)
        if self.bearer_token and self.client:
            headers = {"Authorization": f"Bearer {self.bearer_token}"}
            params = {
                "query": f"conversation_id:{clean_id}",
                "max_results": 50,
                "tweet.fields": "created_at,author_id,public_metrics,in_reply_to_user_id",
            }
            if checkpoint:
                params["next_token"] = checkpoint

            try:
                resp = self.client.get(
                    "https://api.twitter.com/2/tweets/search/recent",
                    params=params,
                    headers=headers,
                    timeout=20,
                )
            except httpx.HTTPError:
                raise CollectionError("network_failure", retryable=True) from None

            if resp.status_code == 429:
                raise CollectionError("rate_limit_exceeded", "blocked", retryable=True)
            if resp.is_error:
                raise CollectionError("api_error", "failed")

            data = resp.json()
            raw_replies = data.get("data", [])
            meta = data.get("meta", {})
            next_token = meta.get("next_token")

            comments = []
            for r in raw_replies:
                metrics = r.get("public_metrics", {})
                comments.append(
                    RawComment(
                        id=str(r["id"]),
                        video_id=clean_id,
                        text=r.get("text", ""),
                        parent_id=clean_id,
                        is_reply=True,
                        parent_source="x_reply",
                        published_at=r.get("created_at"),
                        author_name=f"user_{r.get('author_id', '')}",
                        author_channel_id=r.get("author_id"),
                        likes_value=metrics.get("like_count", 0),
                        source=self.source,
                        platform="x",
                    )
                )
            outcome = "partial" if next_token else "exhausted"
            yield Batch(comments=comments, checkpoint=next_token, outcome=outcome)
            return

        # If any scraper failed with CollectionError, raise it so it's not silently treated as successful empty
        if last_error:
            raise last_error

        if has_empty_scraper_result:
            yield Batch(comments=[], checkpoint=None, outcome="exhausted")
            return

        # If no scraper or bearer token configured, do NOT pretend it's exhausted with 0 comments!
        raise CollectionError("comments_scraper_not_configured", "blocked")

