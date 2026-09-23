"""Reconstruct the stub's tables from token geometry.

Payroll PDFs draw tables with whitespace, not grid lines, so columns have to
be recovered from position. The reliable signal is that every numeric column
is *right*-aligned: amounts share a right edge to within a pixel or two even
though their left edges vary with digit count. Clustering right edges
therefore recovers the column grid, and each cell is the token whose right
edge sits nearest an anchor.

One wrinkle drives most of the code here. OCR merges text separated by a
narrow gap, so ``Hours`` and ``Rate`` frequently arrive as a single
``"8 51.9953"`` box spanning two columns. :func:`split_words` re-splits those
and apportions the box width by character count, which is approximate but far
finer than the ~200px spacing between column anchors.
"""

from __future__ import annotations

import re
from collections.abc import Container, Iterator
from decimal import Decimal, InvalidOperation

from .models import Token
from .taxonomy import normalize

DATE_RANGE = re.compile(
    # The separator is optional: OCR routinely loses a thin hyphen between two
    # dates. Two dates adjacent with nothing but space between them are a range
    # in every payroll layout seen so far.
    r"(\d{1,2}/\d{1,2}/\d{2,4})\s*(?:[-\u2013\u2014]|to|through)?\s*(\d{1,2}/\d{1,2}/\d{2,4})",
    re.IGNORECASE,
)
_NUMERIC = re.compile(r"^\(?-?\$?\d[\d,]*(?:\.\d+)?\)?-?$")


def tidy_text(text: str) -> str:
    """Restore spaces that OCR dropped between words.

    Recognition sometimes joins adjacent words into ``SickPay`` or
    ``BasicEETermLife``. Splitting on a lower-to-upper transition, and between
    an acronym and a following capitalized word, recovers the printed form.

    This is a display-level repair only; classification runs on a normalized
    string with spaces stripped, so it cannot change how a line is bucketed.
    The rule does split genuine intra-word capitals, rendering a surname like
    ``McDonald`` as ``Mc Donald``.
    """
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", text)
    spaced = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", spaced)
    return re.sub(r"\s{2,}", " ", spaced).strip()


def parse_decimal(text: str) -> Decimal | None:
    """Parse a payroll figure, honoring parentheses and trailing-minus negatives."""
    cleaned = text.strip().replace("$", "").replace(",", "").replace(" ", "")
    if not cleaned:
        return None
    negative = False
    if cleaned.startswith("(") and cleaned.endswith(")"):
        negative, cleaned = True, cleaned[1:-1]
    if cleaned.endswith("-"):
        negative, cleaned = True, cleaned[:-1]
    if cleaned.startswith("-"):
        negative, cleaned = True, cleaned[1:]
    if not cleaned:
        return None
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    return -value if negative else value


def is_numeric(text: str) -> bool:
    return bool(_NUMERIC.match(text.strip()))


def split_words(token: Token) -> list[Token]:
    """Split a multi-word token, apportioning its box by character count."""
    parts = token.text.split()
    if len(parts) <= 1:
        return [token]

    total_chars = len(token.text)
    if total_chars == 0:
        return [token]
    per_char = token.width / total_chars

    out: list[Token] = []
    cursor = 0
    for part in parts:
        start = token.text.index(part, cursor)
        cursor = start + len(part)
        out.append(
            Token(
                text=part,
                x0=token.x0 + start * per_char,
                y0=token.y0,
                x1=token.x0 + cursor * per_char,
                y1=token.y1,
                confidence=token.confidence,
            )
        )
    return out


def _combine(window: list[Token]) -> Token:
    return Token(
        text=" ".join(t.text for t in window),
        x0=window[0].x0,
        y0=min(t.y0 for t in window),
        x1=window[-1].x1,
        y1=max(t.y1 for t in window),
        confidence=min(t.confidence for t in window),
    )


def merge_labels(
    row: list[Token],
    vocabulary: Container[str],
    max_window: int = 4,
) -> list[Token]:
    """Rejoin tokens that spell one known label, such as ``Pay Period Begin``.

    Merging is driven by the caller's vocabulary rather than by the gap between
    tokens. A gap threshold cannot work here: on a real stub the space inside
    ``Pay Period End`` and the gutter separating it from ``Check Date`` differ
    by well under a character width, so any threshold that joins the label also
    welds it to its neighbor. Testing the joined text against known labels is
    exact, and an accidental pairing simply fails to match.

    The longest window wins, so ``Pay Period End`` is preferred over ``Pay``.

    Every token is first broken into words, which makes the same pass repair
    the opposite defect: OCR on a dense header often returns one box reading
    ``Pay Period Begin Pay Period End Check Date``, and re-splitting recovers
    the three labels with their own column bounds. Tokens that already hold
    exactly one label are reassembled unchanged.
    """
    ordered = sorted(
        (word for token in row for word in split_words(token)), key=lambda t: t.x0
    )
    merged: list[Token] = []
    index = 0
    while index < len(ordered):
        for size in range(min(max_window, len(ordered) - index), 0, -1):
            window = ordered[index : index + size]
            if normalize("".join(t.text for t in window)) in vocabulary:
                merged.append(_combine(window) if size > 1 else window[0])
                index += size
                break
        else:
            merged.append(ordered[index])
            index += 1
    return merged


def cluster_values(values: list[float], tolerance: float) -> list[float]:
    """Average together values that sit within ``tolerance`` of each other."""
    clusters: list[list[float]] = []
    for value in sorted(values):
        if clusters and value - clusters[-1][-1] <= tolerance:
            clusters[-1].append(value)
        else:
            clusters.append([value])
    return [sum(group) / len(group) for group in clusters]


def column_anchors(rows: list[list[Token]], tolerance: float = 28.0) -> list[float]:
    """Recover right-edge anchors for the numeric columns of a table.

    Only single-word numeric tokens vote. Multi-word tokens carry synthesized
    boxes from :func:`split_words`, which are good enough to *assign* to a
    column but too coarse to *define* one.
    """
    edges = [
        token.x1
        for row in rows
        for token in row
        if is_numeric(token.text) and " " not in token.text
    ]
    return cluster_values(edges, tolerance)


# Header wording for each numeric column, normalized. Providers label the same
# column very differently ("Amount", "Current", "This Period"), so the grid is
# recovered from whichever wording the stub uses rather than from column count.
COLUMN_SYNONYMS: dict[str, tuple[str, ...]] = {
    "hours": ("hours", "hrs", "currenthours", "hoursunits", "units", "qty", "quantity"),
    "rate": ("rate", "hourlyrate", "payrate", "baserate", "rateofpay"),
    "amount": (
        "amount",
        "current",
        "currentamount",
        "thisperiod",
        "thisperiodamount",
        "currentperiod",
        "currentearnings",
        "earnings",
        "currentpay",
    ),
    "ytd_hours": ("ytdhours", "hoursytd", "ytdhrs", "yeartodatehours"),
    "ytd_amount": (
        "ytdamount",
        "ytd",
        "amountytd",
        "yeartodate",
        "ytdearnings",
        "ytdtotal",
        "yeartodateamount",
    ),
}

COLUMN_VOCABULARY: dict[str, str] = {
    phrase: role for role, phrases in COLUMN_SYNONYMS.items() for phrase in phrases
}


def _segmentations(
    words: list[Token],
    max_window: int,
    limit: int = 4000,
) -> Iterator[list[tuple[str, Token]]]:
    """Yield every way of grouping adjacent header words into known labels.

    Greedy longest-match is not safe for column headers because the vocabulary
    overlaps across boundaries: ``Amount | YTD Hours`` and ``Amount YTD |
    Hours`` are both readable, and the greedy pass takes the wrong one. Yielding
    the alternatives lets the caller pick using the column positions, which is
    the evidence that actually settles it.
    """
    count = 0

    def walk(index: int, picked: list[tuple[str, Token]]) -> Iterator[list]:
        nonlocal count
        if count >= limit:
            return
        if index >= len(words):
            count += 1
            yield list(picked)
            return
        for size in range(min(max_window, len(words) - index), 0, -1):
            window = words[index : index + size]
            role = COLUMN_VOCABULARY.get(normalize("".join(t.text for t in window)))
            if role is None:
                continue
            picked.append((role, _combine(window) if size > 1 else window[0]))
            yield from walk(index + size, picked)
            picked.pop()
        yield from walk(index + 1, picked)  # skip this word entirely

    yield from walk(0, [])


def column_roles(
    header: list[Token],
    anchors: list[float],
    tolerance: float,
) -> list[str | None] | None:
    """Name each numeric column by matching header wording to its right edge.

    Returns one role per anchor, or ``None`` when the header cannot be read
    cleanly enough to trust, which lets the caller fall back to position.

    Header-driven naming is what lets the parser read a layout it was not built
    against: a stub with only ``Current`` and ``YTD``, or one that prints
    ``Rate`` before ``Hours``, is described by its own header rather than being
    assumed from the column count.

    Candidate readings are scored by how well the labels line up with the
    columns the data actually forms, so the header and the table have to agree
    before a reading is accepted.
    """
    words = sorted(
        (word for token in header for word in split_words(token)), key=lambda t: t.x0
    )
    if not words or not anchors:
        return None
    if len(words) > 16:
        words = words[-16:]

    best: tuple[int, float, list[str | None]] | None = None
    for segmentation in _segmentations(words, max_window=3):
        if not segmentation:
            continue
        roles: list[str | None] = []
        total = 0.0
        for anchor in anchors:
            distance, role = min(
                (abs(token.x1 - anchor), role) for role, token in segmentation
            )
            if distance <= tolerance:
                roles.append(role)
                total += distance
            else:
                roles.append(None)

        named = [role for role in roles if role]
        if not named or len(named) != len(set(named)):
            continue
        if "amount" not in named and "ytd_amount" not in named:
            continue
        score = (len(named), -total, roles)
        if best is None or (score[0], score[1]) > (best[0], best[1]):
            best = score

    return best[2] if best else None


def assign_columns(
    row: list[Token],
    anchors: list[float],
    max_distance: float = 55.0,
) -> tuple[dict[int, Token], list[Token]]:
    """Split a row into numeric cells keyed by anchor index, plus leftover text.

    When two tokens claim the same column the nearer one wins; the loser falls
    back to the text remainder rather than being dropped, so nothing recognized
    on the page disappears silently.
    """
    cells: dict[int, Token] = {}
    leftovers: list[Token] = []

    for token in row:
        if not is_numeric(token.text):
            leftovers.append(token)
            continue
        distances = [(abs(token.x1 - anchor), index) for index, anchor in enumerate(anchors)]
        distance, index = min(distances)
        if distance > max_distance:
            leftovers.append(token)
            continue
        incumbent = cells.get(index)
        if incumbent is None:
            cells[index] = token
        elif abs(token.x1 - anchors[index]) < abs(incumbent.x1 - anchors[index]):
            cells[index] = token
            leftovers.append(incumbent)
        else:
            leftovers.append(token)

    leftovers.sort(key=lambda t: t.x0)
    return cells, leftovers


def describe(leftovers: list[Token]) -> tuple[str, str | None]:
    """Split the non-numeric remainder of a row into description and date range."""
    text = " ".join(token.text for token in leftovers).strip()
    dates = None
    match = DATE_RANGE.search(text)
    if match:
        dates = f"{match.group(1)} - {match.group(2)}"
        text = (text[: match.start()] + " " + text[match.end() :]).strip()
    description = text.strip(" :\u2013-\t")
    return tidy_text(description), dates


def label_bands(labels: list[Token]) -> list[tuple[Token, float, float]]:
    """Build horizontal bands spanning from each label to the next."""
    ordered = sorted(labels, key=lambda t: t.x0)
    bands: list[tuple[Token, float, float]] = []
    for index, label in enumerate(ordered):
        right = ordered[index + 1].x0 if index + 1 < len(ordered) else float("inf")
        bands.append((label, label.x0, right))
    return bands


def match_by_right_edge(
    labels: list[Token],
    values: list[Token],
    max_distance: float = 120.0,
) -> dict[str, Token]:
    """Pair right-aligned labels with the values sharing their column edge.

    Band matching fails on these summary boxes: ``Net Pay`` is a short label
    whose left edge sits to the *right* of its own long value, so a value
    would be attributed to the preceding column. The shared right edge is the
    stable relationship.
    """
    out: dict[str, Token] = {}
    used: set[int] = set()
    for label in labels:
        best: tuple[float, int] | None = None
        for index, value in enumerate(values):
            if index in used:
                continue
            distance = abs(value.x1 - label.x1)
            if distance <= max_distance and (best is None or distance < best[0]):
                best = (distance, index)
        if best is not None:
            used.add(best[1])
            out[label.text] = values[best[1]]
    return out
