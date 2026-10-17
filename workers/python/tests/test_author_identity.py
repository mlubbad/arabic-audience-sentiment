from collections.abc import Callable
from datetime import datetime, timezone

import httpx
import pytest

from collectors.identity import stable_author_id
from collectors.scrapers.apify import ApifyClient
from collectors.scrapers.brightdata import BrightDataClient
from collectors.telegram_collector import TelegramCollector
from collectors.tiktok_collector import TikTokCollector


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("", None),
        ("   ", None),
        ("None", None),
        ("null", None),
        (123, "123"),
        ("  author-42  ", "author-42"),
    ],
)
def test_stable_author_id(value: object, expected: str | None) -> None:
    assert stable_author_id(value) == expected


def _client_returning(items: list[dict]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=items)

    return httpx.Client(transport=httpx.MockTransport(handler))


def _assert_identity_cases(collect: Callable[[dict], str | None], id_field: str) -> None:
    assert collect({}) is None
    assert collect({"handle": "display_only"}) is None
    assert collect({id_field: 123, "handle": "display_only"}) == "123"


def test_telegram_fixture_author_identity() -> None:
    def collect(author: dict) -> str | None:
        comment = {
            "id": "comment-1",
            "text": "fixture comment",
            "author_name": author.get("handle", ""),
        }
        if "author_id" in author:
            comment["author_id"] = author["author_id"]
        fixture = {"comments": {"1": [comment]}}
        batch = next(TelegramCollector(channel_id="channel", fixture_data=fixture).batches("1"))
        return batch.comments[0].author_channel_id

    _assert_identity_cases(collect, "author_id")


def test_telegram_live_author_identity() -> None:
    class Sender:
        first_name = "Display"
        last_name = "Only"
        username = "display_only"

    class Message:
        id = 1
        text = "live comment"
        message = text
        date = datetime(2026, 1, 1, tzinfo=timezone.utc)
        reactions = None
        reply_to = None

        def __init__(self, sender_id: int | None, include_sender: bool):
            self.sender_id = sender_id
            self.sender = Sender() if include_sender else None

    class Client:
        def __init__(self, sender_id: int | None, include_sender: bool):
            self.sender_id = sender_id
            self.include_sender = include_sender

        def get_entity(self, handle: str) -> str:
            return handle

        def iter_messages(self, channel: str, **kwargs: object) -> list[Message]:
            return [Message(self.sender_id, self.include_sender)]

    def collect(sender_id: int | None, include_sender: bool) -> str | None:
        collector = TelegramCollector(
            channel_id="channel", telethon_client=Client(sender_id, include_sender)
        )
        return next(collector.batches("1")).comments[0].author_channel_id

    assert collect(None, False) is None
    assert collect(None, True) is None
    assert collect(123, True) == "tg_123"


def test_apify_x_author_identity() -> None:
    def collect(author: dict) -> str | None:
        provider_author = {"name": author.get("handle", "")}
        if "id" in author:
            provider_author["id"] = author["id"]
        client = ApifyClient(
            token="test",
            client=_client_returning(
                [{"id": "reply-1", "text": "reply", "author": provider_author}]
            ),
        )
        return client.scrape_x_replies("root-1")[0]["author_channel_id"]

    _assert_identity_cases(collect, "id")


def test_apify_tiktok_author_identity() -> None:
    def collect(author: dict) -> str | None:
        provider_user = {"uniqueId": author.get("handle", "")}
        if "id" in author:
            provider_user["id"] = author["id"]
        client = ApifyClient(
            token="test",
            client=_client_returning(
                [{"id": "comment-1", "text": "comment", "user": provider_user}]
            ),
        )
        return client.scrape_tiktok_comments("video-1")[0]["author_channel_id"]

    _assert_identity_cases(collect, "id")


def test_brightdata_x_author_identity() -> None:
    def collect(author: dict) -> str | None:
        item = {
            "id": "reply-1",
            "text": "reply",
            "user_posted": author.get("handle", ""),
        }
        if "user_id" in author:
            item["user_id"] = author["user_id"]
        client = BrightDataClient(api_key="test", client=_client_returning([item]))
        return client.scrape_x_replies("root-1")[0]["author_channel_id"]

    _assert_identity_cases(collect, "user_id")


def test_brightdata_tiktok_author_identity() -> None:
    def collect(author: dict) -> str | None:
        item = {
            "comment_id": "comment-1",
            "comment": "comment",
            "user": {"uniqueId": author.get("handle", "")},
        }
        if "user_id" in author:
            item["user_id"] = author["user_id"]
        client = BrightDataClient(api_key="test", client=_client_returning([item]))
        return client.scrape_tiktok_comments("video-1")[0]["author_channel_id"]

    _assert_identity_cases(collect, "user_id")


def test_tiktok_fixture_author_identity() -> None:
    def collect(author: dict) -> str | None:
        user = {"unique_id": author.get("handle", ""), "nickname": "Display Only"}
        if "id" in author:
            user["id"] = author["id"]
        fixture = {
            "comments": {
                "1": [{"id": "comment-1", "text": "comment", "user": user}]
            }
        }
        batch = next(TikTokCollector(channel_id="channel", fixture_data=fixture).batches("1"))
        return batch.comments[0].author_channel_id

    _assert_identity_cases(collect, "id")

    author_id_fixture = {
        "comments": {"1": [{"id": "comment-1", "text": "comment", "author_id": 789}]}
    }
    author_id_batch = next(
        TikTokCollector(channel_id="channel", fixture_data=author_id_fixture).batches("1")
    )
    assert author_id_batch.comments[0].author_channel_id == "789"

    uid_fixture = {
        "comments": {"1": [{"id": "comment-1", "text": "comment", "user": {"uid": 456}}]}
    }
    uid_batch = next(TikTokCollector(channel_id="channel", fixture_data=uid_fixture).batches("1"))
    assert uid_batch.comments[0].author_channel_id == "456"
