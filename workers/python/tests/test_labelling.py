"""The evaluation set: what is drawn, what is blinded, what is counted.

An accuracy figure is only as honest as the sample behind it, so the properties
that make it honest are asserted here rather than described in a document.
"""
import csv
import io

from labelling.sampling import CONTRASTIVE, draw, eligible_candidates, length_band
from labelling.sheet import LABELS, SHEET_COLUMNS, cell, key, sheet


def comment(i, text, video="v1", is_reply=False, parent=None):
    return {
        "id": f"c{i}", "text_raw": text, "video_id": video,
        "is_reply": is_reply, "parent_comment_id": parent,
        # Present in a real corpus and must never reach the sheet.
        "author_name": f"مؤلف {i}", "likes_value": 99,
        "prediction": {"label": "positive", "status": "succeeded"},
    }


def corpus(n=60, video_split=30):
    return [
        comment(i, f"تعليق رقم {i} عن المحتوى", "v1" if i < video_split else "v2")
        for i in range(n)
    ]


def rows(text):
    return list(csv.reader(io.StringIO(text.lstrip("﻿"))))


def test_the_same_seed_draws_the_same_round():
    # A round has to be reproducible or a disputed figure cannot be re-checked.
    a = draw(corpus(), 10, 5, seed=7)
    b = draw(corpus(), 10, 5, seed=7)
    assert [c.row_id for c in a.estimate] == [c.row_id for c in b.estimate]
    assert [c.row_id for c in a.estimate] != [
        c.row_id for c in draw(corpus(), 10, 5, seed=8).estimate
    ]


def test_nothing_is_dropped_without_being_counted():
    # Silent exclusion is how a sample stops representing the corpus.
    c = corpus(10) + [comment(90, "   "), comment(91, "<br>"), comment(92, "")]
    pool, excluded, collapsed = eligible_candidates(c)
    assert excluded["not_analysable"] == 3
    assert len(pool) == 10 and collapsed == 0


def test_identical_texts_collapse_but_keep_their_weight():
    # Paying to label the same text twice is waste; forgetting that it occurred
    # twice loses the ability to weight back to the raw population.
    c = [comment(1, "رائع"), comment(2, "رائع"), comment(3, "رائع"), comment(4, "سيئ")]
    pool, _, collapsed = eligible_candidates(c)
    assert collapsed == 2
    assert {p.text: p.duplicates for p in pool} == {"رائع": 3, "سيئ": 1}


def test_a_reply_carries_the_text_it_answers():
    # "لا أوافق" is not sentiment about anything until you know what it answers.
    c = [comment(1, "الحلقة ممتازة"), comment(2, "لا أوافق", is_reply=True, parent="c1")]
    pool, _, _ = eligible_candidates(c)
    reply = next(p for p in pool if p.text == "لا أوافق")
    assert reply.context == "الحلقة ممتازة"
    assert next(p for p in pool if p.text == "الحلقة ممتازة").context is None


def test_the_two_sets_never_overlap():
    # Pooling a content-selected sample into an unbiased one is the mistake the
    # split exists to prevent, so they cannot share an item to begin with.
    d = draw(corpus(40) + [comment(i, f"جيد لكن الصوت ضعيف {i}") for i in range(50, 70)],
             20, 10, seed=3)
    assert {c.row_id for c in d.estimate} & {c.row_id for c in d.booster} == set()


def test_the_booster_finds_the_contrast_a_uniform_draw_would_miss():
    # Mixed sentiment lives behind a contrastive marker; a corpus of short
    # praise contains almost none of it by chance.
    mixed = [comment(i, f"الإخراج جميل لكن الصوت سيئ {i}") for i in range(50, 62)]
    d = draw(corpus(40) + mixed, 10, 8, seed=5)
    assert len(d.booster) == 8
    assert all(CONTRASTIVE.search(c.text) for c in d.booster)


def test_one_video_cannot_swallow_the_estimate_set():
    # Proportional allocation: v1 holds three quarters of the corpus and should
    # take about three quarters of the draw, not all of it.
    c = [comment(i, f"تعليق {i}", "v1") for i in range(60)] + [
        comment(i, f"تعليق {i}", "v2") for i in range(60, 80)
    ]
    d = draw(c, 20, 0, seed=1)
    per_video = {}
    for cand in d.estimate:
        per_video[cand.video_id] = per_video.get(cand.video_id, 0) + 1
    assert per_video == {"v1": 15, "v2": 5}


def test_asking_for_more_than_exists_reports_the_shortfall():
    # A round that is quietly smaller than planned changes the confidence
    # interval without anyone noticing.
    d = draw(corpus(10), 400, 200, seed=1)
    assert d.shortfall["estimate"] == 390
    assert len(d.estimate) == 10


def test_the_sheet_shows_the_text_and_nothing_that_would_bias_the_judgement():
    d = draw(corpus(6), 6, 0, seed=1)
    header, *body = rows(sheet(d.estimate))
    assert header == SHEET_COLUMNS
    # No model answer, no author, no likes, no video: a labeller who can see the
    # prediction is no longer an independent measurement of it.
    flat = sheet(d.estimate)
    for leaked in ("positive", "مؤلف", "99", "v1", "succeeded"):
        assert leaked not in flat
    # The columns a human fills are empty, not pre-filled with a guess.
    assert all(row[3:] == ["", "", ""] for row in body)


def test_the_key_records_which_set_each_row_came_from():
    # Which set an item belongs to decides how it may be counted later.
    d = draw(corpus(40) + [comment(i, f"جيد لكن {i}") for i in range(50, 60)], 10, 5, seed=2)
    header, *body = rows(key(d.estimate, d.booster))
    assert header[0:2] == ["row_id", "set"]
    assert sorted({r[1] for r in body}) == ["booster", "estimate"]
    assert len(body) == len(d.estimate) + len(d.booster)


def test_a_comment_that_looks_like_a_formula_cannot_run_in_a_spreadsheet():
    # The sheet is opened in Excel by people who are not developers.
    assert cell("=HYPERLINK(\"http://x\")").startswith("'=")
    assert cell("+1").startswith("'+")
    assert cell("-2").startswith("'-")
    assert cell("@SUM(A1)").startswith("'@")
    assert cell("نص عادي") == "نص عادي"
    body = sheet(draw([comment(1, "=cmd|'/c calc'!A1")], 1, 0, seed=1).estimate)
    assert "\n=cmd" not in body and "'=cmd" in body


def test_the_sheet_opens_as_arabic_in_excel():
    out = sheet(draw([comment(1, "المحتوى واضح")], 1, 0, seed=1).estimate)
    # Without the BOM Excel reads UTF-8 Arabic as mojibake; without CRLF a cell
    # containing a newline splits into two rows.
    assert out.startswith("﻿")
    assert "\r\n" in out


def test_unclear_is_offered_so_a_labeller_never_has_to_guess():
    # A forced choice between four labels turns "I cannot tell" into noise that
    # looks like a judgement.
    assert "unclear" in LABELS
    assert set(LABELS) >= {"positive", "negative", "neutral", "mixed"}


def test_length_bands_split_where_the_judgement_changes():
    assert length_band("قصير") == "short"
    assert length_band("ب" * 100) == "medium"
    assert length_band("ب" * 500) == "long"
