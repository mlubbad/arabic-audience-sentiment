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
    d = {
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
    if c.author_profile_image_url is not None:
        d["author_profile_image_url"] = c.author_profile_image_url
    if c.author_channel_url is not None:
        d["author_channel_url"] = c.author_channel_url
    if c.reply_count:
        d["reply_count"] = c.reply_count
    if c.updated_at is not None:
        d["updated_at"] = c.updated_at
    return d


def _canonicalise(value: Any) -> Any:
    """Render numbers the way JSON does, and strip NUL bytes and lone surrogates that PostgreSQL rejects.

    Python writes an integral float as 1.0 and JavaScript writes 1. Hashing the
    raw form makes the same payload produce two different digests, which turns a
    legitimate replay into a batch_conflict on the server.
    PostgreSQL rejects NUL (\u0000) characters and unpaired surrogates with 22P05.
    """
    if isinstance(value, str):
        s = value.replace("\x00", "")
        return s.encode("utf-8", "replace").decode("utf-8")
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
    payload = _canonicalise({
        "external_video_id": video_id,
        "video_title": video_title,
        "checkpoint": checkpoint,
        "outcome": outcome,
        "comments": [_comment(c) for c in comments],
        "predictions": list(predictions),
    })
    # Canonical form: the same content must hash identically however the dict
    # was built, or a legitimate replay would look like a conflicting payload.
    canonical = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
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

    def claim(self, job_types: list[str] | None = None) -> dict[str, Any] | None:
        """None means there was no work, which is not a failure.

        `job_types` scopes the claim to work this caller can run. A collection-
        only run asking unscoped would be handed a topics job, claim its lease,
        and have nothing to do with it — the work waits five minutes for a
        worker that can. The server never finishes a job it did not run: the
        caller says what it can run, and the oldest matching job comes back.
        """
        body: dict[str, Any] = {"types": job_types} if job_types else {}
        # This worker knows a reader lease: a token beside an
        # `external_channel_id` is the platform reader's, read by that id and
        # never as `mine=true`. The gateway keeps the reader's token from any
        # claim that does not say so.
        body["reader"] = True
        return self._post("/worker/claim", body)

    def renew_token(self, lease: dict[str, Any]) -> dict[str, Any] | None:
        """A fresh access token for this job's channel, mid-run.

        The claim handed down a token that can lapse before the run ends. This
        asks the server for a new one against the lease still held, so a long
        collection does not lose everything to an hour-old credential. A lost
        lease travels as LeaseLost, exactly as every other leased call; a
        channel whose grant is gone answers with no token at all, which the
        collector turns into the same retryable credential lapse as before.
        None also covers an older gateway without the route, whose 404 keeps
        the run's fallback behaviour intact.
        """
        return self._post("/worker/renew-token", {
            "job_id": lease["job_id"], "lease_token": lease["lease_token"],
            "reader": True,
        })

    def heartbeat(self, lease: dict[str, Any]) -> None:
        self._post("/worker/heartbeat", {"job_id": lease["job_id"], "lease_token": lease["lease_token"]})

    def commit_batch(
        self,
        lease: dict[str, Any],
        video_id: str,
        video_title: str | None,
        batch: Batch,
        predictions: Iterable[dict[str, Any]] = (),
        progress: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        # A channel-wide collection spans many videos, so the checkpoint has to
        # say which one is in hand and which are already finished. Without that
        # a resumed job restarts the channel from the top and re-reads
        # everything it had already read.
        checkpoint: dict[str, Any] = dict(progress or {})
        if batch.checkpoint:
            checkpoint["cursor"] = batch.checkpoint
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

    def commit_catalogue(self, lease: dict[str, Any], videos: list[dict[str, Any]]) -> dict[str, Any] | None:
        return self._post(
            "/worker/commit-catalogue",
            {"job_id": lease["job_id"], "lease_token": lease["lease_token"], "payload": _canonicalise(videos)},
        )

    def commit_channel(self, lease: dict[str, Any], channel: dict[str, Any]) -> dict[str, Any] | None:
        return self._post(
            "/worker/commit-channel",
            {"job_id": lease["job_id"], "lease_token": lease["lease_token"],
             "profile": _canonicalise(channel)},
        )

    def featured_due(self, lease: dict[str, Any]) -> bool:
        data = self._post(
            "/worker/featured-due",
            {"job_id": lease["job_id"], "lease_token": lease["lease_token"]},
        )
        return bool(data and data.get("due") is True)

    def commit_featured(
        self, lease: dict[str, Any], candidates: list[dict[str, Any]]
    ) -> dict[str, Any] | None:
        return self._post(
            "/worker/commit-featured",
            {
                "job_id": lease["job_id"],
                "lease_token": lease["lease_token"],
                "batch_key": "featured",
                "candidates": _canonicalise(candidates),
            },
        )

    def video_finished(self, lease: dict[str, Any], video_id: str, outcome: str,
                       error_code: str | None = None) -> None:
        self._post(
            "/worker/video-finished",
            {"job_id": lease["job_id"], "lease_token": lease["lease_token"],
             "video_id": video_id, "outcome": outcome, "error_code": error_code},
        )

    def video_counts(self, lease: dict[str, Any], counts: dict[str, int | None]) -> dict[str, Any]:
        """Hand the server the counts read for one unit; it answers what is still to read.

        None travels as null, never dropped: it is an answer — the source did
        not say — and the server keeps that video due. A refusal (including
        an older gateway's 404) is the caller's to fall back from.
        """
        data = self._post("/worker/video-counts", {
            "job_id": lease["job_id"], "lease_token": lease["lease_token"],
            "payload": [{"external_video_id": v, "comment_count": n} for v, n in counts.items()],
        })
        return data or {}

    def tick(self) -> dict[str, Any] | None:
        """Ask the server to enqueue whatever is due for this credential's workspace."""
        return self._post("/worker/tick")

    def topics_due(self, lease: dict[str, Any], model_id: str, prompt_version: str,
                   max_rows: int = 200) -> dict[str, Any]:
        """The rows this analyse job should classify, and the key they will be filed under."""
        data = self._post("/worker/topics-due", {
            "job_id": lease["job_id"], "lease_token": lease["lease_token"],
            "model_id": model_id, "prompt_version": prompt_version, "max_rows": max_rows,
        })
        return data or {}

    def commit_topics(self, lease: dict[str, Any], batch_key: str,
                      records: list[dict[str, Any]]) -> dict[str, Any] | None:
        return self._post("/worker/commit-topics", {
            "job_id": lease["job_id"], "lease_token": lease["lease_token"],
            "batch_key": batch_key, "records": _canonicalise(records),
        })
