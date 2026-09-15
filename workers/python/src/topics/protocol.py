"""What a topic classifier is. No model inference is implemented or claimed here."""
from dataclasses import dataclass
from typing import Literal, Protocol

Status = Literal["succeeded", "skipped", "failed", "unsupported"]


class TopicError(Exception):
    """A classification failed for a whole chunk. Carries a code only: a message
    built from a response could echo the request into a log."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class TopicItem:
    index: int
    # None means the text is gone (purged) and the item must not be sent.
    text: str | None
    # The parent's text for a reply; "آمين" alone is unclassifiable.
    parent_text: str | None
    is_reply: bool


@dataclass(frozen=True)
class TopicVerdict:
    status: Status
    topic_key: str | None
    confidence: float | None
    error_code: str | None

    def __post_init__(self):
        if (self.status == "succeeded") != (self.topic_key is not None):
            raise ValueError("Only successful verdicts may name a topic")
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("Invalid confidence")


class TopicClassifier(Protocol):
    model_id: str
    prompt_version: str

    def classify(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]: ...
