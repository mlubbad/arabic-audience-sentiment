"""YouTube Data API adapter. Tested with synthetic HTTP responses; never run live.

Authenticates either with an API key, for public data, or with an OAuth access
token, for a channel its owner has connected. The token path is the product
path: it needs no API key at all, and it reaches a connected channel's comments
directly.
"""
import json
import re
from collections.abc import Iterator, Set as AbstractSet
from datetime import datetime, timezone, timedelta
import httpx
from .protocol import Batch, Catalogue, CollectionError, RawComment

# How soon before expiry the token is swapped for a fresh one. An access
# token that lapses mid-collection costs the whole run, so anything inside
# this margin is renewed before the next request is sent rather than after
# the source refuses it.
_RENEW_MARGIN_SECONDS = 120
_KEYWORD_PARTS = re.compile(r'"([^"]*)"?|(\S+)')


def _parse_keywords(value: str) -> list[str]:
    """Split YouTube keywords without interpreting apostrophes or backslashes."""
    return [quoted or word for quoted, word in _KEYWORD_PARTS.findall(value) if quoted or word]


class YouTubeAPI:
    source = "youtube_data_api_public"
    revision = "api-v3-adapter-v1"

    def __init__(self, api_key: str | None, client: httpx.Client,
                 access_token: str | None = None, expires_at: str | None = None,
                 renew=None, public_reader: bool = False):
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
        # owner's authority is never filed as public data. Reader mode is the
        # reverse case, and it matters just as much: a channel read by id
        # through the platform's own grant is public data — the credential
        # opened the door, it does not own the channel — so the OAuth token
        # must not file the rows as `youtube_oauth` either.
        self.public_reader = bool(public_reader and access_token)
        self.source = ("youtube_data_api_public"
                       if (api_key or self.public_reader) else "youtube_oauth")

    @property
    def credential_kind(self) -> str:
        """Which kind of credential opened the door, for field provenance."""
        if self.public_reader:
            return "platform_reader"
        return "api_key" if self.key else "owner_grant"

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
        if response.status_code == 404:
            if allow_404:
                return None
            reason = self._reason(response)
            raise CollectionError(
                "video_not_found" if (reason == "videoNotFound" or not reason) else f"not_found:{reason}",
                "unavailable",
            )
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

    def _comment(self, item, video, parent=None, reply_count=0):
        try:
            s = item["snippet"]
            parent = s.get("parentId", parent)
            r_count = reply_count or s.get("totalReplyCount", 0)
            return RawComment(id=item["id"], video_id=video, text=s["textOriginal"],
                              parent_id=parent, is_reply=parent is not None,
                              parent_source="api" if parent else "unknown",
                              author_channel_id=s.get("authorChannelId", {}).get("value"),
                              author_name=s.get("authorDisplayName", ""),
                              author_profile_image_url=s.get("authorProfileImageUrl"),
                              author_channel_url=s.get("authorChannelUrl"),
                              reply_count=int(r_count) if r_count is not None else 0,
                              updated_at=s.get("updatedAt"),
                              published_time_raw=s.get("publishedAt"), published_at=s.get("publishedAt"),
                              timestamp_precision="second" if s.get("publishedAt") else "unknown",
                              likes_value=s.get("likeCount"), source=self.source,
                              field_provenance={"source": self.source, "adapter_revision": self.revision,
                                                "credential_kind": self.credential_kind})
        except (KeyError, TypeError, AttributeError):
            raise CollectionError("invalid_comment") from None

    @staticmethod
    def _is_before_or_at(pub_str: str | None, since_str: str | None) -> bool:
        """Check if publishedAt is older than or equal to since (with 60s clock skew tolerance)."""
        if not pub_str or not since_str:
            return False
        try:
            pub_dt = datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
            since_dt = datetime.fromisoformat(since_str.replace("Z", "+00:00"))
            return pub_dt <= (since_dt - timedelta(seconds=60))
        except (ValueError, TypeError):
            return False

    def batches(
        self,
        video_id: str,
        checkpoint: str | None = None,
        since: str | None = None,
        max_items: int | None = None,
        **kwargs,
    ) -> Iterator[Batch]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):

            raise ValueError("invalid_video_id")
        try:
            state = json.loads(checkpoint) if checkpoint else {
                "video_id": video_id, "page": None, "parents": [], "reply_page": None,
                "threads_done": False, "since": since}
            if state["video_id"] != video_id or not isinstance(state["parents"], list):
                raise ValueError()
        except (KeyError, ValueError, TypeError):
            raise CollectionError("invalid_checkpoint") from None
        effective_since = state.get("since") or since
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
                params = {"part": "snippet,replies", "videoId": video_id, "maxResults": 100,
                          "order": "time", "textFormat": "plainText"}
                if state["page"]:
                    params["pageToken"] = state["page"]
                data = self._get("commentThreads", params)
                try:
                    comments = []
                    parents = []
                    cutoff_reached = False
                    for i in data.get("items", []):
                        top = i["snippet"]["topLevelComment"]
                        top_pub = top.get("snippet", {}).get("publishedAt")
                        if effective_since and top_pub and self._is_before_or_at(top_pub, effective_since):
                            cutoff_reached = True
                            break
                        total_replies = i["snippet"].get("totalReplyCount", 0)
                        comments.append(self._comment(top, video_id, reply_count=total_replies))
                        inline = i.get("replies", {}).get("comments", [])
                        if total_replies <= len(inline):
                            for r in inline:
                                comments.append(self._comment(r, video_id, parent=top["id"]))
                        else:
                            parents.append(top["id"])
                    state["parents"] = parents
                except (KeyError, TypeError):
                    raise CollectionError("invalid_thread") from None
                if cutoff_reached:
                    state["threads_done"] = True
                    state["page"] = None
                else:
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

    def featured_channels(self, external_channel_id: str) -> list[dict]:
        """Return the channel identities featured on a YouTube channel page."""
        data = self._get(
            "channelSections",
            {"part": "contentDetails", "channelId": external_channel_id},
        )
        try:
            ids: list[str] = []
            seen: set[str] = set()
            for section in data["items"]:
                channels = (section.get("contentDetails") or {}).get("channels") or []
                if not isinstance(channels, list):
                    raise TypeError
                for channel_id in channels:
                    if not isinstance(channel_id, str):
                        raise TypeError
                    if channel_id != external_channel_id and channel_id not in seen:
                        seen.add(channel_id)
                        ids.append(channel_id)
                        if len(ids) == 100:
                            break
                if len(ids) == 100:
                    break
        except (KeyError, TypeError, AttributeError):
            raise CollectionError("invalid_response") from None

        details: dict[str, dict[str, str | None]] = {}
        for start in range(0, len(ids), 50):
            chunk = ids[start:start + 50]
            response = self._get(
                "channels", {"part": "snippet", "id": ",".join(chunk)}
            )
            try:
                for item in response["items"]:
                    channel_id = item["id"]
                    snippet = item.get("snippet") or {}
                    details[channel_id] = {
                        "title": snippet.get("title") or None,
                        "handle": snippet.get("customUrl") or None,
                    }
            except (KeyError, TypeError, AttributeError):
                raise CollectionError("invalid_response") from None
        return [
            {
                "candidate_external_id": channel_id,
                "title": details.get(channel_id, {}).get("title"),
                "handle": details.get(channel_id, {}).get("handle"),
            }
            for channel_id in ids
        ]

    def channel_profiles(self, ids: list[str]) -> list[dict]:
        """Fetch one bounded YouTube profile batch and preserve unknowns."""
        if not ids:
            return []
        if len(ids) > 50:
            raise CollectionError("invalid_candidate_profiles")
        data = self._get("channels", {"part": "snippet,statistics,topicDetails", "id": ",".join(ids)})
        try:
            profiles = []
            for item in data["items"]:
                profile = self._channel_profile(item)
                profiles.append({key: value for key, value in profile.items() if key in {
                    "external_channel_id", "subscriber_count", "subscriber_count_hidden",
                    "view_count", "video_count", "country", "default_language", "topic_categories",
                }})
            return profiles
        except (KeyError, TypeError, AttributeError):
            raise CollectionError("invalid_response") from None

    _TABS = (("video", "LF"), ("short", "SH"), ("stream", "LV"))
    _DURATION = re.compile(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$")

    @staticmethod
    def _channel_profile(item: dict, requested_channel_id: str | None = None) -> dict:
        """Build one observation without turning an unreturned part into data."""
        try:
            external_channel_id = requested_channel_id or item["id"]
            profile = {"external_channel_id": external_channel_id}
            if "snippet" in item:
                snippet = item["snippet"] or {}
                profile.update({
                    "description": snippet.get("description") or None,
                    "country": snippet.get("country") or None,
                    "default_language": snippet.get("defaultLanguage") or None,
                    "channel_published_at": snippet.get("publishedAt") or None,
                })
            if "brandingSettings" in item:
                raw_keywords = ((item["brandingSettings"] or {}).get("channel") or {}).get(
                    "keywords"
                )
                profile["keywords"] = (
                    _parse_keywords(raw_keywords) if isinstance(raw_keywords, str) else None
                )
            if "topicDetails" in item:
                categories = (item["topicDetails"] or {}).get("topicCategories")
                profile["topic_categories"] = categories if isinstance(categories, list) else None
            if "statistics" in item:
                statistics = item["statistics"] or {}
                hidden = statistics.get("hiddenSubscriberCount")
                raw_counts = (
                    statistics.get("subscriberCount"),
                    statistics.get("viewCount"),
                    statistics.get("videoCount"),
                )
                if (hidden is True or raw_counts[0] is not None) and all(
                    value is not None for value in raw_counts[1:]
                ):
                    profile.update({
                        "subscriber_count": None if hidden is True else int(raw_counts[0]),
                        "view_count": int(raw_counts[1]),
                        "video_count": int(raw_counts[2]),
                        "subscriber_count_hidden": (
                            hidden if isinstance(hidden, bool) else None
                        ),
                    })
            return profile
        except (KeyError, TypeError, ValueError):
            raise CollectionError("invalid_response") from None

    def _playlist(self, playlist_id: str,
                  known: AbstractSet[str] | None = None) -> list[str] | None:
        """The playlist's video ids, or None when the playlist is absent.

        Every id, unless `known` is given: the tab playlists are newest
        first, so a page made only of videos the channel already has means
        the rest of the playlist is known as well, and reading stops there.
        A page with even one new id is not proof of that, so the next page
        is read too.
        """
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
                page_ids = [i["contentDetails"]["videoId"] for i in data["items"]]
            except (KeyError, TypeError):
                raise CollectionError("invalid_response") from None
            ids.extend(page_ids)
            if known and page_ids and all(v in known for v in page_ids):
                return ids
            nxt = data.get("nextPageToken")
            if nxt and nxt == page:
                raise CollectionError("repeated_page_token", "partial")
            page = nxt
            if not page:
                return ids

    def catalogue(self, channel_id: str | None = None,
                  known: AbstractSet[str] | None = None) -> Catalogue:
        """The channel's videos across its three tabs, with the source's counts.

        Cost: about two quota units per fifty videos. The tab playlists are the
        uploads id with LF/SH/LV inserted after UU; a 404 on one is an empty
        tab. If all three are absent the plain uploads list stands in and the
        kind is recorded as unclassified rather than guessed.

        With `channel_id` the channel is named, not inferred. Two credentials
        can carry that request: the project API key, or the platform's reader
        grant (`public_reader=True`) — an OAuth token whose authority is the
        platform's, not the channel owner's, so the rows it reads are still
        public data. What is refused is the one combination that would read a
        channel its credential was never granted for: an owner token plus an
        id. An id that names no channel is a blocked dead end, not an empty
        catalogue.

        With `known` — the ids the channel already has, which the server
        hands a refresh — each tab is read only down to its first page of
        known videos, and only the videos not in `known` are looked up and
        returned. The commit upserts what it is sent and leaves every other
        video as it was, so the list is the new videos alone (possibly none),
        and it is complete: everything past the stop is already catalogued.
        A refresh of a known channel with nothing new costs four units (the
        channel and one page per tab) where the whole read cost two per
        fifty videos. Without `known`, as on a first discover, every tab is
        read to its end.
        """
        if channel_id is not None:
            if not re.fullmatch(r"UC[A-Za-z0-9_-]{22}", channel_id):
                raise ValueError("invalid_channel_id")
            if self.token and not self.public_reader:
                raise ValueError("owner_token_reads_mine_only")
            params = {
                "part": "contentDetails,snippet,statistics,brandingSettings,topicDetails",
                "id": channel_id,
            }
        else:
            params = {
                "part": "contentDetails,snippet,statistics,brandingSettings,topicDetails",
                "mine": "true",
            }
        data = self._get("channels", params)
        if not data["items"]:
            raise CollectionError(
                "channel_not_found" if channel_id else "no_channel_for_credential", "blocked"
            )
        channel_item = data["items"][0]
        profile = self._channel_profile(channel_item, channel_id)
        try:
            uploads = channel_item["contentDetails"]["relatedPlaylists"]["uploads"]
        except (KeyError, TypeError):
            raise CollectionError("invalid_response") from None
        base = uploads[2:]
        # The channel this list is meant to be: the one named, else the one
        # the owner's grant answered for. Every video carries the channel
        # that uploaded it, and the database refuses a catalogue that is not
        # the job's channel; a mismatch here stops the run before anything of
        # it travels.
        expected = channel_id or channel_item.get("id")

        found: dict[str, dict] = {}
        any_tab = False
        for kind, suffix in self._TABS:
            ids = self._playlist(f"UU{suffix}{base}", known)
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
            for vid in self._playlist(uploads, known) or []:
                found.setdefault(vid, {"kind": "video", "tabs": []})

        videos: list[dict] = []
        # What the channel already has is not asked about again: its row
        # keeps the counts it has, and the collect path's live check keeps
        # the comment count of every video due for a read current.
        ids = [vid for vid in found if not known or vid not in known]
        for start in range(0, len(ids), 50):
            chunk = ids[start:start + 50]
            data = self._get("videos", {"part": "snippet,statistics,contentDetails",
                                        "id": ",".join(chunk)})
            for item in data["items"]:
                try:
                    vid = item["id"]
                    s = item.get("snippet", {})
                    stat = item.get("statistics", {})
                    raw = stat.get("commentCount")
                    raw_views = stat.get("viewCount")
                    raw_likes = stat.get("likeCount")
                    raw_fav = stat.get("favoriteCount")
                    provenance = {"source": self.source, "adapter_revision": self.revision,
                                  "credential_kind": self.credential_kind,
                                  "discovered_in_tabs": found[vid]["tabs"]}
                    if unclassified:
                        provenance["kind_unclassified"] = True
                    uploader = s.get("channelId")
                    if expected and uploader and uploader != expected:
                        raise CollectionError("catalogue_channel_mismatch", "blocked")
                    videos.append({
                        "external_video_id": vid,
                        "channel_external_id": uploader,
                        "title": s.get("title") or "",
                        "kind": found[vid]["kind"],
                        "published_at": s.get("publishedAt"),
                        "thumbnail_url": (s.get("thumbnails") or {}).get("medium", {}).get("url"),
                        "duration_sec": self._seconds(item.get("contentDetails", {}).get("duration")),
                        # None is the setting being off, never a count of zero.
                        "reported_comment_count": None if raw is None else int(raw),
                        "view_count": None if raw_views is None else int(raw_views),
                        "like_count": None if raw_likes is None else int(raw_likes),
                        "favorite_count": None if raw_fav is None else int(raw_fav),
                        "tags": s.get("tags") or [],
                        "description": s.get("description") or "",
                        "category_id": s.get("categoryId"),
                        "field_provenance": provenance,
                    })
                except (KeyError, TypeError, ValueError):
                    raise CollectionError("invalid_response") from None
        return Catalogue(videos=videos, complete=True, channel=profile)

    @classmethod
    def _seconds(cls, iso: str | None) -> int | None:
        if not iso:
            return None
        m = cls._DURATION.match(iso)
        if not m:
            return None
        h, mi, s = (int(x) if x else 0 for x in m.groups())
        return h * 3600 + mi * 60 + s
