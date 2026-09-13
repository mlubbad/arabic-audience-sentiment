"""Real inference against a pinned, published Arabic sentiment classifier.

Unlike the deterministic test analyzer beside it, this one performs language
understanding and its output is meant to reach a user. Three things follow from
that, and they are the reason this file is longer than the inference it wraps.

**The revision is pinned to a commit.** `main` moves. A prediction stored today
must stay attributable to exactly the weights that produced it, because the
analysis key that makes predictions unique is built from model, revision,
preprocessing and settings.

**The label mapping is verified against the loaded model, never trusted.** The
registry declares the mapping so it cannot be inferred from output order — but a
declaration is only as good as its agreement with the checkpoint. If the model's
own `id2label` disagrees, every label this adapter produces would be confidently
wrong in a way no test on our side would notice: positives filed as negatives,
an audience reported as hostile. So a mismatch refuses to run.

**A three-class model never reports Mixed.** It has no such class, and emitting
`mixed: 0.0` would present the absence of a class as a measurement of zero.

Inference is injected as a callable returning logits, so every branch here is
testable without downloading half a gigabyte of weights, and `torch` and
`transformers` stay at the edge in `load_pinned`.
"""
import math
import os

from .preprocess import PREPROCESSING_VERSION, is_analysable, to_plain_text
from .protocol import Label, Prediction
from .registry import ModelCard

# Verified against the checkpoint's own config.json at this exact commit:
# id2label == {"0": "positive", "1": "negative", "2": "neutral"}.
# A dialectal-Arabic classifier, which is what YouTube comments actually are;
# the MSA-only variant is a worse fit for the same text.
CAMELBERT_DA_SENTIMENT = ModelCard(
    model_id="CAMeL-Lab/bert-base-arabic-camelbert-da-sentiment",
    revision="b0df630d23e5aa5f8a326017605337f6d0863ecd",
    label_mapping={0: "positive", 1: "negative", 2: "neutral"},
    preprocessing_version=PREPROCESSING_VERSION,
    max_length=256,
)


class LabelMappingMismatch(RuntimeError):
    """The checkpoint does not agree with the mapping we declared for it."""


def verify_mapping(card: ModelCard, id2label: dict) -> None:
    """Refuse a checkpoint whose own labels are not the ones we declared.

    Compared by index and by name. A model with the right names in a different
    order is the dangerous case: it loads, it runs, and every label is wrong.
    """
    actual = {int(k): str(v).strip().lower() for k, v in id2label.items()}
    declared = {int(k): str(v) for k, v in card.label_mapping.items()}
    if actual != declared:
        raise LabelMappingMismatch(
            f"{card.model_id}@{card.revision} reports {actual}, "
            f"but this registry declares {declared}"
        )


def _softmax(logits: list[float]) -> list[float]:
    # Max subtracted first: a large logit would otherwise overflow exp() and
    # turn a confident prediction into nan, which reads as a failure.
    top = max(logits)
    exps = [math.exp(v - top) for v in logits]
    total = sum(exps)
    return [v / total for v in exps]


class LogitsAdapter:
    """Turns per-text logits into predictions the contract accepts."""

    def __init__(self, card: ModelCard, infer):
        self._card = card
        self._infer = infer
        self.model_id = card.model_id
        self.revision = card.revision
        self.label_mapping = card.label_mapping
        self.parameters = card.parameters

    def predict(self, texts: list[str]) -> list[Prediction]:
        plains = [to_plain_text(t) for t in texts]
        # Only analysable rows are sent to the model. An empty or emoji-only
        # comment is skipped rather than pushed through and labelled, because a
        # label on nothing is a label about nothing.
        askable = [i for i, p in enumerate(plains) if is_analysable(p)]
        out: list[Prediction] = [self._nonresult("skipped") for _ in texts]
        if not askable:
            return out
        try:
            logits = self._infer([plains[i] for i in askable])
        except Exception:
            # Inference failed for the batch. Failure is recorded as failure:
            # it is never allowed to become "neutral", which would be a verdict
            # about the audience rather than about the run.
            for i in askable:
                out[i] = self._nonresult("failed")
            return out
        if len(logits) != len(askable):
            for i in askable:
                out[i] = self._nonresult("failed")
            return out
        for i, row in zip(askable, logits):
            out[i] = self._one(row)
        return out

    def _one(self, row: list[float]) -> Prediction:
        if len(row) != len(self.label_mapping):
            return self._nonresult("failed")
        scores = _softmax([float(v) for v in row])
        # Scores cover the classes this model has, and no others. A key for a
        # class it cannot predict would be an invented measurement.
        by_label: dict[str, float] = {
            self.label_mapping[i]: s for i, s in enumerate(scores)
        }
        best: Label = max(by_label, key=lambda k: by_label[k])  # type: ignore[assignment]
        return Prediction(
            status="succeeded",
            label=best,
            scores=by_label,
            model_id=self.model_id,
            revision=self.revision,
        )

    def _nonresult(self, status) -> Prediction:
        return Prediction(
            status=status,
            label=None,
            scores={},
            model_id=self.model_id,
            revision=self.revision,
        )


def load_pinned(card: ModelCard = CAMELBERT_DA_SENTIMENT) -> LogitsAdapter:
    """Load the checkpoint at its pinned revision and check it is what we think.

    Imported here rather than at module scope so the rest of the worker — and
    every test in this suite — runs without torch installed.
    """
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    # Shared hosting caps how many processes and threads an account may have,
    # and torch's OpenMP pool sizes itself from the machine's core count — 18
    # here — which fails outright with "Thread creation failed" before a single
    # comment is read. One thread by default; an operator with room can raise
    # it. Thread count does not change the output, so it is not part of the
    # analysis key: two runs at different widths are the same analysis.
    torch.set_num_threads(int(os.environ.get("SENTIMENT_TORCH_THREADS", "1")))

    tokenizer = AutoTokenizer.from_pretrained(card.model_id, revision=card.revision)
    model = AutoModelForSequenceClassification.from_pretrained(
        card.model_id, revision=card.revision
    )
    verify_mapping(card, model.config.id2label)
    model.eval()

    def infer(texts: list[str]) -> list[list[float]]:
        batch = tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=card.max_length,
            return_tensors="pt",
        )
        with torch.no_grad():
            return model(**batch).logits.tolist()

    return LogitsAdapter(card, infer)
