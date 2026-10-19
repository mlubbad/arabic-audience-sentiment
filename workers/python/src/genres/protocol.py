from dataclasses import dataclass
from typing import Literal, Protocol

Status = Literal["succeeded", "skipped", "failed", "unsupported"]


class GenreError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class GenreItem:
    index: int
    title: str
    description: str
    tags: list[str]
    category_id: str | None
    duration_sec: int | None


@dataclass(frozen=True)
class GenreVerdict:
    status: Status
    genre_key: str | None
    confidence: float | None
    error_code: str | None

    def __post_init__(self) -> None:
        if (self.status == "succeeded") != (self.genre_key is not None):
            raise ValueError("Only successful verdicts may name a genre")
        if self.confidence is not None and not 0 <= self.confidence <= 1:
            raise ValueError("Invalid confidence")


class GenreClassifier(Protocol):
    model_id: str
    prompt_version: str

    def classify(self, taxonomy: list[dict], items: list[GenreItem]) -> list[GenreVerdict]: ...
