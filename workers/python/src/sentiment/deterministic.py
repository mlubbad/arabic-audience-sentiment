"""DETERMINISTIC TEST ANALYZER — NOT A SENTIMENT MODEL.

Exists so pipeline behaviour (skipping, failures, Mixed, provenance) can be tested
without downloading weights. It performs no language understanding and its output
must never be presented to a user as a model prediction.
"""
from .preprocess import PREPROCESSING_VERSION, is_analysable, to_plain_text
from .protocol import Prediction
from .registry import ModelCard

TEST_CARD = ModelCard(
    model_id="deterministic-test-analyzer",
    revision="not-a-model-v1",
    label_mapping={0: "positive", 1: "negative", 2: "neutral", 3: "mixed"},
    preprocessing_version=PREPROCESSING_VERSION,
)

_MARKERS = {"positive": "﹢", "negative": "﹣", "neutral": "﹦", "mixed": "﹙"}


class DeterministicTestAnalyzer:
    """Labels by an explicit marker character. Unmarked text is 'unsupported'."""

    model_id = TEST_CARD.model_id
    revision = TEST_CARD.revision
    label_mapping = TEST_CARD.label_mapping
    parameters = TEST_CARD.parameters

    def predict(self, texts: list[str]) -> list[Prediction]:
        out = []
        for raw in texts:
            plain = to_plain_text(raw)
            if not is_analysable(plain):
                out.append(self._nonresult("skipped"))
                continue
            label = next((k for k, m in _MARKERS.items() if m in plain), None)
            if label is None:
                # No guess, and explicitly not neutral.
                out.append(self._nonresult("unsupported"))
                continue
            out.append(Prediction(status="succeeded", label=label,
                                  scores={k: float(k == label) for k in _MARKERS},
                                  model_id=self.model_id, revision=self.revision))
        return out

    def _nonresult(self, status):
        return Prediction(status=status, label=None, scores={},
                          model_id=self.model_id, revision=self.revision)
