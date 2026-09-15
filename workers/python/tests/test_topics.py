"""Topic verdicts as records, without a model."""
import pytest

from topics.analysis import classify
from topics.deterministic import DeterministicTestClassifier
from topics.protocol import TopicError, TopicItem, TopicVerdict

TAXONOMY = [{"key": "question", "description": "asks"}, {"key": "praise", "description": "thanks"},
            {"key": "other", "description": "else"}]
KEY = "topics:v1+deterministic-test-classifier+t1"


def row(i, text="نص", parent=None, reply=False):
    return {"external_comment_id": f"c{i}", "content_hash": f"h{i}", "text": text,
            "parent_text": parent, "is_reply": reply}


def test_a_verdict_is_consistent():
    with pytest.raises(ValueError):
        TopicVerdict(status="succeeded", topic_key=None, confidence=None, error_code=None)
    with pytest.raises(ValueError):
        TopicVerdict(status="failed", topic_key="praise", confidence=None, error_code="x")
    with pytest.raises(ValueError):
        TopicVerdict(status="succeeded", topic_key="praise", confidence=1.5, error_code=None)


def test_deterministic_classifier_is_stable_and_within_the_taxonomy():
    c = DeterministicTestClassifier()
    items = [TopicItem(0, "أ", None, False), TopicItem(1, "ب", "أ", True), TopicItem(2, "أ", None, False)]
    first = c.classify(TAXONOMY, items)
    second = c.classify(TAXONOMY, items)
    assert first == second
    assert first[0] == first[2]
    assert all(v.status == "succeeded" and v.topic_key in {"question", "praise", "other"} for v in first)


def test_records_carry_the_key_and_provenance():
    records = classify(DeterministicTestClassifier(), TAXONOMY, KEY, [row(1), row(2, reply=True, parent="س")])
    assert [r["external_comment_id"] for r in records] == ["c1", "c2"]
    assert records[0]["classification_key"] == KEY
    assert records[0]["model_id"] == "deterministic-test-classifier"
    assert records[0]["prompt_version"] == "t1"
    assert records[0]["status"] == "succeeded"
    assert set(records[0]) == {"external_comment_id", "content_hash", "classification_key", "status",
                               "topic_key", "confidence", "model_id", "prompt_version", "error_code"}


def test_purged_text_is_unsupported_without_a_call():
    class Explodes:
        model_id, prompt_version = "m", "p"

        def classify(self, taxonomy, items):
            raise AssertionError("must not be called")

    records = classify(Explodes(), TAXONOMY, KEY, [row(1, text=None)])
    assert records == [{"external_comment_id": "c1", "content_hash": "h1", "classification_key": KEY,
                        "status": "unsupported", "topic_key": None, "confidence": None,
                        "model_id": "m", "prompt_version": "p", "error_code": "text_purged"}]


def test_a_verdict_outside_the_taxonomy_fails_rather_than_guesses():
    class Invents:
        model_id, prompt_version = "m", "p"

        def classify(self, taxonomy, items):
            return [TopicVerdict("succeeded", "shipping", 0.9, None) for _ in items]

    [r] = classify(Invents(), TAXONOMY, KEY, [row(1)])
    assert (r["status"], r["topic_key"], r["error_code"]) == ("failed", None, "gemini_bad_response")


def test_a_short_answer_is_an_error_not_a_partial_success():
    class Short:
        model_id, prompt_version = "m", "p"

        def classify(self, taxonomy, items):
            return []

    with pytest.raises(TopicError) as e:
        classify(Short(), TAXONOMY, KEY, [row(1)])
    assert e.value.code == "classification_length_mismatch"


def test_empty_input_is_empty_output():
    assert classify(DeterministicTestClassifier(), TAXONOMY, KEY, []) == []
