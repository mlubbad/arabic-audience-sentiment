"""X (Twitter) collector adapter.

Collects public tweets (kind='tweet') and their replies from X accounts.
Supports hermetic fixture testing, bearer token API v2, and public syndication fallback.
"""

import html
import json
import re
from collections.abc import Iterator
from datetime import datetime, timezone
import httpx
from .protocol import Batch, Catalogue, CollectionError, RawComment


_HANDLE_REGEX = re.compile(r"^[A-Za-z0-9_]{1,15}$")
_TWEET_ID_REGEX = re.compile(r"^[0-9]{1,30}$")


class XCollector:
    source = "x_api"
    revision = "x-adapter-v1"

    def __init__(
        self,
        channel_id: str | None = None,
        client: httpx.Client | None = None,
        bearer_token: str | None = None,
        fixture_data: dict | None = None,
    ):
        self.channel_id = channel_id
        self.client = client
        self.bearer_token = bearer_token
        self.fixture_data = fixture_data

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

        # 2. Bearer token mode (Twitter API v2)
        if self.bearer_token and self.client:
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
                raise CollectionError("rate_limit_exceeded", "failed", retryable=True)
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
                raise CollectionError("rate_limit_exceeded", "failed", retryable=True)
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

        # 3. Public syndication fallback (Zero-key mode)
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
            # Extract JSON from __NEXT_DATA__ if present
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

            # Fallback regex for HTML tweet cards if __NEXT_DATA__ is absent or empty
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

        raise CollectionError("no_transport_configured", "failed")

    def batches(self, video_id: str, checkpoint: str | None = None) -> Iterator[Batch]:
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

        # 2. Bearer token mode (Twitter API v2)
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
                raise CollectionError("rate_limit_exceeded", "failed", retryable=True)
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

        # 3. Public fallback: yields exhausted empty batch
        yield Batch(comments=[], checkpoint=None, outcome="exhausted")
