"""Keep AcroForm / XFA field names and PDF metadata out of the word stream."""

from __future__ import annotations

import re
from typing import Iterable, TypeVar

FIELD_FQN = re.compile(r"\w+\[\d+\](?:\.\w+\[\d+\])+")
FIELD_TAIL = re.compile(r"^f\d+_\d+(?:\[\d+\])?$", re.I)
METADATA_BLOB = re.compile(
    r"topmostSubform|form1\[\d+\]|xfa:|xmpmeta|<\?xml|adobe:ns:meta|"
    r"edge_all_open_tabs|/Type\s*/Metadata",
    re.I,
)

T = TypeVar("T")


def is_form_metadata_noise(text: str) -> bool:
    value = (text or "").strip()
    if not value:
        return True
    if METADATA_BLOB.search(value):
        return True
    if FIELD_FQN.search(value):
        return True
    if FIELD_TAIL.match(value):
        return True
    return False


def scrub_form_metadata_text(text: str) -> str:
    return " ".join(token for token in (text or "").split() if not is_form_metadata_noise(token))


def scrub_words(words: Iterable[T]) -> list[T]:
    return [word for word in words if not is_form_metadata_noise(getattr(word, "text", str(word)))]


def split_field_value(
    value: str,
    x: float,
    y: float,
    w: float,
    h: float,
) -> list[tuple[str, float, float, float, float]]:
    tokens = [token for token in value.strip().split() if token and not is_form_metadata_noise(token)]
    if not tokens:
        return []
    gap = min(0.004, w * 0.02)
    usable = max(w - gap * max(len(tokens) - 1, 0), 0.01)
    letters = sum(len(token) for token in tokens) or 1
    cursor = x
    out: list[tuple[str, float, float, float, float]] = []
    for token in tokens:
        token_w = max((len(token) / letters) * usable, 0.012)
        out.append((token, cursor, y, token_w, max(h, 0.012)))
        cursor += token_w + gap
    return out
