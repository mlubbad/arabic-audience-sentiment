"""An analyse job, over a synthetic control plane."""
import hashlib
import json

import httpx

from server.gateway import ControlPlane
from server.runner import run_job
from topics.deterministic import DeterministicTestClassifier
from topics.protocol import TopicVerdict

KEY = "topics:v1+deterministic-test-classifier+t1"
TAX = [{"key": "question", "description": "asks"}, {"key": "praise", "description": "thanks"}]


class Plane:
    def __init__(self, due=(), active=True, refuse_commit=None, blocked=None):
        self.due_lists = [list(d) for d in due]
        self.active, self.refuse_commit, self.blocked = active, refuse_commit, blocked
        self.calls, self.committed, self.finished = [], [], None

    def handler(self, request):
        path = request.url.path.rsplit("/", 1)[-1]
        self.calls.append(path)
        body = json.loads(request.content) if request.content else {}
        if path == "claim":
            return httpx.Response(200, json={"job_id": "j1", "lease_token": "t1", "type": "analyse",
                                             "checkpoint": None, "access_token": None})
        if path == "topics-due":
            assert body["model_id"] == "deterministic-test-classifier"
            rows = self.due_lists.pop(0) if self.due_lists else []
            reply = {"classification_key": KEY, "active": self.active, "taxonomy": TAX, "rows": rows}
            if self.blocked:
                reply.update(rows=[], taxonomy=[], blocked=self.blocked)
            return httpx.Response(200, json=reply)
        if path == "commit-topics":
            self.committed.append(body)
            if self.refuse_commit:
                return httpx.Response(429, json={"code": self.refuse_commit})
            return httpx.Response(200, json={"replayed": False, "stored": len(body["records"])})
        if path == "finish":
            self.finished = (body["outcome"], body.get("error_code"))
        return httpx.Response(200, json={})

    def plane(self):
        return ControlPlane("https://c.invalid", "cred", httpx.Client(transport=httpx.MockTransport(self.handler)))


def row(i, text="نص"):
    return {"external_comment_id": f"c{i}", "content_hash": f"h{i}", "text": text, "parent_text": None, "is_reply": False}


def test_classifies_until_the_due_list_is_empty_then_succeeds():
    plane = Plane(due=[[row(1), row(2)], [row(3)], []])
    assert run_job(plane.plane(), None, classifier=DeterministicTestClassifier()) is True
    assert [c["records"][0]["external_comment_id"] for c in plane.committed] == ["c1", "c3"]
    assert plane.committed[0]["records"][0]["classification_key"] == KEY
    assert plane.finished == ("succeeded", None)
    assert plane.calls.count("heartbeat") >= 2
    # The batch key names the round, the slice and the sorted ids: a replay of
    # the same slice in the same round replays, a later round's attempt at the
    # same rows (after an outage) is a new batch rather than a batch_conflict.
    expected = hashlib.sha256("1:0:c1,c2".encode()).hexdigest()[:32]
    assert plane.committed[0]["batch_key"] == expected
    assert plane.committed[1]["batch_key"] == hashlib.sha256("2:0:c3".encode()).hexdigest()[:32]


def test_no_classifier_blocks_the_job_and_says_why():
    plane = Plane(due=[[row(1)]])
    assert run_job(plane.plane(), None, classifier=None) is True
    assert plane.committed == []
    assert plane.finished == ("blocked", "no_topic_classifier")


def test_an_inactive_model_blocks_the_job():
    plane = Plane(due=[[]], active=False)
    run_job(plane.plane(), None, classifier=DeterministicTestClassifier())
    assert plane.finished == ("blocked", "topic_model_not_active")


def test_a_failed_item_makes_the_job_partial_with_the_first_code():
    class Flaky:
        model_id, prompt_version = "deterministic-test-classifier", "t1"

        def classify(self, taxonomy, items):
            return [TopicVerdict("failed", None, None, "gemini_rate_limited") if i.index == 0
                    else TopicVerdict("succeeded", "praise", 0.9, None) for i in items]

    plane = Plane(due=[[row(1), row(2)], []])
    run_job(plane.plane(), None, classifier=Flaky())
    assert [r["status"] for r in plane.committed[0]["records"]] == ["failed", "succeeded"]
    assert plane.finished == ("partial", "gemini_rate_limited")


def test_quota_exhausted_blocks_without_looping():
    plane = Plane(due=[[row(1)], [row(1)]], refuse_commit="quota_exceeded")
    run_job(plane.plane(), None, classifier=DeterministicTestClassifier())
    assert len(plane.committed) == 1
    assert plane.finished == ("blocked", "quota_exceeded")


def test_a_due_list_that_never_shrinks_stops_after_a_bound():
    # A server that keeps returning the same rows (a bug) must not spin forever.
    plane = Plane(due=[[row(1)]] * 100)
    run_job(plane.plane(), None, classifier=DeterministicTestClassifier())
    assert len(plane.committed) <= 50
    assert plane.finished[0] == "partial"


def test_a_round_with_no_final_verdict_ends_the_job_after_one_round():
    # Nothing stored can shrink the due list, so asking again would re-send
    # the same rows to Gemini until the round bound. One round, then partial.
    class Down:
        model_id, prompt_version = "deterministic-test-classifier", "t1"

        def classify(self, taxonomy, items):
            return [TopicVerdict("failed", None, None, "gemini_unavailable") for _ in items]

    plane = Plane(due=[[row(1), row(2)], [row(1), row(2)], [row(1), row(2)]])
    run_job(plane.plane(), None, classifier=Down())
    assert plane.calls.count("topics-due") == 1
    assert len(plane.committed) == 1
    assert plane.finished == ("partial", "gemini_unavailable")


def test_a_due_list_is_committed_in_slices_of_twenty_five():
    # One Gemini chunk, one commit: a failure late in the list does not
    # discard the verdicts already paid for earlier in it.
    plane = Plane(due=[[row(i) for i in range(30)], []])
    run_job(plane.plane(), None, classifier=DeterministicTestClassifier())
    assert [len(c["records"]) for c in plane.committed] == [25, 5]
    assert plane.committed[0]["records"][0]["external_comment_id"] == "c0"
    assert plane.committed[1]["records"][0]["external_comment_id"] == "c25"
    first = ",".join(sorted(f"c{i}" for i in range(25)))
    assert plane.committed[0]["batch_key"] == hashlib.sha256(f"1:0:{first}".encode()).hexdigest()[:32]
    second = ",".join(sorted(f"c{i}" for i in range(25, 30)))
    assert plane.committed[1]["batch_key"] == hashlib.sha256(f"1:25:{second}".encode()).hexdigest()[:32]
    # A heartbeat before every slice, not only before the round.
    assert plane.calls.count("heartbeat") >= 2
    assert plane.finished == ("succeeded", None)


def test_a_blocked_due_list_ends_the_job_blocked_before_any_model_call():
    # The server found rows to classify but no allowance to pay for them. The
    # worker must not send them to Gemini and then learn that at commit time.
    plane = Plane(due=[[row(1)]], blocked="quota_exceeded")
    run_job(plane.plane(), None, classifier=DeterministicTestClassifier())
    assert plane.committed == []
    assert plane.finished == ("blocked", "quota_exceeded")
