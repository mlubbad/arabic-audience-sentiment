"""Gemini as a topic classifier.

One generateContent call per chunk, with the answer constrained by a JSON
schema whose topic_key is an enum of the taxonomy: the model cannot name a
topic nobody chose. The key travels in a header, never in the URL, and nothing
here logs, raises or returns a URL or a response body.

What is sent: the taxonomy (key and description), the comment text, and a
reply's parent text. Never an author, an id, or a workspace.
"""
import json
import math
import time
from typing import Any

import httpx

from .protocol import TopicError, TopicItem, TopicVerdict

PROMPT_VERSION = "p1"
CHUNK = 25
_RETRIES = 2
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

_INSTRUCTIONS = (
    "أنت مصنِّف موضوعات لتعليقات يوتيوب باللغة العربية بلهجاتها.\n"
    "لكل تعليق مرقَّم أدناه اختر موضوعًا واحدًا فقط من القائمة، بمفتاحه كما هو.\n"
    "الردود تظهر مع نص التعليق الأصلي الذي تردّ عليه؛ صنِّف الردّ لا الأصل.\n"
    "أجب بمصفوفة JSON فقط، عنصر لكل تعليق: {index, topic_key, confidence}.\n"
)


def build_prompt(taxonomy: list[dict], items: list[TopicItem]) -> str:
    lines = [_INSTRUCTIONS, "الموضوعات:"]
    lines += [f"- {t['key']} — {t['description']}" for t in taxonomy]
    lines.append("\nالتعليقات:")
    for local, item in enumerate(items):
        if item.is_reply and item.parent_text:
            lines.append(f"[{local}] رد على: {item.parent_text}\n    الرد: {item.text}")
        elif item.is_reply:
            lines.append(f"[{local}] رد على تعليق لم يعد متاحًا:\n    الرد: {item.text}")
        else:
            lines.append(f"[{local}] {item.text}")
    return "\n".join(lines)


class GeminiTopicClassifier:
    prompt_version = PROMPT_VERSION

    def __init__(self, api_key: str, client: httpx.Client,
                 model_id: str = "gemini-2.5-flash", sleep=time.sleep):
        if not api_key:
            raise ValueError("missing_gemini_api_key")
        self.model_id = model_id
        self._key, self._client, self._sleep = api_key, client, sleep

    def classify(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]:
        out: list[TopicVerdict] = []
        for start in range(0, len(items), CHUNK):
            out.extend(self._chunk(taxonomy, items[start:start + CHUNK]))
        return out

    def _chunk(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]:
        keys = [t["key"] for t in taxonomy]
        body = {
            "contents": [{"role": "user", "parts": [{"text": build_prompt(taxonomy, items)}]}],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "index": {"type": "INTEGER"},
                            "topic_key": {"type": "STRING", "enum": keys},
                            "confidence": {"type": "NUMBER"},
                        },
                        "required": ["index", "topic_key", "confidence"],
                    },
                },
            },
        }
        try:
            answers = self._ask(body)
        except TopicError as exc:
            return [TopicVerdict("failed", None, None, exc.code) for _ in items]
        by_index: dict[int, Any] = {}
        for a in answers:
            if isinstance(a, dict) and isinstance(a.get("index"), int):
                by_index[a["index"]] = a
        verdicts = []
        for local, _ in enumerate(items):
            a = by_index.get(local)
            key = a.get("topic_key") if a else None
            conf = a.get("confidence") if a else None
            if (key not in keys or not isinstance(conf, (int, float)) or isinstance(conf, bool)
                    or not math.isfinite(conf)):
                verdicts.append(TopicVerdict("failed", None, None, "gemini_bad_response"))
                continue
            verdicts.append(TopicVerdict("succeeded", key, min(max(float(conf), 0.0), 1.0), None))
        return verdicts

    def _ask(self, body: dict) -> list:
        """The parsed answer array, or a TopicError naming why. Retries 429 and 5xx."""
        for attempt in range(_RETRIES + 1):
            try:
                response = self._client.post(
                    f"{_BASE}/{self.model_id}:generateContent",
                    headers={"x-goog-api-key": self._key, "content-type": "application/json"},
                    json=body, timeout=60,
                )
            except httpx.HTTPError:
                # The exception text can carry the URL; only the fact survives.
                if attempt < _RETRIES:
                    self._sleep(2 ** attempt)
                    continue
                raise TopicError("gemini_unavailable") from None
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < _RETRIES:
                    self._sleep(2 ** attempt)
                    continue
                raise TopicError("gemini_rate_limited" if response.status_code == 429
                                 else "gemini_unavailable")
            if response.status_code >= 400:
                raise TopicError("gemini_refused")
            try:
                text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(text)
            except (ValueError, KeyError, IndexError, TypeError):
                raise TopicError("gemini_bad_response") from None
            if not isinstance(parsed, list):
                raise TopicError("gemini_bad_response")
            return parsed
        raise TopicError("gemini_unavailable")
