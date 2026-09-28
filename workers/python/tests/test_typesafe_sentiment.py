"""Tests for the TypeSafe (Jev) sentiment adapter."""
import json
import pytest

from sentiment.typesafe import TypeSafeSentimentAdapter


class FakeResponse:
    def __init__(self, status_code: int, payload: dict | None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def post(self, url, headers=None, json=None, timeout=None):
        self.requests.append({"url": url, "headers": headers or {}, "json": json})
        status, payload = self.responses.pop(0)
        return FakeResponse(status, payload)

    def adapter(self, key="k-sentiment-test"):
        return TypeSafeSentimentAdapter(key, self, sleep=lambda _: None)


def test_requires_api_key():
    client = FakeClient([])
    with pytest.raises(ValueError, match="missing_typesafe_api_key"):
        TypeSafeSentimentAdapter("", client)


def test_the_request_carries_header_and_model_and_criteria():
    answers = {
        "i0": {
            "type": "choice",
            "choice": "positive",
            "confidence": 0.95,
            "probabilities": {"positive": 0.95, "negative": 0.01, "neutral": 0.03, "mixed": 0.01},
        }
    }
    fake = FakeClient([(200, {"answers": answers})])
    adapter = fake.adapter()
    preds = adapter.predict(["محتوى رائع جدا وممتاز"])

    assert len(preds) == 1
    assert preds[0].status == "succeeded"
    assert preds[0].label == "positive"
    assert preds[0].scores["positive"] == 0.95

    assert len(fake.requests) == 1
    req = fake.requests[0]
    assert req["url"] == "https://api.typesafe.ai/v1/systemone"
    assert req["headers"]["Authorization"] == "Bearer k-sentiment-test"
    assert "k-sentiment-test" not in json.dumps(req["json"])

    body = req["json"]
    assert body["model"] == "jev-latest"
    q = body["questions"]["i0"]
    assert q["type"] == "choice"
    assert set(q["criteria"].keys()) == {"positive", "negative", "neutral", "mixed"}


def test_mixed_sentiment_properly_mapped():
    answers = {
        "i0": {
            "type": "choice",
            "choice": "mixed",
            "confidence": 0.88,
            "probabilities": {"positive": 0.45, "negative": 0.35, "neutral": 0.05, "mixed": 0.70},
        }
    }
    fake = FakeClient([(200, {"answers": answers})])
    adapter = fake.adapter()
    preds = adapter.predict(["الفيديو ممتاز لكن الصوت ضعيف"])

    assert len(preds) == 1
    assert preds[0].status == "succeeded"
    assert preds[0].label == "mixed"
    assert preds[0].scores["mixed"] == 0.70


def test_unanalysable_texts_skipped_without_calling_api():
    fake = FakeClient([])
    adapter = fake.adapter()
    preds = adapter.predict(["", "   ", " \n\t "])

    assert len(fake.requests) == 0
    assert len(preds) == 3
    for p in preds:
        assert p.status == "skipped"
        assert p.label is None
        assert p.scores == {}


def test_partially_unanalysable_chunk():
    answers = {
        "i1": {
            "type": "choice",
            "choice": "negative",
            "confidence": 0.90,
            "probabilities": {"positive": 0.02, "negative": 0.90, "neutral": 0.05, "mixed": 0.03},
        }
    }
    fake = FakeClient([(200, {"answers": answers})])
    adapter = fake.adapter()
    preds = adapter.predict(["", "سيء جدا وغير مفيد"])

    assert len(preds) == 2
    assert preds[0].status == "skipped"
    assert preds[1].status == "succeeded"
    assert preds[1].label == "negative"

    # Only one question sent
    body = fake.requests[0]["json"]
    assert "i0" not in body["questions"]
    assert "i1" in body["questions"]


def test_api_refusal_marks_failed():
    fake = FakeClient([(403, {"error": "forbidden"})])
    adapter = fake.adapter()
    preds = adapter.predict(["شرح رائع"])

    assert len(preds) == 1
    assert preds[0].status == "failed"
    assert preds[0].label is None
    assert preds[0].scores == {}


def test_api_rate_limit_and_retry():
    answers = {
        "i0": {
            "type": "choice",
            "choice": "neutral",
            "confidence": 0.80,
            "probabilities": {"positive": 0.1, "negative": 0.1, "neutral": 0.8, "mixed": 0.0},
        }
    }
    fake = FakeClient([
        (429, {"error": "rate limited"}),
        (200, {"answers": answers}),
    ])
    adapter = fake.adapter()
    preds = adapter.predict(["ما هي مواعيد النشر؟"])

    assert len(preds) == 1
    assert preds[0].status == "succeeded"
    assert preds[0].label == "neutral"
    assert len(fake.requests) == 2


def test_bad_response_marks_failed():
    # Model returned an unregistered choice string
    answers = {
        "i0": {
            "type": "choice",
            "choice": "unknown_sentiment_class",
            "confidence": 0.99,
            "probabilities": {},
        }
    }
    fake = FakeClient([(200, {"answers": answers})])
    adapter = fake.adapter()
    preds = adapter.predict(["شكرا جزيلا"])

    assert len(preds) == 1
    assert preds[0].status == "failed"
    assert preds[0].label is None


def test_analysis_key_is_deterministic_and_contains_provenance():
    client = FakeClient([])
    adapter = client.adapter()
    key = adapter.analysis_key

    assert key.startswith("typesafe/jev-latest@1.13.0+strip-html-arabic-norm-v2+")
    # Check that calling it again produces the exact same key
    assert key == adapter.analysis_key
    assert adapter.supports_mixed is True
