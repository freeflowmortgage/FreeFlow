"""Form W-2 grid extractor (IRS Copy B boxes from fw2.pdf).

Box 5 often sits on a number-only line (no "Medicare" text) because payroll PDFs
keep the IRS template and the wage overlay in separate streams. Clip official
Copy B widgets first, then OCR labels, then a 3x2 decimal matrix in the federal
wage column — never the identity column (EIN/SSN) or ADP Gross Pay.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Iterable

from schedule_e_grid import (
    TEMPLATE_DIR,
    _clip_text,
    _open_pdf,
    _page_plain_text,
    _require_pymupdf,
    _widget_value_in_box,
    convert_relative_words,
    ocr_page_words,
    parse_tax_amount,
    relative_box,
)

logger = logging.getLogger("freeflow.w2")

DEFAULT_BLANK = TEMPLATE_DIR / "fw2.pdf"
DEFAULT_MAP = TEMPLATE_DIR / "w2_map.json"

W2_PAGE_MARKERS = ("Wage and Tax Statement", "Medicare wages", "Employer identification number")

TOP_FIELDS = {
    "employer_ein": "f2_02[0]",
    "employer_name": "f2_03[0]",
    "box1": "f2_09[0]",
    "box2": "f2_10[0]",
    "box3": "f2_11[0]",
    "box4": "f2_12[0]",
    "box5": "f2_13[0]",
    "box6": "f2_14[0]",
}
BOTTOM_FIELDS = {
    "employer_ein": "f2_46[0]",
    "employer_name": "f2_47[0]",
    "box1": "f2_53[0]",
    "box2": "f2_54[0]",
    "box3": "f2_55[0]",
    "box4": "f2_56[0]",
    "box5": "f2_57[0]",
    "box6": "f2_58[0]",
}


def _rect_list(widget: Any) -> list[float]:
    rect = widget.rect
    return [float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)]


def generate_template_map(
    blank_pdf_path: str | Path | None = None,
    output_json_path: str | Path | None = None,
) -> dict[str, Any]:
    pymupdf = _require_pymupdf()
    blank_path = Path(blank_pdf_path) if blank_pdf_path else DEFAULT_BLANK
    doc = pymupdf.open(blank_path)
    try:
        page = next(
            (item for item in doc if any("CopyB" in ((widget.field_name or "")) for widget in (item.widgets() or []))),
            None,
        )
        if page is None:
            raise ValueError("fw2.pdf is missing Copy B widgets")
        widgets = {widget.field_name: widget for widget in (page.widgets() or []) if widget.field_name}

        def band(prefix: str, field_ids: dict[str, str]) -> dict[str, Any]:
            boxes: dict[str, list[float]] = {}
            for key, suffix in field_ids.items():
                widget = next((item for name, item in widgets.items() if prefix in name and name.endswith(suffix)), None)
                if widget is None:
                    logger.warning("w2_template_missing field=%s prefix=%s", key, prefix)
                    continue
                boxes[key] = _rect_list(widget)
            if not boxes:
                return {}
            xs = [box[0] for box in boxes.values()] + [box[2] for box in boxes.values()]
            ys = [box[1] for box in boxes.values()] + [box[3] for box in boxes.values()]
            return {
                "origin": [min(xs) - 8, min(ys) - 24],
                "extent": [max(xs) + 8, max(ys) + 8],
                "boxes": boxes,
            }

        template_map = {
            "page_size": [float(page.rect.width), float(page.rect.height)],
            "copy": "B",
            "forms": [band("CopyB_Top", TOP_FIELDS), band("CopyB_Bottom", BOTTOM_FIELDS)],
        }
        template_map["forms"] = [form for form in template_map["forms"] if form]
    finally:
        doc.close()

    destination = Path(output_json_path) if output_json_path else DEFAULT_MAP
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(template_map, indent=2), encoding="utf-8")
    return template_map


def load_template_map(map_path: str | Path | None = None) -> dict[str, Any]:
    path = Path(map_path) if map_path else DEFAULT_MAP
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    if DEFAULT_BLANK.exists():
        return generate_template_map(DEFAULT_BLANK, path)
    raise FileNotFoundError(f"W-2 template map not found at {path}")


def _combined_page_text(page: Any, words: list[dict[str, Any]] | None = None) -> str:
    native = _page_plain_text(page)
    ocr = " ".join(word.get("text", "") for word in (words or []) if word.get("text"))
    return f"{native} {ocr}".strip()


_W2_WAGE_LABELS_FOLDED = (
    "medicarewages",
    "socialsecuritywages",
    "wagestips",
    "federalincometax",
)


def is_w2_instruction_page(text: str) -> bool:
    blob = (text or "").lower()
    if not re.search(
        r"notice to employee|effectively keypunched|instructions for employee|"
        r"this w-2 is acceptable for filing|attach this w-2 to your state",
        blob,
    ):
        return False
    folded = re.sub(r"[^a-z0-9]+", "", blob)
    if sum(needle in folded for needle in _W2_WAGE_LABELS_FOLDED) >= 2:
        return False
    amounts = re.findall(r"\d{1,3}(?:,\d{3})+\.\d{2}|\d{4,}\.\d{2}", text or "")
    return len(amounts) < 2


def is_four_up_w2(text: str) -> bool:
    blob = (text or "").lower()
    return bool(re.search(r"copy\s*b", blob) and re.search(r"copy\s*c", blob))


_WAGE_IN_TEXT = re.compile(r"\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}")


def _looks_like_wage_amount(amount: float, raw: str = "") -> bool:
    """Reject ZIP / EIN / SSN digits that land in a Copy B widget clip."""
    if amount < 100 or amount > 10_000_000:
        return False
    digits = re.sub(r"\D", "", raw or "")
    compact = re.sub(r"[^\d.]", "", raw or "")
    if raw and "." not in compact and re.fullmatch(r"\d{5}", digits or ""):
        return False
    if raw and re.fullmatch(r"\d{9}", digits or ""):
        return False
    if not raw and float(amount).is_integer() and 10_000 <= amount <= 99_999:
        return False
    return True


def _wage_from_clip(raw: str) -> float:
    match = _WAGE_IN_TEXT.search(raw or "")
    if not match:
        return 0.0
    try:
        amount = parse_tax_amount(match.group(0))
    except ValueError:
        return 0.0
    return amount if _looks_like_wage_amount(amount, match.group(0)) else 0.0


def validate_medicare_tax(box5_wages: float, box6_tax: float) -> bool:
    """Box 6 is 1.45% of Box 5. ±$2 covers rounding."""
    if box5_wages <= 0 or box6_tax <= 0:
        return False
    return abs(box6_tax - box5_wages * 0.0145) <= 2.00


def _extract_is_plausible(parsed: dict[str, Any] | None) -> bool:
    if not parsed:
        return False
    box5 = float(parsed.get("box5") or 0)
    box1 = float(parsed.get("box1") or 0)
    box6 = float(parsed.get("box6") or 0)
    if box5 > 0 and box6 > 0 and validate_medicare_tax(box5, box6):
        return True
    # ZIP/EIN rejection lives in _wage_from_clip (raw text). Bare 23500.00 wages
    # are integers as floats and must still count as a filled federal box.
    return (100 <= box5 <= 10_000_000) or (100 <= box1 <= 10_000_000)


def is_earnings_summary_page(text: str) -> bool:
    blob = (text or "").lower()
    return bool(re.search(r"earnings summary|box 1 of w-2|reported w-2 wages", blob))


def _page_size(page: Any) -> tuple[float, float]:
    rect = getattr(page, "rect", None)
    return (
        float(getattr(rect, "width", 0) or 612.0),
        float(getattr(rect, "height", 0) or 792.0),
    )


def _copy_b_words(page: Any, words: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    items = list(words or [])
    if not items:
        return items
    width, height = _page_size(page)
    blob = " ".join(str(word.get("text") or "") for word in items)
    native = ""
    try:
        native = _page_plain_text(page)
    except Exception:
        native = ""
    combined = f"{blob} {native}"
    four_up = is_four_up_w2(blob) or is_four_up_w2(native)
    summary = is_earnings_summary_page(combined)
    clipped = []
    for word in items:
        y0 = float(word.get("y0") or 0)
        x0 = float(word.get("x0") or 0)
        if y0 > height * 0.52:
            continue
        if (four_up or summary) and x0 > width * 0.52:
            continue
        clipped.append(word)
    return clipped or items


def _federal_wage_words(page: Any, words: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Drop SSN/EIN/address (left identity column). Wages sit to the right of that column."""
    items = list(words or [])
    copy_b = _copy_b_words(page, items)
    if not copy_b:
        return copy_b
    width, _height = _page_size(page)
    # Detect the source layout before Copy B clipping removes Copy C. Four-up
    # sheets use a half-width wage column; forgetting that state moves the
    # minimum x-coordinate past every federal wage cell.
    blob = " ".join(str(word.get("text") or "") for word in items)
    native = ""
    try:
        native = _page_plain_text(page)
    except Exception:
        native = ""
    combined = f"{blob} {native}"
    four_up = is_four_up_w2(combined)
    summary = is_earnings_summary_page(combined)
    min_x = width * (0.22 if (four_up or summary) else 0.45)
    wage = [word for word in copy_b if float(word.get("x0") or 0) >= min_x]
    return wage or copy_b


def _native_page_words(page: Any) -> list[dict[str, Any]]:
    try:
        raw = page.get_text("words") or []
    except Exception:
        return []
    words: list[dict[str, Any]] = []
    for item in raw:
        if len(item) < 5:
            continue
        x0, y0, x1, y1, text = item[0], item[1], item[2], item[3], item[4]
        if text:
            words.append(
                {
                    "x0": float(x0),
                    "y0": float(y0),
                    "x1": float(x1),
                    "y1": float(y1),
                    "text": str(text),
                }
            )
    return words


def _overlap_share(a: dict[str, Any], b: dict[str, Any]) -> float:
    width = min(float(a["x1"]), float(b["x1"])) - max(float(a["x0"]), float(b["x0"]))
    height = min(float(a["y1"]), float(b["y1"])) - max(float(a["y0"]), float(b["y0"]))
    if width <= 0 or height <= 0:
        return 0.0
    area = lambda w: max((float(w["x1"]) - float(w["x0"])) * (float(w["y1"]) - float(w["y0"])), 1e-6)  # noqa: E731
    return (width * height) / min(area(a), area(b))


def _with_native_values(native: list[dict[str, Any]], ocr: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Native words plus the OCR words they do not cover.

    Some W-2 generators print the amounts as text and draw the box captions as
    vector outlines. The captions only exist in OCR; the amounts are exact in
    the text layer and OCR can garble them (``90000.00`` read as ``00*00006``).
    """
    if not native:
        return ocr
    return native + [word for word in ocr if not any(_overlap_share(word, n) > 0.3 for n in native)]


_CURRENCY_PIECE = re.compile(r"\$?\d{1,3}(?:,\d{3})*\.\d{2}|\$?\d+\.\d{2}")


def _currency_entries(words: list[dict[str, Any]]) -> list[tuple[float, dict[str, Any]]]:
    """Pull .xx amounts, including two values jammed in one OCR token."""
    entries: list[tuple[float, dict[str, Any]]] = []
    for word in words:
        text = str(word.get("text") or "")
        matches = list(_CURRENCY_PIECE.finditer(text))
        x0 = float(word.get("x0") or 0)
        x1 = float(word.get("x1") or x0)
        span = max(x1 - x0, 1.0)
        for index, match in enumerate(matches):
            compact = match.group(0).replace(",", "").replace("$", "")
            if not re.fullmatch(r"\d{1,7}\.\d{2}", compact):
                continue
            amount = float(compact)
            if amount < 100:
                continue
            piece = {
                **word,
                "x0": x0 + span * (index / max(len(matches), 1)),
                "x1": x0 + span * ((index + 1) / max(len(matches), 1)),
                "text": match.group(0),
            }
            entries.append((amount, piece))
    # OCR baselines on the same printed row commonly differ by a few pixels.
    # Group those entries before sorting left-to-right so Box 5 cannot trade
    # places with Box 6 merely because the tax value was read slightly higher.
    rows: list[list[tuple[float, dict[str, Any]]]] = []
    for entry in sorted(entries, key=lambda item: float(item[1].get("y0") or 0)):
        y0 = float(entry[1].get("y0") or 0)
        if rows:
            row_y = sum(float(item[1].get("y0") or 0) for item in rows[-1]) / len(rows[-1])
            if abs(y0 - row_y) <= 6.0:
                rows[-1].append(entry)
                continue
        rows.append([entry])
    return [
        entry
        for row in rows
        for entry in sorted(row, key=lambda item: float(item[1].get("x0") or 0))
    ]


def parse_unified_w2_matrix(
    page: Any,
    words: list[dict[str, Any]] | None,
    page_index: int = 0,
) -> dict[str, Any] | None:
    """3x2 federal wage grid from the wage column only. Requires Box 6 ≈ Box 5 × 1.45%."""
    wage_words = _federal_wage_words(page, words)
    entries = _currency_entries(wage_words)
    if len(entries) < 6:
        entries = _currency_entries(_copy_b_words(page, words))
    if len(entries) < 6:
        return None
    vals = [item[0] for item in entries[:6]]
    box1, box2, box3, box4, box5, box6 = vals
    if not validate_medicare_tax(box5, box6):
        return None
    overlay: dict[str, Any] = {}
    keys = ("box1", "box2", "box3", "box4", "box5", "box6")
    for key, (_amount, word) in zip(keys, entries[:6]):
        overlay[key] = relative_box(
            page,
            [
                float(word.get("x0") or 0),
                float(word.get("y0") or 0),
                float(word.get("x1") or 0),
                float(word.get("y1") or 0),
            ],
        )
    return {
        "pageIndex": page_index,
        "box1": box1,
        "box2": box2,
        "box3": box3,
        "box4": box4,
        "box5": box5,
        "box6": box6,
        "boxes": overlay,
        "isMedicareValidated": True,
    }


def parse_adp_reported_wages(
    page: Any,
    words: list[dict[str, Any]] | None,
) -> dict[str, float]:
    """ADP earnings summary: Reported W-2 Wages under Box 1 / 3 / 5 of W-2 — not Gross Pay."""
    items = list(words or [])
    if not items:
        return {}
    width, _height = _page_size(page)
    right = [word for word in items if float(word.get("x0") or 0) >= width * 0.48]
    blob_words = right or items
    lines = _cluster_ocr_lines(blob_words)
    header_x: dict[str, float] = {}
    for line in lines:
        if not re.search(r"box\s*[135]\s+of\s+w-?2", line["text"], re.I):
            continue
        line_words = line["words"]
        for box_n, key in (("1", "box1"), ("3", "box3"), ("5", "box5")):
            for index, word in enumerate(line_words):
                window = " ".join(str(item.get("text") or "") for item in line_words[index : index + 6])
                if re.search(rf"box\s*{box_n}\s+of\s+w-?2", window, re.I):
                    header_x[key] = float(word.get("x0") or 0)
                    break
    reported = next((line for line in lines if re.search(r"reported\s+w-?2\s+wages", line["text"], re.I)), None)
    if not reported:
        return {}
    amounts: list[tuple[float, float]] = []
    for word in reported["words"]:
        amount = _word_amount(word)
        if amount is None or amount < 100:
            continue
        amounts.append((amount, float(word.get("x0") or 0)))
    if not amounts:
        for piece in _CURRENCY_PIECE.finditer(reported["text"]):
            compact = piece.group(0).replace(",", "").replace("$", "")
            if re.fullmatch(r"\d{1,7}\.\d{2}", compact):
                val = float(compact)
                if val >= 100:
                    amounts.append((val, float(piece.start())))
    if not amounts:
        return {}
    out: dict[str, float] = {}
    if header_x:
        for key, x_anchor in header_x.items():
            closest = min(amounts, key=lambda item: abs(item[1] - x_anchor))
            out[key] = closest[0]
    else:
        ordered = sorted(amounts, key=lambda item: item[1])
        for key, item in zip(("box1", "box3", "box5"), ordered):
            out[key] = item[0]
    return out


def _merge_box_dict(target: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(target)
    overlay = dict(merged.get("boxes") or {})
    incoming_boxes = incoming.get("boxes") or {}
    for key in ("box1", "box2", "box3", "box4", "box5", "box6"):
        if not merged.get(key) and incoming.get(key):
            merged[key] = incoming[key]
            if incoming_boxes.get(key):
                overlay[key] = incoming_boxes[key]
    if incoming.get("isMedicareValidated"):
        merged["isMedicareValidated"] = True
    merged["boxes"] = overlay
    return merged


def _apply_federal_fallbacks(
    page: Any,
    words: list[dict[str, Any]] | None,
    parsed: dict[str, Any] | None,
    page_index: int,
) -> dict[str, Any] | None:
    current = dict(parsed) if parsed else {"pageIndex": page_index, "boxes": {}}
    if not float(current.get("box5") or 0) or not float(current.get("box6") or 0):
        matrix = parse_unified_w2_matrix(page, words, page_index=page_index)
        if matrix:
            current = _merge_box_dict(current, matrix)
            # A Medicare-validated matrix establishes the complete printed
            # 3x2 federal grid. Prefer all six coordinate-derived values over
            # an unvalidated template clip, which can land one row too low on
            # older four-up W-2 revisions and mislabel Box 5 as Box 1.
            if matrix.get("isMedicareValidated"):
                overlay = dict(current.get("boxes") or {})
                matrix_boxes = matrix.get("boxes") or {}
                for key in ("box1", "box2", "box3", "box4", "box5", "box6"):
                    if matrix.get(key):
                        current[key] = matrix[key]
                        if matrix_boxes.get(key):
                            overlay[key] = matrix_boxes[key]
                current["boxes"] = overlay
    reported = parse_adp_reported_wages(page, words)
    for key in ("box1", "box3", "box5"):
        if not float(current.get(key) or 0) and reported.get(key):
            current[key] = reported[key]
    return current if _extract_is_plausible(current) else parsed


def is_w2_page(page: Any, words: list[dict[str, Any]] | None = None) -> bool:
    blob = _combined_page_text(page, words)
    if is_w2_instruction_page(blob):
        return False
    lowered = blob.lower()
    if "wage and tax statement" in lowered or re.search(r"\bw-?2\b", lowered):
        return True
    return sum(1 for marker in W2_PAGE_MARKERS if marker.lower() in lowered) >= 2


def _scale_box(box: Iterable[float], src: list[float], dst_width: float, dst_height: float) -> list[float]:
    x0, y0, x1, y1 = (float(value) for value in box)
    sx = dst_width / (src[0] or 1.0)
    sy = dst_height / (src[1] or 1.0)
    if dst_height < 500:
        sy = dst_height / 396.0
    return [x0 * sx, y0 * sy, x1 * sx, y1 * sy]


NAME_NOISE = re.compile(
    r"attention|file forms|employer.?s name|address and zip|control number|void|informational|omb no|wage and tax|form w-?2|copy\s*[b2c]|employee.?s name",
    re.I,
)
EIN_RE = re.compile(r"\b(\d{2}-\d{7})\b")
EIN_BARE_RE = re.compile(r"\b(\d{9})\b")
SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
ORG_HINT = re.compile(
    r"\b(inc|llc|llp|lp|corp|corporation|company|co|assoc|association|bank|national|trust|partners|group|services|hospital|university|ltd|limited)\b",
    re.I,
)
PERSON_NAME = re.compile(r"^[A-Z][A-Za-z'-]+(?:\s+[A-Z]\.?){0,2}\s+[A-Z][A-Za-z'-]+$")
MONEY_TOKEN = re.compile(r"^\(?\$?-?\d{1,3}(?:,\d{3})+(?:\.\d{2})?\)?$|^\(?\$?-?\d+\.\d{2}\)?$")


def _normalize_ein(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) != 9:
        return ""
    return f"{digits[:2]}-{digits[2:]}"


def _strip_trailing_address(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip(" ,")
    text = re.sub(r"\s+\d{2,5}\s+[A-Za-z].*$", "", text)
    text = re.sub(r"[,\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$", "", text)
    return text.strip(" ,")


def _is_address_line(value: str) -> bool:
    text = (value or "").strip()
    if re.match(r"^\d{1,5}\s+\S+", text):
        return True
    if re.search(r"\d{1,5}\s+\S+\s+(st|street|ave|avenue|rd|road|blvd|pkwy|ln|dr|way|ct|cir)\b", text, re.I):
        return True
    if re.search(r"\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b", text) and not ORG_HINT.search(text):
        return True
    return False


def _is_form_label_name(value: str) -> bool:
    """Box c's printed label, including the space-stripped OCR run on this form."""
    folded = re.sub(r"[^a-z0-9]+", "", (value or "").lower())
    return any(
        token in folded
        for token in ("employersname", "employersaddress", "addressandzip", "wageandtaxstatement", "controlnumber")
    )


def _first_company_line(raw: str) -> str:
    for part in re.split(r"[\n\r]+", raw or ""):
        value = _strip_trailing_address(part)
        if len(value) < 3 or len(value) > 90 or NAME_NOISE.search(value) or _is_form_label_name(value):
            continue
        if _is_address_line(value) or PERSON_NAME.match(value):
            continue
        if SSN_RE.search(value) or EIN_RE.search(value):
            continue
        if re.fullmatch(r"[\d\s.,$-]+", value):
            continue
        if not re.search(r"[A-Za-z]{3,}", value):
            continue
        return value
    return ""


def _identity_column_words(page: Any, words: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    items = list(words or [])
    copy_b = _copy_b_words(page, items)
    if not copy_b:
        return []
    width, _height = _page_size(page)
    blob = " ".join(str(word.get("text") or "") for word in items)
    four_up = is_four_up_w2(blob)
    summary = is_earnings_summary_page(blob)
    max_x = width * (0.32 if (four_up or summary) else 0.48)
    return [word for word in copy_b if float(word.get("x0") or 0) < max_x]


def _ein_from_text(text: str) -> str:
    hyphen = EIN_RE.search(text or "")
    if hyphen:
        return hyphen.group(1)
    for match in EIN_BARE_RE.finditer(text or ""):
        if SSN_RE.search(text) and re.sub(r"\D", "", SSN_RE.search(text).group(0)) == match.group(1):
            continue
        return _normalize_ein(match.group(1))
    return ""


def _employer_from_identity(
    page: Any,
    words: list[dict[str, Any]] | None,
) -> tuple[str, dict[str, Any] | None, str]:
    """Box c sits under Box b in the left column — no 'Employer name' label required."""
    identity = _identity_column_words(page, words)
    lines = _cluster_ocr_lines(identity or list(words or []))
    ein = ""
    ein_index = -1
    for index, line in enumerate(lines):
        found = _ein_from_text(line["text"])
        if found:
            ein = found
            ein_index = index
            break
    if ein_index < 0:
        ein = _ein_from_text(" ".join(line["text"] for line in lines))
        start = 0
    else:
        start = ein_index + 1
    for follow in lines[start : start + 8]:
        candidate = _first_company_line(follow["text"])
        if not candidate:
            continue
        overlay = relative_box(
            page,
            [
                float(follow["words"][0].get("x0") or 0),
                float(follow["y"]),
                float(follow["words"][-1].get("x1") or 0),
                float(follow["words"][-1].get("y1") or follow["y"]) + 10,
            ],
        )
        return candidate, overlay, ein
    return "", None, ein


def _fill_employer_identity(
    page: Any,
    words: list[dict[str, Any]] | None,
    parsed: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not parsed:
        return parsed
    name, overlay, ein = _employer_from_identity(page, words)
    if _is_form_label_name(str(parsed.get("employerName") or "")):
        parsed["employerName"] = ""
    if not str(parsed.get("employerName") or "").strip() and name:
        parsed["employerName"] = name
        if overlay:
            boxes = dict(parsed.get("boxes") or {})
            boxes["employer_name"] = overlay
            parsed["boxes"] = boxes
    current_ein = str(parsed.get("ein") or "").strip()
    if not current_ein and ein:
        parsed["ein"] = ein
    elif current_ein and "-" not in current_ein:
        parsed["ein"] = _normalize_ein(current_ein) or current_ein
    return parsed


def _cluster_ocr_lines(words: list[dict[str, Any]], y_tol: float = 6.0) -> list[dict[str, Any]]:
    items = sorted(words, key=lambda word: (float(word.get("y0") or 0), float(word.get("x0") or 0)))
    lines: list[dict[str, Any]] = []
    for word in items:
        y0 = float(word.get("y0") or 0)
        if lines and abs(y0 - lines[-1]["y"]) <= y_tol:
            lines[-1]["words"].append(word)
        else:
            lines.append({"y": y0, "words": [word]})
    for line in lines:
        line["words"].sort(key=lambda word: float(word.get("x0") or 0))
        line["text"] = " ".join(str(word.get("text") or "") for word in line["words"])
    return lines


def _word_amount(word: dict[str, Any]) -> float | None:
    text = str(word.get("text") or "").strip()
    if not MONEY_TOKEN.search(text.replace(" ", "")) and not re.search(r"\d+\.\d{2}", text):
        return None
    try:
        amount = parse_tax_amount(text)
    except ValueError:
        return None
    return amount if abs(amount) > 0.004 else None


def _amount_near_label(
    lines: list[dict[str, Any]],
    line_index: int,
    page: Any,
    min_x: float = 0.0,
    max_x: float = float("inf"),
) -> tuple[float, dict[str, Any]] | None:
    found: list[tuple[float, dict[str, Any]]] = []
    for offset in range(0, 3):
        if line_index + offset >= len(lines):
            break
        line = lines[line_index + offset]
        if offset and float(line["y"]) - float(lines[line_index]["y"]) > 36:
            break
        for word in line["words"]:
            x0 = float(word.get("x0") or 0)
            if x0 < min_x or x0 >= max_x:
                continue
            amount = _word_amount(word)
            if amount is None:
                continue
            found.append((amount, word))
        if found:
            break
    if not found:
        return None
    # Nearest amount to the right of the label — not the rightmost on the row (Box 6).
    found.sort(key=lambda item: float(item[1].get("x0") or 0))
    return found[0]


def _phrase_right_edge(line: dict[str, Any], pattern: re.Pattern[str]) -> float:
    """Right edge of a multi-word label. 'Medicare' and 'wages' are separate tokens."""
    match = pattern.search(str(line.get("text") or ""))
    if not match:
        return 0.0
    cursor = 0
    edge = 0.0
    for word in line.get("words") or []:
        token = str(word.get("text") or "")
        if not token:
            continue
        idx = str(line.get("text") or "").find(token, cursor)
        if idx < 0:
            continue
        end = idx + len(token)
        if idx < match.end():
            edge = float(word.get("x1") or edge)
        cursor = end
        if end >= match.end():
            break
    return edge


def _phrase_cell(line: dict[str, Any], pattern: re.Pattern[str]) -> tuple[float, float] | None:
    """Horizontal extent of the box a caption heads: its left edge to the next caption.

    W-2 amounts print under their caption, often left of where the caption
    ends, so "right of the label" picks up the neighbouring box instead.
    """
    words = line.get("words") or []
    for position, word in enumerate(words):
        if not pattern.search(str(word.get("text") or "")) and not pattern.search(
            " ".join(str(w.get("text") or "") for w in words[position : position + 6])
        ):
            continue
        if position + 1 < len(words) and pattern.search(
            " ".join(str(w.get("text") or "") for w in words[position + 1 : position + 7])
        ):
            continue
        left = float(word.get("x0") or 0) - 8
        right = float("inf")
        for later in words[position + 1 :]:
            if re.match(r"^\d{1,2}[a-z]?\b|^[a-f]\b", str(later.get("text") or ""), re.I):
                right = float(later.get("x0") or 0) - 4
                break
        return left, right
    return None


def parse_w2_from_ocr_words(
    page: Any,
    words: list[dict[str, Any]] | None,
    *,
    page_index: int,
) -> dict[str, Any] | None:
    if not words:
        return None
    copy_b = _copy_b_words(page, words)
    lines = _cluster_ocr_lines(copy_b or words)
    blob = " ".join(line["text"] for line in lines)
    boxes: dict[str, float] = {}
    overlay: dict[str, Any] = {}

    def take(key: str, pattern: re.Pattern[str], *, exclude: re.Pattern[str] | None = None) -> None:
        if boxes.get(key):
            return
        for index, line in enumerate(lines):
            if not pattern.search(line["text"]):
                continue
            if exclude and exclude.search(line["text"]) and not pattern.search(line["text"]):
                continue
            label_x = _phrase_right_edge(line, pattern)
            hit = _amount_near_label(lines, index, page, min_x=max(0.0, label_x - 8))
            cell = _phrase_cell(line, pattern)
            if cell and (not hit or not cell[0] <= float(hit[1].get("x0") or 0) < cell[1]):
                hit = _amount_near_label(lines, index, page, min_x=cell[0], max_x=cell[1]) or hit
            if not hit:
                hit = _amount_near_label(lines, index, page)
            if not hit:
                continue
            amount, word = hit
            boxes[key] = amount
            overlay[key] = relative_box(
                page,
                [float(word.get("x0") or 0), float(word.get("y0") or 0), float(word.get("x1") or 0), float(word.get("y1") or 0)],
            )
            return

    take("box5", re.compile(r"medicare wages(?:\s+and\s+tips)?", re.I), exclude=re.compile(r"medicare tax withheld", re.I))
    take("box1", re.compile(r"wages,?\s*tips,?\s*other", re.I), exclude=re.compile(r"social security", re.I))
    take("box3", re.compile(r"social security wages", re.I))
    take("box2", re.compile(r"federal income tax withheld", re.I))
    take("box4", re.compile(r"social security tax withheld", re.I))
    take("box6", re.compile(r"medicare tax withheld", re.I))
    if not boxes.get("box5"):
        fallback = re.search(
            r"medicare wages(?:\s+and\s+tips)?[^\d]{0,48}(\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2})",
            blob,
            re.I,
        )
        if fallback:
            amount = _wage_from_clip(fallback.group(1))
            if amount:
                boxes["box5"] = amount

    ein_match = EIN_RE.search(blob)
    ein = ein_match.group(1) if ein_match else _ein_from_text(blob)
    employer_name = ""
    for index, line in enumerate(lines):
        if not re.search(r"employer.?s name|employer.?s address|\bc\s+employer", line["text"], re.I):
            continue
        for follow in lines[index + 1 : index + 4]:
            candidate = _first_company_line(follow["text"])
            if candidate:
                employer_name = candidate
                overlay["employer_name"] = relative_box(
                    page,
                    [
                        float(follow["words"][0].get("x0") or 0),
                        float(follow["y"]),
                        float(follow["words"][-1].get("x1") or 0),
                        float(follow["words"][-1].get("y1") or follow["y"]) + 10,
                    ],
                )
                break
        break
    year = None
    year_match = re.search(r"\b(20\d{2})\b", blob)
    if year_match:
        year = int(year_match.group(1))
    parsed: dict[str, Any] = {
        "pageIndex": page_index,
        "year": year,
        "employerName": employer_name,
        "ein": ein,
        "box1": boxes.get("box1") or 0.0,
        "box2": boxes.get("box2") or 0.0,
        "box3": boxes.get("box3") or 0.0,
        "box4": boxes.get("box4") or 0.0,
        "box5": boxes.get("box5") or 0.0,
        "box6": boxes.get("box6") or 0.0,
        "boxes": overlay,
    }
    parsed = _fill_employer_identity(page, words, parsed)
    parsed = _apply_federal_fallbacks(page, words, parsed, page_index)
    if not _extract_is_plausible(parsed):
        return None
    return parsed


def parse_w2_form(
    page: Any,
    form: dict[str, Any],
    *,
    page_index: int,
    page_size: list[float],
    words: list[dict[str, Any]] | None = None,
    four_up: bool = False,
) -> dict[str, Any] | None:
    pymupdf = _require_pymupdf()
    dest_width = float(page.rect.width) * (0.5 if four_up else 1.0)
    scaled = {
        key: _scale_box(box, page_size, dest_width, page.rect.height) for key, box in form.get("boxes", {}).items()
    }
    if "box5" not in scaled and "box1" not in scaled:
        return None

    def clip(key: str, *, money: bool = False) -> str:
        box = scaled.get(key)
        if not box:
            return ""
        widget = _widget_value_in_box(page, pymupdf, box)
        if widget:
            return widget
        return _clip_text(page, pymupdf, box, words, money=money)

    employer_name = _first_company_line(clip("employer_name"))
    ein = _normalize_ein(clip("employer_ein"))
    boxes = {}
    for key in ("box1", "box2", "box3", "box4", "box5", "box6"):
        boxes[key] = _wage_from_clip(clip(key, money=True))
    if not _extract_is_plausible(boxes):
        return None
    year = None
    year_match = re.search(r"\b(20\d{2})\b", _combined_page_text(page, words))
    if year_match:
        year = int(year_match.group(1))
    overlay = {key: relative_box(page, box) for key, box in scaled.items()}
    parsed = {
        "pageIndex": page_index,
        "year": year,
        "employerName": employer_name,
        "ein": ein,
        "box1": boxes.get("box1") or 0.0,
        "box2": boxes.get("box2") or 0.0,
        "box3": boxes.get("box3") or 0.0,
        "box4": boxes.get("box4") or 0.0,
        "box5": boxes.get("box5") or 0.0,
        "box6": boxes.get("box6") or 0.0,
        "boxes": overlay,
    }
    return _fill_employer_identity(page, words, parsed)


def _should_ocr_w2(page: Any, words: list[dict[str, Any]] | None, parsed: dict[str, Any] | None) -> bool:
    name = str((parsed or {}).get("employerName") or "")
    has_name = bool(name.strip()) and not _is_form_label_name(name)
    has_box5 = float((parsed or {}).get("box5") or 0) >= 100
    # A template clip can look filled (Box 1 or the Box c label) and still miss
    # Medicare wages. Keep reading words until Box 5 is actually present.
    if _extract_is_plausible(parsed) and has_name and has_box5:
        return False
    blob = _combined_page_text(page, words).lower()
    if "wage and tax statement" in blob or "medicare wages" in blob:
        if _extract_is_plausible(parsed) and has_box5 and not has_name:
            native = _page_plain_text(page)
            return len(native.strip()) < 80
        return True
    native = _page_plain_text(page)
    return len(native.strip()) < 80


def extract_w2_pages(
    pdf_input: str | Path | bytes,
    template_map: dict[str, Any] | None = None,
    ocr_pages: Iterable[Any] | None = None,
) -> list[dict[str, Any]]:
    pymupdf = _require_pymupdf()
    mapping = template_map or load_template_map()
    page_size = mapping.get("page_size") or [612.0, 792.0]
    supplied: dict[int, Any] = {}
    for page_result in ocr_pages or []:
        index = getattr(page_result, "index", None)
        if index is None:
            continue
        supplied[int(index)] = page_result
    doc = _open_pdf(pymupdf, pdf_input)
    try:
        extracts: list[dict[str, Any]] = []
        for index, page in enumerate(doc):
            page_words: list[dict[str, Any]] | None = None
            convert_page = supplied.get(index)
            if convert_page is not None:
                page_words = convert_relative_words(convert_page.words, page.rect.width, page.rect.height)
                if not getattr(convert_page, "is_native_text", True):
                    page_words = _with_native_values(_native_page_words(page), page_words)
            forms = mapping.get("forms") or []
            if page.rect.height < 500:
                forms = forms[:1]
            parsed: dict[str, Any] | None = None
            if not page_words:
                page_words = _native_page_words(page) or None
            looks_w2 = is_w2_page(page, page_words)
            four_up = is_four_up_w2(_combined_page_text(page, page_words))
            if looks_w2:
                for form in forms:
                    parsed = parse_w2_form(
                        page, form, page_index=index, page_size=page_size, words=page_words, four_up=four_up
                    )
                    if _extract_is_plausible(parsed):
                        break
                    parsed = None
                if convert_page is not None and page_words and _should_ocr_w2(page, page_words, parsed):
                    parsed = parse_w2_from_ocr_words(page, page_words, page_index=index) or parsed
            # The shared converter has already made the OCR/native-text
            # decision for every supplied page. Re-running the specialized
            # fallback here loads a second RapidOCR engine and can exhaust the
            # parser task on multi-page scanned packets. Keep the fallback for
            # standalone callers that did not supply converter evidence.
            if convert_page is None and _should_ocr_w2(page, page_words, parsed):
                try:
                    ocr_words = ocr_page_words(page)
                except Exception:
                    logger.exception("w2_page_ocr_failed page=%s", index)
                    ocr_words = []
                if ocr_words:
                    page_words = ocr_words
                    looks_w2 = looks_w2 or is_w2_page(page, page_words)
                    four_up = four_up or is_four_up_w2(_combined_page_text(page, page_words))
                if looks_w2:
                    parsed = parse_w2_from_ocr_words(page, page_words, page_index=index) or parsed
                    if not _extract_is_plausible(parsed):
                        parsed = None
                        for form in forms:
                            parsed = parse_w2_form(
                                page, form, page_index=index, page_size=page_size, words=page_words, four_up=four_up
                            )
                            if _extract_is_plausible(parsed):
                                break
                            parsed = None
            if looks_w2:
                parsed = _apply_federal_fallbacks(page, page_words, parsed, index)
                parsed = _fill_employer_identity(page, page_words, parsed)
            if _extract_is_plausible(parsed) and parsed:
                extracts.append(parsed)
        return extracts
    finally:
        doc.close()
