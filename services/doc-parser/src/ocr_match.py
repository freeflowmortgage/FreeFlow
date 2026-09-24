"""OCR-tolerant catalog matching when RapidOCR drops spaces."""

from __future__ import annotations

import re

_MIN_NEEDLE_CHARS = 6
"""Shorter folded text matches almost anything and is not evidence of a form."""


def folded_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def _fold_literal(raw: str) -> str:
    """Reduce one literal run of a regex to comparable folded text."""
    text = raw.replace(r"\s+", " ").replace(r"\s*", " ").replace(r"\s", " ")
    text = text.replace(r"\.", ".")
    text = re.sub(r"\\[bBdDsSwW]", " ", text)
    text = re.sub(r"\(\?:|[()[\]{}^$?*+\\]", " ", text)
    return folded_text(text)


def _top_level_alternatives(pattern: str) -> list[str]:
    """Split on ``|`` outside groups and character classes.

    A plain split broke ``Year to Date (?:Gross|Earnings)`` into a bare
    ``Earnings)`` alternative, so any page with the word "earnings" (Form
    1120 page 3, "undistributed earnings") read as a pay stub.
    """
    parts: list[str] = []
    depth = 0
    in_class = False
    current: list[str] = []
    index = 0
    while index < len(pattern):
        char = pattern[index]
        if char == "\\" and index + 1 < len(pattern):
            current.append(pattern[index : index + 2])
            index += 2
            continue
        if in_class:
            in_class = char != "]"
        elif char == "[":
            in_class = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif char == "|" and depth == 0:
            parts.append("".join(current))
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    parts.append("".join(current))
    return parts


def fold_alternatives(pattern: str) -> list[list[str]]:
    """Fold a regex into one list of literal segments per top-level alternative.

    Segments come from splitting on ``.*``, and all of an alternative's
    segments must appear, in order, for it to match. Keeping only the text
    before the first ``.*`` made ``Schedule C.*Profit or Loss From Business``
    match on the word ``schedulec`` alone, so a Schedule E page that merely
    referred to Schedule C was classified as one, given a Schedule C field
    catalog, and put a Sch C tab in front of the underwriter.
    """
    alternatives: list[list[str]] = []
    for alt in _top_level_alternatives(pattern or ""):
        # A group with its own alternation, "(?:Gross|Earnings)", has no single
        # literal to require, so it becomes a gap between its neighbours.
        alt = re.sub(r"\((?:\?:)?[^()]*(?<!\\)\|[^()]*\)", ".*", alt)
        segments = [folded for raw in alt.split(".*") if (folded := _fold_literal(raw))]
        if sum(len(segment) for segment in segments) >= _MIN_NEEDLE_CHARS:
            alternatives.append(segments)
    return alternatives


def regex_fold_needles(pattern: str) -> list[str]:
    """Leading folded needle per alternative. Kept for callers that want a hint."""
    return [segments[0] for segments in fold_alternatives(pattern) if segments]


MAX_WILDCARD_GAP = 120
"""How much folded text a `.*` may span between two literal segments.

A form title and its subtitle sit within a line or two of each other. Letting a
wildcard run the length of a page made unrelated text satisfy a rule: Schedule
E page 1 mentions "on page 2, line 40" in its instructions and carries
"Schedule E (Form 1040)" in the footer, which together matched the page 2 rule
and routed a rental page onto the partnership tab.
"""


def _contains_in_order(blob: str, segments: list[str], max_gap: int = MAX_WILDCARD_GAP) -> bool:
    if not segments:
        return False
    start = blob.find(segments[0])
    while start >= 0:
        position = start + len(segments[0])
        matched = True
        for segment in segments[1:]:
            found = blob.find(segment, position)
            if found < 0 or found - position > max_gap:
                matched = False
                break
            position = found + len(segment)
        if matched:
            return True
        # The first segment can repeat; a later occurrence may sit closer to
        # the rest of the title.
        start = blob.find(segments[0], start + 1)
    return False


def pattern_matches(matcher: re.Pattern[str], blob: str) -> bool:
    if matcher.search(blob or ""):
        return True

    folded_blob = folded_text(blob)
    return any(
        _contains_in_order(folded_blob, segments)
        for segments in fold_alternatives(matcher.pattern)
    )
