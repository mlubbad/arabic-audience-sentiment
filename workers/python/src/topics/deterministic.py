"""DETERMINISTIC TEST CLASSIFIER — NOT A TOPIC MODEL.

Exists so the pipeline (chunking, records, metering, job outcomes) can be tested
without a network. It hashes the text and picks a topic by the hash; it
understands nothing and its output must never be shown as a model verdict.
"""
import hashlib

from .protocol import TopicItem, TopicVerdict


class DeterministicTestClassifier:
    model_id = "deterministic-test-classifier"
    prompt_version = "t1"

    def classify(self, taxonomy: list[dict], items: list[TopicItem]) -> list[TopicVerdict]:
        keys = [t["key"] for t in taxonomy]
        out = []
        for item in items:
            digest = hashlib.sha256((item.text or "").encode()).digest()
            out.append(TopicVerdict("succeeded", keys[digest[0] % len(keys)], 1.0, None))
        return out
