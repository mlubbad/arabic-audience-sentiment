"""The one Meta Graph client: bearer, cursor paging, and coded refusals.

Both connected collectors (Facebook pages, Instagram accounts) read through
this. Graph error bodies quote the request and sometimes the token, so only
Meta's numeric error code reaches a CollectionError; the message never does.
"""

from datetime import datetime, timezone
import re

import httpx

from .protocol import CollectionError

GRAPH_FACEBOOK = "https://graph.facebook.com/v25.0"
GRAPH_INSTAGRAM = "https://graph.instagram.com/v25.0"

_OFFSET_NO_COLON = re.compile(r"([+-]\d{2})(\d{2})$")


def parse_graph_time(value: object) -> tuple[str | None, str]:
    """A Graph timestamp as ISO 8601 UTC with second precision, or unknown.

    Meta writes ``+0000`` where ISO wants ``+00:00``; unix integers appear on
    scraped rows. Anything else is unknown: never now(), never a guess.
    """
    if isinstance(value, bool):
        return None, "unknown"
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat(), "second"
        except (OverflowError, OSError, ValueError):
            return None, "unknown"
    if not isinstance(value, str) or not value.strip():
        return None, "unknown"
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    text = _OFFSET_NO_COLON.sub(r"\1:\2", text)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None, "unknown"
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(), "second"


_RATE_LIMIT = {4, 17, 32, 613}
_PERMISSION = {10, 200, 230}
_NOT_FOUND = {803, 24}


def graph_error(status: int, body: object) -> CollectionError:
    """Meta's numeric code mapped to a stable outcome; the message is dropped."""
    code = None
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict) and isinstance(err.get("code"), int):
            code = err["code"]
    if code == 190:
        return CollectionError("invalid_credentials", "blocked")
    if code in _RATE_LIMIT:
        return CollectionError("rate_limit_exceeded", "failed", retryable=True)
    if code in _PERMISSION:
        return CollectionError("permission_missing", "blocked")
    if code in _NOT_FOUND:
        return CollectionError("channel_not_found", "failed")
    if code is None and status >= 500:
        return CollectionError("source_unavailable", "failed", retryable=True)
    return CollectionError("api_error", "failed")


class MetaGraphClient:
    def __init__(self, client: httpx.Client, access_token: str, base_url: str, timeout: float = 20.0):
        self.client = client
        self.access_token = access_token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get(self, path: str, params: dict[str, str] | None = None) -> dict:
        url = f"{self.base_url}/{path.lstrip('/')}"
        headers = {"Authorization": f"Bearer {self.access_token}"}
        try:
            resp = self.client.get(url, params=params or {}, headers=headers, timeout=self.timeout)
        except httpx.HTTPError:
            raise CollectionError("network_failure", retryable=True) from None
        try:
            body = resp.json()
        except ValueError:
            body = None
        if resp.is_error:
            raise graph_error(resp.status_code, body)
        if not isinstance(body, dict):
            raise CollectionError("invalid_response_format", "failed")
        return body

    def page(
        self, path: str, params: dict[str, str] | None, after: str | None
    ) -> tuple[list[dict], str | None]:
        """One page of an edge: its rows, and the cursor to continue only when Meta says there is more."""
        query = dict(params or {})
        if after:
            query["after"] = after
        body = self.get(path, query)
        data = body.get("data")
        rows = [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []
        paging = body.get("paging") if isinstance(body.get("paging"), dict) else {}
        cursors = paging.get("cursors") if isinstance(paging.get("cursors"), dict) else {}
        next_cursor = cursors.get("after") if paging.get("next") else None
        return rows, (str(next_cursor) if next_cursor else None)
