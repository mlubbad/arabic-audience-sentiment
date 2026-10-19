import json
from pathlib import Path

import httpx

from genres.analysis import classify
from genres.gemini import CHUNK, GeminiGenreClassifier
from genres.protocol import GenreItem
from genres.protocol import GenreVerdict
from server.runner import run_genres

TAXONOMY = [
    {"key": "sports", "parent_key": None, "level": 1,
     "name_en": "Sports", "description": "Sport"},
    {"key": "sports_football", "parent_key": "sports", "level": 2,
     "name_en": "Football", "description": "Football matches"},
]


def item(index: int) -> GenreItem:
    return GenreItem(index, f"فيديو {index}", "وصف", ["كرة"], "17", 60)


def response(answer) -> httpx.Response:
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [
        {"text": json.dumps(answer)}
    ]}}]})


def test_request_enum_matches_due_taxonomy_and_chunks_at_fifty():
    bodies = []

    def handler(request):
        body = json.loads(request.content)
        bodies.append(body)
        count = body["contents"][0]["parts"][0]["text"].count("العنوان:")
        return response([
            {"index": i, "genre_key": "sports_football", "confidence": 0.9}
            for i in range(count)
        ])

    classifier = GeminiGenreClassifier(
        "key", httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _: None
    )
    verdicts = classifier.classify(TAXONOMY, [item(i) for i in range(51)])
    assert CHUNK == 50
    assert len(verdicts) == 51
    assert [b["generationConfig"]["responseSchema"]["items"]["properties"]
            ["genre_key"]["enum"] for b in bodies] == [
                ["sports", "sports_football"], ["sports", "sports_football"]
            ]
    assert [b["contents"][0]["parts"][0]["text"].count("العنوان:") for b in bodies] == [50, 1]


def test_bad_key_is_failed_and_bisected_once():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        body = json.loads(request.content)
        count = body["contents"][0]["parts"][0]["text"].count("العنوان:")
        return response([
            {"index": i, "genre_key": "invented", "confidence": 0.8}
            for i in range(count)
        ])

    classifier = GeminiGenreClassifier(
        "key", httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _: None
    )
    verdicts = classifier.classify(TAXONOMY, [item(0), item(1), item(2), item(3)])
    assert calls == 3
    assert {verdict.error_code for verdict in verdicts} == {"gemini_bad_response"}


def test_real_builder_writes_the_golden_fixture():
    def handler(_request):
        return response([{"index": 0, "genre_key": "sports_football", "confidence": 0.875}])

    classifier = GeminiGenreClassifier(
        "key", httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda _: None
    )
    rows = [{"external_video_id": "video-golden", "title": "نهائي البطولة",
             "description": "ملخص المباراة", "tags": ["كرة القدم"],
             "category_id": "17", "duration_sec": 90}]
    records = classify(
        classifier, TAXONOMY, "genres:v2+gemini-3.6-flash+g1", 2, rows
    )
    fixture = {"batch_key": "golden-genres", "records": records}
    path = Path(__file__).parent / "fixtures" / "golden_genres.json"
    path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    assert json.loads(path.read_text(encoding="utf-8")) == fixture


def test_runner_finishes_blocked_before_classification_when_switch_is_off():
    class Plane:
        committed = False
        finished = None

        def genres_due(self, lease, model_id, prompt_version):
            return {"blocked": "genre_classification_off"}

        def finish(self, lease, outcome, error=None):
            self.finished = (outcome, error)

    class Explodes:
        model_id, prompt_version = "model", "g1"

        def classify(self, taxonomy, items):
            raise AssertionError("the switch must stop the model call")

    plane = Plane()
    assert run_genres(plane, {"lease_token": "lease"}, Explodes()) is True
    assert plane.finished == ("blocked", "genre_classification_off")


def test_runner_commits_one_slice_and_blocks_depleted_credits():
    class Plane:
        committed = []
        finished = None

        def genres_due(self, lease, model_id, prompt_version):
            return {"classification_key": "genres:v2+model+g1", "taxonomy_version": 2,
                    "taxonomy": TAXONOMY,
                    "rows": [{"external_video_id": "v", "title": "t", "description": "",
                              "tags": [], "category_id": None, "duration_sec": None}]}

        def heartbeat(self, lease):
            pass

        def commit_genres(self, lease, key, records):
            self.committed.extend(records)

        def finish(self, lease, outcome, error=None):
            self.finished = (outcome, error)

    class Depleted:
        model_id, prompt_version = "model", "g1"

        def classify(self, taxonomy, items):
            return [GenreVerdict("failed", None, None, "gemini_credits_depleted")]

    plane = Plane()
    run_genres(plane, {"lease_token": "lease"}, Depleted())
    assert len(plane.committed) == 1
    assert plane.finished == ("blocked", "gemini_credits_depleted")
