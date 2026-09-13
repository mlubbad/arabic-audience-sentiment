"""Scores a model against the human-labelled set, and reports what it cannot score.

The headline is **macro F1**, not accuracy, and the distinction is the whole
point. A model can reach 0.80 accuracy on a corpus that is mostly praise while
being useless on negative comments — and negative is what a customer pays to
find. Accuracy hides that; macro F1 does not, because every class weighs the
same however rare it is.

Implemented here rather than pulled in, so the worker keeps its single
dependency and every number is auditable in the place it is reported.
"""
import csv
import io
import math
from dataclasses import dataclass, field

LABELS = ("positive", "negative", "neutral", "mixed")
# A gold row a human could not label is not a model error. It is coverage, and
# folding it into either side of the ratio misstates what the model can do.
UNSCORABLE = ("unclear", "")


@dataclass(frozen=True)
class ClassScore:
    label: str
    support: int
    predicted: int
    precision: float
    recall: float
    f1: float


@dataclass
class Report:
    macro_f1: float = 0.0
    accuracy: float = 0.0
    accuracy_low: float = 0.0
    accuracy_high: float = 0.0
    scored: int = 0
    per_class: list[ClassScore] = field(default_factory=list)
    confusion: dict = field(default_factory=dict)
    # Everything that did not reach the ratio, counted rather than dropped.
    coverage: dict = field(default_factory=dict)

    def meets(self, gate: float) -> bool:
        """The decision gate is on macro F1. Accuracy never decides this."""
        return self.macro_f1 >= gate


def read_labels(text: str, column: str = "label") -> dict[str, str]:
    rows = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    return {r["row_id"]: (r.get(column) or "").strip().lower() for r in rows if r.get("row_id")}


def read_sets(key_text: str) -> dict[str, str]:
    """row_id -> which sample it came from. Decides what may be scored together."""
    rows = csv.DictReader(io.StringIO(key_text.lstrip("﻿")))
    return {r["row_id"]: r["set"] for r in rows if r.get("row_id")}


def wilson(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """95% interval for a proportion.

    Wilson rather than the normal approximation: at the extremes the textbook
    interval runs past 0 or 1 and reports impossible bounds, which is exactly
    where a rare class lands.
    """
    if total == 0:
        return (0.0, 0.0)
    p = successes / total
    d = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / d
    half = z / d * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return (max(0.0, centre - half), min(1.0, centre + half))


def score(gold: dict[str, str], predicted: dict[str, str]) -> Report:
    report = Report()
    unclear = sum(1 for v in gold.values() if v in UNSCORABLE)
    missing_prediction = [k for k, v in gold.items() if v not in UNSCORABLE and k not in predicted]
    unknown_rows = [k for k in predicted if k not in gold]

    pairs = [
        (gold[k], predicted[k])
        for k in gold
        if gold[k] not in UNSCORABLE and k in predicted
    ]
    report.coverage = {
        "gold_rows": len(gold),
        "unclear": unclear,
        "missing_prediction": len(missing_prediction),
        "predicted_rows_not_in_gold": len(unknown_rows),
        "scored": len(pairs),
    }
    report.scored = len(pairs)
    if not pairs:
        return report

    report.confusion = {}
    for g, p in pairs:
        report.confusion[(g, p)] = report.confusion.get((g, p), 0) + 1

    correct = sum(1 for g, p in pairs if g == p)
    report.accuracy = correct / len(pairs)
    report.accuracy_low, report.accuracy_high = wilson(correct, len(pairs))

    # Every class the gold set contains is averaged, including one the model
    # never predicts — that scores zero rather than vanishing. Dropping it is
    # precisely how a model that cannot find negatives reports a good average.
    classes = sorted({g for g, _ in pairs} | set(LABELS) & {p for _, p in pairs})
    for label in classes:
        tp = sum(1 for g, p in pairs if g == label and p == label)
        fp = sum(1 for g, p in pairs if g != label and p == label)
        fn = sum(1 for g, p in pairs if g == label and p != label)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        report.per_class.append(
            ClassScore(label, tp + fn, tp + fp, precision, recall, f1)
        )

    # Averaged over the classes actually present in the gold set: a class nobody
    # labelled was never measured, and inventing a zero for it would understate
    # the model as surely as omitting a missed class overstates it.
    present = [c for c in report.per_class if c.support > 0]
    report.macro_f1 = sum(c.f1 for c in present) / len(present) if present else 0.0
    return report


def cohens_kappa(a: dict[str, str], b: dict[str, str]) -> float | None:
    """Agreement between two labellers, corrected for agreement by chance.

    None when it cannot be computed, which is two distinct cases and both are
    real: no overlapping rows to compare, or every rater used a single category
    so chance agreement is already total and the statistic is 0/0. Reporting 1.0
    there would read as "perfect agreement, trust these labels"; reporting 0.0
    would read as "no better than chance". Neither is true, so the caller is
    told it is undefined and why.

    Without this number there is no way to separate model error from label
    noise, and every figure downstream inherits that ambiguity.
    """
    shared = [(a[k], b[k]) for k in a if k in b and a[k] and b[k]]
    if not shared:
        return None
    n = len(shared)
    observed = sum(1 for x, y in shared if x == y) / n
    labels = {x for x, _ in shared} | {y for _, y in shared}
    expected = sum(
        (sum(1 for x, _ in shared if x == c) / n) * (sum(1 for _, y in shared if y == c) / n)
        for c in labels
    )
    if expected >= 1.0:
        return None
    return (observed - expected) / (1 - expected)
