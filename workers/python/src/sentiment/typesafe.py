"""TypeSafe (Jev) System One Arabic sentiment classifier adapter.

Conforms to the SentimentAdapter protocol. Evaluates comments in parallel
using TypeSafe's System One API with calibrated probability distributions
across all four required classes: positive, negative, neutral, and mixed.

The key travels in the Authorization header, never in a URL or logged payload.
Provenanced with model_id, revision, PREPROCESSING_VERSION, and parameters_digest.
"""
import math
import time
from typing import Any

import httpx

from .preprocess import (
    PREPROCESSING_VERSION,
    is_analysable,
    normalize_arabic_text,
    to_plain_text,
)
from .protocol import Label, Prediction
from .registry import parameters_digest

PROMPT_VERSION = "jev-sentiment-v1"
CHUNK = 25
_RETRIES = 2
_BASE = "https://api.typesafe.ai/v1/systemone"
MODEL = "typesafe/jev-latest"
REVISION = "1.13.0"

LABEL_MAPPING: dict[int, Label] = {
    0: "positive",
    1: "negative",
    2: "neutral",
    3: "mixed",
}
VALID_LABELS: set[str] = set(LABEL_MAPPING.values())

SENTIMENT_CRITERIA: dict[str, str] = {
    "positive": (
        "Positive sentiment: compliments, praise, gratitude, congratulations, "
        "prayers of blessing (دعاء بالخير), optimism, happiness, or enthusiastic agreement."
    ),
    "negative": (
        "Negative sentiment: criticism, complaints, dissatisfaction, anger, "
        "frustration, objection, mockery, insults, or hostility."
    ),
    "neutral": (
        "Neutral sentiment: purely factual statements, objective information, "
        "inquiries without emotional valence, or objective commentary."
    ),
    "mixed": (
        "Mixed sentiment: contains both positive and negative feelings or "
        "conflicting judgments in the same comment (e.g., praising the effort "
        "while criticizing the quality or sound)."
    ),
}

_INSTRUCTIONS = (
    "Classify the overall sentiment of this Arabic comment into exactly one of the four categories: "
    "positive, negative, neutral, or mixed. Take dialectal nuances and idioms into account."
)


class SentimentError(Exception):
    """Raised when the TypeSafe API refuses, fails, or returns malformed data."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class TypeSafeSentimentAdapter:
    """SentimentAdapter implementation backed by TypeSafe Jev System One."""

    label_mapping = LABEL_MAPPING
    supports_mixed = True

    def __init__(
        self,
        api_key: str,
        client: httpx.Client,
        model_id: str = MODEL,
        revision: str = REVISION,
        sleep=time.sleep,
    ):
        if not api_key:
            raise ValueError("missing_typesafe_api_key")
        self.model_id = model_id
        self.revision = revision
        self.preprocessing_version = PREPROCESSING_VERSION
        self._key = api_key
        self._client = client
        self._sleep = sleep

    @property
    def parameters(self) -> dict[str, object]:
        return {
            "prompt_version": PROMPT_VERSION,
            "instructions": _INSTRUCTIONS,
            "criteria": SENTIMENT_CRITERIA,
        }

    @property
    def analysis_key(self) -> str:
        return (
            f"{self.model_id}@{self.revision}"
            f"+{self.preprocessing_version}+{parameters_digest(self.parameters)}"
        )

    def predict(self, texts: list[str]) -> list[Prediction]:
        out: list[Prediction] = []
        for start in range(0, len(texts), CHUNK):
            out.extend(self._chunk(texts[start : start + CHUNK]))
        return out

    def _chunk(self, texts: list[str]) -> list[Prediction]:
        state: dict[str, Any] = {"items": []}
        questions: dict[str, Any] = {}
        predictions: list[Prediction | None] = []

        active_indices: list[int] = []
        for local, raw in enumerate(texts):
            plain = to_plain_text(raw) if raw is not None else ""
            if not is_analysable(plain):
                predictions.append(
                    Prediction(
                        status="skipped",
                        label=None,
                        scores={},
                        model_id=self.model_id,
                        revision=self.revision,
                    )
                )
                continue

            normalized = normalize_arabic_text(raw)
            state["items"].append({"text": normalized})
            q_id = f"i{local}"
            questions[q_id] = {
                "type": "choice",
                "instructions": f"{_INSTRUCTIONS} Judge the comment `{q_id}`.",
                "criteria": SENTIMENT_CRITERIA,
            }
            predictions.append(None)
            active_indices.append(local)

        if not active_indices:
            return [p for p in predictions if p is not None]

        body = {
            "state": state,
            "model": self.model_id.replace("typesafe/", ""),
            "questions": questions,
        }

        try:
            answers = self._ask(body)
        except SentimentError:
            return [
                p
                if p is not None
                else Prediction(
                    status="failed",
                    label=None,
                    scores={},
                    model_id=self.model_id,
                    revision=self.revision,
                )
                for p in predictions
            ]

        out: list[Prediction] = []
        for local in range(len(texts)):
            if predictions[local] is not None:
                out.append(predictions[local])
                continue

            q_id = f"i{local}"
            ans = answers.get(q_id)
            if not isinstance(ans, dict):
                out.append(
                    Prediction(
                        status="failed",
                        label=None,
                        scores={},
                        model_id=self.model_id,
                        revision=self.revision,
                    )
                )
                continue

            choice = ans.get("choice")
            raw_probs = ans.get("probabilities")

            if choice not in VALID_LABELS or not isinstance(raw_probs, dict):
                out.append(
                    Prediction(
                        status="failed",
                        label=None,
                        scores={},
                        model_id=self.model_id,
                        revision=self.revision,
                    )
                )
                continue

            scores: dict[str, float] = {}
            valid_scores = True
            for lbl in ("positive", "negative", "neutral", "mixed"):
                prob = raw_probs.get(lbl, 0.0)
                if not isinstance(prob, (int, float)) or isinstance(prob, bool) or not math.isfinite(prob):
                    valid_scores = False
                    break
                scores[lbl] = min(max(float(prob), 0.0), 1.0)

            if not valid_scores:
                out.append(
                    Prediction(
                        status="failed",
                        label=None,
                        scores={},
                        model_id=self.model_id,
                        revision=self.revision,
                    )
                )
                continue

            out.append(
                Prediction(
                    status="succeeded",
                    label=choice,  # type: ignore[arg-type]
                    scores=scores,
                    model_id=self.model_id,
                    revision=self.revision,
                )
            )

        return out

    def _ask(self, body: dict) -> dict:
        """Call TypeSafe System One API with retry discipline for 429 and 5xx."""
        for attempt in range(_RETRIES + 1):
            try:
                response = self._client.post(
                    _BASE,
                    headers={
                        "Authorization": f"Bearer {self._key}",
                        "content-type": "application/json",
                    },
                    json=body,
                    timeout=60,
                )
            except httpx.HTTPError:
                if attempt < _RETRIES:
                    self._sleep(2**attempt)
                    continue
                raise SentimentError("typesafe_unavailable") from None

            if response.status_code == 429 or response.status_code >= 500:
                if attempt < _RETRIES:
                    self._sleep(2**attempt)
                    continue
                raise SentimentError(
                    "typesafe_rate_limited"
                    if response.status_code == 429
                    else "typesafe_unavailable"
                )

            if response.status_code >= 400:
                raise SentimentError("typesafe_refused")

            try:
                parsed = response.json().get("answers")
            except (ValueError, KeyError, TypeError, AttributeError):
                raise SentimentError("typesafe_bad_response") from None

            if not isinstance(parsed, dict):
                raise SentimentError("typesafe_bad_response")

            return parsed

        raise SentimentError("typesafe_unavailable")
