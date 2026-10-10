"""Extract the ordered borrower roster from a URLA/Form 1003.

The result is deliberately narrow: borrower display names and their source
boxes only.  Stated income and other 1003 values never enter the income
calculation projection.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ai_pdf_converter import PageResult


_NON_ALPHA = re.compile(r"[^a-z]+")
_NAME_LABEL = "namefirstmiddlelastsuffix"
_INVALID_NAME_WORDS = {
    "name", "first", "middle", "last", "suffix", "borrower", "alternate",
    "employer", "business", "creditor", "property", "agency", "loan",
}


def _fold(value: str) -> str:
    return _NON_ALPHA.sub("", value.casefold())


def _is_person_name(value: str) -> bool:
    words = [re.sub(r"[^A-Za-z'\-]", "", word) for word in value.split()]
    words = [word for word in words if word]
    if not 2 <= len(words) <= 6:
        return False
    if any(word.casefold() in _INVALID_NAME_WORDS for word in words):
        return False
    return all(len(word) >= 2 and any(char.isalpha() for char in word) for word in words)


def extract_urla_borrowers(pages: list["PageResult"]) -> list[dict[str, Any]]:
    """Return distinct borrower names in URLA document order.

    The standard URLA prints ``Name (First, Middle, Last, Suffix)`` directly
    above the filled value.  OCR emits each visual row as one bounded item, so
    the closest qualifying row underneath that label is the authoritative
    candidate.  No general page text is retained by this projection.
    """

    borrowers: list[dict[str, Any]] = []
    seen: set[str] = set()
    for page in pages:
        ordered = sorted(page.words, key=lambda word: (word.y, word.x))
        for label in ordered:
            if _NAME_LABEL not in _fold(label.text):
                continue
            candidates = [
                word for word in ordered
                if word.y > label.y
                and word.y - label.y <= 0.035
                and abs(word.x - label.x) <= 0.08
                and word.x < label.x + max(label.w, 0.25)
                and _is_person_name(word.text.strip())
            ]
            if not candidates:
                continue
            candidate = min(candidates, key=lambda word: (word.y - label.y, abs(word.x - label.x)))
            key = _fold(candidate.text)
            if not key or key in seen:
                continue
            seen.add(key)
            borrowers.append({
                "name": candidate.text.strip(),
                "pageIndex": page.index,
                "box": [candidate.x, candidate.y, candidate.w, candidate.h],
            })
    return borrowers[:4]
