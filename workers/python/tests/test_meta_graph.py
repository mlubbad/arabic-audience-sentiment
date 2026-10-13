"""The one Meta Graph client both connected collectors read through."""

import httpx
import pytest
from collectors.protocol import CollectionError
from collectors.meta_graph import (
    GRAPH_FACEBOOK,
    GRAPH_INSTAGRAM,
    MetaGraphClient,
    graph_error,
    parse_graph_time,
)


def test_parse_graph_time_accepts_meta_offset():
    # Meta writes "+0000" where ISO 8601 wants "+00:00"; the row must not lose its date.
    assert parse_graph_time("2024-05-01T10:00:00+0000") == ("2024-05-01T10:00:00+00:00", "second")
    assert parse_graph_time("2024-05-01T10:00:00Z") == ("2024-05-01T10:00:00+00:00", "second")
    assert parse_graph_time(1714557600) == ("2024-05-01T10:00:00+00:00", "second")


def test_parse_graph_time_unknown_is_none():
    assert parse_graph_time(None) == (None, "unknown")
    assert parse_graph_time("yesterday") == (None, "unknown")
    assert parse_graph_time("") == (None, "unknown")


@pytest.mark.parametrize(
    "code,expected_code,outcome,retryable",
    [
        (190, "invalid_credentials", "blocked", False),
        (4, "rate_limit_exceeded", "failed", True),
        (17, "rate_limit_exceeded", "failed", True),
        (32, "rate_limit_exceeded", "failed", True),
        (613, "rate_limit_exceeded", "failed", True),
        (10, "permission_missing", "blocked", False),
        (200, "permission_missing", "blocked", False),
        (230, "permission_missing", "blocked", False),
        (803, "channel_not_found", "failed", False),
        (24, "channel_not_found", "failed", False),
        (100, "api_error", "failed", False),
    ],
)
def test_graph_error_mapping(code, expected_code, outcome, retryable):
    err = graph_error(400, {"error": {"code": code, "message": "secret-bearing text"}})
    assert isinstance(err, CollectionError)
    assert (err.code, err.outcome, err.retryable) == (expected_code, outcome, retryable)
    assert "secret" not in str(err)


def test_graph_error_server_side_is_retryable_and_unknown_is_api_error():
    err = graph_error(503, "<html>")
    assert (err.code, err.outcome, err.retryable) == ("source_unavailable", "failed", True)
    err = graph_error(400, {"error": {"code": 99999}})
    assert (err.code, err.outcome) == ("api_error", "failed")


def test_get_sends_bearer_and_maps_190():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization")
        seen["url"] = str(request.url)
        return httpx.Response(400, json={"error": {"code": 190, "message": "expired"}})

    client = MetaGraphClient(
        httpx.Client(transport=httpx.MockTransport(handler)), "tok", GRAPH_FACEBOOK
    )
    with pytest.raises(CollectionError) as exc:
        client.get("/me", {"fields": "id,name"})
    assert exc.value.code == "invalid_credentials"
    assert seen["auth"] == "Bearer tok"
    assert seen["url"].startswith("https://graph.facebook.com/v25.0/me?")
    assert "tok" not in seen["url"]


def test_page_returns_cursor_only_when_next_exists():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(dict(request.url.params))
        if request.url.params.get("after") == "c2":
            return httpx.Response(200, json={"data": [{"id": "3"}], "paging": {"cursors": {"after": "c3"}}})
        return httpx.Response(
            200,
            json={
                "data": [{"id": "1"}, {"id": "2"}],
                "paging": {"cursors": {"after": "c2"}, "next": "https://graph.instagram.com/next"},
            },
        )

    client = MetaGraphClient(
        httpx.Client(transport=httpx.MockTransport(handler)), "tok", GRAPH_INSTAGRAM
    )
    items, after = client.page("/me/media", {"fields": "id"}, None)
    assert [i["id"] for i in items] == ["1", "2"]
    assert after == "c2"
    items, after = client.page("/me/media", {"fields": "id"}, "c2")
    assert [i["id"] for i in items] == ["3"]
    assert after is None
    assert calls[1]["after"] == "c2"


def test_transport_failure_is_retryable_and_non_json_is_refused():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    client = MetaGraphClient(httpx.Client(transport=httpx.MockTransport(boom)), "tok", GRAPH_FACEBOOK)
    with pytest.raises(CollectionError) as exc:
        client.get("/me")
    assert (exc.value.code, exc.value.retryable) == ("network_failure", True)

    client = MetaGraphClient(
        httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, text="<html>"))),
        "tok",
        GRAPH_FACEBOOK,
    )
    with pytest.raises(CollectionError) as exc:
        client.get("/me")
    assert exc.value.code == "invalid_response_format"
