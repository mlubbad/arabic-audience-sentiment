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
