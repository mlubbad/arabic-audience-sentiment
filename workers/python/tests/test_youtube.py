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

    plain = _responding(403, {"error": {"errors": [{"reason": "forbidden"}]}})
    with pytest.raises(CollectionError) as caught:
        list(YouTubeAPI("key", plain).batches("abcdefghijk", None))
    assert caught.value.code == "source_access_denied"


def test_a_refusal_with_no_reason_is_still_handled():
    client = _responding(403, {"nothing": "useful"})
    with pytest.raises(CollectionError) as caught:
        list(YouTubeAPI("key", client).batches("abcdefghijk", None))
    assert caught.value.code == "source_access_denied"
