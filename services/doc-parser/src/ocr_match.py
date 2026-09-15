"""OCR-tolerant catalog matching when RapidOCR drops spaces."""

from __future__ import annotations

import re


def folded_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def regex_fold_needles(pattern: str) -> list[str]:
    needles: list[str] = []
    for alt in re.split(r"(?<!\\)\|", pattern or ""):
        head = alt.split(".*")[0]
        text = head.replace(r"\s+", " ").replace(r"\s*", " ").replace(r"\s", " ")
        text = text.replace(r"\.", ".")
        text = re.sub(r"\\[bBdDsSwW]", " ", text)
        text = re.sub(r"\(\?:|[()[\]{}^$?*+\\]", " ", text)
        folded = folded_text(text)
        if len(folded) >= 6 and folded not in needles:
            needles.append(folded)
    return needles


def pattern_matches(matcher: re.Pattern[str], blob: str) -> bool:
    if matcher.search(blob or ""):
        return True
    folded_blob = folded_text(blob)
    return any(needle in folded_blob for needle in regex_fold_needles(matcher.pattern))
