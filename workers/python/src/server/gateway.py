"""Client for the control plane's worker gateway.

The worker holds a scoped credential, never the service role, and never tells
the server which tenant to write to: the server derives that from the
credential and the job. Nothing here sends a workspace, and the tests assert it.
"""
import hashlib
import json
from typing import Any, Iterable

import httpx

from collectors.protocol import Batch, RawComment
from sentiment.preprocess import to_plain_text

# Only a source that was traversed to its end is a success. Everything else
# keeps its own name, so a stoppage can never be filed as completion.
_FINISH = {
    "exhausted": "succeeded",
    "partial": "partial",
    "blocked": "blocked",
    "failed": "failed",
    "explicitly_disabled": "blocked",
    "unavailable": "blocked",
}


class ControlPlaneError(Exception):
    def __init__(self, code: str, retryable: bool = False):
        # Carries the code alone: a message built from the response could echo
        # the credential or the endpoint into a log.
        super().__init__(code)
        self.code, self.retryable = code, retryable


def _refusal_code(data: object, status: int) -> str:
    """The server's own code, or something better than silence.

    A refusal used to collapse to the bare string "control_plane_error"
    whenever the body did not carry `code` — which told an operator nothing at
    all about a batch the server had just rejected. The full message is still
    not repeated: a PostgREST error can contain the request URL, and that URL
    carries the key. So this takes a short token-shaped value only, and
    otherwise falls back to naming the status.
    """
    if isinstance(data, dict):
        for key in ("code", "error", "error_code"):
            value = data.get(key)
            # A code is a token. A sentence is a message, and messages are the
            # things that carry URLs.
            if isinstance(value, str) and value and len(value) <= 64 and " " not in value:
                return value
    return f"control_plane_error:{status}"


class LeaseLost(ControlPlaneError):
    def __init__(self):
        super().__init__("lease_lost", retryable=False)


def finish_status(outcome: str) -> str:
    if outcome not in _FINISH:
        raise ValueError("unknown_outcome")
    return _FINISH[outcome]


def content_hash(text: str) -> str:
    """The identity of a stored text.

    Shared with the analysis builder on purpose. A prediction whose hash does
    not match its comment is stored but never becomes the effective label, so
    the two must be computed in one place or they will drift apart silently.
    """
    return hashlib.sha256(text.encode()).hexdigest()


def _comment(c: RawComment) -> dict[str, Any]:
    return {
        "external_comment_id": c.id,
        "external_parent_id": c.parent_id,
        "is_reply": c.is_reply,
        "parent_source": c.parent_source,
        "author_channel_id": c.author_channel_id,
        "author_name": c.author_name,
        "text_raw": c.text,
        "text_plain": to_plain_text(c.text),
        # Hashes the stored text only, so a likes-only refresh leaves the hash
        # alone and an existing prediction stays effective.
        "content_hash": content_hash(c.text),
        "published_time_raw": c.published_time_raw,
        "published_at": c.published_at,
        "timestamp_precision": c.timestamp_precision,
        "likes_raw": c.likes_raw,
        "likes_value": c.likes_value,
        "source": c.source,
        "field_provenance": c.field_provenance,
    }


def _canonicalise(value: Any) -> Any:
    """Render numbers the way JSON does, so both languages agree.

    Python writes an integral float as 1.0 and JavaScript writes 1. Hashing the
    raw form makes the same payload produce two different digests, which turns a
    legitimate replay into a batch_conflict on the server.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _canonicalise(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_canonicalise(v) for v in value]
    return value


def build_batch(
    video_id: str,
    video_title: str | None,
    checkpoint: dict[str, Any],
    outcome: str,
    comments: Iterable[RawComment],
    predictions: Iterable[dict[str, Any]] = (),
) -> tuple[dict[str, Any], str]:
    payload = {
        "external_video_id": video_id,
        "video_title": video_title,
        "checkpoint": checkpoint,
        "outcome": outcome,
        "comments": [_comment(c) for c in comments],
        "predictions": list(predictions),
    }
    # Canonical form: the same content must hash identically however the dict
    # was built, or a legitimate replay would look like a conflicting payload.
    canonical = json.dumps(
        _canonicalise(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return payload, hashlib.sha256(canonical.encode()).hexdigest()


class ControlPlane:
    def __init__(self, base_url: str, credential: str, client: httpx.Client):
        if not credential:
            raise ValueError("missing_worker_credential")
        self._base, self._credential, self._client = base_url.rstrip("/"), credential, client

    def _post(self, path: str, body: dict[str, Any] | None = None) -> dict[str, Any] | None:
        try:
            response = self._client.post(
                f"{self._base}{path}",
                json=body or {},
                headers={"authorization": f"Bearer {self._credential}"},
                timeout=30,
            )
        except httpx.HTTPError:
            raise ControlPlaneError("network_failure", retryable=True) from None
        if response.status_code == 204:
            return None
        try:
            data = response.json()
        except ValueError:
            raise ControlPlaneError("invalid_response", retryable=False) from None
        if response.status_code >= 400:
            code = _refusal_code(data, response.status_code)
            if code == "lease_lost":
                raise LeaseLost()
            # 5xx may be transient; a refusal at 4xx is a decision, not a blip.
            raise ControlPlaneError(code, retryable=response.status_code >= 500)
        return data

    def claim(self) -> dict[str, Any] | None:
        """None means there was no work, which is not a failure."""
        return self._post("/worker/claim")

    def heartbeat(self, lease: dict[str, Any]) -> None:
        self._post("/worker/heartbeat", {"job_id": lease["job_id"], "lease_token": lease["lease_token"]})

    def commit_batch(
        self,
        lease: dict[str, Any],
        video_id: str,
        video_title: str | None,
        batch: Batch,
        predictions: Iterable[dict[str, Any]] = (),
    ) -> dict[str, Any] | None:
        checkpoint = {"cursor": batch.checkpoint} if batch.checkpoint else {}
        payload, digest = build_batch(
            video_id, video_title, checkpoint, batch.outcome, batch.comments, predictions
        )
        return self._post(
            "/worker/commit-batch",
            {
                "job_id": lease["job_id"],
                "lease_token": lease["lease_token"],
                # Idempotency: the same key with the same digest is a no-op,
                # the same key with a different digest is a conflict.
                "batch_key": digest[:32],
                "payload_hash": digest,
                "payload": payload,
            },
        )

    def finish(self, lease: dict[str, Any], outcome: str, error_code: str | None = None) -> None:
        self._post(
            "/worker/finish",
            {
                "job_id": lease["job_id"],
                "lease_token": lease["lease_token"],
                "outcome": finish_status(outcome),
                "error_code": error_code,
            },
        )
