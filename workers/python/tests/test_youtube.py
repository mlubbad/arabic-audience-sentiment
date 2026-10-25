import httpx
import pytest
from collectors.youtube_api import YouTubeAPI
from collectors.protocol import CollectionError


def test_explicit_reply_pagination_and_checkpoint_resume():
    seen = []
    def handler(request):
        seen.append(request.url.path)
        if request.url.path.endswith('/commentThreads'):
            return httpx.Response(200, json={'items': [{'snippet': {'topLevelComment': {'id': 'parent', 'snippet': {'textOriginal': 'تعليق'}}, 'totalReplyCount': 2}}]})
        page = request.url.params.get('pageToken')
        return httpx.Response(200, json={'items': [{'id': 'r2' if page else 'r1', 'snippet': {'textOriginal': 'رد', 'parentId': 'parent'}}], **({} if page else {'nextPageToken': 'two'})})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI('fixture-key', client)
        first = next(adapter.batches('abcdefghijk', None))
        remaining = list(adapter.batches('abcdefghijk', first.checkpoint))
        assert [c.id for b in [first, *remaining] for c in b.comments] == ['parent', 'r1', 'r2']
        assert remaining[-1].outcome == 'exhausted'
        assert remaining[0].comments[0].parent_source == 'api'
        assert seen.count('/youtube/v3/commentThreads') == 1


@pytest.mark.parametrize('code,outcome', [(403, 'blocked'), (429, 'blocked'), (500, 'failed')])
def test_http_failures_are_not_exhaustion(code, outcome):
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(code, json={'error': {}}))) as client:
        with pytest.raises(CollectionError) as e:
            list(YouTubeAPI('fixture-key', client).batches('abcdefghijk', None))
        assert e.value.outcome == outcome
        assert 'fixture-key' not in str(e.value)


def test_invalid_json_and_ssrf_input():
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text='not json'))) as client:
        with pytest.raises(CollectionError, match='invalid_response'):
            list(YouTubeAPI('fixture-key', client).batches('abcdefghijk', None))
        with pytest.raises(ValueError):
            list(YouTubeAPI('fixture-key', client).batches('https://internal', None))


def _responding(status, body, capture=None):
    """A transport that answers once, recording what it was asked."""
    def handler(request):
        if capture is not None:
            capture.append(request)
        return httpx.Response(status, json=body)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_a_connected_channel_is_read_with_the_owner_token_not_an_api_key():
    # The product path. It needs no API key at all, and every row must record
    # that it was read on the owner's authority rather than as public data.
    seen = []
    client = _responding(200, {"items": [
        {"snippet": {"topLevelComment": {"id": "c1", "snippet": {
            "textOriginal": "تعليق", "publishedAt": "2026-09-01T09:00:00Z"}},
            "totalReplyCount": 0}}]}, seen)
    adapter = YouTubeAPI(None, client, access_token="ya29.token")
    batch = next(adapter.batches("abcdefghijk", None))
    assert seen[0].headers["authorization"] == "Bearer ya29.token"
    # The key must not travel as well: a stale key answering for a revoked
    # token would file the row under the wrong provenance.
    assert "key=" not in str(seen[0].url)
    assert adapter.source == "youtube_oauth"
    assert batch.comments[0].source == "youtube_oauth"


def test_exactly_one_credential_is_required():
    client = _responding(200, {"items": []})
    with pytest.raises(ValueError, match="need_exactly_one_credential"):
        YouTubeAPI(None, client)
    with pytest.raises(ValueError, match="need_exactly_one_credential"):
        YouTubeAPI("key", client, access_token="token")


def test_an_expired_token_asks_to_be_renewed_rather_than_blocking_the_channel():
    # 401 is a credential that needs refreshing, not a refusal. Marking the
    # channel blocked would stop collection permanently for something an hour
    # of token life caused.
    client = _responding(401, {"error": {"errors": [{"reason": "authError"}]}})
    with pytest.raises(CollectionError) as caught:
        list(YouTubeAPI(None, client, access_token="stale").batches("abcdefghijk", None))
    assert caught.value.code == "credential_expired"
    assert caught.value.retryable is True
    assert caught.value.outcome != "blocked"


def test_comments_turned_off_is_the_video_s_answer_not_our_access_problem():
    # A property of the video, and a legitimate one. Filing it as access denied
    # reads as a problem with our credentials and hides the real ones.
    client = _responding(403, {"error": {"errors": [{"reason": "commentsDisabled"}]}})
    with pytest.raises(CollectionError) as caught:
        list(YouTubeAPI("key", client).batches("abcdefghijk", None))
    assert caught.value.code == "comments_disabled"
    assert caught.value.outcome == "explicitly_disabled"


def test_quota_is_distinguished_from_being_refused():
    # Quota comes back tomorrow; a refusal does not. Collapsing them would have
    # the worker give up on a channel it could read in an hour.
    client = _responding(403, {"error": {"errors": [{"reason": "quotaExceeded"}]}})
    with pytest.raises(CollectionError) as caught:
        list(YouTubeAPI("key", client).batches("abcdefghijk", None))
    assert caught.value.code == "quota_exceeded"
    assert caught.value.retryable is True

    # An unhandled refusal carries Google's own name for it, so a blocked job
    # says which permission is missing rather than only that one is.
    plain = _responding(403, {"error": {"errors": [{"reason": "forbidden"}]}})
    with pytest.raises(CollectionError) as caught:
        list(YouTubeAPI("key", plain).batches("abcdefghijk", None))
    assert caught.value.code == "source_access_denied:forbidden"


def test_a_refusal_with_no_reason_is_still_handled():
    # And a refusal with no reason at all still has to be handled.
    client = _responding(403, {"nothing": "useful"})
    with pytest.raises(CollectionError) as caught:
        list(YouTubeAPI("key", client).batches("abcdefghijk", None))
    assert caught.value.code == "source_access_denied"


def test_comment_counts_asks_statistics_fifty_at_a_time_and_never_invents_a_number():
    # One unit answers fifty counts. A video the source did not list, and one
    # it listed without a commentCount (comments off), are both None: unknown
    # is never zero, and never "the same as last time".
    seen = []

    def handler(request):
        seen.append(request)
        ids = request.url.params["id"].split(",")
        items = [{"id": v, "statistics": {"commentCount": str(i)}} for i, v in enumerate(ids)]
        # The second id in every chunk has comments switched off; the last id
        # of the whole request is dropped from the answer altogether.
        items[1]["statistics"] = {"viewCount": "5"}
        items = [i for i in items if i["id"] != "v0000000059"]
        return httpx.Response(200, json={"items": items})

    ids = [f"v{n:010d}" for n in range(60)]
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        counts = YouTubeAPI(None, client, access_token="ya29.token").comment_counts(ids)
    assert len(seen) == 2
    assert [len(r.url.params["id"].split(",")) for r in seen] == [50, 10]
    assert all(r.url.params["part"] == "statistics" for r in seen)
    assert all(r.url.path.endswith("/videos") for r in seen)
    assert all(r.headers["authorization"] == "Bearer ya29.token" for r in seen)
    assert set(counts) == set(ids)
    assert counts["v0000000000"] == 0 and counts["v0000000002"] == 2
    assert counts["v0000000001"] is None and counts["v0000000051"] is None
    assert counts["v0000000059"] is None
    assert counts["v0000000052"] == 2


def test_comment_counts_of_nothing_asks_nothing():
    seen = []
    with _responding(200, {"items": []}, seen) as client:
        assert YouTubeAPI("fixture-key", client).comment_counts([]) == {}
    assert seen == []


@pytest.mark.parametrize("status", [500, 503, 404])
def test_comment_counts_failure_is_retryable_and_named(status):
    # The caller falls back to reading every due video; it must be able to
    # tell this failure from a refusal of the read itself.
    with _responding(status, {"error": {}}) as client:
        with pytest.raises(CollectionError) as raised:
            YouTubeAPI("fixture-key", client).comment_counts(["abcdefghijk"])
    assert raised.value.code == "statistics_lookup_failed"
    assert raised.value.retryable is True
    assert "fixture-key" not in str(raised.value)


def test_comment_counts_refuses_an_id_it_would_not_read():
    with _responding(200, {"items": []}) as client:
        with pytest.raises(ValueError):
            YouTubeAPI("fixture-key", client).comment_counts(["https://internal"])


def _token_source(requests, responses):
    """A renew callable that answers from a list, recording the ask."""
    def renew():
        requests.append("renew")
        answer = responses[len([r for r in requests if r == "renew"]) - 1]
        return answer if isinstance(answer, dict) else None
    return renew


def test_a_lapsed_token_is_swapped_mid_run_and_the_request_is_repeated():
    # The whole run used to end at the first 401. With a renewal route the
    # very request is repeated under the fresh token, and the batch completes.
    state = {"calls": 0}
    def handler(request):
        state["calls"] += 1
        if state["calls"] == 1:
            return httpx.Response(401, json={"error": {"errors": []}})
        return httpx.Response(200, json={"items": []})

    renews = []
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI(None, client, access_token="ya29.stale",
                             renew=_token_source(renews, [{"access_token": "ya29.fresh",
                                                           "access_token_expires_at": None}]))
        batch = next(adapter.batches("abcdefghijk", None))
    assert batch.outcome == "exhausted"
    assert renews == ["renew"]
    assert adapter.token == "ya29.fresh"


def test_a_renewal_that_comes_back_empty_is_a_retryable_credential_lapse():
    def handler(request):
        return httpx.Response(401, json={"error": {"errors": []}})

    renews = []
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI(None, client, access_token="ya29.stale",
                             renew=_token_source(renews, [None]))
        with pytest.raises(CollectionError) as e:
            next(adapter.batches("abcdefghijk", None))
    assert e.value.code == "credential_expired"
    assert e.value.outcome == "failed" and e.value.retryable is True
    assert renews == ["renew"]


def test_a_token_nearing_its_end_is_renewed_before_the_source_is_asked():
    # Without the proactive swap the first request would spend the run's
    # remaining seconds collecting a page it then loses to the lapse.
    import datetime
    nearly_gone = (datetime.datetime.now(datetime.timezone.utc)
                   + datetime.timedelta(seconds=30)).isoformat()
    fresh = (datetime.datetime.now(datetime.timezone.utc)
             + datetime.timedelta(hours=1)).isoformat()

    seen_auth = []
    def handler(request):
        seen_auth.append(request.headers.get("authorization"))
        return httpx.Response(200, json={"items": []})

    renews = []
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI(None, client, access_token="ya29.old", expires_at=nearly_gone,
                             renew=_token_source(renews, [{"access_token": "ya29.new",
                                                           "access_token_expires_at": fresh}]))
        next(adapter.batches("abcdefghijk", None))
    assert renews == ["renew"]
    assert seen_auth == ["Bearer ya29.new"]


def test_a_token_with_time_left_is_not_renewed_at_all():
    import datetime
    fine = (datetime.datetime.now(datetime.timezone.utc)
            + datetime.timedelta(hours=1)).isoformat()

    seen_auth = []
    def handler(request):
        seen_auth.append(request.headers.get("authorization"))
        return httpx.Response(200, json={"items": []})

    renews = []
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI(None, client, access_token="ya29.kept", expires_at=fine,
                             renew=_token_source(renews, [{"access_token": "ya29.other"}]))
        next(adapter.batches("abcdefghijk", None))
    assert renews == []
    assert seen_auth == ["Bearer ya29.kept"]


def test_without_a_renewal_route_a_lapse_stays_a_retryable_credential_lapse():
    # The old behaviour, kept for a gateway that predates the route.
    def handler(request):
        return httpx.Response(401, json={"error": {"errors": []}})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI(None, client, access_token="ya29.stale")
        with pytest.raises(CollectionError) as e:
            next(adapter.batches("abcdefghijk", None))
    assert e.value.code == "credential_expired"
    assert e.value.retryable is True


def test_inline_replies_yielded_without_calling_comments_endpoint():
    # When commentThreads returns inline replies and totalReplyCount <= len(inline),
    # all replies are extracted inline with 0 extra quota units spent calling /comments.
    seen_paths = []

    def handler(request):
        seen_paths.append(request.url.path)
        if request.url.path.endswith("/commentThreads"):
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "snippet": {
                                "topLevelComment": {
                                    "id": "t1",
                                    "snippet": {"textOriginal": "تعليق رئيسي"},
                                },
                                "totalReplyCount": 2,
                            },
                            "replies": {
                                "comments": [
                                    {
                                        "id": "r1",
                                        "snippet": {
                                            "textOriginal": "رد أول",
                                            "parentId": "t1",
                                        },
                                    },
                                    {
                                        "id": "r2",
                                        "snippet": {
                                            "textOriginal": "رد ثان",
                                            "parentId": "t1",
                                        },
                                    },
                                ]
                            },
                        }
                    ]
                },
            )
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI("fixture-key", client)
        batches = list(adapter.batches("abcdefghijk", None))
        assert len(batches) == 1
        assert batches[0].outcome == "exhausted"
        comments = batches[0].comments
        assert [c.id for c in comments] == ["t1", "r1", "r2"]
        assert comments[1].parent_id == "t1"
        assert comments[2].parent_id == "t1"
        assert all(c.video_id == "abcdefghijk" for c in comments)
        # Absolutely no call to /comments:
        assert not any(p.endswith("/comments") for p in seen_paths)


def test_overflow_replies_fallback_to_comments_endpoint():
    # When totalReplyCount > len(inline) (e.g. 1 inline but 3 total), the thread
    # is scheduled for explicit reply pagination via /comments to fetch complete history.
    seen_paths = []

    def handler(request):
        seen_paths.append(request.url.path)
        if request.url.path.endswith("/commentThreads"):
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "snippet": {
                                "topLevelComment": {
                                    "id": "t1",
                                    "snippet": {"textOriginal": "تعليق رئيسي"},
                                },
                                "totalReplyCount": 3,
                            },
                            "replies": {
                                "comments": [
                                    {
                                        "id": "r1",
                                        "snippet": {
                                            "textOriginal": "رد أول",
                                            "parentId": "t1",
                                        },
                                    }
                                ]
                            },
                        }
                    ]
                },
            )
        if request.url.path.endswith("/comments"):
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "r1_full",
                            "snippet": {
                                "textOriginal": "رد أول كامل",
                                "parentId": "t1",
                            },
                        },
                        {
                            "id": "r2_full",
                            "snippet": {
                                "textOriginal": "رد ثان كامل",
                                "parentId": "t1",
                            },
                        },
                        {
                            "id": "r3_full",
                            "snippet": {
                                "textOriginal": "رد ثالث كامل",
                                "parentId": "t1",
                            },
                        },
                    ]
                },
            )
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI("fixture-key", client)
        batches = list(adapter.batches("abcdefghijk", None))
        # Batch 1 yielded top comment t1, Batch 2 yielded replies from /comments
        all_comments = [c for b in batches for c in b.comments]
        assert [c.id for c in all_comments] == ["t1", "r1_full", "r2_full", "r3_full"]
        assert any(p.endswith("/comments") for p in seen_paths)


def test_early_stopping_on_since_watermark():
    # When since is provided, thread pagination terminates immediately upon encountering
    # a comment older than or equal to the since cutoff, skipping older pages.
    calls = []

    def handler(request):
        calls.append(request.url.params.get("pageToken"))
        if not request.url.params.get("pageToken"):
            return httpx.Response(
                200,
                json={
                    "nextPageToken": "page2_token",
                    "items": [
                        {
                            "snippet": {
                                "topLevelComment": {
                                    "id": "new_c",
                                    "snippet": {
                                        "textOriginal": "جديد",
                                        "publishedAt": "2026-09-23T10:00:00Z",
                                    },
                                },
                                "totalReplyCount": 0,
                            }
                        },
                        {
                            "snippet": {
                                "topLevelComment": {
                                    "id": "old_c",
                                    "snippet": {
                                        "textOriginal": "قديم",
                                        "publishedAt": "2026-09-21T08:00:00Z",
                                    },
                                },
                                "totalReplyCount": 0,
                            }
                        },
                    ],
                },
            )
        # Should NOT be reached because early stopping halted at old_c
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "snippet": {
                            "topLevelComment": {
                                "id": "ancient_c",
                                "snippet": {
                                    "textOriginal": "أقدم",
                                    "publishedAt": "2026-09-19T00:00:00Z",
                                },
                            },
                            "totalReplyCount": 0,
                        }
                    }
                ]
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI("fixture-key", client)
        batches = list(
            adapter.batches("abcdefghijk", None, since="2026-09-22T00:00:00Z")
        )
        assert len(batches) == 1
        assert batches[0].outcome == "exhausted"
        assert [c.id for c in batches[0].comments] == ["new_c"]
        # Crucial check: page2 was NEVER called!
        assert calls == [None]


def test_youtube_interaction_fields_extracted():
    def handler(request):
        if request.url.path.endswith('/commentThreads'):
            return httpx.Response(200, json={
                'items': [{
                    'snippet': {
                        'topLevelComment': {
                            'id': 'c_rich',
                            'snippet': {
                                'textOriginal': 'تعليق تفاعلي',
                                'authorDisplayName': 'المعلق الفعال',
                                'authorChannelId': {'value': 'UCcommenter123'},
                                'authorProfileImageUrl': 'https://yt3.ggpht.com/avatar.jpg',
                                'authorChannelUrl': 'http://www.youtube.com/channel/UCcommenter123',
                                'publishedAt': '2026-09-23T10:00:00Z',
                                'updatedAt': '2026-09-23T10:05:00Z',
                                'likeCount': 42,
                            }
                        },
                        'totalReplyCount': 2
                    }
                }]
            })
        if request.url.path.endswith('/comments'):
            return httpx.Response(200, json={
                'items': [{
                    'id': 'reply_1',
                    'snippet': {
                        'textOriginal': 'رد رائع',
                        'parentId': 'c_rich',
                        'authorDisplayName': 'المجيب',
                        'authorProfileImageUrl': 'https://yt3.ggpht.com/reply_avatar.jpg',
                        'publishedAt': '2026-09-23T11:00:00Z',
                    }
                }]
            })
        return httpx.Response(404, json={})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI("fixture-key", client)
        batches = list(adapter.batches("abcdefghijk", None))
        assert len(batches) == 2
        c = batches[0].comments[0]
        assert c.author_name == "المعلق الفعال"
        assert c.author_channel_id == "UCcommenter123"
        assert c.author_profile_image_url == "https://yt3.ggpht.com/avatar.jpg"
        assert c.author_channel_url == "http://www.youtube.com/channel/UCcommenter123"
        assert c.reply_count == 2
        assert c.updated_at == "2026-09-23T10:05:00Z"
        assert c.likes_value == 42
        r = batches[1].comments[0]
        assert r.author_profile_image_url == "https://yt3.ggpht.com/reply_avatar.jpg"
        assert r.is_reply is True


def test_reply_aware_delta_sync_harvests_new_replies_on_older_threads():
    # When topLevelComment is older than `since`, but has an inline reply newer
    # than `since`, the reply is harvested from the current page without paging further.
    calls = []

    def handler(request):
        calls.append((request.url.path, request.url.params.get("pageToken")))
        if request.url.path.endswith("/commentThreads"):
            return httpx.Response(
                200,
                json={
                    "nextPageToken": "page2_never_called",
                    "items": [
                        {
                            "snippet": {
                                "topLevelComment": {
                                    "id": "old_thread",
                                    "snippet": {
                                        "textOriginal": "تعليق قديم",
                                        "publishedAt": "2026-09-15T08:00:00Z",
                                    },
                                },
                                "totalReplyCount": 2,
                            },
                            "replies": {
                                "comments": [
                                    {
                                        "id": "old_reply",
                                        "snippet": {
                                            "textOriginal": "رد قديم",
                                            "parentId": "old_thread",
                                            "publishedAt": "2026-09-16T08:00:00Z",
                                        },
                                    },
                                    {
                                        "id": "fresh_reply",
                                        "snippet": {
                                            "textOriginal": "رد جديد اليوم على تعليق قديم",
                                            "parentId": "old_thread",
                                            "publishedAt": "2026-09-25T10:00:00Z",
                                        },
                                    },
                                ]
                            },
                        }
                    ],
                },
            )
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        adapter = YouTubeAPI("fixture-key", client)
        batches = list(
            adapter.batches("abcdefghijk", None, since="2026-09-22T00:00:00Z")
        )
        assert len(batches) == 1
        assert batches[0].outcome == "exhausted"
        assert [c.id for c in batches[0].comments] == ["fresh_reply"]
        assert batches[0].comments[0].parent_id == "old_thread"
        assert calls == [("/youtube/v3/commentThreads", None)]


def test_sub_batching_guard_splits_pages_exceeding_500_comments():
    # A single commentThreads page of 100 threads x 5 inline replies = 600 comments.
    # Commit-batch rejects > 500 comments, so batches() must split into <= 500 chunks.
    items = []
    for t_idx in range(100):
        tid = f"t_{t_idx:03d}"
        items.append({
            "snippet": {
                "topLevelComment": {
                    "id": tid,
                    "snippet": {"textOriginal": f"تعليق {t_idx}"},
                },
                "totalReplyCount": 5,
            },
            "replies": {
                "comments": [
                    {
                        "id": f"{tid}_r{r_idx}",
                        "snippet": {
                            "textOriginal": f"رد {r_idx}",
                            "parentId": tid,
                        },
                    }
                    for r_idx in range(5)
                ]
            },
        })

    client = _responding(200, {"items": items})
    adapter = YouTubeAPI("fixture-key", client)
    batches = list(adapter.batches("abcdefghijk", None))
    assert len(batches) == 2
    assert len(batches[0].comments) == 500
    assert batches[0].outcome == "partial"
    assert len(batches[1].comments) == 100
    assert batches[1].outcome == "exhausted"


def test_rss_recent_videos_and_precheck_zero_quota():
    ch_id = "UC" + "x" * 22
    rss_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
          xmlns:media="http://search.yahoo.com/mrss/"
          xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <yt:videoId>vid00000001</yt:videoId>
        <yt:channelId>{ch_id}</yt:channelId>
        <title>حلقة &amp; نقاش</title>
        <published>2026-10-20T12:00:00+00:00</published>
        <media:group>
          <media:description>وصف الحلقة</media:description>
          <media:thumbnail url="https://i.ytimg.com/vi/vid00000001/hqdefault.jpg"/>
          <media:community>
            <media:statistics views="9500"/>
          </media:community>
        </media:group>
      </entry>
    </feed>"""

    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path.endswith("/feeds/videos.xml"):
            return httpx.Response(200, text=rss_xml)
        if request.url.path.endswith("/channels"):
            return httpx.Response(200, json={
                "items": [{
                    "id": ch_id,
                    "contentDetails": {"relatedPlaylists": {"uploads": "UU" + "x" * 22}},
                    "snippet": {"title": "قناة"},
                }]
            })
        return httpx.Response(500)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        api = YouTubeAPI("fixture-key", client)
        recent = api.rss_recent_videos(ch_id)
        assert len(recent) == 1
        assert recent[0]["external_video_id"] == "vid00000001"
        assert recent[0]["title"] == "حلقة & نقاش"
        assert recent[0]["view_count"] == 9500

        # When known already includes vid00000001 and use_rss_precheck=True,
        # playlistItems is skipped completely.
        cat = api.catalogue(ch_id, known={"vid00000001"}, use_rss_precheck=True)
        assert cat.complete is True
        assert cat.videos == []
        assert not any(p.endswith("/playlistItems") for p in calls)


def test_websub_subscription_and_zero_quota_html_resolution_and_transcript():
    ch_id = "UC" + "z" * 22

    def handler(request):
        if str(request.url).startswith("https://pubsubhubbub.appspot.com/subscribe"):
            return httpx.Response(202, text="")
        if str(request.url) == "https://www.youtube.com/@aljazeera360":
            return httpx.Response(
                200,
                text=f'<html><head><meta itemprop="channelId" content="{ch_id}"></head></html>',
            )
        if request.url.path.endswith("/api/timedtext"):
            return httpx.Response(
                200,
                text='<transcript><text start="0" dur="2">بسم الله &amp; أهلاً بكم</text></transcript>',
            )
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        api = YouTubeAPI("fixture-key", client)
        assert api.subscribe_websub(ch_id, "https://app.sky-develop.net/api/websub") is True
        assert api.resolve_channel_id_zero_quota("@aljazeera360") == ch_id
        assert api.fetch_video_transcript("vid00000001") == "بسم الله & أهلاً بكم"



