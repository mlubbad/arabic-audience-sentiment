"""Builds a labelling round from a corpus file. Never invoked by installation."""
import argparse
import json
import os
from pathlib import Path

from .sampling import draw
from .sheet import key, sheet


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--corpus", type=Path, required=True,
                   help="JSON with a 'comments' array, as the dashboard fixture has")
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--estimate", type=int, default=400)
    p.add_argument("--booster", type=int, default=200)
    # Recorded in the manifest so a round can be redrawn exactly.
    p.add_argument("--seed", type=int, required=True)
    args = p.parse_args()

    # uv runs this with the working directory set to workers/python, so a path
    # the user typed at the repo root would not resolve. npm records where the
    # command was actually invoked from; without it, paths are taken as given.
    root = Path(os.environ.get("INIT_CWD", "."))
    corpus = args.corpus if args.corpus.is_absolute() else root / args.corpus
    out = args.out if args.out.is_absolute() else root / args.out
    if not corpus.exists():
        raise SystemExit(f"corpus not found: {corpus}")

    comments = json.loads(corpus.read_text())["comments"]
    d = draw(comments, args.estimate, args.booster, args.seed)
    out.mkdir(parents=True, exist_ok=True)
    (out / "estimate-sheet.csv").write_text(sheet(d.estimate), encoding="utf-8")
    (out / "booster-sheet.csv").write_text(sheet(d.booster), encoding="utf-8")
    (out / "key.csv").write_text(key(d.estimate, d.booster), encoding="utf-8")
    manifest = {
        "seed": args.seed,
        "corpus_comments": len(comments),
        "eligible_unique_texts": d.eligible,
        "duplicates_collapsed": d.collapsed,
        "excluded": d.excluded,
        "estimate_drawn": len(d.estimate),
        "booster_drawn": len(d.booster),
        "shortfall": d.shortfall,
        "note": "Accuracy may be reported from the estimate set only. The booster "
                "is selected on content and is for per-class study and model choice.",
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
