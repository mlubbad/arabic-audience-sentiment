"""Analysis reaching the server path at all, and the seams it crosses.

Nothing connected the sentiment package to the control plane before this: the
server-backed runner committed comments with an empty prediction list, so a
configured analyzer produced no stored labels whatsoever.
"""
import pytest

from collectors.protocol import Batch, RawComment
from sentiment.deterministic import DeterministicTestAnalyzer
from sentiment.preprocess import PREPROCESSING_VERSION
from sentiment.protocol import Prediction
from server.analysis import AnalysisError, analyse
from server.gateway import _comment, content_hash
from server.runner import run_once

from test_run_once import Recorder

ANALYZER = DeterministicTestAnalyzer()


def comment(identifier, text):
    return RawComment(identifier, "abcdefghijk", text, author_name="مؤلف")


def test_a_prediction_hashes_the_same_text_the_comment_row_stores():
    # The single most consequential seam here. sentiment_predictions is joined
    # to comments on content_hash, so a prediction hashing differently is stored
    # and then never becomes the effective label — visible as a comment that is
    # analysed but shows no verdict, with nothing failing anywhere.
    c = comment("c1", "المحتوى واضح ﹢")
    [record] = analyse(ANALYZER, [c])
    assert record["content_hash"] == _comment(c)["content_hash"]
    assert record["content_hash"] == content_hash(c.text)


def test_every_prediction_names_a_comment_in_the_same_batch():
    # The contract requires it and the database now refuses a batch without it,
    # so the producing side must not be able to emit one that violates it.
    comments = [comment("c1", "﹢ جيد"), comment("c2", "﹣ سيئ")]
    records = analyse(ANALYZER, comments)
    assert [r["external_comment_id"] for r in records] == ["c1", "c2"]
    assert {r["label"] for r in records} == {"positive", "negative"}


def test_an_unanalysable_row_is_recorded_without_a_label_and_costs_nothing():
    # Unsupported is a real result, distinct from neutral. Recording it as
    # neutral would invent a measurement; dropping it would hide the gap.
    [record] = analyse(ANALYZER, [comment("c1", "نص بلا علامة")])
    assert record["status"] == "unsupported"
    assert record["label"] is None
    assert record["class_scores"] == {}


def test_the_record_carries_the_fingerprint_the_server_identifies_a_run_by():
    [record] = analyse(ANALYZER, [comment("c1", "﹦ عادي")])
    assert record["model_id"] == ANALYZER.model_id
    assert record["revision"] == ANALYZER.revision
    assert record["preprocessing_version"] == PREPROCESSING_VERSION
    assert record["analysis_key"] == f"{ANALYZER.model_id}@{ANALYZER.revision}+{PREPROCESSING_VERSION}"


def test_an_adapter_that_returns_the_wrong_number_of_verdicts_is_refused():
    class Short:
        model_id, revision = "m", "r"

        def predict(self, texts):
            return [Prediction("succeeded", "positive", {"positive": 1.0}, "m", "r")]

    # Zipping a short list would leave later rows unanalysed while the run
    # reported success, which is the failure-becomes-success pattern exactly.
    with pytest.raises(AnalysisError):
        analyse(Short(), [comment("c1", "أ"), comment("c2", "ب")])


def test_an_adapter_failure_carries_a_code_and_not_the_adapter_s_message():
    class Broken:
        model_id, revision = "m", "r"

        def predict(self, texts):
            raise RuntimeError("/Users/someone/models/weights.bin not found")

    with pytest.raises(AnalysisError) as caught:
        analyse(Broken(), [comment("c1", "أ")])
    assert str(caught.value) == "analysis_failed"
    assert "weights.bin" not in str(caught.value)


def test_the_runner_commits_labels_alongside_the_rows_they_describe():
    rec = Recorder()
    batch = Batch([comment("c1", "﹢ ممتاز"), comment("c2", "﹣ ضعيف")], None, "exhausted")
    run_once(rec.plane(), _Collector(batch), "abcdefghijk", analyzer=ANALYZER)
    payload = rec.committed[0]
    assert [p["external_comment_id"] for p in payload["predictions"]] == ["c1", "c2"]
    # Rows and verdicts in one commit, so the database writes them atomically.
    assert len(payload["comments"]) == 2
    assert rec.finished == "succeeded"


def test_without_an_analyzer_the_job_is_collection_only():
    rec = Recorder()
    run_once(rec.plane(), _Collector(Batch([comment("c1", "﹢")], None, "exhausted")), "abcdefghijk")
    assert rec.committed[0]["predictions"] == []
    assert rec.finished == "succeeded"


def test_an_analysis_failure_keeps_the_rows_but_is_never_finished_as_success():
    class Broken:
        model_id, revision = "m", "r"

        def predict(self, texts):
            raise RuntimeError("no weights")

    rec = Recorder()
    batch = Batch([comment("c1", "﹢ ممتاز")], None, "exhausted")
    run_once(rec.plane(), _Collector(batch), "abcdefghijk", analyzer=Broken())
    # The collected rows are real and are kept.
    assert len(rec.committed[0]["comments"]) == 1
    assert rec.committed[0]["predictions"] == []
    # The source was exhausted but not everything in it was labelled, so the
    # run is partial. Reporting success would claim coverage it does not have.
    assert rec.finished == "partial"


class _Collector:
    source = revision = "test"

    def __init__(self, *batches):
        self.batches_out = list(batches)

    def batches(self, video_id, checkpoint):
        yield from self.batches_out
