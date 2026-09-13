"""Pinned model registry. Label mappings are declared, never inferred from order."""
import hashlib
import json
from dataclasses import dataclass, field

from .protocol import Label

LABELS: tuple[Label, ...] = ("positive", "negative", "neutral", "mixed")


def parameters_digest(parameters: dict[str, object]) -> str:
    """Stable short digest of a settings dict, insensitive to key order."""
    canonical = json.dumps(parameters, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:12]


@dataclass(frozen=True)
class ModelCard:
    model_id: str
    revision: str
    label_mapping: dict[int, Label]
    preprocessing_version: str
    max_length: int = 256
    measured: dict[str, float] = field(default_factory=dict)

    def __post_init__(self):
        if not self.revision or self.revision == "main":
            # A moving ref is not a revision; an invented SHA is worse.
            raise ValueError("revision must be a pinned immutable commit")
        if sorted(self.label_mapping) != list(range(len(self.label_mapping))):
            raise ValueError("label mapping must cover contiguous indices from zero")
        if any(v not in LABELS for v in self.label_mapping.values()):
            raise ValueError("unknown label in mapping")
        if len(set(self.label_mapping.values())) != len(self.label_mapping):
            raise ValueError("duplicate label in mapping")

    @property
    def supports_mixed(self) -> bool:
        """A three-class model must not report 0% Mixed as if it had measured it."""
        return "mixed" in self.label_mapping.values()

    @property
    def parameters(self) -> dict[str, object]:
        """The inference settings that change what the model outputs.

        Declared rather than implied: the server stores these as part of what
        identifies an analysis run, and a setting left out of here is a
        difference the server cannot see.
        """
        return {"max_length": self.max_length}

    @property
    def analysis_key(self) -> str:
        """Fingerprint of model+revision+preprocessing+settings; not a run id.

        Settings belong in it because a prediction is unique on this key: two
        analyses of the same comment differing only in their settings would
        otherwise collide and the second would be silently discarded.
        """
        return (
            f"{self.model_id}@{self.revision}"
            f"+{self.preprocessing_version}+{parameters_digest(self.parameters)}"
        )


# Candidates recorded in the handoff. Revisions are deliberately absent until a real
# download pins them: no SHA is invented here, so no card is constructed yet.
CANDIDATES: dict[str, dict[int, Label]] = {
    "PRAli22/AraBert-Arabic-Sentiment-Analysis": {0: "positive", 1: "negative", 2: "neutral", 3: "mixed"},
    "CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment": {0: "positive", 1: "negative", 2: "neutral"},
}
