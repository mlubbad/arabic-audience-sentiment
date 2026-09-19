"""YouTube Data API adapter. Tested with synthetic HTTP responses; never run live.

Authenticates either with an API key, for public data, or with an OAuth access
token, for a channel its owner has connected. The token path is the product
path: it needs no API key at all, and it reaches a connected channel's comments
directly.
"""
import json
import re
from collections.abc import Iterator
from datetime import datetime, timezone
import httpx
from .protocol import Batch, Catalogue, CollectionError, RawComment

# How soon before expiry the token is swapped for a fresh one. An access
# token that lapses mid-collection costs the whole run, so anything inside
# this margin is renewed before the next request is sent rather than after
# the source refuses it.
_RENEW_MARGIN_SECONDS = 120


class YouTubeAPI:
    source = "youtube_data_api_public"
    revision = "api-v3-adapter-v1"

    def __init__(self, api_key: str | None, client: httpx.Client,
                 access_token: str | None = None, expires_at: str | None = None,
                 renew=None):
        # Exactly one. Sending both would let a stale key silently answer for a
        # revoked token, and the row would record the wrong provenance.
        if bool(api_key) == bool(access_token):
            raise ValueError("need_exactly_one_credential")
        self.key, self.token, self.client = api_key, access_token, client
        # When the token lapses and who can hand over a fresh one. The renewal
        # itself happens on the server — the refresh token and the sealing key
        # never leave it — so this is a question asked against a lease, not a
        # credential held here.
        self.renew = renew
        self._expiry = self._parse_expiry(expires_at)
        # The provenance travels with every row, so a comment read on the
        # owner's authority is never filed as public data.
        self.source = "youtube_oauth" if access_token else "youtube_data_api_public"

    @staticmethod
    def _parse_expiry(value: str | None):
        """RFC 3339 to an aware datetime, or None when the source said nothing."""
        if not value:
            return None
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None

    def _refresh(self):
        """Swap in a fresh token, or say the credential lapsed.

        The renewal is a question to the server, answered against the lease
        this run still holds. An empty answer means the channel's grant is
        gone — the next claim hands the job back unconnected, which is the
        operator's signal to reconnect — so the run ends as the same retryable
        credential lapse it would have hit at the next request anyway.
        """
        fresh = self.renew() if self.renew else None
        token = fresh.get("access_token") if isinstance(fresh, dict) else None
        if not token:
            raise CollectionError("credential_expired", "failed", retryable=True)
        self.token = token
        self._expiry = self._parse_expiry(fresh.get("access_token_expires_at"))

    def _bearer(self) -> str:
        """The credential for the next request, renewed when it is about to lapse."""
        if self.token and self._expiry is not None and self.renew is not None:
            remaining = (self._expiry - datetime.now(timezone.utc)).total_seconds()
            if remaining < _RENEW_MARGIN_SECONDS:
                self._refresh()
        return self.token

    def _send(self, resource, query, headers):
        return self.client.get(f"https://www.googleapis.com/youtube/v3/{resource}",
                               params=query, headers=headers,
                               timeout=20, follow_redirects=False)

    def _get(self, resource, params, allow_404=False):
        headers = {"authorization": f"Bearer {self._bearer()}"} if self.token else {}
        query = params if self.token else {**params, "key": self.key}
        try:
            response = self._send(resource, query, headers)
        except httpx.HTTPError:
            raise CollectionError("network_failure", retryable=True) from None
        # An expired access token is not a refusal; it is a credential that
        # needs renewing. Reported as retryable so the caller refreshes rather
        # than marking the channel blocked and stopping collection for good.
        # With a renewal route, the run swaps the token and repeats the very
        # request, so a lapse mid-collection no longer costs the run.
        if response.status_code == 401 and self.token and self.renew is not None:
            self._refresh()
            try:
                response = self._send(resource, query,
                                      {"authorization": f"Bearer {self.token}"})
            except httpx.HTTPError:
                raise CollectionError("network_failure", retryable=True) from None
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
            # Google's own reason travels with the refusal. It is an enum, not
            # prose: it carries no request detail and no credential, and it is
            # the difference between a job that says "blocked" and one that says
            # which permission is missing. A blocked job with no reason is a
            # dead end for whoever has to act on it.
            raise CollectionError(
                f"source_access_denied:{reason}" if reason else "source_access_denied",
                "blocked",
            )
        if response.status_code == 404 and allow_404:
            return None
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

    def comment_counts(self, video_ids: list[str]) -> dict[str, int | None]:
        """The source's commentCount for each video, fifty ids per unit.

        The live check's cheap question: videos.list(part=statistics) answers
        fifty videos for one quota unit, where reading one video costs one
        unit per page whether or not anything was written. None is the source
        declining to say — comments switched off, or a video it did not list
        — and never a count of zero. Any failure is one named code, retryable:
        the caller's answer to it is to read every due video as before, and
        a wrong count must never stand in for that.
        """
        for vid in video_ids:
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
                raise ValueError("invalid_video_id")
        counts: dict[str, int | None] = {vid: None for vid in video_ids}
        ids = list(counts)
        for start in range(0, len(ids), 50):
            chunk = ids[start:start + 50]
            try:
                data = self._get("videos", {"part": "statistics", "id": ",".join(chunk)})
            except CollectionError:
                raise CollectionError("statistics_lookup_failed", retryable=True) from None
            for item in data["items"]:
                try:
                    vid = item["id"]
                    raw = (item.get("statistics") or {}).get("commentCount")
                    if vid in counts:
                        counts[vid] = None if raw is None else int(raw)
                except (KeyError, TypeError, ValueError, AttributeError):
                    raise CollectionError("statistics_lookup_failed", retryable=True) from None
        return counts

    _TABS = (("video", "LF"), ("short", "SH"), ("stream", "LV"))
    _DURATION = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$")

    def _playlist(self, playlist_id: str) -> list[str] | None:
        """Every video id in a playlist, or None when the playlist is absent."""
        ids: list[str] = []
        page = None
        while True:
            params = {"part": "contentDetails", "playlistId": playlist_id, "maxResults": 50}
            if page:
                params["pageToken"] = page
            data = self._get("playlistItems", params, allow_404=True)
            if data is None:
                return None if not ids else ids
            try:
                ids.extend(i["contentDetails"]["videoId"] for i in data["items"])
            except (KeyError, TypeError):
                raise CollectionError("invalid_response") from None
            nxt = data.get("nextPageToken")
            if nxt and nxt == page:
                raise CollectionError("repeated_page_token", "partial")
            page = nxt
            if not page:
                return ids

    def catalogue(self, channel_id: str | None = None) -> Catalogue:
        """The channel's videos across its three tabs, with the source's counts.

        Cost: about two quota units per fifty videos. The tab playlists are the
        uploads id with LF/SH/LV inserted after UU; a 404 on one is an empty
        tab. If all three are absent the plain uploads list stands in and the
        kind is recorded as unclassified rather than guessed.

        With `channel_id` the channel is named, not inferred: this is the
        public path, where the lease carries the platform id and the credential
        is a project API key with no channel of its own. It requires that key —
        an OAuth collector is bound to the channel the grant names, and taking
        an id on that path would read a channel the token was never granted
        for — and an id that names no channel is a blocked dead end, not an
        empty catalogue.
        """
        if channel_id is not None:
            if not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", channel_id):
                raise ValueError("invalid_channel_id")
            if self.token:
                raise ValueError("channel_id_needs_api_key")
            params = {"part": "contentDetails", "id": channel_id}
        else:
            params = {"part": "contentDetails", "mine": "true"}
        data = self._get("channels", params)
        if not data["items"]:
            raise CollectionError(
                "channel_not_found" if channel_id else "no_channel_for_credential", "blocked"
            )
        try:
            uploads = data["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
        except (KeyError, TypeError):
            raise CollectionError("invalid_response") from None
        base = uploads[2:]

        found: dict[str, dict] = {}
        any_tab = False
        for kind, suffix in self._TABS:
            ids = self._playlist(f"UU{suffix}{base}")
            if ids is None:
                continue
            any_tab = True
            for vid in ids:
                if vid in found:
                    found[vid]["tabs"].append(kind)
                else:
                    found[vid] = {"kind": kind, "tabs": [kind]}
        unclassified = False
        if not any_tab:
            unclassified = True
            for vid in self._playlist(uploads) or []:
                found.setdefault(vid, {"kind": "video", "tabs": []})

        videos: list[dict] = []
        ids = list(found)
        for start in range(0, len(ids), 50):
            chunk = ids[start:start + 50]
            data = self._get("videos", {"part": "snippet,statistics,contentDetails",
                                        "id": ",".join(chunk)})
            for item in data["items"]:
                try:
                    vid = item["id"]
                    s = item.get("snippet", {})
                    raw = item.get("statistics", {}).get("commentCount")
                    provenance = {"source": self.source, "adapter_revision": self.revision,
                                  "discovered_in_tabs": found[vid]["tabs"]}
                    if unclassified:
                        provenance["kind_unclassified"] = True
                    videos.append({
                        "external_video_id": vid,
                        "title": s.get("title") or "",
                        "kind": found[vid]["kind"],
                        "published_at": s.get("publishedAt"),
                        "thumbnail_url": (s.get("thumbnails") or {}).get("medium", {}).get("url"),
                        "duration_sec": self._seconds(item.get("contentDetails", {}).get("duration")),
                        # None is the setting being off, never a count of zero.
                        "reported_comment_count": None if raw is None else int(raw),
                        "field_provenance": provenance,
                    })
                except (KeyError, TypeError, ValueError):
                    raise CollectionError("invalid_response") from None
        return Catalogue(videos=videos, complete=True)

    @classmethod
    def _seconds(cls, iso: str | None) -> int | None:
        if not iso:
            return None
        m = cls._DURATION.match(iso)
        if not m:
            return None
        h, mi, s = (int(x) if x else 0 for x in m.groups())
        return h * 3600 + mi * 60 + s
