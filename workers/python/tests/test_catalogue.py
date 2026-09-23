"""The channel's videos, with what the source says about each."""
import httpx
import pytest

from collectors.protocol import CollectionError
from collectors.youtube_api import YouTubeAPI


def channel(uploads="UUxxxxxxxxxxxxxxxxxxxxxx"):
    return {"items": [{"contentDetails": {"relatedPlaylists": {"uploads": uploads}}}]}


def items(ids, next_page=None):
    body = {"items": [{"contentDetails": {"videoId": v}} for v in ids]}
    if next_page:
        body["nextPageToken"] = next_page
    return body


def stats(rows):
    return {"items": [
        {"id": r["id"],
         "snippet": {"title": r.get("title", r["id"]), "publishedAt": "2026-01-02T03:04:05Z",
                     "thumbnails": {"medium": {"url": f"https://i/{r['id']}.jpg"}}},
         "statistics": ({"commentCount": str(r["comments"])} if r.get("comments") is not None else {}),
         "contentDetails": {"duration": r.get("duration", "PT1M5S")}}
        for r in rows]}


def serve(tabs, videos, fail=None):
    calls = []

    def handler(request):
        p = request.url.path
        calls.append((p, dict(request.url.params)))
        if fail and p.endswith(fail):
            return httpx.Response(500, json={"error": {}})
        if p.endswith("/channels"):
            return httpx.Response(200, json=channel())
        if p.endswith("/playlistItems"):
            pl = request.url.params["playlistId"]
            page = request.url.params.get("pageToken")
            tab = tabs.get(pl)
            if tab is None:
                return httpx.Response(404, json={"error": {"errors": [{"reason": "playlistNotFound"}]}})
            pages = tab if tab and isinstance(tab[0], list) else [tab]
            idx = int(page or 0)
            nxt = str(idx + 1) if idx + 1 < len(pages) else None
            return httpx.Response(200, json=items(pages[idx], nxt))
        if p.endswith("/videos"):
            wanted = request.url.params["id"].split(",")
            return httpx.Response(200, json=stats([v for v in videos if v["id"] in wanted]))
        return httpx.Response(404, json={"error": {}})

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def test_three_tabs_classify_kind_and_a_missing_count_is_disabled():
    client, calls = serve(
        {"UULFxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"],
         "UUSHxxxxxxxxxxxxxxxxxxxxxx": ["bbbbbbbbbbb"],
         "UULVxxxxxxxxxxxxxxxxxxxxxx": None},
        [{"id": "aaaaaaaaaaa", "title": "أول", "comments": 12},
         {"id": "bbbbbbbbbbb", "title": "قصير", "comments": None}],
    )
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert cat.complete is True
    by = {v["external_video_id"]: v for v in cat.videos}
    assert by["aaaaaaaaaaa"]["kind"] == "video"
    assert by["aaaaaaaaaaa"]["reported_comment_count"] == 12
    assert by["aaaaaaaaaaa"]["duration_sec"] == 65
    assert by["aaaaaaaaaaa"]["thumbnail_url"] == "https://i/aaaaaaaaaaa.jpg"
    assert by["bbbbbbbbbbb"]["kind"] == "short"
    assert by["bbbbbbbbbbb"]["reported_comment_count"] is None
    assert by["aaaaaaaaaaa"]["field_provenance"]["discovered_in_tabs"] == ["video"]
    assert all("tok" not in str(c) for c in calls)


def test_a_video_in_two_tabs_keeps_the_first_kind_and_records_both():
    client, _ = serve(
        {"UULFxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"],
         "UUSHxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"],
         "UULVxxxxxxxxxxxxxxxxxxxxxx": None},
        [{"id": "aaaaaaaaaaa", "comments": 1}],
    )
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert len(cat.videos) == 1
    assert cat.videos[0]["kind"] == "video"
    assert cat.videos[0]["field_provenance"]["discovered_in_tabs"] == ["video", "short"]


def test_pagination_and_fifty_id_chunks():
    ids = [f"v{i:010d}" for i in range(120)]
    client, calls = serve(
        {"UULFxxxxxxxxxxxxxxxxxxxxxx": [ids[:50], ids[50:100], ids[100:]],
         "UUSHxxxxxxxxxxxxxxxxxxxxxx": None, "UULVxxxxxxxxxxxxxxxxxxxxxx": None},
        [{"id": i, "comments": 0} for i in ids],
    )
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert len(cat.videos) == 120
    assert sum(1 for p, _ in calls if p.endswith("/videos")) == 3
    assert sum(1 for p, _ in calls if p.endswith("/playlistItems")) == 3 + 2  # 3 pages + 2 empty tabs


def test_every_tab_missing_falls_back_to_all_uploads_unclassified():
    client, _ = serve(
        {"UUxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"]},
        [{"id": "aaaaaaaaaaa", "comments": 2}],
    )
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert cat.complete is True
    assert cat.videos[0]["kind"] == "video"
    assert cat.videos[0]["field_provenance"]["kind_unclassified"] is True


def test_a_failing_statistics_call_is_not_a_complete_catalogue():
    client, _ = serve(
        {"UULFxxxxxxxxxxxxxxxxxxxxxx": ["aaaaaaaaaaa"], "UUSHxxxxxxxxxxxxxxxxxxxxxx": None,
         "UULVxxxxxxxxxxxxxxxxxxxxxx": None},
        [{"id": "aaaaaaaaaaa", "comments": 2}],
        fail="/videos",
    )
    with pytest.raises(CollectionError) as e:
        YouTubeAPI(None, client, access_token="tok").catalogue()
    assert e.value.code == "source_unavailable"
    assert e.value.retryable is True


def test_needs_the_owner_token():
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"items": []}))) as client:
        with pytest.raises(CollectionError, match="no_channel_for_credential"):
            YouTubeAPI("key", client).catalogue()


def test_catalogue_extracts_video_interaction_metrics():
    def handler(request):
        p = request.url.path
        if p.endswith("/channels"):
            return httpx.Response(200, json=channel())
        if p.endswith("/playlistItems"):
            pl = request.url.params["playlistId"]
            if "LF" in pl:
                return httpx.Response(200, json=items(["vid12345678"]))
            return httpx.Response(404, json={"error": {}})
        if p.endswith("/videos"):
            return httpx.Response(200, json={
                "items": [{
                    "id": "vid12345678",
                    "snippet": {
                        "title": "فيديو تفاعلي",
                        "publishedAt": "2026-09-20T00:00:00Z",
                        "description": "وصف الفيديو",
                        "tags": ["arabic", "sentiment"],
                        "categoryId": "27",
                        "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/vid12345678/mqdefault.jpg"}},
                    },
                    "statistics": {
                        "viewCount": "125000",
                        "likeCount": "4300",
                        "favoriteCount": "0",
                        "commentCount": "210",
                    },
                    "contentDetails": {"duration": "PT5M30S"},
                }]
            })
        return httpx.Response(404, json={})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    cat = YouTubeAPI(None, client, access_token="tok").catalogue()
    assert cat.complete is True
    v = cat.videos[0]
    assert v["external_video_id"] == "vid12345678"
    assert v["title"] == "فيديو تفاعلي"
    assert v["view_count"] == 125000
    assert v["like_count"] == 4300
    assert v["favorite_count"] == 0
    assert v["reported_comment_count"] == 210
    assert v["tags"] == ["arabic", "sentiment"]
    assert v["description"] == "وصف الفيديو"
    assert v["category_id"] == "27"
    assert v["duration_sec"] == 330

