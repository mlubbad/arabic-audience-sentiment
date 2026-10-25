"""Gemini video-genre classifier with an enum constrained response."""
import json
import math
import time
from typing import Any

import httpx

from .protocol import GenreError, GenreItem, GenreVerdict

PROMPT_VERSION = "g1"
CHUNK = 50
_RETRIES = 2
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

_INSTRUCTIONS = (
    "أنت مصنّف لأنواع محتوى الفيديو. اختر نوعًا واحدًا لكل فيديو من القائمة.\n"
    "اختر النوع الأكثر تخصّصًا الذي ينطبق. إذا لم ينطبق إلا نوع من المستوى الأول فاختره.\n"
    "لا تخترع مفتاحًا. أجب بمصفوفة JSON فقط: {index, genre_key, confidence}.\n"
)


def build_prompt(taxonomy: list[dict], items: list[GenreItem]) -> str:
    lines = [_INSTRUCTIONS, "الأنواع:"]
    for genre in taxonomy:
        indent = "  " * (int(genre["level"]) - 1)
        lines.append(
            f"{indent}- {genre['key']} — {genre['name_en']} — {genre['description']}"
        )
    lines.append("\nالفيديوهات:")
    for local, item in enumerate(items):
        lines.append(
            f"[{local}] العنوان: {item.title}\n"
            f"    الوصف: {item.description}\n"
            f"    الوسوم: {', '.join(item.tags)}"
        )
    return "\n".join(lines)


class GeminiGenreClassifier:
    prompt_version = PROMPT_VERSION

    def __init__(self, api_key: str, client: httpx.Client,
                 model_id: str = "gemini-3.6-flash", sleep=time.sleep,
                 service_tier: str | None = None):
        if not api_key:
            raise ValueError("missing_gemini_api_key")
        self.model_id = model_id
        self.service_tier = service_tier
        self._key, self._client, self._sleep = api_key, client, sleep

    def classify(self, taxonomy: list[dict], items: list[GenreItem]) -> list[GenreVerdict]:
        out: list[GenreVerdict] = []
        for start in range(0, len(items), CHUNK):
            out.extend(self._chunk(taxonomy, items[start:start + CHUNK]))
        return out

    def _chunk(self, taxonomy: list[dict], items: list[GenreItem],
               split: bool = True) -> list[GenreVerdict]:
        keys = [genre["key"] for genre in taxonomy]
        body = {
            "contents": [{"role": "user", "parts": [{"text": build_prompt(taxonomy, items)}]}],
            "generationConfig": {
                "temperature": 0,
                "thinkingConfig": {"thinkingBudget": 0},
                "responseMimeType": "application/json",
                "responseSchema": {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "index": {"type": "INTEGER"},
                            "genre_key": {"type": "STRING", "enum": keys},
                            "confidence": {"type": "NUMBER"},
                        },
                        "required": ["index", "genre_key", "confidence"],
                    },
                },
            },
        }
        try:
            answers = self._ask(body)
        except GenreError as exc:
            if exc.code == "gemini_bad_response" and split and len(items) > 1:
                half = len(items) // 2
                return (self._chunk(taxonomy, items[:half], split=False)
                        + self._chunk(taxonomy, items[half:], split=False))
            return [GenreVerdict("failed", None, None, exc.code) for _ in items]
        if any(not isinstance(answer, dict) or answer.get("genre_key") not in keys
               for answer in answers):
            if split and len(items) > 1:
                half = len(items) // 2
                return (self._chunk(taxonomy, items[:half], split=False)
                        + self._chunk(taxonomy, items[half:], split=False))
            return [GenreVerdict("failed", None, None, "gemini_bad_response") for _ in items]
        by_index: dict[int, Any] = {}
        for answer in answers:
            if isinstance(answer, dict) and isinstance(answer.get("index"), int):
                by_index[answer["index"]] = answer
        verdicts = []
        for local, _ in enumerate(items):
            answer = by_index.get(local)
            key = answer.get("genre_key") if answer else None
            confidence = answer.get("confidence") if answer else None
            if (key not in keys or not isinstance(confidence, (int, float))
                    or isinstance(confidence, bool) or not math.isfinite(confidence)):
                verdicts.append(GenreVerdict("failed", None, None, "gemini_bad_response"))
            else:
                verdicts.append(GenreVerdict(
                    "succeeded", key, min(max(float(confidence), 0.0), 1.0), None
                ))
        return verdicts

    def _ask(self, body: dict) -> list:
        active_tier = self.service_tier
        for attempt in range(_RETRIES + 1):
            req_body = {**body, "serviceTier": active_tier} if active_tier else body
            try:
                response = self._client.post(
                    f"{_BASE}/{self.model_id}:generateContent",
                    headers={"x-goog-api-key": self._key, "content-type": "application/json"},
                    json=req_body, timeout=60,
                )
            except httpx.HTTPError:
                if active_tier == "flex":
                    active_tier = None
                if attempt < _RETRIES:
                    self._sleep(2 ** attempt)
                    continue
                raise GenreError("gemini_unavailable") from None
            if active_tier == "flex" and response.status_code in (400, 429, 503):
                active_tier = None
                try:
                    response = self._client.post(
                        f"{_BASE}/{self.model_id}:generateContent",
                        headers={"x-goog-api-key": self._key, "content-type": "application/json"},
                        json=body, timeout=60,
                    )
                except httpx.HTTPError:
                    if attempt < _RETRIES:
                        self._sleep(2 ** attempt)
                        continue
                    raise GenreError("gemini_unavailable") from None
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < _RETRIES:
                    self._sleep(2 ** attempt)
                    continue
                raise GenreError("gemini_rate_limited" if response.status_code == 429
                                 else "gemini_unavailable")
            if response.status_code == 402:
                raise GenreError("gemini_credits_depleted")
            if response.status_code >= 400:
                try:
                    message = str(response.json().get("error", {}).get("message", "")).lower()
                    if "prepayment credits are depleted" in message or "resource_exhausted" in message:
                        raise GenreError("gemini_credits_depleted")
                except GenreError:
                    raise
                except (ValueError, KeyError, TypeError, json.JSONDecodeError):
                    pass
                raise GenreError("gemini_refused")
            try:
                text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(text)
            except (ValueError, KeyError, IndexError, TypeError):
                raise GenreError("gemini_bad_response") from None
            if not isinstance(parsed, list):
                raise GenreError("gemini_bad_response")
            return parsed
        raise GenreError("gemini_unavailable")
