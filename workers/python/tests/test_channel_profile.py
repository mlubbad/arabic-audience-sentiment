"""The profile observation returned by the existing channels.list request."""
import json
from pathlib import Path

import httpx

from collectors.youtube_api import YouTubeAPI


CHANNEL_ID = "UCxxxxxxxxxxxxxxxxxxxxxx"
UPLOADS = "UUxxxxxxxxxxxxxxxxxxxxxx"
GOLDEN = Path(__file__).parent / "fixtures" / "golden_channel.json"
PARTS = "contentDetails,snippet,statistics,brandingSettings,topicDetails"


def catalogue(channel_item):
    calls = []

    def handler(request):
        calls.append((request.url.path, dict(request.url.params)))
        if request.url.path.endswith("/channels"):
            return httpx.Response(200, json={"items": [channel_item]})
        if request.url.path.endswith("/playlistItems"):
            return httpx.Response(404, json={"error": {}})
        raise AssertionError(f"unexpected request: {request.url.path}")

    client = httpx.Client(transport=httpx.MockTransport(handler))
    return YouTubeAPI(None, client, access_token="tok").catalogue(), calls


def item(**parts):
    return {
        "id": CHANNEL_ID,
        "contentDetails": {"relatedPlaylists": {"uploads": UPLOADS}},
        **parts,
    }


def test_builds_the_full_profile_and_writes_the_cross_language_fixture():
    result, calls = catalogue(item(
        snippet={
            "description": "قناة للوصفات",
            "country": "TR",
            "defaultLanguage": "ar",
            "publishedAt": "2020-01-02T03:04:05Z",
        },
        brandingSettings={"channel": {"keywords": 'طبخ "حلويات شرقية" وصفات'}},
        topicDetails={"topicCategories": [
            "https://en.wikipedia.org/wiki/Food",
            "https://en.wikipedia.org/wiki/Lifestyle_(sociology)",
        ]},
        statistics={
            "subscriberCount": "1200",
            "viewCount": "34000",
            "videoCount": "56",
            "hiddenSubscriberCount": False,
        },
    ))
    expected = {
        "external_channel_id": CHANNEL_ID,
        "description": "قناة للوصفات",
        "country": "TR",
        "default_language": "ar",
        "channel_published_at": "2020-01-02T03:04:05Z",
        "keywords": ["طبخ", "حلويات شرقية", "وصفات"],
        "topic_categories": [
            "https://en.wikipedia.org/wiki/Food",
            "https://en.wikipedia.org/wiki/Lifestyle_(sociology)",
        ],
        "subscriber_count": 1200,
        "view_count": 34000,
        "video_count": 56,
        "subscriber_count_hidden": False,
    }
    assert result.channel == expected
    channel_calls = [query for path, query in calls if path.endswith("/channels")]
    assert channel_calls == [{"part": PARTS, "mine": "true"}]
    GOLDEN.write_text(
        json.dumps(expected, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def test_hidden_subscribers_are_explicitly_unknown_even_if_a_count_is_returned():
    result, _ = catalogue(item(statistics={
        "subscriberCount": "999",
        "viewCount": "34000",
        "videoCount": "56",
        "hiddenSubscriberCount": True,
    }))
    assert result.channel == {
        "external_channel_id": CHANNEL_ID,
        "subscriber_count": None,
        "view_count": 34000,
        "video_count": 56,
        "subscriber_count_hidden": True,
    }


def test_missing_statistics_omits_every_statistics_key():
    result, _ = catalogue(item())
    assert result.channel == {"external_channel_id": CHANNEL_ID}


def test_an_incomplete_count_set_is_not_sent_and_unknown_text_is_none():
    result, _ = catalogue(item(
        snippet={},
        statistics={"subscriberCount": "10", "viewCount": "20",
                    "hiddenSubscriberCount": False},
    ))
    assert result.channel == {
        "external_channel_id": CHANNEL_ID,
        "description": None,
        "country": None,
        "default_language": None,
        "channel_published_at": None,
        "subscriber_count_hidden": False,
    }
    assert not ({"subscriber_count", "view_count", "video_count"} & result.channel.keys())
