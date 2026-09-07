"""Schedule E Page 1 grid extractor (properties A/B/C on every rental page).

The line-regex mapper only keeps the first Line 1a / Line 2 hit on a page, so
column B/C and later Schedule E pages drop address and fair rental days.

This module builds a one-time bounding-box map from the official IRS blank
(f1040se.pdf) and clips those boxes on every Page 1 in the package — not just
doc[0].
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger("freeflow.schedule_e")

def _template_dir() -> Path:
    here = Path(__file__).resolve().parent
    for candidate in (here / "templates", here.parent / "templates"):
        if candidate.exists():
            return candidate
    return here.parent / "templates"


TEMPLATE_DIR = _template_dir()
DEFAULT_BLANK = TEMPLATE_DIR / "f1040se.pdf"
DEFAULT_MAP = TEMPLATE_DIR / "schedule_e_map.json"

PAGE1_MARKERS = (
    "Supplemental Income and Loss",
    "Physical address of each property",
    "Fair Rental",
)
ROW_ANCHORS = {
    "3": "Rents received",
    "4": "Royalties received",
    "5": "Advertising",
    "6": "Auto and travel",
    "7": "Cleaning and maintenance",
    "8": "Commissions",
    "9": "Insurance",
    "10": "Legal and other professional",
    "11": "Management fees",
    "12": "Mortgage interest paid",
    "13": "Other interest",
    "14": "Repairs",
    "15": "Supplies",
    "16": "Taxes",
    "17": "Utilities",
    "18": "Depreciation expense or depletion",
    "19": "Other (list)",
    "20": "Total expenses",
    "21": "file Form 6198",
}


def parse_tax_amount(raw_text: str) -> float:
    """Parse IRS numeric strings into signed floats, including '(2,564)'."""
    if not raw_text:
        return 0.0
    clean = raw_text.strip().replace("$", "").replace(",", "")
    paren = re.search(r"\(\s*(\d+(?:\.\d+)?)\s*\)", clean)
    if paren:
        return -float(paren.group(1))
    if clean.startswith("-"):
        digits = re.sub(r"[^\d.]", "", clean)
        return -float(digits) if digits else 0.0
    digits = re.sub(r"[^\d.]", "", clean)
    return float(digits) if digits else 0.0


_OCR_ENGINE = None
NATIVE_TEXT_MIN_CHARS = 40
ROTATION_DIGITS = str.maketrans("01689", "01986")


def _require_pymupdf():
    try:
        import pymupdf
    except ImportError as exc:  # pragma: no cover - optional at runtime
        raise RuntimeError("pymupdf is required for the Schedule E grid parser") from exc
    return pymupdf


def _ocr_engine():
    global _OCR_ENGINE
    if _OCR_ENGINE is not None:
        return _OCR_ENGINE
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        from rapidocr import RapidOCR
    _OCR_ENGINE = RapidOCR()
    return _OCR_ENGINE


def _page_plain_text(page: Any) -> str:
    return (page.get_text("text") or "").strip()


def page_needs_ocr(page: Any) -> bool:
    return len(_page_plain_text(page)) < NATIVE_TEXT_MIN_CHARS


def _normalize_ocr_rows(raw: Any) -> list[tuple[Any, str]]:
    if raw is None:
        return []
    if hasattr(raw, "result"):
        raw = raw.result
    rows: list[tuple[Any, str]] = []
    for item in raw or []:
        if item is None:
            continue
        if isinstance(item, dict):
            box = item.get("box") or item.get("dt_boxes")
            text = str(item.get("text") or item.get("rec_txt") or "").strip()
        else:
            box, text = item[0], str(item[1]).strip()
        if box is not None and text:
            rows.append((box, text))
    return rows


def _ocr_numpy_words(image: Any, zoom: float) -> list[dict[str, Any]]:
    try:
        engine = _ocr_engine()
    except ImportError:
        logger.warning("schedule_e_ocr_unavailable")
        return []
    output = engine(image)
    raw = output[0] if isinstance(output, tuple) else output
    words: list[dict[str, Any]] = []
    for box, text in _normalize_ocr_rows(raw):
        xs = [point[0] for point in box]
        ys = [point[1] for point in box]
        words.append(
            {
                "x0": min(xs) / zoom,
                "y0": min(ys) / zoom,
                "x1": max(xs) / zoom,
                "y1": max(ys) / zoom,
                "text": text,
            }
        )
    return words


def ocr_page_words(page: Any, *, zoom: float = 2.5) -> list[dict[str, Any]]:
    cached = getattr(page, "_freeflow_ocr_words", None)
    if cached is not None:
        return cached
    pymupdf = _require_pymupdf()
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    try:
        import io

        import numpy as np
        from PIL import Image

        image = np.array(Image.open(io.BytesIO(pix.tobytes("png"))))
    finally:
        pix = None
    words = _ocr_numpy_words(image, zoom)
    setattr(page, "_freeflow_ocr_words", words)
    logger.info("schedule_e_page_ocr words=%s", len(words))
    return words


def convert_relative_words(
    relative_words: Iterable[Any],
    page_width: float,
    page_height: float,
) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for word in relative_words or []:
        text = str(getattr(word, "text", None) or (word.get("text") if isinstance(word, dict) else "") or "").strip()
        if not text:
            continue
        if isinstance(word, dict):
            x, y, w, h = float(word["x"]), float(word["y"]), float(word["w"]), float(word["h"])
        else:
            x, y, w, h = float(word.x), float(word.y), float(word.w), float(word.h)
        words.append(
            {
                "x0": x * page_width,
                "y0": y * page_height,
                "x1": (x + w) * page_width,
                "y1": (y + h) * page_height,
                "text": text,
            }
        )
    return words


def relative_box(page: Any, box: Iterable[float] | None) -> dict[str, float] | None:
    """Convert a PDF-point clip [x0, y0, x1, y1] into a 0–1 overlay box."""
    if not box:
        return None
    coords = [float(value) for value in box]
    if len(coords) < 4:
        return None
    x0, y0, x1, y1 = coords[:4]
    width = float(page.rect.width) or 1.0
    height = float(page.rect.height) or 1.0
    rel = {
        "x": x0 / width,
        "y": y0 / height,
        "w": max(0.0, (x1 - x0) / width),
        "h": max(0.0, (y1 - y0) / height),
    }
    if rel["w"] <= 0 or rel["h"] <= 0:
        return None
    return rel


def property_overlay_boxes(page: Any, template_map: dict[str, Any], column: str) -> dict[str, Any]:
    meta = template_map.get("properties_meta", {}).get(column, {})
    financials: dict[str, dict[str, float]] = {}
    for line_num, columns in (template_map.get("financial_grid") or {}).items():
        rel = relative_box(page, columns.get(column))
        if rel:
            financials[str(line_num)] = rel
    boxes: dict[str, Any] = {"financials": financials}
    address = relative_box(page, meta.get("address_box"))
    type_code = relative_box(page, meta.get("type_code_box"))
    days = relative_box(page, meta.get("fair_rental_days_box"))
    if address:
        boxes["address"] = address
    if type_code:
        boxes["type"] = type_code
    if days:
        boxes["days"] = days
    return boxes


def words_in_box(words: Iterable[dict[str, Any]], box: Iterable[float], *, pad: float = 3.0) -> list[dict[str, Any]]:
    x0, y0, x1, y1 = (float(v) for v in box)
    hits: list[dict[str, Any]] = []
    for word in words:
        cx = (float(word["x0"]) + float(word["x1"])) / 2
        cy = (float(word["y0"]) + float(word["y1"])) / 2
        if x0 - pad <= cx <= x1 + pad and y0 - pad <= cy <= y1 + pad:
            hits.append(word)
    hits.sort(key=lambda item: (item["x0"], item["y0"]))
    return hits


def clip_words_text(words: Iterable[dict[str, Any]], box: Iterable[float], *, money: bool = False) -> str:
    hits = words_in_box(words, box)
    if money:
        amountish = [word for word in hits if re.search(r"[\d()]", word["text"])]
        if amountish:
            hits = amountish
    return " ".join(word["text"] for word in hits).strip()


def _digit_text(words: list[dict[str, Any]]) -> str:
    hits = [word for word in words if re.search(r"[\d()]", word["text"])]
    hits.sort(key=lambda item: item["x0"])
    return " ".join(word["text"] for word in hits).strip()


def ocr_clip_readings(page: Any, box: Iterable[float], *, zoom: float = 6.0, pad: float = 2.0) -> list[float]:
    """High-zoom recrop of one cell, upright and 180° (006 ↔ 900). Both readings are form-bound."""
    pymupdf = _require_pymupdf()
    x0, y0, x1, y1 = (float(v) for v in box)
    rect = pymupdf.Rect(x0 - pad, y0 - pad, x1 + pad, y1 + pad)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=rect, alpha=False)
    try:
        import io

        import numpy as np
        from PIL import Image

        image = np.array(Image.open(io.BytesIO(pix.tobytes("png"))))
    finally:
        pix = None
    readings: list[float] = []
    seen: set[float] = set()
    for crop in (image, np.rot90(image, 2)):
        raw = _digit_text(_ocr_numpy_words(crop, zoom))
        if not raw:
            continue
        amount = parse_tax_amount(raw)
        if amount in seen:
            continue
        seen.add(amount)
        readings.append(amount)
    return readings


def rotation_twin_amount(value: float, needed: float) -> bool:
    """True when `value` is an upside-down reading of `needed` (006 ↔ 900)."""
    if abs(value - round(value)) > 1e-6 or abs(needed - round(needed)) > 1e-6:
        return False
    current_i, needed_i = int(round(value)), int(round(needed))
    if current_i < 0 or needed_i < 0:
        return False
    width = max(len(str(current_i)), len(str(needed_i)), 1)
    source = str(current_i).zfill(width)
    if any(char not in "01689" for char in source):
        return False
    return int(source.translate(ROTATION_DIGITS)[::-1]) == needed_i


def _first_hit(page: Any, needle: str):
    hits = page.search_for(needle)
    if not hits:
        raise ValueError(f"Schedule E template is missing anchor {needle!r}")
    return hits[0]


def _open_pdf(pymupdf, pdf_input: str | Path | bytes):
    if isinstance(pdf_input, (bytes, bytearray)):
        return pymupdf.open(stream=bytes(pdf_input), filetype="pdf")
    return pymupdf.open(pdf_input)


def _page_search_text(page: Any, words: list[dict[str, Any]] | None = None) -> str:
    text = _page_plain_text(page)
    if text:
        return text
    source = words if words is not None else (ocr_page_words(page) if page_needs_ocr(page) else [])
    return " ".join(word["text"] for word in source)


def is_schedule_e_page1(page: Any, words: list[dict[str, Any]] | None = None) -> bool:
    text = _page_search_text(page, words)
    if "Page 2" in text and "Part II" in text:
        return False
    return all(marker.lower() in text.lower() for marker in PAGE1_MARKERS)


def extract_tax_year(page: Any, words: list[dict[str, Any]] | None = None) -> int | None:
    text = _page_search_text(page, words)
    match = re.search(r"\b(20\d{2})\b", text)
    return int(match.group(1)) if match else None


def generate_template_map(
    blank_pdf_path: str | Path | None = None,
    output_json_path: str | Path | None = None,
) -> dict[str, Any]:
    """Map deterministic boxes from the official blank Schedule E Page 1."""
    pymupdf = _require_pymupdf()
    blank_path = Path(blank_pdf_path) if blank_pdf_path else DEFAULT_BLANK
    doc = pymupdf.open(blank_path)
    try:
        page = doc[0]
        anchor_1a = _first_hit(page, "1a")
        anchor_1b = _first_hit(page, "1b")
        fair_rental = page.search_for("Fair Rental Days") or page.search_for("Fair Rental")
        if not fair_rental:
            raise ValueError("Schedule E template is missing Fair Rental Days")
        fair_rental_anchor = fair_rental[0]
        legend_anchor = _first_hit(page, "Type of Property:")
        prop_anchor = _first_hit(page, "Properties:")
        rents_anchor = _first_hit(page, "Rents received")

        addr_left = anchor_1a.x0 + 15
        addr_right = page.rect.width - 36
        addr_span = max(anchor_1b.y0 - anchor_1a.y1, 24.0)
        row_height = addr_span / 3.0
        properties_meta = {
            letter: {
                "address_box": [
                    addr_left,
                    anchor_1a.y1 + idx * row_height,
                    addr_right,
                    anchor_1a.y1 + (idx + 1) * row_height if idx < 2 else anchor_1b.y0,
                ]
            }
            for idx, letter in enumerate(("A", "B", "C"))
        }

        meta_words = page.get_text(
            "words",
            clip=pymupdf.Rect(anchor_1b.x0, anchor_1b.y1, fair_rental_anchor.x0, legend_anchor.y0),
        )
        meta_rows: dict[str, tuple[float, float]] = {}
        for word in meta_words:
            if word[4] in {"A", "B", "C"}:
                meta_rows[word[4]] = (word[1] - 2, word[3] + 2)
        for letter, (y0, y1) in meta_rows.items():
            # Type code is a narrow box under 1b — do not stretch to Fair Rental Days.
            properties_meta[letter]["type_code_box"] = [
                anchor_1b.x0 + 15,
                y0,
                min(anchor_1b.x0 + 90, fair_rental_anchor.x0 - 80),
                y1,
            ]
            properties_meta[letter]["fair_rental_days_box"] = [
                fair_rental_anchor.x0 - 2,
                y0,
                fair_rental_anchor.x1 + 4,
                y1,
            ]

        # Column A sits left of the "Properties:" label; clip the full header band.
        header_strip = pymupdf.Rect(300, prop_anchor.y1 - 2, page.rect.width, rents_anchor.y0)
        centers: dict[str, float] = {}
        for word in page.get_text("words", clip=header_strip):
            if word[4] in {"A", "B", "C"}:
                centers[word[4]] = (word[0] + word[2]) / 2
        columns_x: dict[str, list[float]] = {}
        ordered = [letter for letter in ("A", "B", "C") if letter in centers]
        for idx, letter in enumerate(ordered):
            left = 320.0 if idx == 0 else (centers[ordered[idx - 1]] + centers[letter]) / 2
            right = page.rect.width - 20 if idx == len(ordered) - 1 else (centers[letter] + centers[ordered[idx + 1]]) / 2
            columns_x[letter] = [left, right]

        financial_grid: dict[str, dict[str, list[float]]] = {}
        for line_num, label in ROW_ANCHORS.items():
            hits = page.search_for(label)
            if not hits:
                logger.warning("schedule_e_template_missing_row line=%s label=%s", line_num, label)
                continue
            hit = hits[0]
            y0, y1 = hit.y0 - 2, hit.y1 + 3
            financial_grid[line_num] = {letter: [x0, y0, x1, y1] for letter, (x0, x1) in columns_x.items()}

        template_map = {"properties_meta": properties_meta, "financial_grid": financial_grid}
        _overlay_official_widgets(page, template_map)
    finally:
        doc.close()

    destination = Path(output_json_path) if output_json_path else DEFAULT_MAP
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(template_map, indent=2), encoding="utf-8")
    return template_map


def _rect_list(widget: Any) -> list[float]:
    rect = widget.rect
    return [float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)]


def _overlay_official_widgets(page: Any, template_map: dict[str, Any]) -> None:
    """Snap boxes to the official IRS AcroForm widgets on f1040se.pdf when present."""
    widgets = list(page.widgets() or [])
    if not widgets:
        return

    for letter in ("A", "B", "C"):
        row = f"Row{letter}[0]"
        meta = template_map["properties_meta"].setdefault(letter, {})
        line2_days: list[Any] = []
        for widget in widgets:
            name = widget.field_name or ""
            if f"Table_Line1a[0].{row}" in name:
                meta["address_box"] = _rect_list(widget)
            elif f"Table_Line1b[0].{row}" in name:
                meta["type_code_box"] = _rect_list(widget)
            elif f"Table_Line2[0].{row}" in name and getattr(widget, "field_type_string", "Text") == "Text":
                line2_days.append(widget)
        if line2_days:
            line2_days.sort(key=lambda item: item.rect.x0)
            meta["fair_rental_days_box"] = _rect_list(line2_days[0])
            if len(line2_days) > 1:
                meta["personal_use_days_box"] = _rect_list(line2_days[1])

    for line_num in ROW_ANCHORS:
        money = [
            widget
            for widget in widgets
            if f".Line{line_num}[0]" in (widget.field_name or "")
            and widget.rect.x0 > 300
            and getattr(widget, "field_type_string", "Text") == "Text"
        ]
        money.sort(key=lambda item: item.rect.x0)
        if len(money) < 3:
            continue
        template_map["financial_grid"][line_num] = {
            letter: _rect_list(widget) for letter, widget in zip(("A", "B", "C"), money[:3])
        }


def load_template_map(map_path: str | Path | None = None) -> dict[str, Any]:
    path = Path(map_path) if map_path else DEFAULT_MAP
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    if DEFAULT_BLANK.exists():
        return generate_template_map(DEFAULT_BLANK, path)
    raise FileNotFoundError(f"Schedule E template map not found at {path}")


def _widget_value_in_box(page: Any, pymupdf, box: Iterable[float]) -> str:
    target = pymupdf.Rect(box)
    hits: list[tuple[float, str]] = []
    for widget in page.widgets() or []:
        value = str(getattr(widget, "field_value", "") or "").strip()
        if not value:
            continue
        overlap = target & widget.rect
        if overlap.is_empty:
            continue
        hits.append((overlap.get_area(), value))
    if not hits:
        return ""
    hits.sort(reverse=True)
    return hits[0][1]


def _clip_text(
    page: Any,
    pymupdf,
    box: Iterable[float],
    words: list[dict[str, Any]] | None = None,
    *,
    money: bool = False,
) -> str:
    clipped = (page.get_text("text", clip=pymupdf.Rect(box)) or "").strip()
    if clipped:
        return clipped
    widget = _widget_value_in_box(page, pymupdf, box)
    if widget:
        return widget
    if words:
        return clip_words_text(words, box, money=money)
    return ""


ADDRESS_NOISE = re.compile(
    r"physical address of each property(?:\s*\(\s*street,\s*city,\s*state,\s*ZIP code\s*\))?",
    re.I,
)


def _has_money(financials: dict[str, Any] | None) -> bool:
    return any(abs(float(value or 0)) > 0.005 for value in (financials or {}).values())


def clean_address(raw: str) -> str:
    text = ADDRESS_NOISE.sub(" ", raw or "")
    return re.sub(r"\s+", " ", text).strip(" \t,;:-")


def clean_property_type(raw: str) -> str:
    match = re.search(r"[1-8]", raw or "")
    return match.group(0) if match else ""


def clean_fair_rental_days(raw: str) -> int:
    candidates = [int(token) for token in re.findall(r"\d{1,3}", raw or "")]
    days = [value for value in candidates if 1 <= value <= 366]
    return days[-1] if days else 0


def is_street_address(address: str) -> bool:
    if not address or len(address) < 8:
        return False
    return bool(re.search(r"\d{1,6}\s+[A-Za-z]", address))


def _best_identity(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    streets = [clean_address(row.get("address") or "") for row in rows]
    streets = [address for address in streets if is_street_address(address)]
    streets.sort(key=lambda address: ("," in address, len(address)), reverse=True)
    types = [clean_property_type(row.get("property_type") or "") for row in rows]
    days = [clean_fair_rental_days(row.get("fair_rental_days") or "") for row in rows]
    return {
        "address": streets[0] if streets else "",
        "property_type": next((code for code in types if code), ""),
        "fair_rental_days": next((value for value in days if value), 0),
    }


def _coalesce_software_layout(extracted: dict[str, dict[str, Any]]) -> None:
    """Tax-software prints often put the only address on official row B while money stays in column A."""
    money_letters = [letter for letter in ("A", "B", "C") if _has_money(extracted[letter].get("financials"))]
    if len(money_letters) != 1:
        for row in extracted.values():
            row["address"] = clean_address(row.get("address") or "")
            row["property_type"] = clean_property_type(row.get("property_type") or "")
            row["fair_rental_days"] = str(clean_fair_rental_days(row.get("fair_rental_days") or ""))
        return

    identity = _best_identity(extracted.values())
    owner = extracted[money_letters[0]]
    owner["address"] = identity["address"]
    owner["property_type"] = identity["property_type"]
    owner["fair_rental_days"] = str(identity["fair_rental_days"] or "")
    for letter in ("A", "B", "C"):
        if letter == money_letters[0]:
            continue
        extracted[letter]["address"] = ""
        extracted[letter]["property_type"] = ""
        extracted[letter]["fair_rental_days"] = ""


def _occupied(prop: dict[str, Any]) -> bool:
    if is_street_address(prop.get("address") or ""):
        return True
    return _has_money(prop.get("financials"))


EXPENSE_LINES = tuple(str(line) for line in range(5, 20))
RECONCILE_TOLERANCE = 1.0


def _money(financials: dict[str, Any], line: str) -> float:
    return float(financials.get(line, 0.0) or 0.0)


def suspect_expense_lines(financials: dict[str, Any], delta: float) -> list[str]:
    """Expense lines that could absorb `delta` as a 6/9 rotation (or unique garbled amount)."""
    twins: list[str] = []
    garbled: list[str] = []
    for line in EXPENSE_LINES:
        current = _money(financials, line)
        needed = current + delta
        if needed < -RECONCILE_TOLERANCE:
            continue
        if rotation_twin_amount(current, needed):
            twins.append(line)
        if current + RECONCILE_TOLERANCE < needed and current < 10:
            garbled.append(line)
    if twins:
        return twins
    return garbled if len(garbled) == 1 else []


def recheck_mismatched_addbacks(
    financials: dict[str, Any],
    *,
    recheck_line,
) -> dict[str, Any] | None:
    """When L3/L20/L21 already balance, recrop the suspect add-back and keep it only if the form agrees.

    `recheck_line(line_num)` must return the amount bound on the form for that cell, or None.
    Math alone never overwrites a line — the reread has to match the missing delta.
    """
    itemized = sum(_money(financials, line) for line in EXPENSE_LINES)
    reported_20 = _money(financials, "20")
    reported_21 = _money(financials, "21")
    rents = _money(financials, "3") + _money(financials, "4")
    if abs(reported_20) <= RECONCILE_TOLERANCE or abs(itemized - reported_20) <= RECONCILE_TOLERANCE:
        return None
    if abs((rents - reported_20) - reported_21) > RECONCILE_TOLERANCE:
        return None
    delta = reported_20 - itemized
    for line in suspect_expense_lines(financials, delta):
        needed = _money(financials, line) + delta
        reread = recheck_line(line)
        if reread is None:
            continue
        candidates = reread if isinstance(reread, (list, tuple)) else [reread]
        for candidate in candidates:
            if candidate is None or candidate == "":
                continue
            reread_amount = (
                parse_tax_amount(str(candidate)) if not isinstance(candidate, (int, float)) else float(candidate)
            )
            if abs(reread_amount - needed) <= RECONCILE_TOLERANCE:
                previous = _money(financials, line)
                financials[line] = reread_amount
                return {
                    "recheckedLine": line,
                    "recheckedFrom": previous,
                    "recheckedTo": reread_amount,
                    "recheckValidated": True,
                    "recheckSource": "form-bound",
                }
    return None


def reconcile_schedule_e_financials(financials: dict[str, Any]) -> dict[str, Any]:
    """Failsafe: if itemized lines 5–19 match (or can stand in for) Line 20, confirm the visual parse.

    Visual clips stay unless Line 20 / 21 is blank and the itemized math is complete.
    Qualifying still uses the form Line 20 — this does not rebuild expenses from add-backs.
    """
    itemized = sum(_money(financials, line) for line in EXPENSE_LINES)
    reported_20 = _money(financials, "20")
    line20_source = "visual"
    if abs(reported_20) <= RECONCILE_TOLERANCE and itemized > RECONCILE_TOLERANCE:
        financials["20"] = itemized
        line20_source = "itemized-sum"
        used_20 = itemized
    else:
        used_20 = reported_20

    has_itemized = itemized > RECONCILE_TOLERANCE
    has_line20 = abs(used_20) > RECONCILE_TOLERANCE
    expenses_balanced = has_itemized and has_line20 and abs(itemized - used_20) <= RECONCILE_TOLERANCE

    rents = _money(financials, "3") + _money(financials, "4")
    calculated_net = rents - used_20
    reported_21 = _money(financials, "21")
    if calculated_net < 0 and reported_21 > 0 and abs(abs(calculated_net) - reported_21) <= RECONCILE_TOLERANCE:
        financials["21"] = -reported_21
        reported_21 = -reported_21
    net_source = "visual"
    if abs(reported_21) <= RECONCILE_TOLERANCE and abs(calculated_net) > RECONCILE_TOLERANCE:
        financials["21"] = calculated_net
        reported_21 = calculated_net
        net_source = "calculated"
    net_balanced = abs(calculated_net - reported_21) <= RECONCILE_TOLERANCE and abs(calculated_net) > RECONCILE_TOLERANCE

    if line20_source == "itemized-sum" or (net_source == "calculated" and has_itemized and not expenses_balanced):
        status = "reconstructed"
    elif expenses_balanced and (net_balanced or abs(calculated_net) <= RECONCILE_TOLERANCE):
        status = "confirmed"
    elif has_itemized and has_line20 and not expenses_balanced:
        status = "mismatch"
    else:
        status = "incomplete"

    return {
        "status": status,
        "itemizedExpenses": round(itemized, 2),
        "reportedLine20": round(reported_20, 2),
        "line20Source": line20_source,
        "expensesBalanced": expenses_balanced,
        "calculatedNet": round(calculated_net, 2),
        "netBalanced": net_balanced,
    }


def rental_months_from_days(days: int) -> int:
    """Form 1038: ceil(fair rental days / 30), capped at 12. Blank Line 2 → 12 months."""
    if days <= 0:
        return 12
    return max(1, min(12, (days + 29) // 30))


def reconcile_fair_rental_days(fair_days: int, personal_days: int = 0) -> dict[str, Any]:
    """Accept Line 2 when it is a real day count; do not treat a blank as confirmed."""
    if 1 <= fair_days <= 366:
        days_status = "full-year" if fair_days >= 365 else "accepted"
        days_balanced = personal_days <= 0 or fair_days + personal_days <= 366
    else:
        days_status = "missing"
        days_balanced = False
    return {
        "fairRentalDays": fair_days,
        "personalUseDays": personal_days,
        "rentalMonths": rental_months_from_days(fair_days),
        "daysStatus": days_status,
        "daysBalanced": days_balanced,
    }


def parse_schedule_e_page(
    page: Any,
    template_map: dict[str, Any],
    *,
    page_index: int,
    words: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    pymupdf = _require_pymupdf()
    page_words = words if words is not None else (ocr_page_words(page) if page_needs_ocr(page) else [])
    year = extract_tax_year(page, page_words)
    extracted: dict[str, dict[str, Any]] = {"A": {}, "B": {}, "C": {}}

    for letter, boxes in template_map["properties_meta"].items():
        extracted[letter] = {
            "address": _clip_text(page, pymupdf, boxes["address_box"], page_words) if "address_box" in boxes else "",
            "property_type": _clip_text(page, pymupdf, boxes["type_code_box"], page_words) if "type_code_box" in boxes else "",
            "fair_rental_days": _clip_text(page, pymupdf, boxes["fair_rental_days_box"], page_words) if "fair_rental_days_box" in boxes else "",
            "personal_use_days": _clip_text(page, pymupdf, boxes["personal_use_days_box"], page_words) if "personal_use_days_box" in boxes else "",
            "financials": {},
        }

    for line_num, prop_boxes in template_map["financial_grid"].items():
        for letter, bbox in prop_boxes.items():
            extracted[letter]["financials"][line_num] = parse_tax_amount(
                _clip_text(page, pymupdf, bbox, page_words, money=True)
            )

    _coalesce_software_layout(extracted)

    properties: list[dict[str, Any]] = []
    for letter in ("A", "B", "C"):
        raw = extracted[letter]
        financials = raw["financials"]

        def _recheck(line_num: str, *, _letter: str = letter) -> list[float]:
            box = template_map["financial_grid"].get(line_num, {}).get(_letter)
            if not box:
                return []
            readings = ocr_clip_readings(page, box)
            fallback = clip_words_text(page_words, box, money=True)
            if fallback:
                amount = parse_tax_amount(fallback)
                if amount not in readings:
                    readings.append(amount)
            return readings

        recheck = recheck_mismatched_addbacks(financials, recheck_line=_recheck)
        determination = reconcile_schedule_e_financials(financials)
        if recheck:
            determination.update(recheck)
        days = clean_fair_rental_days(str(raw.get("fair_rental_days") or ""))
        personal_days = clean_fair_rental_days(str(raw.get("personal_use_days") or ""))
        determination.update(reconcile_fair_rental_days(days, personal_days))
        prop = {
            "pageIndex": page_index,
            "column": letter,
            "year": year,
            "address": clean_address(raw.get("address") or ""),
            "propertyType": clean_property_type(raw.get("property_type") or ""),
            "fairRentalDays": days,
            "financials": financials,
            "determination": determination,
            "boxes": property_overlay_boxes(page, template_map, letter),
        }
        if _occupied(prop):
            properties.append(prop)
    return properties


def extract_schedule_e_pages(
    pdf_input: str | Path | bytes,
    template_map: dict[str, Any] | None = None,
    ocr_pages: Iterable[Any] | None = None,
) -> list[dict[str, Any]]:
    """Extract every Schedule E Page 1 in the PDF (all years, columns A/B/C)."""
    pymupdf = _require_pymupdf()
    mapping = template_map or load_template_map()
    supplied: dict[int, Any] = {}
    for page_result in ocr_pages or []:
        index = getattr(page_result, "index", None)
        if index is None or getattr(page_result, "is_native_text", False):
            continue
        supplied[int(index)] = page_result
    doc = _open_pdf(pymupdf, pdf_input)
    try:
        properties: list[dict[str, Any]] = []
        for index, page in enumerate(doc):
            page_words: list[dict[str, Any]] | None = None
            convert_page = supplied.get(index)
            if convert_page is not None:
                page_words = convert_relative_words(convert_page.words, page.rect.width, page.rect.height)
            elif page_needs_ocr(page):
                page_words = ocr_page_words(page)
            if not is_schedule_e_page1(page, page_words):
                continue
            properties.extend(parse_schedule_e_page(page, mapping, page_index=index, words=page_words))
        return properties
    finally:
        doc.close()
