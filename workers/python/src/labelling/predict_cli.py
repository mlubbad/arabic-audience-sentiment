"""Runs a candidate model over a sheet of texts and writes its verdicts.

Separate from the worker on purpose: this is evaluation, not production. It
writes a plain `row_id,label` file that `label:score` reads, so a candidate is
compared against the human set through exactly the same scorer that judges the
model in use — a comparison where each side was measured differently is not a
comparison.

A row the model skips or fails on is written with an empty label rather than a
guess. The scorer counts those as coverage, and a model that declines half the
sheet should not look accurate on the half it answered.
"""
import argparse
import csv
import sys
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--texts", required=True, help="CSV with row_id,text")
    p.add_argument("--model", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--batch", type=int, default=16)
    args = p.parse_args()

    from sentiment.transformer import CANDIDATES, load_pinned

    if args.model not in CANDIDATES:
        raise SystemExit(f"unknown model; choose from {sorted(CANDIDATES)}")
    card = CANDIDATES[args.model]
    print(f"loading {card.model_id}@{card.revision[:12]}", file=sys.stderr)
    adapter = load_pinned(card)

    rows = list(csv.DictReader(Path(args.texts).read_text().lstrip("﻿").splitlines()))
    out = []
    for start in range(0, len(rows), args.batch):
        chunk = rows[start : start + args.batch]
        for row, pred in zip(chunk, adapter.predict([r["text"] for r in chunk])):
            out.append((row["row_id"], pred.label or "", pred.status))
        print(f"  {min(start + args.batch, len(rows))}/{len(rows)}", file=sys.stderr)

    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["row_id", "label", "status"])
        w.writerows(out)
    answered = sum(1 for _, label, _ in out if label)
    print(f"{answered}/{len(out)} answered -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
