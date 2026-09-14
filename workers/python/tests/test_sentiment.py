import pytest

from sentiment.deterministic import TEST_CARD, DeterministicTestAnalyzer
from sentiment.preprocess import PREPROCESSING_VERSION, is_analysable, is_arabic, to_plain_text
from sentiment.protocol import Prediction
from sentiment.registry import CANDIDATES, ModelCard


def test_html_is_stripped_for_analysis_without_losing_meaning():
    assert to_plain_text("<b>رائع</b><br>جداً") == "رائع\nجداً"
    # Entities must not be able to reintroduce markup after decoding.
    assert "<" not in to_plain_text("&lt;script&gt;alert(1)&lt;/script&gt;")
    # Negation, emoji and dialect letters survive normalisation.
    assert to_plain_text("  ما   حبيتها 😞 مش حلو  ") == "ما حبيتها 😞 مش حلو"


def test_empty_and_markup_only_text_is_skipped_never_neutral():
    analyzer = DeterministicTestAnalyzer()
    for raw in ["", "   ", "<br>", "&nbsp;"]:
        prediction = analyzer.predict([raw])[0]
        assert prediction.status == "skipped"
        assert prediction.label is None


def test_unmarked_text_is_unsupported_rather_than_guessed_neutral():
    prediction = DeterministicTestAnalyzer().predict(["نص بلا علامة"])[0]
    assert prediction.status == "unsupported"
    assert prediction.label is None


def test_mixed_is_a_first_class_label_and_scores_are_complete():
    results = DeterministicTestAnalyzer().predict(["حلو﹙ بس طويل", "ممتاز﹢"])
    assert [r.label for r in results] == ["mixed", "positive"]
    assert set(results[0].scores) == {"positive", "negative", "neutral", "mixed"}
    assert results[0].model_id == TEST_CARD.model_id


def test_prediction_rejects_inconsistent_status_and_out_of_range_scores():
    with pytest.raises(ValueError):
        Prediction(status="failed", label="neutral", scores={}, model_id="m", revision="r")
    with pytest.raises(ValueError):
        Prediction(status="succeeded", label=None, scores={}, model_id="m", revision="r")
    with pytest.raises(ValueError):
        Prediction(status="succeeded", label="positive", scores={"positive": 1.4},
                   model_id="m", revision="r")


def test_registry_refuses_moving_refs_and_malformed_label_mappings():
    with pytest.raises(ValueError, match="pinned"):
        ModelCard("m", "main", {0: "positive"}, PREPROCESSING_VERSION)
    with pytest.raises(ValueError, match="contiguous"):
        ModelCard("m", "abc123", {1: "positive"}, PREPROCESSING_VERSION)
    with pytest.raises(ValueError, match="duplicate"):
        ModelCard("m", "abc123", {0: "positive", 1: "positive"}, PREPROCESSING_VERSION)
    with pytest.raises(ValueError, match="unknown"):
        ModelCard("m", "abc123", {0: "very_positive"}, PREPROCESSING_VERSION)


def test_three_class_candidate_reports_mixed_as_unsupported():
    three = ModelCard("CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment", "abc123",
                      CANDIDATES["CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment"],
                      PREPROCESSING_VERSION)
    assert three.supports_mixed is False
    assert TEST_CARD.supports_mixed is True
    # analysis_key fingerprints model+revision+preprocessing, so it is not a run id.
    assert three.analysis_key != TEST_CARD.analysis_key
    assert "abc123" in three.analysis_key


def test_language_flagging_does_not_reject_rows():
    assert is_arabic("تعليق") and not is_arabic("great video")
    assert is_analysable("great video")


def test_arabic_normalization_tatweel_tashkeel_and_elongation():
    from sentiment.preprocess import (
        normalize_arabic_text,
        reduce_elongation,
        strip_tashkeel,
        strip_tatweel,
    )

    # Tashkeel removal
    assert strip_tashkeel("شُكْراً جَزِيلاً") == "شكرا جزيلا"
    # Tatweel removal
    assert strip_tatweel("شــــكـــراً") == "شكراً"
    # Elongation reduction: 3+ repeated chars -> 2
    assert reduce_elongation("راااااائع جدااااا") == "راائع جداا"
    # Combined normalization
    assert normalize_arabic_text("<b>شـــــكراً</b><br>رااااائع جداً 👏") == "شكراً\nراائع جداً 👏"

