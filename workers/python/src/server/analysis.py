"""Turns collected rows into the prediction records a batch carries.

No model inference happens here and none is claimed. This is the wiring between
a `SentimentAdapter` and the I1 batch contract: which comment a verdict is
about, which text it judged, and which model produced it.

Until now nothing connected the two. `run_once` collected rows and committed
them with an empty prediction list, so the server path stored comments and never
a single label, whatever analyzer was configured.
"""
from typing import Any, Sequence

from collectors.protocol import RawComment
from sentiment.preprocess import PREPROCESSING_VERSION
from sentiment.registry import parameters_digest

from .gateway import content_hash


class AnalysisError(Exception):
    """Analysis failed for a batch. Collection still stands; coverage does not."""

    def __init__(self, code: str = "analysis_failed"):
        super().__init__(code)  # Code only: an adapter error can quote a path.
        self.code = code


def analysis_key(model_id: str, revision: str, parameters: dict) -> str:
    """Fingerprint of model+revision+preprocessing+settings. Matches ModelCard."""
    return f"{model_id}@{revision}+{PREPROCESSING_VERSION}+{parameters_digest(parameters)}"


def analyse(analyzer, comments: Sequence[RawComment]) -> list[dict[str, Any]]:
    """One prediction record per comment, in the order they were given.

    Every record names a comment in the same sequence, which is what the batch
    contract requires and what the database now refuses a batch for lacking.
    """
    if not comments:
        return []
    # An adapter that declares no settings has none; {} is what the server
    # stores and is a statement, not a missing value.
    parameters = dict(getattr(analyzer, "parameters", None) or {})
    try:
        predictions = analyzer.predict([c.text for c in comments])
    except Exception as exc:  # noqa: BLE001 — the adapter's type is not ours to know
        raise AnalysisError() from exc
    if len(predictions) != len(comments):
        # A shorter list would silently leave rows unanalysed while the run
        # reported success, and a longer one would name comments that do not
        # exist. Neither is recoverable here.
        raise AnalysisError("analysis_length_mismatch")
    return [_record(c, p, parameters) for c, p in zip(comments, predictions)]


def _record(c: RawComment, p, parameters: dict) -> dict[str, Any]:
    return {
        "external_comment_id": c.id,
        # The exact text judged. A later edit changes the comment's hash, and
        # this prediction stops being the effective label rather than being
        # quietly applied to text no model ever saw.
        "content_hash": content_hash(c.text),
        "analysis_key": analysis_key(p.model_id, p.revision, parameters),
        "status": p.status,
        "label": p.label,
        "class_scores": dict(p.scores),
        "model_id": p.model_id,
        "revision": p.revision,
        "preprocessing_version": PREPROCESSING_VERSION,
        # Part of what identifies the run. The column existed and its unique
        # index named it, but nothing ever wrote it.
        "parameters": parameters,
    }
