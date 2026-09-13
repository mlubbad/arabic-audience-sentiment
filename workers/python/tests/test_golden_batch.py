"""Guards the fixture the TypeScript side consumes.

If the client's payload shape or its canonical hashing changes, this fails here
rather than silently letting the two languages disagree about what a batch is.
"""
import json
from pathlib import Path

from collectors.protocol import RawComment
from server.gateway import build_batch

GOLDEN = Path(__file__).parent / "fixtures" / "golden_batch.json"


def rebuild():
    comments = [
        RawComment("cmt-1", "abcdefghijk", "المحتوى واضح ومفيد", author_name="مؤلف ١",
                   published_time_raw="2026-09-01T09:00:00Z", published_at="2026-09-01T09:00:00Z",
                   timestamp_precision="second", author_channel_id="UCauthor1",
                   likes_raw="12", likes_value=12, source="youtube_data_api_public",
                   field_provenance={"source": "api"}),
        RawComment("cmt-2", "abcdefghijk", "أتمنى تحسين الصوت", parent_id="cmt-1", is_reply=True,
                   parent_source="api", author_name="مؤلف ٢",
                   published_time_raw="2026-09-02T09:00:00Z", published_at="2026-09-02T09:00:00Z",
                   timestamp_precision="second", author_channel_id="UCauthor2",
                   likes_raw=None, likes_value=None, source="youtube_data_api_public",
                   field_provenance={"source": "api"}),
    ]
    golden = json.loads(GOLDEN.read_text())
    return build_batch(
        "abcdefghijk", "حلقة تجريبية", {"page": 1}, "exhausted",
        comments, golden["payload"]["predictions"],
    )


def test_the_client_still_produces_the_fixture_typescript_reads():
    payload, digest = rebuild()
    golden = json.loads(GOLDEN.read_text())
    assert payload == golden["payload"]
    # The digest is the contract between the two languages: a replay is only
    # recognised as identical if both sides canonicalise the same way.
    assert digest == golden["payload_hash"]


def test_the_fixture_exercises_the_cases_worth_carrying_across():
    golden = json.loads(GOLDEN.read_text())["payload"]
    rows = golden["comments"]
    # A reply with a parent, and a top-level row without one.
    assert [r["is_reply"] for r in rows] == [False, True]
    assert rows[1]["external_parent_id"] == "cmt-1"
    # Unknown engagement stays null rather than becoming zero.
    assert rows[1]["likes_value"] is None and rows[1]["likes_raw"] is None
    # Arabic survives the round trip unescaped.
    assert "المحتوى" in rows[0]["text_raw"]
    # The prediction names the exact text it judged.
    assert golden["predictions"][0]["content_hash"] == rows[0]["content_hash"]
