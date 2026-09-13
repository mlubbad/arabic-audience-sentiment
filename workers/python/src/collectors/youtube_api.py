"""YouTube Data API adapter. Tested with synthetic HTTP responses; never run live.

Authenticates either with an API key, for public data, or with an OAuth access
token, for a channel its owner has connected. The token path is the product
path: it needs no API key at all, and it reaches a connected channel's comments
directly.
"""
import json
import re
from collections.abc import Iterator
import httpx
from .protocol import Batch, CollectionError, RawComment


class YouTubeAPI:
    source = "youtube_data_api_public"
    revision = "api-v3-adapter-v1"

    def __init__(self, api_key: str | None, client: httpx.Client, access_token: str | None = None):
        # Exactly one. Sending both would let a stale key silently answer for a
        # revoked token, and the row would record the wrong provenance.
        if bool(api_key) == bool(access_token):
            raise ValueError("need_exactly_one_credential")
        self.key, self.token, self.client = api_key, access_token, client
        # The provenance travels with every row, so a comment read on the
        # owner's authority is never filed as public data.
        self.source = "youtube_oauth" if access_token else "youtube_data_api_public"

    def _get(self, resource, params):
        headers = {"authorization": f"Bearer {self.token}"} if self.token else {}
        query = params if self.token else {**params, "key": self.key}
        try:
            response = self.client.get(f"https://www.googleapis.com/youtube/v3/{resource}",
                                       params=query, headers=headers,
                                       timeout=20, follow_redirects=False)
        except httpx.HTTPError:
            raise CollectionError("network_failure", retryable=True) from None
        # An expired access token is not a refusal; it is a credential that
        # needs renewing. Reported as retryable so the caller refreshes rather
        # than marking the channel blocked and stopping collection for good.
        if response.status_code == 401:
            raise CollectionError("credential_expired", "failed", retryable=True)
        if response.status_code in (403, 429):
            reason = self._reason(response)
            # Comments turned off on a video is a property of the video, and a
            # legitimate answer. Filing it as "access denied" would read as a
            # problem with our credentials and hide the real ones.
            if reason == "commentsDisabled":
                raise CollectionError("comments_disabled", "explicitly_disabled")
            if reason in ("quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded"):
                raise CollectionError("quota_exceeded", "blocked", retryable=True)
            raise CollectionError("source_access_denied", "blocked")
        if response.status_code >= 500:
            raise CollectionError("source_unavailable", retryable=True)
        if response.status_code != 200:
            raise CollectionError("source_http_error")
        try:
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                raise ValueError()
            return data
        except ValueError:
            raise CollectionError("invalid_response") from None

    @staticmethod
    def _reason(response) -> str:
        """Google's own name for the refusal, or "" when it did not give one."""
        try:
            errors = response.json()["error"]["errors"]
            return errors[0].get("reason", "") if errors else ""
        except (ValueError, KeyError, TypeError, IndexError):
            return ""

    def _comment(self, item, video, parent=None):
        try:
            s = item["snippet"]
            parent = s.get("parentId", parent)
            return RawComment(id=item["id"], video_id=video, text=s["textOriginal"],
                              parent_id=parent, is_reply=parent is not None,
                              parent_source="api" if parent else "unknown",
                              author_channel_id=s.get("authorChannelId", {}).get("value"),
                              author_name=s.get("authorDisplayName", ""),
                              published_time_raw=s.get("publishedAt"), published_at=s.get("publishedAt"),
                              timestamp_precision="second" if s.get("publishedAt") else "unknown",
                              likes_value=s.get("likeCount"), source=self.source,
                              field_provenance={"source": self.source, "adapter_revision": self.revision})
        except (KeyError, TypeError, AttributeError):
            raise CollectionError("invalid_comment") from None

    def batches(self, video_id: str, checkpoint: str | None) -> Iterator[Batch]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise ValueError("invalid_video_id")
        try:
            state = json.loads(checkpoint) if checkpoint else {
                "video_id": video_id, "page": None, "parents": [], "reply_page": None, "threads_done": False}
            if state["video_id"] != video_id or not isinstance(state["parents"], list):
                raise ValueError()
        except (KeyError, ValueError, TypeError):
            raise CollectionError("invalid_checkpoint") from None
        while True:
            if state["parents"]:
                parent = state["parents"][0]
                params = {"part": "snippet", "parentId": parent, "maxResults": 100, "textFormat": "plainText"}
                if state["reply_page"]:
                    params["pageToken"] = state["reply_page"]
                data = self._get("comments", params)
                comments = [self._comment(c, video_id, parent) for c in data["items"]]
                next_page = data.get("nextPageToken")
                if next_page and next_page == state["reply_page"]:
                    raise CollectionError("repeated_page_token", "partial")
                state["reply_page"] = next_page
                if not next_page:
                    state["parents"].pop(0)
            elif not state["threads_done"]:
                params = {"part": "snippet", "videoId": video_id, "maxResults": 100,
                          "order": "time", "textFormat": "plainText"}
                if state["page"]:
                    params["pageToken"] = state["page"]
                data = self._get("commentThreads", params)
                try:
                    comments = [self._comment(i["snippet"]["topLevelComment"], video_id) for i in data["items"]]
                    state["parents"] = [i["snippet"]["topLevelComment"]["id"] for i in data["items"]
                                        if i["snippet"]["totalReplyCount"] > 0]
                except (KeyError, TypeError):
                    raise CollectionError("invalid_thread") from None
                next_page = data.get("nextPageToken")
                if next_page and next_page == state["page"]:
                    raise CollectionError("repeated_page_token", "partial")
                state["page"] = next_page
                state["threads_done"] = next_page is None
            else:
                yield Batch([], None, "exhausted")
                return
            done = state["threads_done"] and not state["parents"]
            yield Batch(comments, None if done else json.dumps(state), "exhausted" if done else "partial")
            if done:
                return
