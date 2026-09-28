"""Tests for the TypeSafe (Jev) unified enrichment engine."""
import pytest

from enrichment.protocol import EnrichmentItem
from enrichment.typesafe import TypeSafeEnricher


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

    def enricher(self, key="k-enrichment-test"):
        return TypeSafeEnricher(key, self, sleep=lambda _: None)


TAXONOMY = [
    {"key": "praise", "description": "Compliments and support"},
    {"key": "question", "description": "Inquiries asking for information"},
    {"key": "criticism", "description": "Complaints and objections"},
]


def test_requires_api_key():
    client = FakeClient([])
    with pytest.raises(ValueError, match="missing_typesafe_api_key"):
        TypeSafeEnricher("", client)


def test_unified_speculative_fanout_single_request():
    answers = {
        "sent_0": {
            "type": "choice",
            "choice": "positive",
            "confidence": 0.95,
            "probabilities": {"positive": 0.95, "negative": 0.01, "neutral": 0.03, "mixed": 0.01},
        },
        "top_0": {
            "type": "choice",
            "choice": "praise",
            "confidence": 0.92,
            "probabilities": {"praise": 0.92, "question": 0.05, "criticism": 0.03},
        },
        "inq_0": {
            "type": "noul",
            "noul": 0.08,
        },
        "urg_0": {
            "type": "score",
            "score": 0,
        },
    }
    fake = FakeClient([(200, {"answers": answers})])
    enricher = fake.enricher()

    items = [EnrichmentItem(id="c1", text="عمل رائع جدا يا هندسة")]
    verdicts = enricher.enrich(TAXONOMY, items)

    assert len(fake.requests) == 1
    req = fake.requests[0]
    body = req["json"]

    # Verify speculative fan-out questions in single payload
    assert "sent_0" in body["questions"]
    assert "top_0" in body["questions"]
    assert "inq_0" in body["questions"]
    assert "urg_0" in body["questions"]

    # Verify results unpacked correctly
    assert len(verdicts) == 1
    v = verdicts[0]
    assert v.sentiment_status == "succeeded"
    assert v.sentiment_label == "positive"
    assert v.sentiment_scores["positive"] == 0.95
    assert v.topic_status == "succeeded"
    assert v.topic_key == "praise"
    assert v.topic_confidence == 0.92
    assert v.is_question == 0.08
    assert v.urgency == 0


def test_skips_unanalysable_items():
    fake = FakeClient([])
    enricher = fake.enricher()

    items = [EnrichmentItem(id="c1", text="   ")]
    verdicts = enricher.enrich(TAXONOMY, items)

    assert len(fake.requests) == 0
    assert len(verdicts) == 1
    v = verdicts[0]
    assert v.sentiment_status == "skipped"
    assert v.topic_status == "skipped"
    assert v.sentiment_label is None
    assert v.topic_key is None


def test_reply_context_included_in_state():
    answers = {
        "sent_0": {"type": "choice", "choice": "neutral", "probabilities": {"neutral": 0.9}},
        "top_0": {"type": "choice", "choice": "question", "confidence": 0.85},
        "inq_0": {"type": "noul", "noul": 0.95},
        "urg_0": {"type": "score", "score": 1},
    }
    fake = FakeClient([(200, {"answers": answers})])
    enricher = fake.enricher()

    items = [
        EnrichmentItem(
            id="c2",
            text="ما هو الجزء التالي؟",
            parent_text="شرح اساسيات الذكاء الاصطناعي",
            is_reply=True,
        )
    ]
    verdicts = enricher.enrich(TAXONOMY, items)

    assert len(verdicts) == 1
    assert verdicts[0].is_question == 0.95
    assert verdicts[0].urgency == 1
    assert verdicts[0].topic_key == "question"

    state_item = fake.requests[0]["json"]["state"]["items"][0]
    assert state_item["is_reply"] is True
    assert "اساسيات" in state_item["parent_text"]


def test_api_refusal_marks_failed():
    fake = FakeClient([(403, {"error": "forbidden"})])
    enricher = fake.enricher()

    items = [EnrichmentItem(id="c1", text="نص تجريبي")]
    verdicts = enricher.enrich(TAXONOMY, items)

    assert len(verdicts) == 1
    v = verdicts[0]
    assert v.sentiment_status == "failed"
    assert v.topic_status == "failed"
    assert v.topic_error_code == "typesafe_refused"


def test_retries_on_rate_limit():
    answers = {
        "sent_0": {"type": "choice", "choice": "negative", "probabilities": {"negative": 0.8}},
        "top_0": {"type": "choice", "choice": "criticism", "confidence": 0.77},
        "inq_0": {"type": "noul", "noul": 0.1},
        "urg_0": {"type": "score", "score": 2},
    }
    fake = FakeClient([
        (429, {"error": "rate limit"}),
        (200, {"answers": answers}),
    ])
    enricher = fake.enricher()

    items = [EnrichmentItem(id="c1", text="الصوت غير مسموع إطلاقا")]
    verdicts = enricher.enrich(TAXONOMY, items)

    assert len(fake.requests) == 2
    assert len(verdicts) == 1
    assert verdicts[0].sentiment_label == "negative"
    assert verdicts[0].topic_key == "criticism"
    assert verdicts[0].urgency == 2
