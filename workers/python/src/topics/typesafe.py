"""TypeSafe (Jev) as a topic classifier.

One systemone request per chunk: every item is a `choice` question over the
same taxonomy, answered in parallel with typed probabilities. There is no JSON
array to parse, no safety threshold to disable, and no chain-of-thought bill —
the answer arrives under the id the question was given. The key travels in the
Authorization header, never in a URL, and nothing here logs, raises or returns
a URL or a response body.

What is sent: the taxonomy (key and description), the comment text, and a
reply's parent text. Never an author, an id, or a workspace.

Drop-in for the TopicClassifier protocol: same constructor shape as
GeminiTopicClassifier(key, client), same verdict discipline. A failed chunk
fails whole, never silently; a purged text is skipped, never sent.
"""
import math
import time
from typing import Any

import httpx

from .protocol import TopicError, TopicItem, TopicVerdict

# v1 asks each item which topic fits, referencing the item by id inside the
# shared state. A change to the instructions or the state shape is a new
# version: verdicts stored under the old classification key must keep meaning
# what they meant when they were stored.
PROMPT_VERSION = "jev1"
# A chunk is bounded so one failed request loses a bounded number of metered
# verdicts. Smaller than Gemini's 100: each question repeats the criteria, so
# a request is bigger per item and a failure costs more per item.
CHUNK = 25
_RETRIES = 2
_BASE = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"

_INSTRUCTIONS = (
    "Which topic best describes this YouTube comment, written in an Arabic "
    "dialect? If the comment is a reply, judge the reply in light of the "
    "parent it answers, not the parent itself."
)


class TypeSafeTopicClassifier:
    prompt_version = PROMPT_VERSION

    def __init__(self, api_key: str, client: httpx.Client,
                 model_id: str = MODEL, sleep=time.sleep):
        if not api_key:
            raise ValueError("missing_typesafe_api_key")
        self.model_id = model_id
        self._key, self._client, self._sleep = api_key, client, sleep

    def classify(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]:
        out: list[TopicVerdict] = []
        for start in range(0, len(items), CHUNK):
            out.extend(self._chunk(taxonomy, items[start:start + CHUNK]))
        return out

    def _chunk(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]:
        keys = [t["key"] for t in taxonomy]
        state: dict[str, Any] = {"taxonomy": [{"key": t["key"], "description": t["description"]}
                                              for t in taxonomy],
                                 "items": []}
        questions: dict[str, Any] = {}
        # A purged text must not be sent anywhere; it is skipped here so the
        # caller never has to filter, and the verdict is an answer not a drop.
        verdicts: list[TopicVerdict | None] = []
        for local, item in enumerate(items):
            if item.text is None:
                verdicts.append(TopicVerdict("skipped", None, None, None))
                continue
            ref = f"items[{local}].text"
            if item.is_reply and item.parent_text:
                ref += (f" — a reply to the comment `items[{local}].parent_text`; "
                        "classify the reply, not the parent")
            elif item.is_reply:
                ref += " — a reply whose parent comment is no longer available"
            state["items"].append({"text": item.text, "parent_text": item.parent_text})
            questions[f"i{local}"] = {
                "type": "choice",
                "instructions": f"{_INSTRUCTIONS} Judge the comment `{ref}`.",
                "criteria": {t["key"]: t["description"] for t in taxonomy},
            }
            verdicts.append(None)

        body = {"state": state, "model": self.model_id, "questions": questions}
        try:
            answers = self._ask(body)
        except TopicError as exc:
            return [v if v is not None else TopicVerdict("failed", None, None, exc.code)
                    for v in verdicts]

        verdicts_out: list[TopicVerdict] = []
        for local, item in enumerate(items):
            if verdicts[local] is not None:
                verdicts_out.append(verdicts[local])
                continue
            a = answers.get(f"i{local}")
            key = a.get("choice") if isinstance(a, dict) else None
            conf = a.get("confidence") if isinstance(a, dict) else None
            if (key not in keys or not isinstance(conf, (int, float)) or isinstance(conf, bool)
                    or not math.isfinite(conf)):
                verdicts_out.append(TopicVerdict("failed", None, None, "typesafe_bad_response"))
                continue
            verdicts_out.append(TopicVerdict("succeeded", key, min(max(float(conf), 0.0), 1.0), None))
        return verdicts_out

    def _ask(self, body: dict) -> dict:
        """The answers map, or a TopicError naming why. Retries 429 and 5xx."""
        for attempt in range(_RETRIES + 1):
            try:
                response = self._client.post(
                    _BASE,
                    headers={"Authorization": f"Bearer {self._key}",
                             "content-type": "application/json"},
                    json=body, timeout=60,
                )
            except httpx.HTTPError:
                # The exception text can carry the URL; only the fact survives.
                if attempt < _RETRIES:
                    self._sleep(2 ** attempt)
                    continue
                raise TopicError("typesafe_unavailable") from None
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < _RETRIES:
                    self._sleep(2 ** attempt)
                    continue
                raise TopicError("typesafe_rate_limited" if response.status_code == 429
                                 else "typesafe_unavailable")
            if response.status_code >= 400:
                raise TopicError("typesafe_refused")
            try:
                parsed = response.json()["answers"]
            except (ValueError, KeyError, TypeError):
                raise TopicError("typesafe_bad_response") from None
            if not isinstance(parsed, dict):
                raise TopicError("typesafe_bad_response")
            return parsed
        raise TopicError("typesafe_unavailable")
