"""A discover job commits the catalogue and ends honestly."""

import json

import httpx

from collectors.protocol import Catalogue, CollectionError
from server.gateway import ControlPlane
from server.runner import run_discover, run_job


class Lister:
    def __init__(self, result):
        self.result = result

    def catalogue(self, channel_id=None):
        # channel_id travels only on the public path, where the collector is
        # told which channel it was built for; the OAuth path leaves it None.
        self.asked = channel_id
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def channel_profiles(self, ids):
        self.profile_ids = ids
        return [{"external_channel_id": ids[0], "country": "TR"}]


def plane(
    sent,
    lease_type="discover",
    token="tok",
    catalogue_refusal=None,
    channel_refusal=None,
    lease_extra=None,
    candidates=None,
):
    def handler(request):
        path = request.url.path.rsplit("/", 1)[-1]
        if path == "claim":
            return httpx.Response(
                200,
                json={
                    "job_id": "j",
                    "lease_token": "t",
                    "type": lease_type,
                    "checkpoint": None,
                    "videos": [],
                    **({"access_token": token} if token else {}),
                    **(lease_extra or {}),
                },
            )
        if path == "commit-catalogue" and catalogue_refusal:
            return httpx.Response(400, json={"code": catalogue_refusal})
        if path == "commit-catalogue":
            sent["catalogue"] = json.loads(request.content)["payload"]
            sent.setdefault("commits", []).append("catalogue")
            return httpx.Response(200, json={"videos": len(sent["catalogue"])})
        if path == "commit-channel" and channel_refusal:
            return httpx.Response(500, json={"code": channel_refusal})
        if path == "commit-channel":
            sent["channel"] = json.loads(request.content)["profile"]
            sent.setdefault("commits", []).append("channel")
            return httpx.Response(200, json={"channel_id": "c"})
        if path == "candidates-due":
            return httpx.Response(200, json=candidates or [])
        if path == "commit-candidate-profiles":
            sent["candidate_profiles"] = json.loads(request.content)["profiles"]
        if path == "finish":
            b = json.loads(request.content)
            sent["finish"], sent["error_code"] = b["outcome"], b["error_code"]
        if path == "tick":
            sent["ticked"] = True
            return httpx.Response(200, json={"discover": 0, "collect": 0})
        return httpx.Response(200, json={})

    return ControlPlane("https://c.invalid", "cred", httpx.Client(transport=httpx.MockTransport(handler)))


def test_commits_the_catalogue_and_succeeds_when_complete():
    sent = {}
    videos = [{"external_video_id": "a" * 11, "title": "x", "kind": "video", "reported_comment_count": 3}]
    assert (
        run_discover(plane(sent), lambda tok, expires_at=None, renew=None: Lister(Catalogue(videos, True)))
        is True
    )
    assert sent["catalogue"] == videos
    assert sent["finish"] == "succeeded"


def test_an_incomplete_catalogue_is_partial():
    sent = {}
    assert (
        run_discover(
            plane(sent),
            lambda tok, expires_at=None, renew=None: Lister(Catalogue([], False, "uploads_lookup_failed")),
        )
        is True
    )
    assert (sent["finish"], sent["error_code"]) == ("partial", "uploads_lookup_failed")


def test_a_youtube_profile_is_committed_after_the_catalogue():
    sent = {}
    profile = {
        "external_channel_id": "UC" + "x" * 22,
        "subscriber_count": 10,
        "view_count": 20,
        "video_count": 3,
    }
    result = Catalogue([], True, channel=profile)
    run_discover(
        plane(sent, lease_extra={"platform": "youtube"}),
        lambda tok, expires_at=None, renew=None: Lister(result),
    )
    assert sent["commits"] == ["catalogue", "channel"]
    assert sent["channel"] == profile
    assert sent["finish"] == "succeeded"


def test_a_failed_channel_profile_commit_makes_the_discover_partial():
    sent = {}
    result = Catalogue([], True, channel={"external_channel_id": "UC" + "x" * 22})
    run_discover(
        plane(sent, channel_refusal="source_unavailable", lease_extra={"platform": "youtube"}),
        lambda tok, expires_at=None, renew=None: Lister(result),
    )
    assert sent["catalogue"] == []
    assert (sent["finish"], sent["error_code"]) == ("partial", "channel_profile_commit_failed")


def test_a_refusal_is_blocked_with_its_code():
    sent = {}
    run_discover(
        plane(sent),
        lambda tok, expires_at=None, renew=None: Lister(CollectionError("source_access_denied:x", "blocked")),
    )
    assert (sent["finish"], sent["error_code"]) == ("blocked", "source_access_denied:x")


def test_no_token_is_blocked_before_any_listing():
    sent = {}
    run_discover(
        plane(sent, token=None),
        lambda tok, expires_at=None, renew=None: (_ for _ in ()).throw(AssertionError("built")),
    )
    assert (sent["finish"], sent["error_code"]) == ("blocked", "channel_not_connected")


def test_run_job_dispatches_on_the_lease_type():
    sent = {}
    assert run_job(plane(sent), lambda tok, expires_at=None, renew=None: Lister(Catalogue([], True))) is True
    assert sent["finish"] == "succeeded" and "catalogue" in sent


def test_a_catalogue_the_database_says_is_another_channels_ends_blocked():
    # The database refuses a list whose videos are not the job's channel's.
    # The run ends there, named, rather than holding its lease until it lapses
    # and a reclaim reads and refuses the same list again.
    sent = {}
    videos = [{"external_video_id": "a" * 11, "channel_external_id": "UC" + "y" * 22}]
    run_discover(
        plane(sent, catalogue_refusal="catalogue_channel_mismatch"),
        lambda tok, expires_at=None, renew=None: Lister(Catalogue(videos, True)),
    )
    assert (sent["finish"], sent["error_code"]) == ("blocked", "catalogue_channel_mismatch")


class KnownLister(Lister):
    def catalogue(self, channel_id=None, known=None):
        self.known = known
        return super().catalogue(channel_id)


def test_a_refresh_hands_the_collector_what_the_channel_already_has():
    sent = {}
    lister = KnownLister(Catalogue([], True))
    known = ["a" * 11, "b" * 11]
    assert (
        run_discover(
            plane(sent, lease_extra={"known_video_ids": known}),
            lambda tok, expires_at=None, renew=None: lister,
        )
        is True
    )
    assert lister.known == frozenset(known)
    # Nothing new is a complete answer: committed (so the channel counts as
    # catalogued now) and the job succeeds.
    assert sent["catalogue"] == []
    assert sent["finish"] == "succeeded"


def test_without_a_usable_list_the_channel_is_read_whole():
    for extra in (
        {},
        {"known_video_ids": None},
        {"known_video_ids": "aaaaaaaaaaa"},
        {"known_video_ids": ["aaaaaaaaaaa", 7]},
        {"known_video_ids": ["aaaaaaaaaaa"], "platform": "telegram"},
    ):
        sent = {}
        lister = KnownLister(Catalogue([], True))
        run_discover(
            plane(sent, lease_extra=extra), lambda tok, expires_at=None, renew=None, lister=lister: lister
        )
        assert lister.known is None, extra
        assert sent["finish"] == "succeeded"


def test_candidate_profiles_follow_featured_discovery_and_finish_after_commit():
    sent = {}
    candidate = "UC" + "c" * 22
    lister = Lister(Catalogue([], True, channel={"external_channel_id": "UC" + "x" * 22}))
    run_discover(
        plane(sent, lease_extra={"platform": "youtube"}, candidates=[candidate]),
        lambda *args, **kwargs: lister,
    )
    assert lister.profile_ids == [candidate]
    assert sent["candidate_profiles"] == [{"external_channel_id": candidate, "country": "TR"}]
    assert sent["finish"] == "succeeded"
