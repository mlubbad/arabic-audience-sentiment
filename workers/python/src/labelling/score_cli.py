"""Scores a model's output against the returned human sheets.

The estimate and booster sets are reported separately and never pooled: only
the estimate set was drawn without regard to what a comment says, so only it can
carry a headline figure.
"""
import argparse
import json
import os
from pathlib import Path

from .score import cohens_kappa, read_labels, read_sets, score


def _render(name: str, report, gate: float) -> dict:
    out = {
        "set": name,
        "macro_f1": round(report.macro_f1, 4),
        "accuracy": round(report.accuracy, 4),
        "accuracy_95_interval": [round(report.accuracy_low, 4), round(report.accuracy_high, 4)],
        "meets_gate": report.meets(gate),
        "per_class": [
            {
                "label": c.label, "support": c.support, "predicted": c.predicted,
                "precision": round(c.precision, 4), "recall": round(c.recall, 4),
                "f1": round(c.f1, 4),
            }
            for c in report.per_class
        ],
        "coverage": report.coverage,
        "confusion": {f"{g}->{p}": n for (g, p), n in sorted(report.confusion.items())},
    }
    if name != "estimate":
        out["note"] = (
            "Selected on content. For per-class study and model choice only; "
            "never quote this as the model's accuracy."
        )
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--gold", type=Path, required=True, help="returned labelling sheet")
    p.add_argument("--predictions", type=Path, required=True, help="row_id,label CSV")
    p.add_argument("--key", type=Path, help="key.csv, to split estimate from booster")
    p.add_argument("--second-labeller", type=Path, help="a second returned sheet, for kappa")
    # The gate is on macro F1 and deliberately has no default that could be
    # mistaken for a blessing: 0.75 is the number the plan commits to.
    p.add_argument("--gate", type=float, default=0.75)
    args = p.parse_args()

    root = Path(os.environ.get("INIT_CWD", "."))
    rd = lambda q: (q if q.is_absolute() else root / q).read_text()  # noqa: E731

    gold = read_labels(rd(args.gold))
    predicted = read_labels(rd(args.predictions))
    sets = read_sets(rd(args.key)) if args.key else {}

    groups = {}
    if sets:
        for name in sorted(set(sets.values())):
            ids = {k for k, v in sets.items() if v == name}
            groups[name] = score({k: v for k, v in gold.items() if k in ids}, predicted)
    else:
        groups["estimate"] = score(gold, predicted)

    result = {"gate_macro_f1": args.gate, "sets": [_render(n, r, args.gate) for n, r in groups.items()]}

    if args.second_labeller:
        k = cohens_kappa(gold, read_labels(rd(args.second_labeller)))
        result["labeller_agreement_kappa"] = (
            None if k is None else round(k, 4)
        )
        result["agreement_note"] = (
            "Undefined: no overlapping rows, or every rater used one category."
            if k is None
            else "Below about 0.6 the label definitions are the problem, not the labellers."
        )
    else:
        result["agreement_note"] = (
            "No second labeller supplied, so label noise is unmeasured and every "
            "figure here inherits that ambiguity."
        )

    print(json.dumps(result, ensure_ascii=False, indent=2))
    headline = groups.get("estimate")
    # Non-zero on a failed gate, so this can sit in a pipeline and mean something.
    raise SystemExit(0 if headline and headline.meets(args.gate) else 1)


if __name__ == "__main__":
    main()
