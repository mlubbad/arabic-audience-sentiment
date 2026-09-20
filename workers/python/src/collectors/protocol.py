"""Adapter contracts. Exhaustion describes source traversal, never 100% coverage."""
from dataclasses import dataclass, field
from typing import Literal, Protocol, Iterator

Outcome = Literal["partial", "exhausted", "explicitly_disabled", "unavailable", "failed", "blocked"]


@dataclass(frozen=True)
class RawComment:
    id: str
    video_id: str
    text: str
    parent_id: str | None = None
    is_reply: bool = False
    parent_source: str = "unknown"
    published_time_raw: str | None = None
    published_at: str | None = None
    timestamp_precision: str = "unknown"
    author_channel_id: str | None = None
    author_name: str = ""
    likes_raw: str | None = None
    likes_value: int | None = None
    source: str = "sanitized_fixture"
    platform: str = "youtube"
    field_provenance: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Batch:
    comments: list[RawComment]
    checkpoint: str | None
    outcome: Outcome


@dataclass(frozen=True)
class Catalogue:
    """Every video the source listed. complete is whether every tab was read
    to its end — never a claim that every video that exists was listed."""
    videos: list[dict]
    complete: bool
    reason: str | None = None


class CollectionError(Exception):
    def __init__(self, code: str, outcome: Outcome = "failed", retryable: bool = False):
        super().__init__(code)  # Never retain transport URLs/keys or raw provider errors.
        self.code, self.outcome, self.retryable = code, outcome, retryable


class Collector(Protocol):
    source: str
    revision: str

    def batches(self, video_id: str, checkpoint: str | None) -> Iterator[Batch]: ...
