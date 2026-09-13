"""Guards the fixture the TypeScript side consumes.

The fixture is the exact request body ControlPlane.commit_batch posts, captured
from the real client through a mock transport. It used to hold only the payload,
and the TypeScript seam test rebuilt the envelope around it by hand — so both
sides reimplemented the envelope and neither checked the other's version of it.
Recording what is actually sent is the only form of this fixture that can catch
a drift in the envelope.
"""
import json
from pathlib import Path

import httpx

from collectors.protocol import Batch, RawComment
from sentiment.deterministic import DeterministicTestAnalyzer
from server.analysis import analyse
from server.gateway import ControlPlane

GOLDEN = Path(__file__).parent / "fixtures" / "golden_batch.json"
LEASE = {
    "job_id": "20000000-0000-4000-8000-000000000001",
    "lease_token": "30000000-0000-4000-8000-000000000001",
}


def rebuild():
    comments = [
        RawComment("cmt-1", "abcdefghijk", "المحتوى واضح ومفيد ﹢", author_name="مؤلف ١",
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
    captured: dict = {}

    def handler(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"replayed": False})

    client = httpx.Client(transport=httpx.MockTransport(handler), base_url="https://control.invalid")
    ControlPlane("https://control.invalid", "worker-credential-value", client).commit_batch(
        LEASE, "abcdefghijk", "حلقة تجريبية",
        Batch(comments=comments, checkpoint="page-2-token", outcome="exhausted"),
        # Produced by the real analyzer, not written by hand. The TypeScript
        # seam test commits this into real SQL, so a record the analyzer builds
        # that the contract or the database would reject fails there.
        analyse(DeterministicTestAnalyzer(), comments),
    )
    return captured


def test_the_client_still_posts_the_envelope_typescript_reads():
    golden = json.loads(GOLDEN.read_text())
    assert rebuild() == golden["envelope"]


def test_the_envelope_is_the_shape_the_wire_contract_describes():
    envelope = json.loads(GOLDEN.read_text())["envelope"]
    # Envelope around payload, never one flat object: the contract says so and
    # this is where that claim is checked against a real request body.
    assert set(envelope) == {"job_id", "lease_token", "batch_key", "payload_hash", "payload"}
    assert set(envelope["payload"]) == {
        "external_video_id", "video_title", "checkpoint", "outcome", "comments", "predictions",
    }
    # No workspace anywhere: the server derives the tenant from the credential.
    assert "workspace_id" not in envelope and "workspace_id" not in envelope["payload"]
    # The key is a prefix of the digest, so a reused key with different rows
    # cannot look like a replay.
    assert envelope["payload_hash"].startswith(envelope["batch_key"])


def test_the_fixture_exercises_the_cases_worth_carrying_across():
    payload = json.loads(GOLDEN.read_text())["envelope"]["payload"]
    rows = payload["comments"]
    # A reply with a parent, and a top-level row without one.
    assert [r["is_reply"] for r in rows] == [False, True]
    assert rows[1]["external_parent_id"] == "cmt-1"
    # Unknown engagement stays null rather than becoming zero.
    assert rows[1]["likes_value"] is None and rows[1]["likes_raw"] is None
    # Arabic survives the round trip unescaped.
    assert "المحتوى" in rows[0]["text_raw"]
    # One verdict per row, each naming the exact text it judged.
    assert [p["external_comment_id"] for p in payload["predictions"]] == ["cmt-1", "cmt-2"]
    assert payload["predictions"][0]["content_hash"] == rows[0]["content_hash"]
    assert payload["predictions"][1]["content_hash"] == rows[1]["content_hash"]
    # A labelled row and an unanalysable one, so the fixture carries both a
    # billable analysis and a result that is explicitly not a neutral verdict.
    assert payload["predictions"][0]["status"] == "succeeded"
    assert payload["predictions"][1]["status"] == "unsupported"
    assert payload["predictions"][1]["label"] is None
    # The checkpoint is the shape the client really sends and the runner really
    # resumes from. The old fixture carried {"page": 1}, which nothing produces.
    assert payload["checkpoint"] == {"cursor": "page-2-token"}
