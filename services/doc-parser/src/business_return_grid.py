"""Form 1065 / 1120-S return and Schedule K-1 cells from the official blanks.

templates/business_return_fields.json pins every figure the Form 1084
business-income calculation reads to its cell on the IRS fillable blank, next
to the caption that cell must sit beside. This module reads those cells.

A cell is only trusted after its caption is found where the blank puts it,
allowing a small vertical drift for scans and tax-software margins. A page
whose caption is not there (a different revision, a software substitute form,
a badly skewed scan) yields nothing for that field, and the label-anchored
catalog in irs_form_extract.py reads it instead.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from ocr_match import pattern_matches
from schedule_e_grid import TEMPLATE_DIR, _clip_text, parse_tax_amount, relative_box

logger = logging.getLogger("freeflow.business_return")

MAP_PATH = TEMPLATE_DIR / "business_return_fields.json"

ROW_TOLERANCE = 4.0
ABOVE_REACH = 16.0
COLUMN_REACH = 48.0
# Scans and software-printed returns sit a few points off the blank. Wider
# than this and a neighbouring line's caption starts to match.
MAX_DRIFT = 9.0
DRIFT_STEP = 1.0

OTHER_INCOME_NOTE = (
    "Other income (loss) is reported on {form} {line}: {value}. It is removed from "
    "qualifying income. Obtain the statement and confirm whether any of it is "
    "recurring before adding it back."
)

# form key in the map -> (form label, field -> source id)
SOURCE_IDS: dict[str, tuple[str, dict[str, str]]] = {
    "1065": (
        "Form 1065",
        {
            "ordinary_income": "pt-return-ord",
            "gain_4797": "pt-return-4797",
            "other_income": "pt-return-other",
            "depreciation": "pt-return-dep",
            "meals": "pt-return-meals",
        },
    ),
    "1120s": (
        "Form 1120-S",
        {
            "ordinary_income": "scorp-return-ord",
            "gain_4797": "scorp-return-4797",
            "other_income": "scorp-return-other",
            "depreciation": "scorp-return-dep",
            "meals": "scorp-return-meals",
        },
    ),
    "1065-k1": (
        "Form 1065",
        {
            "ordinary_income": "pt-ord",
            "net_rental_real_estate": "pt-rre",
            "other_net_rental": "pt-onr",
            "guaranteed_payments_services": "pt-gp-services",
            "guaranteed_payments_capital": "pt-gp-capital",
            "profit_pct_end": "pt-profit-pct",
            "capital_pct_end": "pt-capital-pct",
            "profit_pct_begin": "pt-profit-pct-begin",
            "capital_pct_begin": "pt-capital-pct-begin",
            "distributions": "pt-dist",
        },
    ),
    "1120s-k1": (
        "Form 1120-S",
        {
            "ordinary_income": "scorp-ord",
            "net_rental_real_estate": "scorp-rre",
            "other_net_rental": "scorp-onr",
            "allocation_pct": "scorp-own-pct",
            "distributions": "scorp-dist",
        },
    ),
}

FIELD_LABELS = {
    "ordinary_income": ("income", "Ordinary Business Income (Loss)"),
    "gain_4797": ("adjustment", "Net Gain (Loss) from Form 4797"),
    "other_income": ("adjustment", "Other Income (Loss)"),
    "depreciation": ("addback", "Depreciation"),
    "meals": ("adjustment", "Travel, Meals and Entertainment (M-1)"),
    "net_rental_real_estate": ("income", "Net Rental Real Estate Income (Loss)"),
    "other_net_rental": ("income", "Other Net Rental Income (Loss)"),
    "guaranteed_payments_services": ("income", "Guaranteed Payments for Services"),
    "guaranteed_payments_capital": ("income", "Guaranteed Payments for Capital"),
    "profit_pct_end": ("ownership", "End-of-Year Profit %"),
    "capital_pct_end": ("ownership", "End-of-Year Capital %"),
    "profit_pct_begin": ("ownership", "Beginning-of-Year Profit %"),
    "capital_pct_begin": ("ownership", "Beginning-of-Year Capital %"),
    "allocation_pct": ("ownership", "Current Year Allocation %"),
    "distributions": ("income", "Distributions"),
}

PERCENT_FIELDS = {"profit_pct_end", "capital_pct_end", "profit_pct_begin", "capital_pct_begin", "allocation_pct"}

M1_PAGE = re.compile(r"Schedule\s+M-1", re.I)


@lru_cache(maxsize=1)
def load_map(path: str | None = None) -> dict[str, Any]:
    source = Path(path) if path else MAP_PATH
    return json.loads(source.read_text(encoding="utf-8"))


def _fold(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def page_words(page: Any, ocr_words: Iterable[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Native text-layer words, or the OCR words for a page without one."""
    words = [
        {"x0": float(w[0]), "y0": float(w[1]), "x1": float(w[2]), "y1": float(w[3]), "text": str(w[4])}
        for w in (page.get_text("words") or [])
        if str(w[4]).strip()
    ]
    if words:
        return words
    return [dict(word) for word in (ocr_words or []) if str(word.get("text", "")).strip()]


def _scale(page: Any, box: Iterable[float], size: Iterable[float]) -> list[float]:
    width, height = (float(v) for v in size)
    sx = float(page.rect.width) / width if width else 1.0
    sy = float(page.rect.height) / height if height else 1.0
    x0, y0, x1, y1 = (float(v) for v in box)
    return [x0 * sx, y0 * sy, x1 * sx, y1 * sy]


def _shift(box: list[float], dy: float) -> list[float]:
    return [box[0], box[1] + dy, box[2], box[3] + dy]


def _text_left(words: list[dict[str, Any]], box: list[float]) -> str:
    centre = (box[1] + box[3]) / 2
    row = [
        w for w in words
        if abs((w["y0"] + w["y1"]) / 2 - centre) < ROW_TOLERANCE and w["x1"] <= box[0] + 1
    ]
    return " ".join(w["text"] for w in sorted(row, key=lambda w: w["x0"]))


def _text_above(words: list[dict[str, Any]], box: list[float]) -> str:
    hits = [
        w for w in words
        if box[1] - ABOVE_REACH <= w["y0"] and w["y1"] <= box[1] + 2
        and w["x1"] >= box[0] - 2 and w["x0"] <= box[2]
    ]
    return " ".join(w["text"] for w in sorted(hits, key=lambda w: (w["y0"], w["x0"])))


def _column_header(words: list[dict[str, Any]], box: list[float], header: str) -> bool:
    target = _fold(header)
    for w in words:
        if _fold(w["text"]) != target:
            continue
        centre = (w["x0"] + w["x1"]) / 2
        if box[0] <= centre <= box[2] and box[1] - COLUMN_REACH <= w["y0"] < box[1]:
            return True
    return False


def _passes(words: list[dict[str, Any]], box: list[float], checks: Iterable[Iterable[str]]) -> bool:
    for mode, text in checks:
        if mode == "left":
            ok = _fold(text) in _fold(_text_left(words, box))
        elif mode == "above":
            ok = _fold(text) in _fold(_text_above(words, box))
        elif mode == "column":
            ok = _column_header(words, box, text)
        else:
            ok = False
        if not ok:
            return False
    return True


def locate(words: list[dict[str, Any]], box: list[float], checks: list[list[str]]) -> list[float] | None:
    """The box moved to where its caption actually is.

    Every check passes over a band of offsets a few points wide, so the first
    passing offset sits at the band's edge, half a row off the value. The box
    is centred on the band nearest the blank's position instead.
    """
    steps = int(MAX_DRIFT / DRIFT_STEP)
    offsets = [step * DRIFT_STEP for step in range(-steps, steps + 1)]
    passing = [dy for dy in offsets if _passes(words, _shift(box, dy), checks)]
    if not passing:
        return None
    nearest = min(passing, key=abs)
    low = high = nearest
    while low - DRIFT_STEP in passing:
        low -= DRIFT_STEP
    while high + DRIFT_STEP in passing:
        high += DRIFT_STEP
    return _shift(box, (low + high) / 2)


def _money(raw: str) -> float | None:
    text = re.sub(r"\s+", " ", raw or "").strip()
    match = re.search(r"\(?-?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\)?", text)
    if not match:
        return None
    return parse_tax_amount(match.group(0))


def _dollars(amount: float) -> str:
    return f"-${abs(amount):,.2f}" if amount < 0 else f"${amount:,.2f}"


def _percent(raw: str) -> float | None:
    match = re.search(r"(\d{1,3}(?:\.\d+)?)\s*%?", (raw or "").strip())
    if not match:
        return None
    value = float(match.group(1))
    return value if 0 <= value <= 100 else None


def _record(
    page: Any,
    *,
    page_index: int,
    form: str,
    source_id: str,
    field: str,
    line: str,
    value: str,
    numeric: float,
    box: list[float],
) -> dict[str, Any]:
    category, label = FIELD_LABELS[field]
    slug = re.sub(r"[^a-z0-9]+", "-", form.lower()).strip("-")
    return {
        "pageIndex": page_index,
        "form": form,
        "sourceFieldId": source_id,
        "boxLabel": line,
        "fieldLabel": label,
        "lineNum": line,
        "category": category,
        "value": value,
        "numericValue": numeric,
        "box": relative_box(page, box) or {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0},
        "entityId": f"{slug}-p{page_index}",
        "extractor": "template",
    }


def _read_field(
    page: Any,
    pymupdf: Any,
    words: list[dict[str, Any]],
    ocr_words: list[dict[str, Any]] | None,
    *,
    page_index: int,
    form: str,
    source_id: str,
    field: str,
    spec: dict[str, Any],
    size: list[float],
) -> dict[str, Any] | None:
    checks = spec.get("checks") or [["left", spec["caption"]]]
    box = locate(words, _scale(page, spec["box"], size), checks)
    if box is None:
        return None
    raw = _clip_text(page, pymupdf, box, ocr_words, money=True)
    if field in PERCENT_FIELDS:
        pct = _percent(raw)
        if pct is None:
            return None
        return _record(
            page, page_index=page_index, form=form, source_id=source_id, field=field,
            line=spec["line"], value=f"{pct:g}%", numeric=pct, box=box,
        )
    amount = _money(raw)
    if amount is None:
        return None
    return _record(
        page, page_index=page_index, form=form, source_id=source_id, field=field,
        line=spec["line"], value=_dollars(amount), numeric=amount, box=box,
    )


def _read_coded(
    page: Any,
    pymupdf: Any,
    words: list[dict[str, Any]],
    ocr_words: list[dict[str, Any]] | None,
    *,
    page_index: int,
    form: str,
    source_id: str,
    spec: dict[str, Any],
    size: list[float],
) -> dict[str, Any] | None:
    """Sum the amounts on rows whose code is a distribution code.

    Rows with another code are other items in the same box (tax-exempt income,
    nondeductible expenses, section 737 property) and are not distributions.
    """
    rows = spec["rows"]
    first = _scale(page, rows[0]["amount"], size)
    anchor = locate(words, first, [["above", spec["caption"]]])
    if anchor is None:
        return None
    dy = anchor[1] - first[1]
    codes = {code.upper() for code in spec["codes"]}
    total = 0.0
    boxes: list[list[float]] = []
    for row in rows:
        code_box = _shift(_scale(page, row["code"], size), dy)
        amount_box = _shift(_scale(page, row["amount"], size), dy)
        code = _clip_text(page, pymupdf, code_box, ocr_words).strip()
        amount_raw = _clip_text(page, pymupdf, amount_box, ocr_words, money=True)
        if not code:
            # Printed K-1s often run the code and amount together in one text span.
            joined = _clip_text(page, pymupdf, [code_box[0], code_box[1], amount_box[2], amount_box[3]], ocr_words)
            match = re.match(r"\s*([A-Za-z])\b\s*(.*)", joined or "")
            if match:
                code, amount_raw = match.group(1), match.group(2)
        code_letter = re.sub(r"[^A-Za-z]", "", code)[:1].upper()
        if code_letter not in codes:
            continue
        amount = _money(amount_raw)
        if amount is None:
            continue
        total += amount
        boxes.append([code_box[0], code_box[1], amount_box[2], amount_box[3]])
    if not boxes:
        return None
    union = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    line = f"{spec['line']}{''.join(sorted(codes))}"
    return _record(
        page, page_index=page_index, form=form, source_id=source_id, field="distributions",
        line=line, value=_dollars(total), numeric=total, box=union,
    )


def _combine_guaranteed_payments(rows: list[dict[str, Any]], page: Any, page_index: int) -> None:
    parts = [row for row in rows if row["sourceFieldId"] in ("pt-gp-services", "pt-gp-capital")]
    if not parts:
        return
    total = sum(float(row["numericValue"]) for row in parts)
    union = {
        "x": min(row["box"]["x"] for row in parts),
        "y": min(row["box"]["y"] for row in parts),
    }
    union["w"] = max(row["box"]["x"] + row["box"]["w"] for row in parts) - union["x"]
    union["h"] = max(row["box"]["y"] + row["box"]["h"] for row in parts) - union["y"]
    rows.append(
        {
            **parts[0],
            "sourceFieldId": "pt-gp",
            "boxLabel": "Box 4a + 4b",
            "lineNum": "Box 4a + 4b",
            "fieldLabel": "Guaranteed Payments",
            "value": _dollars(total),
            "numericValue": total,
            "box": union,
        }
    )


def _other_income_note(rows: list[dict[str, Any]]) -> None:
    other = next((row for row in rows if row["sourceFieldId"].endswith("-return-other")), None)
    if other is None or abs(float(other["numericValue"])) < 0.005:
        return
    note = {
        "severity": "warning",
        "message": OTHER_INCOME_NOTE.format(form=other["form"], line=other["lineNum"].lower(), value=other["value"]),
    }
    for row in rows:
        row["reviewNotes"] = [*row.get("reviewNotes", []), note]


_PAGE_TITLES = (
    # K-1s first: a K-1 repeats its return's name in the header.
    (re.compile(r"Schedule K-1\s*\(Form\s*1120-?S\)", re.I), "1120s-k1"),
    (re.compile(r"Schedule K-1\s*\(Form\s*1065\)", re.I), "1065-k1"),
    (re.compile(r"U\.S\. Income Tax Return for an S Corporation", re.I), "1120s"),
    (re.compile(r"U\.S\. Return of Partnership Income", re.I), "1065"),
)
_M1_FORMS = (
    (re.compile(r"Form\s*1120-?S", re.I), "1120s"),
    (re.compile(r"Form\s*1065", re.I), "1065"),
)


def form_key_for_page(text: str) -> str | None:
    """Which map entry applies to a page, from its printed title.

    Matched OCR-tolerantly: a scan reads "ScheduleK-1(Form1065)".
    """
    for pattern, key in _PAGE_TITLES:
        if pattern_matches(pattern, text):
            return key
    if pattern_matches(M1_PAGE, text):
        for pattern, key in _M1_FORMS:
            if pattern_matches(pattern, text):
                return key
    return None


def extract_business_return_page(
    page: Any,
    pymupdf: Any,
    *,
    form_key: str,
    page_index: int,
    ocr_words: list[dict[str, Any]] | None = None,
    located: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Template rows for one page.

    ``located`` collects every source id whose caption was found, filled or
    not. A located cell that is empty is a blank line on the return, and the
    label catalog must not then fill it with the line number beside it.
    """
    mapping = load_map()
    entry = mapping["forms"].get(form_key)
    if entry is None or form_key not in SOURCE_IDS:
        return []
    form, ids = SOURCE_IDS[form_key]
    size = mapping.get("page_size") or [612, 792]
    words = page_words(page, ocr_words)
    if not words:
        return []
    found: set[str] = set()
    rows: list[dict[str, Any]] = []
    for field, spec in entry.get("fields", {}).items():
        source_id = ids.get(field)
        if source_id is None:
            continue
        checks = spec.get("checks") or [["left", spec["caption"]]]
        if locate(words, _scale(page, spec["box"], size), checks) is not None:
            found.add(source_id)
        row = _read_field(
            page, pymupdf, words, ocr_words, page_index=page_index, form=form,
            source_id=source_id, field=field, spec=spec, size=size,
        )
        if row is not None:
            rows.append(row)
    for name, spec in (entry.get("coded_boxes") or {}).items():
        source_id = ids.get(name)
        if source_id is None:
            continue
        if locate(words, _scale(page, spec["rows"][0]["amount"], size), [["above", spec["caption"]]]) is not None:
            found.add(source_id)
        row = _read_coded(
            page, pymupdf, words, ocr_words, page_index=page_index, form=form,
            source_id=source_id, spec=spec, size=size,
        )
        if row is not None:
            rows.append(row)
    if form_key == "1065-k1":
        _combine_guaranteed_payments(rows, page, page_index)
        if {"pt-gp-services", "pt-gp-capital"} <= found:
            found.add("pt-gp")
    if located is not None:
        located.update(found)
    _other_income_note(rows)
    logger.info("business_return_template form=%s page=%s fields=%s", form_key, page_index, len(rows))
    return rows
