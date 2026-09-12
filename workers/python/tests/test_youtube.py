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
