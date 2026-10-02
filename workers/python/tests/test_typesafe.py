"""Tests for the TypeSafe topic classifier, in the style of test_gemini.py."""
import json

import httpx
import pytest

from topics.typesafe import CHUNK, TypeSafeTopicClassifier
from topics.protocol import TopicItem

TAXONOMY = [{"key": "question", "description": "asks"}, {"key": "praise", "description": "thanks"}]


def answer(pairs):
    """A systemone answers map: id -> choice answer with confidence."""
    return {f"i{i}": {"type": "choice", "choice": k, "confidence": c,
                      "probabilities": {k: 1.0}}
            for i, k, c in pairs}


class Fake:
    """httpx.Client stand-in that records requests and replays responses."""

    def __init__(self, responses):
        self.responses, self.requests = list(responses), []

    def post(self, url, headers=None, json=None, timeout=None):
        self.requests.append({"url": url, "headers": headers or {}, "json": json})
        status, payload = self.responses.pop(0)
        return _Response(status, payload)

    def classifier(self, key="k-test"):
        return TypeSafeTopicClassifier(key, self)


class _Response:
    def __init__(self, status, payload):
        self.status_code, self._payload = status, payload

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def items(n, parent=None, reply=False):
    return [TopicItem(i, f"نص {i}", parent, reply) for i in range(n)]


def test_the_request_carries_the_taxonomy_and_one_question_per_item():
    fake = Fake([(200, {"answers": answer([(0, "praise", 0.9)])})])
    fake.classifier().classify(TAXONOMY, items(1))
    body = fake.requests[0]["json"]
    assert body["model"] == "jev-latest"
    assert body["state"]["taxonomy"] == TAXONOMY
    q = body["questions"]["i0"]
    assert q["type"] == "choice"
    assert set(q["criteria"]) == {"question", "praise"}
    # The key travels in the header, never in a URL or the body.
    assert fake.requests[0]["headers"]["Authorization"] == "Bearer k-test"
    assert "k-test" not in json.dumps(body)
    assert "api.typesafe.ai" not in json.dumps(body)


def test_a_reply_is_shown_with_its_parent():
    fake = Fake([(200, {"answers": answer([(0, "praise", 0.9)])})])
    fake.classifier().classify(TAXONOMY, [TopicItem(0, "آمين", "اللهم اغفر لنا", True)])
    q = fake.requests[0]["json"]["questions"]["i0"]
    assert "parent_text" in q["instructions"]


def test_a_reply_without_its_parent_says_so():
    fake = Fake([(200, {"answers": answer([(0, "praise", 0.9)])})])
    fake.classifier().classify(TAXONOMY, [TopicItem(0, "آمين", None, True)])
    q = fake.requests[0]["json"]["questions"]["i0"]
    assert "no longer available" in q["instructions"]


def test_a_purged_text_is_skipped_and_never_sent():
    fake = Fake([(200, {"answers": answer([(1, "praise", 0.9)])})])
    verdicts = fake.classifier().classify(TAXONOMY, [TopicItem(0, None, None, False),
                                                     TopicItem(1, "نص", None, False)])
    assert (verdicts[0].status, verdicts[0].topic_key) == ("skipped", None)
    assert verdicts[1].status == "succeeded"
    sent = fake.requests[0]["json"]["state"]["items"]
    assert sent == [{"text": "نص", "parent_text": None}]


def test_verdicts_are_mapped_from_answers():
    fake = Fake([(200, {"answers": answer([(0, "question", 0.62)])})])
    v = fake.classifier().classify(TAXONOMY, items(1))[0]
    assert (v.status, v.topic_key, v.confidence, v.error_code) == ("succeeded", "question", 0.62, None)


def test_a_choice_outside_the_taxonomy_fails_that_item_only():
    fake = Fake([(200, {"answers": answer([(0, "question", 0.9)]),
                        "i1": {"type": "choice", "choice": "invented", "confidence": 0.9,
                               "probabilities": {}}})])
    v = fake.classifier().classify(TAXONOMY, items(2))
    assert v[0].status == "succeeded"
    assert (v[1].status, v[1].error_code) == ("failed", "typesafe_bad_response")


def test_a_missing_answer_fails_its_item():
    fake = Fake([(200, {"answers": {}})])
    v = fake.classifier().classify(TAXONOMY, items(1))[0]
    assert (v.status, v.error_code) == ("failed", "typesafe_bad_response")


def test_429_is_retried_then_succeeds():
    fake = Fake([(429, None), (200, {"answers": answer([(0, "praise", 0.9)])})])
    v = fake.classifier().classify(TAXONOMY, items(1))[0]
    assert v.status == "succeeded"
    assert len(fake.requests) == 2


def test_persistent_429_fails_the_chunk_whole():
    fake = Fake([(429, None), (429, None), (429, None)])
    v = fake.classifier().classify(TAXONOMY, items(2))
    assert [x.status for x in v] == ["failed", "failed"]
    assert all(x.error_code == "typesafe_rate_limited" for x in v)


def test_a_4xx_fails_the_chunk_whole_without_retry():
    fake = Fake([(401, {"error": "unauthorized"})])
    v = fake.classifier().classify(TAXONOMY, items(1))
    assert len(fake.requests) == 1
    assert (v[0].status, v[0].error_code) == ("failed", "typesafe_refused")


def test_a_non_json_response_fails_the_chunk_whole():
    fake = Fake([(200, None)])
    v = fake.classifier().classify(TAXONOMY, items(1))
    assert (v[0].status, v[0].error_code) == ("failed", "typesafe_bad_response")


def test_chunks_are_bounded():
    first = answer([(i, "praise", 0.9) for i in range(CHUNK)])
    second = answer([(CHUNK, "praise", 0.9)])
    fake = Fake([(200, {"answers": first}), (200, {"answers": second})])
    v = fake.classifier().classify(TAXONOMY, items(CHUNK + 1))
    assert len(v) == CHUNK + 1
    assert len(fake.requests) == 2


def test_a_missing_key_is_a_constructor_error():
    with pytest.raises(ValueError):
        TypeSafeTopicClassifier("", httpx.Client())
