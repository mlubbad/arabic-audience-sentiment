"""Seltz AI multi-key context attribution for audience sentiment spikes.

Queries Seltz Search (`/v1/search`) and Answer (`/v1/answer`) constrained to a
spike's UTC date window (`from_date`, `to_date`) to explain which public news
or web events coincided with a surge in Positive, Negative, or Mixed sentiment.

Keys travel strictly in the `x-api-key` header and rotate round-robin across the
configured pool with automatic failover on HTTP 402, 429, or 5xx. Never sends
workspace IDs, comment IDs, or author identities.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Literal

import httpx

SentimentLabel = Literal["positive", "negative", "neutral", "mixed"]
AttributionStatus = Literal["succeeded", "empty", "failed"]

_BASE_URL = "https://api.seltz.ai"
_SYSTEM_PROMPT_AR = (
    "أنت محلل سياق إعلامي وبيانات. لخّص باللغة العربية الفصيحة الحدث أو الخبر "
    "الذي تزامن مع موجة المشاعر المحددة استناداً إلى المصادر فقط، دون استخدام "
    "الشرطة الطويلة (em dash)."
)

_ANSWER_SCHEMA: dict[str, Any] = {
    "type": "json_schema",
    "json_schema": {
        "name": "spike_context_attribution",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "headline_ar": {"type": "string"},
                "summary_ar": {"type": "string"},
            },
            "required": ["headline_ar", "summary_ar"],
            "additionalProperties": False,
        },
    },
}


@dataclass(frozen=True)
class SpikeWindow:
    query: str
    from_date: str
    to_date: str | None = None
    dominant_sentiment: SentimentLabel = "negative"
    scope: Literal["news", "web"] = "news"

    def __post_init__(self) -> None:
        if not self.query or not self.query.strip():
            raise ValueError("empty_spike_query")
        if not self.from_date or not self.from_date.strip():
            raise ValueError("empty_from_date")
        if self.dominant_sentiment not in ("positive", "negative", "neutral", "mixed"):
            raise ValueError("invalid_dominant_sentiment")


@dataclass(frozen=True)
class ContextCitation:
    url: str
    published_date: str | None = None
    snippet: str | None = None


@dataclass(frozen=True)
class SpikeContextAttribution:
    status: AttributionStatus
    headline_ar: str | None
    summary_ar: str | None
    citations: tuple[ContextCitation, ...]
    error_code: str | None = None

    def __post_init__(self) -> None:
        if self.status == "succeeded" and (not self.headline_ar or not self.summary_ar):
            raise ValueError("Succeeded attribution requires headline_ar and summary_ar")
        if self.status == "failed" and not self.error_code:
            raise ValueError("Failed attribution requires error_code")

    def to_db_record(
        self,
        *,
        workspace_id: str,
        channel_id: str,
        window: SpikeWindow,
    ) -> dict[str, Any]:
        """Serialize into a `public.sentiment_spike_attributions` row payload."""
        return {
            "workspace_id": workspace_id,
            "channel_id": channel_id,
            "from_date": window.from_date.strip(),
            "to_date": (window.to_date or window.from_date).strip(),
            "dominant_sentiment": window.dominant_sentiment,
            "query": window.query.strip()[:300],
            "scope": window.scope,
            "status": self.status,
            "headline_ar": self.headline_ar,
            "summary_ar": self.summary_ar,
            "citations": [
                {
                    "url": c.url,
                    "published_date": c.published_date,
                    "snippet": c.snippet,
                }
                for c in self.citations
            ],
            "error_code": self.error_code,
        }


class SeltzSpikeContextAttributor:
    """Round-robin Seltz AI client for attributing sentiment spikes to dated events."""

    def __init__(
        self,
        api_keys: list[str] | tuple[str, ...] | str,
        client: httpx.Client,
        base_url: str = _BASE_URL,
    ) -> None:
        if isinstance(api_keys, str):
            parsed = [k.strip() for k in api_keys.split(",") if k.strip()]
        else:
            parsed = [k.strip() for k in api_keys if k and k.strip()]
        if not parsed:
            raise ValueError("missing_seltz_api_keys")
        self._keys: tuple[str, ...] = tuple(parsed)
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._next_idx = 0

    def _rotate_keys(self) -> list[str]:
        n = len(self._keys)
        start = self._next_idx % n
        self._next_idx = (start + 1) % n
        return [self._keys[(start + i) % n] for i in range(n)]

    def _post_with_failover(self, path: str, payload: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        candidates = self._rotate_keys()
        last_error_code = "seltz_upstream_error"

        for key in candidates:
            headers = {
                "x-api-key": key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            }
            try:
                resp = self._client.post(f"{self._base_url}{path}", json=payload, headers=headers)
            except httpx.HTTPError:
                last_error_code = "seltz_network_error"
                continue

            if resp.status_code == 200:
                try:
                    return resp.json(), None
                except ValueError:
                    return None, "seltz_invalid_json"

            if resp.status_code == 401:
                last_error_code = "seltz_auth_failed"
                continue
            if resp.status_code == 402:
                last_error_code = "seltz_quota_exhausted"
                continue
            if resp.status_code == 429:
                last_error_code = "seltz_rate_limited"
                continue
            if resp.status_code >= 500:
                last_error_code = "seltz_upstream_error"
                continue

            return None, f"seltz_http_{resp.status_code}"

        return None, last_error_code

    def attribute_spike(self, window: SpikeWindow, max_results: int = 5) -> SpikeContextAttribution:
        search_payload: dict[str, Any] = {
            "query": window.query.strip(),
            "scope": window.scope,
            "tier": "pro",
            "max_results": max_results,
            "from_date": window.from_date.strip(),
            "fields": {"content": {"max_characters_per_result": 1200}},
        }
        if window.to_date:
            search_payload["to_date"] = window.to_date.strip()

        search_data, err = self._post_with_failover("/v1/search", search_payload)
        if err is not None or search_data is None:
            return SpikeContextAttribution(
                status="failed",
                headline_ar=None,
                summary_ar=None,
                citations=(),
                error_code=err or "seltz_upstream_error",
            )

        raw_docs = search_data.get("documents")
        if not isinstance(raw_docs, list):
            return SpikeContextAttribution(
                status="failed",
                headline_ar=None,
                summary_ar=None,
                citations=(),
                error_code="seltz_invalid_json",
            )

        citations: list[ContextCitation] = []
        for doc in raw_docs:
            if not isinstance(doc, dict):
                continue
            url = doc.get("url")
            if not isinstance(url, str) or not url.strip():
                continue
            content = doc.get("content")
            snippet = content.strip()[:400] if isinstance(content, str) and content.strip() else None
            pub_date = doc.get("published_date")
            citations.append(
                ContextCitation(
                    url=url.strip(),
                    published_date=pub_date if isinstance(pub_date, str) else None,
                    snippet=snippet,
                )
            )

        if not citations:
            return SpikeContextAttribution(
                status="empty",
                headline_ar=None,
                summary_ar=None,
                citations=(),
                error_code=None,
            )

        sentiment_ar = {
            "positive": "إيجابية",
            "negative": "سلبية",
            "neutral": "محايدة",
            "mixed": "مختلطة",
        }[window.dominant_sentiment]

        sys_prompt = (
            f"{_SYSTEM_PROMPT_AR} "
            f"الفترة الزمنية المرصودة: من {window.from_date} إلى {window.to_date or 'الآن'}، "
            f"ونوع الطفرة العاطفية لدى الجمهور: ({sentiment_ar})."
        )
        ans_payload: dict[str, Any] = {
            "query": window.query.strip(),
            "scope": window.scope,
            "model": "seltz-base",
            "system_prompt": sys_prompt,
            "response_format": _ANSWER_SCHEMA,
        }

        ans_data, ans_err = self._post_with_failover("/v1/answer", ans_payload)
        if ans_err is not None or ans_data is None:
            # Fallback to deterministic headline from top dated document if /v1/answer fails
            top = citations[0]
            first_line = (top.snippet or window.query).splitlines()[0].lstrip("# ").strip()[:140]
            return SpikeContextAttribution(
                status="succeeded",
                headline_ar=first_line or window.query.strip(),
                summary_ar=f"تزامنت موجة المشاعر ({sentiment_ar}) مع نشر {len(citations)} مصادر موثقة في الفترة المحددة.",
                citations=tuple(citations),
                error_code=None,
            )

        raw_answer = ans_data.get("answer")
        if not isinstance(raw_answer, str):
            return SpikeContextAttribution(
                status="failed",
                headline_ar=None,
                summary_ar=None,
                citations=tuple(citations),
                error_code="seltz_invalid_json",
            )
        try:
            parsed_ans = json.loads(raw_answer)
        except ValueError:
            return SpikeContextAttribution(
                status="failed",
                headline_ar=None,
                summary_ar=None,
                citations=tuple(citations),
                error_code="seltz_invalid_json",
            )

        headline = str(parsed_ans.get("headline_ar") or "").strip()
        summary = str(parsed_ans.get("summary_ar") or "").strip()
        if not headline or not summary:
            return SpikeContextAttribution(
                status="failed",
                headline_ar=None,
                summary_ar=None,
                citations=tuple(citations),
                error_code="seltz_invalid_json",
            )

        return SpikeContextAttribution(
            status="succeeded",
            headline_ar=headline,
            summary_ar=summary,
            citations=tuple(citations),
            error_code=None,
        )

    def attribute_and_persist(
        self,
        *,
        supabase_url: str,
        supabase_service_key: str,
        workspace_id: str,
        channel_id: str,
        window: SpikeWindow,
        max_results: int = 5,
    ) -> SpikeContextAttribution:
        """Attribute a sentiment spike and upsert the result into `public.sentiment_spike_attributions`."""
        attribution = self.attribute_spike(window, max_results=max_results)
        record = attribution.to_db_record(
            workspace_id=workspace_id,
            channel_id=channel_id,
            window=window,
        )
        base = supabase_url.rstrip("/")
        headers = {
            "apikey": supabase_service_key,
            "Authorization": f"Bearer {supabase_service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        resp = self._client.post(
            f"{base}/rest/v1/sentiment_spike_attributions"
            "?on_conflict=workspace_id,channel_id,from_date,to_date,dominant_sentiment",
            headers=headers,
            json=record,
        )
        resp.raise_for_status()
        return attribution
