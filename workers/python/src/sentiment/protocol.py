"""No model inference is implemented or claimed by this interface."""
from dataclasses import dataclass
from typing import Literal, Protocol

Label = Literal["positive", "negative", "neutral", "mixed"]


@dataclass(frozen=True)
class Prediction:
    status: Literal["succeeded", "skipped", "failed", "unsupported"]
    label: Label | None
    scores: dict[str, float]
    model_id: str
    revision: str

    def __post_init__(self):
        if (self.status == "succeeded") != (self.label is not None):
            raise ValueError("Only successful predictions may have a label")
        if any(not 0 <= value <= 1 for value in self.scores.values()):
            raise ValueError("Invalid class score")


class SentimentAdapter(Protocol):
    model_id: str
    revision: str
    label_mapping: dict[int, Label]
    # Settings that change the output. An adapter with none declares {}, which
    # is a statement rather than an absence.
    parameters: dict[str, object]

    def predict(self, texts: list[str]) -> list[Prediction]: ...
