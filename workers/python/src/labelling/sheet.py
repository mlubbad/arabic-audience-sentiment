"""The file a labeller opens, and the key we keep.

Two files on purpose. The sheet carries only what someone needs to judge the
sentiment of a text; the key carries the join back to the corpus. A sheet that
travels between people should not also be a list of who said what.

What is deliberately absent from the sheet: any model prediction, any existing
label, the author, the like count, and the video. A labeller who can see the
model's answer is no longer an independent measurement of it, and one who can
see the likes is being told which comments matter.
"""
import csv
import io
import re

from .sampling import Candidate

SHEET_COLUMNS = ["row_id", "context", "text", "label", "confidence", "notes"]
KEY_COLUMNS = ["row_id", "set", "video_id", "is_reply", "length_band", "arabic", "duplicates"]

LABELS = ("positive", "negative", "neutral", "mixed", "unclear")

# A cell a spreadsheet would evaluate on open rather than display. Same rule as
# the dashboard export, for the same reason.
FORMULA_START = re.compile(r"^[=+\-@\t\r]")


def cell(value: str) -> str:
    """Neutralise on the way out only; the stored text is never rewritten."""
    return f"'{value}" if FORMULA_START.search(value) else value


def _write(columns: list[str], rows: list[list[str]]) -> str:
    out = io.StringIO()
    # Excel needs CRLF to keep an Arabic cell containing a newline in one cell.
    w = csv.writer(out, lineterminator="\r\n")
    w.writerow(columns)
    w.writerows([[cell(v) for v in row] for row in rows])
    # A BOM, so Excel opens UTF-8 Arabic as Arabic rather than as mojibake.
    return "﻿" + out.getvalue()


def sheet(candidates: list[Candidate]) -> str:
    """The blind file. label/confidence/notes are left empty to be filled in."""
    return _write(
        SHEET_COLUMNS,
        [[c.row_id, c.context or "", c.text, "", "", ""] for c in candidates],
    )


def key(estimate: list[Candidate], booster: list[Candidate]) -> str:
    """Kept by us. Which set an item came from decides how it may be counted."""
    rows = [
        [c.row_id, name, c.video_id, str(c.is_reply).lower(), c.band,
         str(c.arabic).lower(), str(c.duplicates)]
        for name, group in (("estimate", estimate), ("booster", booster))
        for c in group
    ]
    return _write(KEY_COLUMNS, rows)
