"""TypeSafe (Jev) unified enrichment engine.

Evaluates 4-class sentiment, topic taxonomy, actionable inquiry detection,
and urgency rating simultaneously in a single forward pass per chunk of comments.
"""
import math
import time
from typing import Any, Sequence

import httpx

from sentiment.preprocess import (
    PREPROCESSING_VERSION,
    is_analysable,
    normalize_arabic_text,
    to_plain_text,
)
from sentiment.protocol import Label
from sentiment.registry import parameters_digest
from sentiment.typesafe import SENTIMENT_CRITERIA, VALID_LABELS

from .protocol import EnrichedVerdict, EnrichmentItem

PROMPT_VERSION = "jev-enrichment-v1"
CHUNK = 25
_RETRIES = 2
_BASE = "https://api.typesafe.ai/v1/systemone"
MODEL = "typesafe/jev-latest"
REVISION = "1.13.0"

_SENTIMENT_INSTRUCTIONS = (
    "Classify the overall sentiment of this Arabic comment into exactly one of the four categories: "
    "positive, negative, neutral, or mixed. Take dialectal nuances and idioms into account."
)

_TOPIC_INSTRUCTIONS = (
    "Which topic best describes this comment, written in an Arabic dialect? "
    "If the comment is a reply, judge the reply in light of the parent it answers, not the parent itself."
)

_INQUIRY_INSTRUCTIONS = (
    "Does this comment ask an explicit question or require an answer or clarification from the creator?"
)

_URGENCY_CRITERIA = {
    "0": "Standard comment, casual observation, praise, or routine greeting",
    "1": "Constructive suggestion, mild question, or gentle feedback",
    "2": "Clear complaint, product/technical issue, or pointed disagreement",
    "3": "Severe crisis, harassment, scam report, or high-priority operational escalation",
}


class EnrichmentError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class TypeSafeEnricher:
    """Evaluates sentiment, topic taxonomy, and intent in a single TypeSafe Jev API call."""

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
            "sentiment_instructions": _SENTIMENT_INSTRUCTIONS,
            "topic_instructions": _TOPIC_INSTRUCTIONS,
            "sentiment_criteria": SENTIMENT_CRITERIA,
            "urgency_criteria": _URGENCY_CRITERIA,
        }

    @property
    def analysis_key(self) -> str:
        return (
            f"{self.model_id}@{self.revision}"
            f"+{self.preprocessing_version}+{parameters_digest(self.parameters)}"
        )

    def enrich(
        self, taxonomy: list[dict], items: Sequence[EnrichmentItem]
    ) -> list[EnrichedVerdict]:
        out: list[EnrichedVerdict] = []
        for start in range(0, len(items), CHUNK):
            out.extend(self._chunk(taxonomy, items[start : start + CHUNK]))
        return out

    def _chunk(
        self, taxonomy: list[dict], items: Sequence[EnrichmentItem]
    ) -> list[EnrichedVerdict]:
        topic_keys = [t["key"] for t in taxonomy]
        state: dict[str, Any] = {
            "taxonomy": [
                {"key": t["key"], "description": t["description"]} for t in taxonomy
            ],
            "items": [],
        }
        questions: dict[str, Any] = {}
        verdicts: list[EnrichedVerdict | None] = []

        active_indices: list[int] = []
        for local, item in enumerate(items):
            plain = to_plain_text(item.text) if item.text is not None else ""
            if not is_analysable(plain):
                verdicts.append(
                    EnrichedVerdict(
                        sentiment_status="skipped",
                        sentiment_label=None,
                        sentiment_scores={},
                        topic_status="skipped",
                        topic_key=None,
                        topic_confidence=None,
                        topic_error_code=None,
                    )
                )
                continue

            normalized_text = normalize_arabic_text(item.text)  # type: ignore[arg-type]
            normalized_parent = (
                normalize_arabic_text(item.parent_text)
                if item.parent_text
                else None
            )

            state_item = {
                "text": normalized_text,
                "parent_text": normalized_parent,
                "is_reply": item.is_reply,
            }
            state["items"].append(state_item)

            ref = f"items[{len(state['items']) - 1}].text"
            if item.is_reply and normalized_parent:
                topic_ref = f"{ref} (reply to parent `{normalized_parent}`)"
            else:
                topic_ref = ref

            # 1. Sentiment Question
            questions[f"sent_{local}"] = {
                "type": "choice",
                "instructions": f"{_SENTIMENT_INSTRUCTIONS} Judge `{ref}`.",
                "criteria": SENTIMENT_CRITERIA,
            }

            # 2. Topic Taxonomy Question
            questions[f"top_{local}"] = {
                "type": "choice",
                "instructions": f"{_TOPIC_INSTRUCTIONS} Judge `{topic_ref}`.",
                "criteria": {t["key"]: t["description"] for t in taxonomy},
            }

            # 3. Actionable Question Detection (Noul: P(yes))
            questions[f"inq_{local}"] = {
                "type": "noul",
                "instructions": f"{_INQUIRY_INSTRUCTIONS} Judge `{ref}`.",
            }

            # 4. Severity / Urgency Rating (Score 0-3)
            questions[f"urg_{local}"] = {
                "type": "score",
                "instructions": f"Rate the operational urgency of the comment `{ref}`.",
                "criteria": _URGENCY_CRITERIA,
            }

            verdicts.append(None)
            active_indices.append(local)

        if not active_indices:
            return [v for v in verdicts if v is not None]

        body = {
            "state": state,
            "model": self.model_id.replace("typesafe/", ""),
            "questions": questions,
        }

        try:
            answers = self._ask(body)
        except EnrichmentError as exc:
            return [
                v
                if v is not None
                else EnrichedVerdict(
                    sentiment_status="failed",
                    sentiment_label=None,
                    sentiment_scores={},
                    topic_status="failed",
                    topic_key=None,
                    topic_confidence=None,
                    topic_error_code=exc.code,
                )
                for v in verdicts
            ]

        out: list[EnrichedVerdict] = []
        for local in range(len(items)):
            if verdicts[local] is not None:
                out.append(verdicts[local])
                continue

            # Parse Sentiment
            sent_ans = answers.get(f"sent_{local}")
            sent_choice = sent_ans.get("choice") if isinstance(sent_ans, dict) else None
            sent_probs = sent_ans.get("probabilities") if isinstance(sent_ans, dict) else None

            sent_status: Any = "failed"
            sent_label: Label | None = None
            sent_scores: dict[str, float] = {}

            if sent_choice in VALID_LABELS and isinstance(sent_probs, dict):
                valid = True
                for lbl in ("positive", "negative", "neutral", "mixed"):
                    prob = sent_probs.get(lbl, 0.0)
                    if not isinstance(prob, (int, float)) or isinstance(prob, bool) or not math.isfinite(prob):
                        valid = False
                        break
                    sent_scores[lbl] = min(max(float(prob), 0.0), 1.0)
                if valid:
                    sent_status = "succeeded"
                    sent_label = sent_choice

            # Parse Topic
            top_ans = answers.get(f"top_{local}")
            top_choice = top_ans.get("choice") if isinstance(top_ans, dict) else None
            top_conf = top_ans.get("confidence") if isinstance(top_ans, dict) else None

            top_status: Any = "failed"
            top_key: str | None = None
            top_confidence: float | None = None
            top_err: str | None = "typesafe_bad_response"

            if (
                top_choice in topic_keys
                and isinstance(top_conf, (int, float))
                and not isinstance(top_conf, bool)
                and math.isfinite(top_conf)
            ):
                top_status = "succeeded"
                top_key = top_choice
                top_confidence = min(max(float(top_conf), 0.0), 1.0)
                top_err = None

            # Parse Inquiry (Noul)
            inq_ans = answers.get(f"inq_{local}")
            inq_val: float | None = None
            if isinstance(inq_ans, dict):
                raw_noul = inq_ans.get("noul")
                if isinstance(raw_noul, (int, float)) and not isinstance(raw_noul, bool) and math.isfinite(raw_noul):
                    inq_val = min(max(float(raw_noul), 0.0), 1.0)

            # Parse Urgency (Score)
            urg_ans = answers.get(f"urg_{local}")
            urg_val: int | None = None
            if isinstance(urg_ans, dict):
                raw_score = urg_ans.get("score")
                if isinstance(raw_score, int) and not isinstance(raw_score, bool):
                    urg_val = raw_score

            out.append(
                EnrichedVerdict(
                    sentiment_status=sent_status,
                    sentiment_label=sent_label,
                    sentiment_scores=sent_scores,
                    topic_status=top_status,
                    topic_key=top_key,
                    topic_confidence=top_confidence,
                    topic_error_code=top_err,
                    is_question=inq_val,
                    urgency=urg_val,
                )
            )

        return out

    def _ask(self, body: dict) -> dict:
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
                raise EnrichmentError("typesafe_unavailable") from None

            if response.status_code == 429 or response.status_code >= 500:
                if attempt < _RETRIES:
                    self._sleep(2**attempt)
                    continue
                raise EnrichmentError(
                    "typesafe_rate_limited"
                    if response.status_code == 429
                    else "typesafe_unavailable"
                )

            if response.status_code >= 400:
                raise EnrichmentError("typesafe_refused")

            try:
                parsed = response.json().get("answers")
            except (ValueError, KeyError, TypeError, AttributeError):
                raise EnrichmentError("typesafe_bad_response") from None

            if not isinstance(parsed, dict):
                raise EnrichmentError("typesafe_bad_response")

            return parsed

        raise EnrichmentError("typesafe_unavailable")
