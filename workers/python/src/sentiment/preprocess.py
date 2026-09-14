"""Analysis-text preparation. Preserves negation, emoji and dialect letters."""
import html
import re
import unicodedata

_TAG = re.compile(r"<[^>]+>")
_BR = re.compile(r"<\s*br\s*/?\s*>", re.IGNORECASE)
_SPACE = re.compile(r"[ \t ‏‎]+")
_BLANK = re.compile(r"\n{3,}")
_AROUND_NEWLINE = re.compile(r" *\n *")
_ARABIC = re.compile(r"[؀-ۿݐ-ݿ]")

PREPROCESSING_VERSION = "strip-html-normalize-space-v1"

_TASHKEEL = re.compile(r"[\u064B-\u0652\u0670]")
_TATWEEL = re.compile(r"\u0640+")
_REPEATED_CHARS = re.compile(r"(.)\1{2,}", re.DOTALL)


def strip_tashkeel(text: str) -> str:
    """Remove Arabic diacritics (fatḥah, ḍammah, kasrah, sukūn, shaddah, tanwīn)."""
    return _TASHKEEL.sub("", text)


def strip_tatweel(text: str) -> str:
    """Remove Arabic kashida/tatweel (ـ)."""
    return _TATWEEL.sub("", text)


def reduce_elongation(text: str) -> str:
    """Reduce 3 or more consecutive identical characters to 2 (e.g. راااائع -> راائع)."""
    return _REPEATED_CHARS.sub(r"\1\1", text)


def normalize_arabic_text(text: str) -> str:
    """Cleans and normalizes Arabic text while preserving emoji, dialect, and negation."""
    plain = to_plain_text(text)
    plain = strip_tatweel(plain)
    plain = reduce_elongation(plain)
    return plain


def to_plain_text(raw: str) -> str:
    """HTML is removed for analysis only; the raw text is stored untouched."""
    text = _BR.sub("\n", raw)
    text = _TAG.sub(" ", text)
    # Entities are decoded after tag removal so an encoded tag cannot reappear.
    text = html.unescape(text)
    text = _TAG.sub(" ", text)
    text = unicodedata.normalize("NFC", text)
    text = _SPACE.sub(" ", text)
    # Removing a tag leaves a filler space; it must not survive next to a line break.
    text = _AROUND_NEWLINE.sub("\n", text)
    return _BLANK.sub("\n\n", text).strip()


def is_analysable(text: str) -> bool:
    """Empty and whitespace-only texts are skipped, never scored as neutral."""
    return bool(text and text.strip())


def is_arabic(text: str) -> bool:
    """Flags non-Arabic text for separate evaluation; it is not a rejection."""
    return _ARABIC.search(text) is not None

