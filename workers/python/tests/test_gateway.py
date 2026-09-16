import json

import httpx
import pytest

from collectors.protocol import Batch, RawComment
from server.gateway import ControlPlane, ControlPlaneError, LeaseLost, build_batch, finish_status

CRED = "worker-credential-value"
BASE = "https://control.invalid"


def comment(identifier="c1", text="تعليق"):
    return RawComment(identifier, "abcdefghijk", text, author_name="مؤلف", likes_value=3, likes_raw="3")


def plane(handler):
    client = httpx.Client(transport=httpx.MockTransport(handler), base_url=BASE)
    return ControlPlane(BASE, CRED, client)


def test_payload_matches_the_contract_and_hashes_stably():
    payload, digest = build_batch("abcdefghijk", "حلقة", {"page": 1}, "partial", [comment()], [])
    assert set(payload) == {
        "external_video_id", "video_title", "checkpoint", "outcome", "comments", "predictions",
    }
    row = payload["comments"][0]
    assert row["external_comment_id"] == "c1"
    assert row["text_plain"] and row["content_hash"] and len(row["content_hash"]) == 64
    # The same content in a different insertion order must hash identically, or
    # a replay would look like a different payload and be rejected as a conflict.
    shuffled = dict(reversed(list(payload.items())))
    assert build_batch("abcdefghijk", "حلقة", {"page": 1}, "partial", [comment()], [])[1] == digest
    assert json.dumps(shuffled, sort_keys=True) == json.dumps(payload, sort_keys=True)
    assert len(digest) == 64


def test_only_an_exhausted_source_becomes_a_success():
    assert finish_status("exhausted") == "succeeded"
    assert finish_status("partial") == "partial"
    assert finish_status("blocked") == "blocked"
    assert finish_status("failed") == "failed"
    # Nothing else may map to succeeded, whatever a collector invents.
    assert all(finish_status(o) != "succeeded" for o in ("partial", "blocked", "failed"))
    with pytest.raises(ValueError):
        finish_status("nearly_done")


def test_the_credential_is_sent_as_a_bearer_and_never_leaks_into_errors():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(500, json={"code": "server_error"})

    with pytest.raises(ControlPlaneError) as raised:
        plane(handler).claim()
    assert seen["auth"] == f"Bearer {CRED}"
    assert CRED not in str(raised.value)
    assert BASE not in str(raised.value)


def test_no_work_is_not_an_error():
    assert plane(lambda r: httpx.Response(204)).claim() is None


def test_distinct_server_refusals_stay_distinct():
    def refuse(code, status):
        return lambda r: httpx.Response(status, json={"code": code})

    lease = {"job_id": "j", "lease_token": "t"}
    with pytest.raises(LeaseLost):
        plane(refuse("lease_lost", 409)).heartbeat(lease)
    for code, status, retryable in [
        ("batch_conflict", 409, False),
        ("quota_exceeded", 429, False),
        ("invalid_batch", 400, False),
    ]:
        with pytest.raises(ControlPlaneError) as raised:
            plane(refuse(code, status)).commit_batch(
                lease, "abcdefghijk", None, Batch([comment()], None, "partial")
            )
        assert raised.value.code == code
        assert raised.value.retryable is retryable


def test_a_full_run_claims_commits_and_finishes_explicitly():
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if request.url.path.endswith("/claim"):
            return httpx.Response(200, json={"job_id": "j1", "lease_token": "t1", "checkpoint": None})
        body = json.loads(request.content)
        if request.url.path.endswith("/commit-batch"):
            assert len(body["payload_hash"]) == 64
            # The worker never tells the server which tenant to write to.
            assert "workspace_id" not in body and "workspace_id" not in body["payload"]
            return httpx.Response(200, json={"replayed": False})
        if request.url.path.endswith("/finish"):
            assert body["outcome"] == "succeeded"
            return httpx.Response(200, json={})
        return httpx.Response(200, json={})

    control = plane(handler)
    lease = control.claim()
    assert lease["job_id"] == "j1"
    control.heartbeat(lease)
    control.commit_batch(lease, "abcdefghijk", "حلقة", Batch([comment()], None, "exhausted"))
    control.finish(lease, "exhausted")
    assert [c.rsplit("/", 1)[-1] for c in calls] == ["claim", "heartbeat", "commit-batch", "finish"]


def test_video_counts_posts_each_count_under_the_lease_and_returns_the_answer():
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"read": ["abcdefghijk"], "unchanged": 1, "updated": 2})

    lease = {"job_id": "j", "lease_token": "t"}
    answer = plane(handler).video_counts(lease, {"abcdefghijk": 3, "bcdefghijkl": None})
    assert seen["path"].endswith("/worker/video-counts")
    assert seen["body"]["job_id"] == "j" and seen["body"]["lease_token"] == "t"
    # A dict of id -> count on this side; the server's list shape on the
    # wire, with None carried as null rather than dropped: a null is an
    # answer ("the source did not say"), and the server keeps that video due.
    assert seen["body"]["payload"] == [
        {"external_video_id": "abcdefghijk", "comment_count": 3},
        {"external_video_id": "bcdefghijkl", "comment_count": None},
    ]
    assert "workspace_id" not in seen["body"]
    assert answer == {"read": ["abcdefghijk"], "unchanged": 1, "updated": 2}


def test_video_counts_refusals_stay_refusals():
    lease = {"job_id": "j", "lease_token": "t"}
    with pytest.raises(ControlPlaneError) as raised:
        plane(lambda r: httpx.Response(400, json={"code": "invalid_counts"})).video_counts(lease, {})
    assert raised.value.code == "invalid_counts" and raised.value.retryable is False
    # An older gateway without the route: still an error the caller can fall
    # back from, never an empty "read" list that would read nothing.
    with pytest.raises(ControlPlaneError) as raised:
        plane(lambda r: httpx.Response(404, json={"code": "not_found"})).video_counts(lease, {})
    assert raised.value.code == "not_found"
