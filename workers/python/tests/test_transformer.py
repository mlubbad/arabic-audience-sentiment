"""The real adapter's behaviour, without downloading any weights.

Inference is injected, so every branch below is exercised against logits we
choose. What is *not* covered here is whether the checkpoint is any good at
Arabic — that is a measurement, and it belongs to the golden set, not to a
unit test.
"""
import pytest

from sentiment.registry import ModelCard
from sentiment.preprocess import PREPROCESSING_VERSION
from sentiment.transformer import (
    CAMELBERT_DA_SENTIMENT,
    LabelMappingMismatch,
    LogitsAdapter,
    verify_mapping,
)

CARD = CAMELBERT_DA_SENTIMENT


def adapter(logits, card=CARD):
    return LogitsAdapter(card, lambda texts: logits[: len(texts)])


def test_the_pinned_card_is_a_commit_not_a_branch():
    # ModelCard refuses "main" already; this asserts the shipped card is a real
    # 40-character commit and not something that merely passes that check.
    assert len(CARD.revision) == 40
    assert all(c in "0123456789abcdef" for c in CARD.revision)


def test_a_checkpoint_that_disagrees_with_the_declaration_is_refused():
    # The dangerous case: the right label names in a different order. It loads,
    # it runs, and every prediction is confidently inverted.
    with pytest.raises(LabelMappingMismatch):
        verify_mapping(CARD, {0: "negative", 1: "positive", 2: "neutral"})
    with pytest.raises(LabelMappingMismatch):
        verify_mapping(CARD, {0: "positive", 1: "negative"})
    # The checkpoint's own config.json at the pinned commit, verbatim.
    verify_mapping(CARD, {"0": "positive", "1": "negative", "2": "neutral"})


def test_the_declared_order_decides_the_label():
    # Index 1 wins. With the declared mapping that is "negative"; reading the
    # same logits against a different order would return something else, which
    # is exactly why the mapping is declared and verified rather than assumed.
    out = adapter([[0.1, 4.0, 0.2]]).predict(["نص عربي"])
    assert out[0].status == "succeeded"
    assert out[0].label == "negative"


def test_a_three_class_model_never_reports_mixed():
    out = adapter([[2.0, 0.1, 0.1]]).predict(["نص"])
    # Not "mixed": 0.0 — a class the model does not have is not a measurement
    # of zero, and the dashboard would plot it as one.
    assert set(out[0].scores) == {"positive", "negative", "neutral"}
    assert "mixed" not in out[0].scores
    assert not CARD.supports_mixed


def test_scores_are_probabilities_that_sum_to_one():
    out = adapter([[3.0, 1.0, 0.5]]).predict(["نص"])
    assert sum(out[0].scores.values()) == pytest.approx(1.0)
    assert out[0].scores["positive"] > out[0].scores["neutral"]


def test_large_logits_do_not_overflow_into_a_failure():
    out = adapter([[1000.0, 1.0, 1.0]]).predict(["نص"])
    assert out[0].status == "succeeded"
    assert out[0].label == "positive"


def test_empty_text_is_skipped_and_never_sent_to_the_model():
    seen = []

    def infer(texts):
        seen.append(list(texts))
        return [[1.0, 0.0, 0.0]] * len(texts)

    out = LogitsAdapter(CARD, infer).predict(["   ", "نص حقيقي", ""])
    assert [p.status for p in out] == ["skipped", "succeeded", "skipped"]
    # Only the analysable row reached the model.
    assert seen == [["نص حقيقي"]]
    assert out[0].label is None and out[0].scores == {}


def test_nothing_analysable_means_the_model_is_not_called_at_all():
    def infer(texts):  # pragma: no cover - must never run
        raise AssertionError("the model was asked about nothing")

    out = LogitsAdapter(CARD, infer).predict(["", "  "])
    assert [p.status for p in out] == ["skipped", "skipped"]


def test_inference_failure_is_recorded_as_failure_not_as_neutral():
    def infer(texts):
        raise RuntimeError("CUDA out of memory")

    out = LogitsAdapter(CARD, infer).predict(["نص", "نص آخر"])
    assert [p.status for p in out] == ["failed", "failed"]
    # The failure mode this guards: a crashed batch quietly reported as an
    # audience with no opinion.
    assert all(p.label is None for p in out)


def test_a_short_batch_from_the_model_fails_rather_than_misaligns():
    # Two asked, one returned. Zipping would silently attach the first row's
    # verdict to the first comment and drop the second — or worse, shift every
    # label by one in a longer batch.
    out = LogitsAdapter(CARD, lambda t: [[1.0, 0.0, 0.0]]).predict(["أ", "ب"])
    assert [p.status for p in out] == ["failed", "failed"]


def test_a_row_of_the_wrong_width_fails_rather_than_guessing():
    out = adapter([[1.0, 0.0]]).predict(["نص"])
    assert out[0].status == "failed"


def test_every_prediction_carries_the_model_and_revision():
    out = adapter([[1.0, 0.0, 0.0]]).predict(["نص"])
    failed = LogitsAdapter(CARD, lambda t: 1 / 0).predict(["نص"])
    for p in (*out, *failed):
        assert p.model_id == CARD.model_id
        assert p.revision == CARD.revision


def test_the_analysis_key_changes_when_the_settings_change():
    other = ModelCard(
        model_id=CARD.model_id,
        revision=CARD.revision,
        label_mapping=CARD.label_mapping,
        preprocessing_version=PREPROCESSING_VERSION,
        max_length=128,
    )
    # Same weights, different truncation: a different analysis, and the key has
    # to say so or the second result silently collides with the first.
    assert other.analysis_key != CARD.analysis_key
