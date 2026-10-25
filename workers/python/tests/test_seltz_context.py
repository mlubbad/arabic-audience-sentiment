"""Unit tests for Seltz AI multi-key spike context attribution."""
from __future__ import annotations

import json

import httpx
import pytest

from enrichment import (
    SeltzSpikeContextAttributor,
    SpikeWindow,
)


def test_requires_at_least_one_key() -> None:
    client = httpx.Client()
    with pytest.raises(ValueError, match="missing_seltz_api_keys"):
        SeltzSpikeContextAttributor("", client)


def test_spike_window_validates_mixed_and_dates() -> None:
    w = SpikeWindow(
        query="سياسة الخصوصية يوتيوب",
        from_date="2026-10-01",
        to_date="2026-10-15",
        dominant_sentiment="mixed",
    )
    assert w.dominant_sentiment == "mixed"
    with pytest.raises(ValueError, match="empty_spike_query"):
        SpikeWindow(query="  ", from_date="2026-10-01")


def test_round_robin_and_failover_on_402_and_429() -> None:
    seen_keys: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        key = request.headers.get("x-api-key", "")
        seen_keys.append(key)
        if key == "key_1":
            return httpx.Response(402, json={"error": {"code": "INSUFFICIENT_CREDITS", "message": "exhausted"}})
        if key == "key_2":
            return httpx.Response(429, json={"error": {"code": "RATE_LIMITED", "message": "slow down"}})
        if request.url.path == "/v1/search":
            return httpx.Response(
                200,
                json={
                    "documents": [
                        {
                            "url": "https://example.com/news/privacy-update",
                            "published_date": "2026-10-10T12:00:00Z",
                            "content": "# تحديث جديد في سياسة الخصوصية\nأعلنت المنصة تغييرات جوهرية في مشاركة البيانات.",
                        }
                    ]
                },
            )
        if request.url.path == "/v1/answer":
            return httpx.Response(
                200,
                json={
                    "answer": json.dumps(
                        {
                            "headline_ar": "تحديث سياسة الخصوصية ومشاركة البيانات",
                            "summary_ar": "تزامنت موجة المشاعر المختلطة مع إعلان تحديث شروط مشاركة البيانات في 10 أكتوبر.",
                        },
                        ensure_ascii=False,
                    ),
                    "citations": [{"url": "https://example.com/news/privacy-update"}],
                },
            )
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    attributor = SeltzSpikeContextAttributor(["key_1", "key_2", "key_3"], client)
    res = attributor.attribute_spike(
        SpikeWindow(
            query="سياسة الخصوصية",
            from_date="2026-10-01",
            to_date="2026-10-15",
            dominant_sentiment="mixed",
        )
    )
    assert res.status == "succeeded"
    assert res.headline_ar == "تحديث سياسة الخصوصية ومشاركة البيانات"
    assert len(res.citations) == 1
    assert res.citations[0].url == "https://example.com/news/privacy-update"
    assert "key_1" in seen_keys and "key_2" in seen_keys and "key_3" in seen_keys


def test_all_keys_exhausted_returns_failed_not_empty() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"error": {"code": "INSUFFICIENT_CREDITS", "message": "exhausted"}})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    attributor = SeltzSpikeContextAttributor(["key_1", "key_2"], client)
    res = attributor.attribute_spike(SpikeWindow(query="اختبار", from_date="now-7d"))
    assert res.status == "failed"
    assert res.error_code == "seltz_quota_exhausted"


def test_zero_matching_documents_returns_empty() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"documents": []})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    attributor = SeltzSpikeContextAttributor(["key_1"], client)
    res = attributor.attribute_spike(SpikeWindow(query="حدث نادر", from_date="now-24h"))
    assert res.status == "empty"
    assert res.error_code is None
    assert res.citations == ()


def test_attribute_and_persist_upserts_to_supabase() -> None:
    persisted_payloads: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/search":
            return httpx.Response(
                200,
                json={
                    "documents": [
                        {
                            "url": "https://aljazeera360.com/doc1",
                            "published_date": "2026-10-16",
                            "content": "إطلاق سلسلة وثائقية جديدة على الجزيرة 360",
                        }
                    ]
                },
            )
        if request.url.path == "/v1/answer":
            return httpx.Response(
                200,
                json={
                    "answer": json.dumps(
                        {
                            "headline_ar": "إطلاق سلسلة وثائقية جديدة",
                            "summary_ar": "تزامنت الطفرة مع عرض الحلقة الأولى.",
                        },
                        ensure_ascii=False,
                    )
                },
            )
        if request.url.path == "/rest/v1/sentiment_spike_attributions":
            persisted_payloads.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(201)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    attributor = SeltzSpikeContextAttributor(["key_1"], client)
    win = SpikeWindow(
        query="الجزيرة 360 وثائقي",
        from_date="2026-10-15",
        to_date="2026-10-18",
        dominant_sentiment="positive",
    )
    out = attributor.attribute_and_persist(
        supabase_url="https://example.supabase.co",
        supabase_service_key="srv-key",
        workspace_id="ws-1",
        channel_id="ch-1",
        window=win,
    )
    assert out.status == "succeeded"
    assert len(persisted_payloads) == 1
    assert persisted_payloads[0]["workspace_id"] == "ws-1"
    assert persisted_payloads[0]["channel_id"] == "ch-1"
    assert persisted_payloads[0]["headline_ar"] == "إطلاق سلسلة وثائقية جديدة"
    assert persisted_payloads[0]["citations"][0]["url"] == "https://aljazeera360.com/doc1"

