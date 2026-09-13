"""Choosing which comments a human should label, and why those ones.

Two samples, drawn for two different jobs, and deliberately not pooled.

The ESTIMATE set is a proportionally stratified random sample. It is the only
one an accuracy figure may be computed from, because it is the only one whose
selection does not depend on what the comment says.

The BOOSTER set is purposive: it over-selects comments carrying a contrastive
marker, which is where Mixed sentiment actually lives. It exists so the rare
class can be studied and a model chosen, and it must never be added to the
headline number — selecting on content and then measuring accuracy over the
result reports the sample, not the corpus.
"""
import hashlib
import random
import re
from dataclasses import dataclass, field

from sentiment.preprocess import is_analysable, is_arabic, to_plain_text

# Contrastive markers in MSA and the common dialects. A comment that praises and
# then qualifies is where Mixed lives, and a uniform sample of a corpus that is
# mostly short praise will contain almost none of it.
CONTRASTIVE = re.compile(
    r"(?:^|\W)(?:لكن|لكنّ|ولكن|بس|رغم|بالرغم|مع ذلك|إلا أن|الا ان|غير أن|"
    r"من ناحية|في المقابل|أما|امّا|however|but)(?:\W|$)"
)

SHORT, MEDIUM, LONG = "short", "medium", "long"


def length_band(text: str) -> str:
    n = len(text)
    return SHORT if n < 40 else (MEDIUM if n <= 200 else LONG)


@dataclass(frozen=True)
class Candidate:
    """One unique text, with the context a labeller legitimately needs."""

    row_id: str
    text: str
    # A reply without its parent is unlabellable: "لا أوافق" is not sentiment
    # about anything until you know what it answers.
    context: str | None
    video_id: str
    is_reply: bool
    band: str
    arabic: bool
    # How many identical texts collapsed into this one. Kept so the estimate can
    # be reweighted back to the raw population if that is ever the question.
    duplicates: int = 1


@dataclass
class Draw:
    estimate: list[Candidate] = field(default_factory=list)
    booster: list[Candidate] = field(default_factory=list)
    # Never a silent drop. Each exclusion is a number someone can question.
    excluded: dict[str, int] = field(default_factory=dict)
    collapsed: int = 0
    eligible: int = 0
    shortfall: dict[str, int] = field(default_factory=dict)


def _row_id(plain: str) -> str:
    """Opaque and stable. Not the comment id: the sheet must not be joinable to
    an author by anyone who gets a copy of it."""
    return hashlib.sha256(plain.encode()).hexdigest()[:16]


def eligible_candidates(comments: list[dict]) -> tuple[list[Candidate], dict[str, int], int]:
    """Unique, analysable texts, with every exclusion counted."""
    excluded = {"not_analysable": 0}
    by_text: dict[str, Candidate] = {}
    order: list[str] = []
    parents = {c.get("id"): c for c in comments}
    collapsed = 0
    for c in comments:
        plain = to_plain_text(c.get("text_raw", ""))
        if not is_analysable(plain):
            excluded["not_analysable"] += 1
            continue
        if plain in by_text:
            existing = by_text[plain]
            by_text[plain] = Candidate(
                **{**existing.__dict__, "duplicates": existing.duplicates + 1}
            )
            collapsed += 1
            continue
        parent = parents.get(c.get("parent_comment_id"))
        by_text[plain] = Candidate(
            row_id=_row_id(plain),
            text=plain,
            context=to_plain_text(parent["text_raw"]) if parent else None,
            video_id=str(c.get("video_id", "")),
            is_reply=bool(c.get("is_reply")),
            band=length_band(plain),
            arabic=is_arabic(plain),
        )
        order.append(plain)
    return [by_text[t] for t in order], excluded, collapsed


def _proportional(pool: list[Candidate], size: int, rng: random.Random) -> list[Candidate]:
    """Proportional allocation across videos, largest remainder for the rest.

    Still an unbiased sample of the corpus, but it cannot be swallowed by one
    video that happens to carry half the comments.
    """
    if size >= len(pool):
        return list(pool)
    groups: dict[str, list[Candidate]] = {}
    for c in pool:
        groups.setdefault(c.video_id, []).append(c)
    exact = {v: len(g) * size / len(pool) for v, g in groups.items()}
    take = {v: int(n) for v, n in exact.items()}
    # Hand out what rounding dropped, largest fractional part first; the video
    # id breaks ties so the draw stays reproducible.
    remaining = size - sum(take.values())
    for v, _ in sorted(exact.items(), key=lambda kv: (-(kv[1] % 1), kv[0]))[:remaining]:
        take[v] += 1
    drawn: list[Candidate] = []
    for v, g in groups.items():
        drawn.extend(rng.sample(g, min(take[v], len(g))))
    return drawn


def draw(
    comments: list[dict],
    estimate_size: int = 400,
    booster_size: int = 200,
    seed: int = 0,
) -> Draw:
    pool, excluded, collapsed = eligible_candidates(comments)
    rng = random.Random(seed)
    result = Draw(excluded=excluded, collapsed=collapsed, eligible=len(pool))

    result.estimate = _proportional(pool, estimate_size, rng)
    if len(result.estimate) < estimate_size:
        result.shortfall["estimate"] = estimate_size - len(result.estimate)

    chosen = {c.row_id for c in result.estimate}
    # Disjoint by construction: an item cannot be both an unbiased draw and a
    # content-selected one, and pooling them later would be the mistake this
    # split exists to prevent.
    contrastive = [
        c for c in pool if c.row_id not in chosen and CONTRASTIVE.search(c.text)
    ]
    result.booster = rng.sample(contrastive, min(booster_size, len(contrastive)))
    if len(result.booster) < booster_size:
        result.shortfall["booster"] = booster_size - len(result.booster)

    # Shuffled so consecutive items are not from one video: a labeller who sees
    # thirty comments about the same episode starts labelling the episode.
    rng.shuffle(result.estimate)
    rng.shuffle(result.booster)
    return result
