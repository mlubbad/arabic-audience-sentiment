"""Public API adapter. Tested with synthetic HTTP responses; no live collection claim."""
import json
import re
from collections.abc import Iterator
import httpx
from .protocol import Batch, CollectionError, RawComment


class YouTubeAPI:
    source = "youtube_data_api_public"
    revision = "api-v3-adapter-v1"

    def __init__(self, api_key: str, client: httpx.Client):
        if not api_key:
            raise ValueError("missing_api_key")
        self.key, self.client = api_key, client

    def _get(self, resource, params):
        try:
            response = self.client.get(f"https://www.googleapis.com/youtube/v3/{resource}",
                                       params={**params, "key": self.key}, timeout=20, follow_redirects=False)
        except httpx.HTTPError:
            raise CollectionError("network_failure", retryable=True) from None
        if response.status_code in (403, 429):
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

    def _comment(self, item, video, parent=None):
        try:
            s = item["snippet"]
            parent = s.get("parentId", parent)
            return RawComment(id=item["id"], video_id=video, text=s["textOriginal"],
                              parent_id=parent, is_reply=parent is not None,
                              parent_source="api" if parent else "unknown",
                              author_channel_id=s.get("authorChannelId", {}).get("value"),
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
