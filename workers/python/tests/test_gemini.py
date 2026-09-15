"""The Gemini adapter, over a fake transport. No request leaves the process."""
import json

import httpx

from topics.gemini import CHUNK, PROMPT_VERSION, GeminiTopicClassifier, build_prompt
from topics.protocol import TopicItem

TAXONOMY = [{"key": "question", "description": "asks"}, {"key": "praise", "description": "thanks"}]


def answer(pairs):
    return {"candidates": [{"content": {"parts": [{"text": json.dumps(
        [{"index": i, "topic_key": k, "confidence": 0.9} for i, k in pairs])}]}}]}


class Fake:
    def __init__(self, responses):
        self.responses, self.requests = list(responses), []

    def handler(self, request):
        self.requests.append(request)
        status, body = self.responses.pop(0)
        return httpx.Response(status, json=body)

    def classifier(self, **kw):
        return GeminiTopicClassifier("secret-key", httpx.Client(transport=httpx.MockTransport(self.handler)),
                                     sleep=lambda s: None, **kw)


def items(n):
    return [TopicItem(i, f"نص {i}", None, False) for i in range(n)]


def test_the_key_travels_in_a_header_and_never_in_the_url():
    fake = Fake([(200, answer([(0, "praise")]))])
    fake.classifier().classify(TAXONOMY, items(1))
    [req] = fake.requests
    assert "secret-key" not in str(req.url)
    assert req.headers["x-goog-api-key"] == "secret-key"
    assert req.url.path.endswith("/models/gemini-2.5-flash:generateContent")


def test_the_request_constrains_the_answer_to_the_taxonomy():
    fake = Fake([(200, answer([(0, "praise")]))])
    fake.classifier().classify(TAXONOMY, items(1))
    body = json.loads(fake.requests[0].content)
    cfg = body["generationConfig"]
    assert cfg["temperature"] == 0
    assert cfg["responseMimeType"] == "application/json"
    assert cfg["responseSchema"]["items"]["properties"]["topic_key"]["enum"] == ["question", "praise"]
    assert "نص 0" in body["contents"][0]["parts"][0]["text"]


def test_a_reply_is_shown_with_its_parent():
    prompt = build_prompt(TAXONOMY, [TopicItem(0, "آمين", "اللهم اغفر لنا", True)])
    assert "رد على: اللهم اغفر لنا" in prompt
    assert "question — asks" in prompt


def test_chunks_of_twenty_five_and_verdicts_in_order():
    fake = Fake([(200, answer([(i, "praise") for i in range(CHUNK)])),
                 (200, answer([(0, "question"), (1, "praise")]))])
    verdicts = fake.classifier().classify(TAXONOMY, items(CHUNK + 2))
    assert len(fake.requests) == 2
    assert len(verdicts) == CHUNK + 2
    assert verdicts[CHUNK].topic_key == "question"
    # Indices in the second chunk are local to it.
    assert json.loads(fake.requests[1].content)["contents"][0]["parts"][0]["text"].count("[0]") == 1


def test_rate_limit_is_retried_then_fails_the_chunk_with_a_code():
    fake = Fake([(429, {"error": {"message": "https://leak.invalid?key=secret-key"}})] * 3)
    [v] = fake.classifier().classify(TAXONOMY, items(1))
    assert (v.status, v.error_code) == ("failed", "gemini_rate_limited")
    assert len(fake.requests) == 3


def test_server_error_fails_the_chunk_and_a_later_chunk_still_runs():
    fake = Fake([(503, {}), (503, {}), (503, {}), (200, answer([(0, "praise")]))])
    verdicts = fake.classifier().classify(TAXONOMY, items(CHUNK + 1))
    assert all(v.error_code == "gemini_unavailable" for v in verdicts[:CHUNK])
    assert verdicts[CHUNK].topic_key == "praise"


def test_a_missing_index_fails_only_that_item():
    fake = Fake([(200, answer([(1, "praise")]))])
    a, b = fake.classifier().classify(TAXONOMY, items(2))
    assert (a.status, a.error_code) == ("failed", "gemini_bad_response")
    assert b.topic_key == "praise"


def test_unparseable_text_fails_the_chunk():
    fake = Fake([(200, {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]})])
    [v] = fake.classifier().classify(TAXONOMY, items(1))
    assert v.error_code == "gemini_bad_response"


def test_a_blocked_or_empty_candidate_fails_the_chunk():
    fake = Fake([(200, {"candidates": []})])
    [v] = fake.classifier().classify(TAXONOMY, items(1))
    assert v.error_code == "gemini_bad_response"


def test_nothing_raised_carries_the_url():
    fake = Fake([(400, {"error": {"message": "bad request at https://x.invalid?key=secret-key"}})])
    [v] = fake.classifier().classify(TAXONOMY, items(1))
    assert v.status == "failed" and "secret-key" not in (v.error_code or "")


def test_prompt_version_is_declared():
    assert PROMPT_VERSION == "p1"
    assert GeminiTopicClassifier("k", httpx.Client()).prompt_version == "p1"
