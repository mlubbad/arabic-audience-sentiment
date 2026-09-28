"""Protocol and dataclasses for unified omnichannel comment enrichment.

Combines sentiment analysis, topic classification, and actionable intent
into a single high-throughput, low-latency evaluation pass.
"""
from dataclasses import dataclass
from typing import Literal, Protocol, Sequence

from sentiment.protocol import Label

EnrichmentStatus = Literal["succeeded", "skipped", "failed", "unsupported"]


@dataclass(frozen=True)
class EnrichedVerdict:
    sentiment_status: EnrichmentStatus
    sentiment_label: Label | None
    sentiment_scores: dict[str, float]

    topic_status: EnrichmentStatus
    topic_key: str | None
    topic_confidence: float | None
    topic_error_code: str | None

    is_question: float | None = None
    urgency: int | None = None

    def __post_init__(self):
        if (self.sentiment_status == "succeeded") != (self.sentiment_label is not None):
            raise ValueError("Only successful sentiment predictions may have a label")
        if (self.topic_status == "succeeded") != (self.topic_key is not None):
            raise ValueError("Only successful topic predictions may have a topic_key")


@dataclass(frozen=True)
class EnrichmentItem:
    id: str
    text: str | None
    parent_text: str | None = None
    is_reply: bool = False


class Enricher(Protocol):
    model_id: str
    revision: str

    def enrich(
        self, taxonomy: list[dict], items: Sequence[EnrichmentItem]
    ) -> list[EnrichedVerdict]: ...
