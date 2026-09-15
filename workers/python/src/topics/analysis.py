"""Turns due rows into the records commit-topics accepts.

The wiring between a TopicClassifier and the control plane: which comment a
verdict is about, which text it judged, and under which key. Mirrors
server/analysis.py for sentiment.
"""
from typing import Any, Sequence

from .protocol import TopicError, TopicItem, TopicVerdict


def classify(classifier, taxonomy: list[dict], classification_key: str,
             rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """One record per row, in the order given. A shorter or longer answer is an error."""
    if not rows:
        return []
    allowed = {t["key"] for t in taxonomy}
    sendable = [TopicItem(i, r["text"], r.get("parent_text"), bool(r.get("is_reply")))
                for i, r in enumerate(rows) if r.get("text") is not None]
    verdicts: dict[int, TopicVerdict] = {}
    if sendable:
        answers = classifier.classify(taxonomy, sendable)
        if len(answers) != len(sendable):
            raise TopicError("classification_length_mismatch")
        for item, verdict in zip(sendable, answers):
            if verdict.status == "succeeded" and verdict.topic_key not in allowed:
                # A topic nobody chose. Failed, not guessed, not "other".
                verdict = TopicVerdict("failed", None, None, "gemini_bad_response")
            verdicts[item.index] = verdict
    out = []
    for i, r in enumerate(rows):
        v = verdicts.get(i) or TopicVerdict("unsupported", None, None, "text_purged")
        out.append({
            "external_comment_id": r["external_comment_id"],
            "content_hash": r["content_hash"],
            "classification_key": classification_key,
            "status": v.status,
            "topic_key": v.topic_key,
            "confidence": v.confidence,
            "model_id": classifier.model_id,
            "prompt_version": classifier.prompt_version,
            "error_code": v.error_code,
        })
    return out
