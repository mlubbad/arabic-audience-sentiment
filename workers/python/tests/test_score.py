"""Scoring a model against the human set — and the ways a score can flatter.

Each test here is a way a number could look good while the product is broken.
"""
from labelling.score import (
    cohens_kappa,
    read_labels,
    read_sets,
    score,
    wilson,
)


def pairs(spec):
    """spec: list of (gold, predicted, count) -> two row_id-keyed dicts."""
    gold, pred, i = {}, {}, 0
    for g, p, n in spec:
        for _ in range(n):
            i += 1
            gold[f"r{i}"] = g
            if p is not None:
                pred[f"r{i}"] = p
    return gold, pred


def test_macro_f1_exposes_a_model_that_cannot_find_negatives():
    # The central case from the research: 80% accuracy on a corpus that is
    # mostly praise, while the class the customer pays to find is never
    # predicted at all. Accuracy calls this good. Macro F1 must not.
    gold, pred = pairs([
        ("positive", "positive", 80),
        ("negative", "positive", 20),
    ])
    r = score(gold, pred)
    assert r.accuracy == 0.8
    # negative scores zero and still counts in the average, so the mean falls.
    assert r.macro_f1 < 0.5
    assert not r.meets(0.75)
    negative = next(c for c in r.per_class if c.label == "negative")
    assert negative.support == 20 and negative.recall == 0.0 and negative.f1 == 0.0


def test_a_class_the_model_never_predicts_is_not_quietly_dropped():
    # If an unpredicted class were skipped instead of scored zero, the average
    # would be taken over the classes the model happens to be good at.
    gold, pred = pairs([("positive", "positive", 10), ("mixed", "positive", 10)])
    r = score(gold, pred)
    assert {c.label for c in r.per_class} >= {"positive", "mixed"}
    assert next(c for c in r.per_class if c.label == "mixed").f1 == 0.0


def test_a_class_nobody_labelled_does_not_drag_the_average_down():
    # The mirror error: inventing a zero for a class the gold set never
    # contained would understate a model that was never asked about it.
    gold, pred = pairs([("positive", "positive", 5), ("negative", "negative", 5)])
    r = score(gold, pred)
    assert r.macro_f1 == 1.0
    assert all(c.support > 0 for c in r.per_class if c.f1 == 0.0) or r.macro_f1 == 1.0


def test_unclear_rows_are_coverage_and_never_model_error():
    # A human who could not tell is not evidence about the model. Counting it
    # as a miss would punish the model for the corpus being ambiguous.
    gold, pred = pairs([("positive", "positive", 8), ("unclear", "negative", 2)])
    r = score(gold, pred)
    assert r.scored == 8
    assert r.accuracy == 1.0
    assert r.coverage["unclear"] == 2


def test_rows_missing_a_prediction_are_reported_not_skipped_silently():
    # A model that fails on a third of the set and is scored on the rest is
    # being measured on the part it found easy.
    gold, pred = pairs([("positive", "positive", 6), ("negative", None, 3)])
    r = score(gold, pred)
    assert r.coverage["missing_prediction"] == 3
    assert r.coverage["scored"] == 6
    assert r.scored + r.coverage["missing_prediction"] == 9


def test_predictions_for_rows_nobody_labelled_are_counted():
    gold, pred = pairs([("positive", "positive", 3)])
    pred["ghost"] = "negative"
    r = score(gold, pred)
    assert r.coverage["predicted_rows_not_in_gold"] == 1
    assert r.scored == 3


def test_the_interval_never_reports_an_impossible_bound():
    # Near the edge, not at it: 19/20 is where the textbook normal
    # approximation returns an upper bound above 1, and a rare class lands
    # there routinely. At exactly 20/20 both methods agree, so testing only the
    # degenerate case proves nothing — this test used to, and a mutation
    # swapping in the approximation survived it.
    low, high = wilson(19, 20)
    assert 0.0 <= low <= 1.0 and 0.0 <= high <= 1.0
    assert high < 1.0  # the approximation gives about 1.045 here
    low, high = wilson(1, 20)
    assert low > 0.0  # the approximation gives about -0.046
    assert 0.0 <= low <= 1.0 and 0.0 <= high <= 1.0

    low, high = wilson(20, 20)
    assert 0.0 <= low <= 1.0 and high == 1.0
    low, high = wilson(0, 20)
    assert low == 0.0 and 0.0 <= high <= 1.0
    # A small sample must report a wide interval rather than a confident one.
    narrow = wilson(80, 400)
    wide = wilson(8, 40)
    assert (wide[1] - wide[0]) > (narrow[1] - narrow[0])


def test_an_empty_set_scores_nothing_rather_than_claiming_perfection():
    # 0/0 is not 100%.
    r = score({}, {})
    assert r.scored == 0 and r.macro_f1 == 0.0 and not r.meets(0.75)


def test_kappa_separates_real_agreement_from_agreement_by_chance():
    a = {f"r{i}": ("positive" if i % 2 else "negative") for i in range(20)}
    assert cohens_kappa(a, dict(a)) == 1.0
    # Disagreeing exactly as often as chance predicts is worth nothing.
    b = {f"r{i}": ("positive" if i < 10 else "negative") for i in range(20)}
    assert cohens_kappa(a, b) == 0.0
    assert cohens_kappa(a, {}) is None


def test_kappa_is_undefined_rather_than_flattering_when_everyone_says_one_thing():
    # Two labellers who both answer "positive" every time agree completely and
    # by chance, so the statistic is 0/0. Returning 1.0 would read as "perfect
    # agreement, trust these labels" and 0.0 as "no better than chance".
    # Neither is true; undefined is.
    always = {f"r{i}": "positive" for i in range(20)}
    assert cohens_kappa(always, dict(always)) is None


def test_reading_a_returned_sheet_and_its_key():
    sheet = "﻿row_id,context,text,label,confidence,notes\r\nr1,,نص,Positive,3,\r\nr2,,نص,negative,2,\r\n"
    assert read_labels(sheet) == {"r1": "positive", "r2": "negative"}
    key = "﻿row_id,set,video_id,is_reply,length_band,arabic,duplicates\r\nr1,estimate,v,false,short,true,1\r\nr2,booster,v,false,short,true,1\r\n"
    assert read_sets(key) == {"r1": "estimate", "r2": "booster"}
