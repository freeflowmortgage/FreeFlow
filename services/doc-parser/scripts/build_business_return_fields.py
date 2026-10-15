"""Build and verify templates/business_return_fields.json.

    python scripts/build_business_return_fields.py

The exact cells the Form 1084 business-income calculation reads from Forms
1065 and 1120-S, with their boxes taken from the official fillable blanks.

Each entry states the caption its box must sit next to, and the build fails if
it does not. That check is the point of this file. Line numbers restart in
every schedule and shift between form revisions: on the 2025 forms ordinary
business income is 1065 line 23 and 1120-S line 22, one past "Total
deductions", and a line number alone put "4b" on Schedule K's Guaranteed
payments instead of Schedule M-1's meals. Pinning each box to its caption means
a revision that moves a line fails loudly here instead of quietly extracting
the wrong figure.

The same items sit at different line numbers on the two forms:

    item                      1065         1120-S
    gain or loss, Form 4797   line 6       line 4
    other income or loss      line 7       line 5
    depreciation              line 16c     line 14
    depreciation in COGS      line 16b     --
    ordinary business income  line 23      line 22
    meals and entertainment   M-1 line 4b  M-1 line 3b
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"

# (field, form label, line label, page, box, caption the box must sit beside,
#  how the 1084 calculation uses it)
FIELDS: dict[str, dict] = {
    "1065": {
        "blank": "f1065.pdf",
        "fields": [
            ("ordinary_income", "Line 23", 0, [504.0, 510.0, 576.0, 522.0],
             "Ordinary business income", "base"),
            ("gain_4797", "Line 6", 0, [504.0, 294.0, 576.0, 306.0],
             "Form 4797", "subtract"),
            ("other_income", "Line 7", 0, [504.0, 306.0, 576.0, 318.0],
             "Other income", "subtract_with_review"),
            ("depreciation", "Line 16c", 0, [504.0, 426.0, 576.0, 438.0],
             "depreciation reported on Form 1125-A", "add_back"),
            ("depreciation_1125a", "Line 16b", 0, [410.4, 426.0, 481.65, 438.0],
             "Less depreciation reported on Form 1125-A", "add_back"),
            ("meals", "Schedule M-1 line 4b", 5, [165.6, 648.0, 223.2, 660.0],
             "Travel and entertainment", "deduct"),
        ],
    },
    "1120s": {
        "blank": "f1120s.pdf",
        "fields": [
            ("ordinary_income", "Line 22", 0, [496.8, 480.0, 576.0, 492.0],
             "Ordinary business income", "base"),
            ("gain_4797", "Line 4", 0, [496.8, 264.0, 576.0, 276.0],
             "Form 4797", "subtract"),
            ("other_income", "Line 5", 0, [496.8, 276.0, 576.0, 288.0],
             "Other income", "subtract_with_review"),
            ("depreciation", "Line 14", 0, [496.8, 384.0, 576.0, 396.0],
             "Depreciation from Form 4562", "add_back"),
            ("meals", "Schedule M-1 line 3b", 4, [168.8, 192.0, 223.2, 204.0],
             "Travel and entertainment", "deduct"),
        ],
    },
}

# Cells a figure falls back to when its own cell is blank, best first.
#
# Form 1065 splits depreciation over three cells: 16a is every dollar of
# trade-or-business depreciation the partnership claimed, 16b the part of that
# already deducted through cost of goods sold on Form 1125-A, and 16c the
# remainder, deducted on line 16 itself. Reading 16c alone was short by 16b,
# and a return with nothing in cost of goods sold often carries the figure on
# 16a with the 16c net left blank, which was read as no depreciation at all.
#
# 16b is read alongside 16c so the two add up to 16a, and 16a stands in when
# 16c is blank. A return cannot need both: 16c is blank only when there is no
# 16b to subtract from 16a.
FALLBACK_CELLS: dict[tuple[str, str], list[tuple[str, int, list[float], str]]] = {
    ("1065", "depreciation"): [
        ("Line 16a", 0, [410.4, 414.0, 481.65, 426.0],
         "Depreciation (if required, attach Form 4562)"),
    ],
}

ROW_TOLERANCE = 4.0

# K-1s are laid out differently from the return faces. A Part III box prints
# its caption above the entry cell, and the Item J ownership table crosses a
# row caption on the left (Profit / Loss / Capital) with a column header above
# (Beginning / Ending). Each field therefore lists one or more checks:
#   ("left",   text)  printed to the left on the same row
#   ("above",  text)  printed just above, overlapping the box horizontally
#   ("column", text)  a column header somewhere above whose centre falls
#                     inside the box, which is what separates Ending from
#                     Beginning on the ownership row
K1_FIELDS: dict[str, dict] = {
    "1065-k1": {
        "blank": "f1065sk1.pdf",
        "fields": [
            ("ordinary_income", "Box 1", 0, [331.2, 82.0, 445.65, 96.0],
             [("above", "Ordinary business income")], "base"),
            ("net_rental_real_estate", "Box 2", 0, [331.2, 106.0, 445.65, 120.0],
             [("above", "Net rental real estate income")], "base"),
            ("other_net_rental", "Box 3", 0, [331.2, 129.92, 445.65, 144.0],
             [("above", "Other net rental income")], "base"),
            ("guaranteed_payments_services", "Box 4a", 0, [331.2, 154.0, 445.65, 168.0],
             [("above", "Guaranteed payments for services")], "base"),
            ("guaranteed_payments_capital", "Box 4b", 0, [331.2, 178.0, 445.65, 192.0],
             [("above", "Guaranteed payments for capital")], "base"),
            ("profit_pct_end", "Item J", 0, [194.4, 444.0, 288.0, 456.0],
             [("left", "Profit"), ("column", "Ending")], "ownership_freddie"),
            ("capital_pct_end", "Item J", 0, [194.4, 468.0, 288.0, 480.0],
             [("left", "Capital"), ("column", "Ending")], "ownership_fnma"),
            ("profit_pct_begin", "Item J", 0, [79.2, 444.0, 180.0, 456.0],
             [("left", "Profit"), ("column", "Beginning")], "reference"),
            ("capital_pct_begin", "Item J", 0, [79.2, 468.0, 180.0, 480.0],
             [("left", "Capital"), ("column", "Beginning")], "reference"),
        ],
    },
    "1120s-k1": {
        "blank": "f1120ssk.pdf",
        "fields": [
            ("ordinary_income", "Box 1", 0, [331.2, 82.0, 445.4, 96.0],
             [("above", "Ordinary business income")], "base"),
            ("net_rental_real_estate", "Box 2", 0, [331.2, 106.0, 445.4, 120.0],
             [("above", "Net rental real estate income")], "base"),
            ("other_net_rental", "Box 3", 0, [331.2, 130.0, 445.4, 144.0],
             [("above", "Other net rental income")], "base"),
            ("allocation_pct", "Item G", 0, [208.8, 528.0, 289.6, 540.0],
             [("left", "Current year allocation percentage")], "ownership"),
        ],
    },
}

# Distributions sit in coded boxes, where each row is a code cell plus an
# amount cell and only some codes are distributions. Reading the first amount
# in the box, or every amount in it, gets this wrong in both directions:
#   1065 K-1 Box 19 has two rows; code A is cash and marketable securities,
#     B is a distribution subject to section 737, C is other property. The
#     rows below it belong to Box 20 and must never be read as distributions.
#   1120-S K-1 Box 16 has six rows; only code D is distributions. A, B and C
#     are tax-exempt income and nondeductible expenses, E is repayment of
#     loans from shareholders, F is other.
CODED_BOXES: dict[str, dict] = {
    "1065-k1": {
        "distributions": {
            "line": "Box 19",
            "caption": "Distributions",
            "codes": ["A"],
            "other_codes": {"B": "Distribution subject to section 737", "C": "Other property"},
            "rows": [
                {"code": [446.4, 358.0, 468.0, 372.0], "amount": [468.0, 358.0, 574.0, 372.0]},
                {"code": [446.4, 372.0, 468.0, 396.0], "amount": [468.0, 372.0, 574.0, 396.0]},
            ],
        },
    },
    "1120s-k1": {
        "distributions": {
            "line": "Box 16",
            "caption": "Items affecting shareholder basis",
            "codes": ["D"],
            "other_codes": {
                "A": "Tax-exempt interest income",
                "B": "Other tax-exempt income",
                "C": "Nondeductible expenses",
                "E": "Repayment of loans from shareholders",
                "F": "Other",
            },
            "rows": [
                {"code": [446.4, y, 468.0, y + 14.0], "amount": [468.0, y, 575.0, y + 14.0]}
                for y in (346.0, 370.0, 394.0, 418.0, 442.0, 466.0)
            ],
        },
    },
}


def caption_beside(page: fitz.Page, box: list[float]) -> str:
    """All printed text to the left of a box on the same row."""
    centre = (box[1] + box[3]) / 2
    words = sorted(page.get_text("words"), key=lambda word: word[0])
    return " ".join(
        word[4]
        for word in words
        if abs((word[1] + word[3]) / 2 - centre) < ROW_TOLERANCE and word[2] <= box[0] + 1
    )


def caption_above(page: fitz.Page, box: list[float], reach: float = 16.0) -> str:
    """Printed text just above a box that overlaps it horizontally."""
    words = sorted(page.get_text("words"), key=lambda word: (word[1], word[0]))
    return " ".join(
        word[4]
        for word in words
        if box[1] - reach <= word[1] and word[3] <= box[1] + 2
        and word[2] >= box[0] - 2 and word[0] <= box[2]
    )


def column_header_above(page: fitz.Page, box: list[float], header: str, reach: float = 48.0) -> bool:
    """A header word above the box whose centre falls inside it horizontally."""
    for word in page.get_text("words"):
        if word[4].strip().lower() != header.lower():
            continue
        centre = (word[0] + word[2]) / 2
        if box[0] <= centre <= box[2] and box[1] - reach <= word[1] < box[1]:
            return True
    return False


def _check(page: fitz.Page, box: list[float], mode: str, text: str) -> tuple[bool, str]:
    if mode == "left":
        found = caption_beside(page, box)
        return text.lower() in found.lower(), found
    if mode == "above":
        found = caption_above(page, box)
        return text.lower() in found.lower(), found
    if mode == "column":
        return column_header_above(page, box, text), f"column header {text!r}"
    raise ValueError(f"unknown check mode {mode!r}")


def build() -> tuple[dict, list[str]]:
    out: dict = {"units": "pdf-points", "page_size": [612, 792], "forms": {}}
    failures: list[str] = []

    for form, spec in FIELDS.items():
        document = fitz.open(TEMPLATES / spec["blank"])
        try:
            entries = {}
            for field, line, page_index, box, expected, use in spec["fields"]:
                ok, found = _check(document[page_index], box, "left", expected)
                if not ok:
                    failures.append(
                        f"{form} {field}: box on page {page_index} sits beside "
                        f"{found[-90:]!r}, expected {expected!r}"
                    )
                entry = {
                    "line": line,
                    "page": page_index,
                    "box": box,
                    "caption": expected,
                    "use": use,
                }
                fallbacks = []
                for alt_line, alt_page, alt_box, alt_caption in FALLBACK_CELLS.get((form, field), []):
                    ok, found = _check(document[alt_page], alt_box, "left", alt_caption)
                    if not ok:
                        failures.append(
                            f"{form} {field}: fallback box on page {alt_page} sits beside "
                            f"{found[-90:]!r}, expected {alt_caption!r}"
                        )
                    fallbacks.append(
                        {"line": alt_line, "page": alt_page, "box": alt_box, "caption": alt_caption}
                    )
                if fallbacks:
                    entry["fallbacks"] = fallbacks
                entries[field] = entry
            out["forms"][form] = {"blank": spec["blank"], "fields": entries}
        finally:
            document.close()

    for form, spec in K1_FIELDS.items():
        document = fitz.open(TEMPLATES / spec["blank"])
        try:
            entries = {}
            for field, line, page_index, box, checks, use in spec["fields"]:
                for mode, text in checks:
                    ok, found = _check(document[page_index], box, mode, text)
                    if not ok:
                        failures.append(
                            f"{form} {field}: {mode} check for {text!r} failed; "
                            f"found {found[-90:]!r}"
                        )
                entries[field] = {
                    "line": line,
                    "page": page_index,
                    "box": box,
                    "caption": checks[0][1],
                    "checks": [list(check) for check in checks],
                    "use": use,
                }
            coded = {}
            for name, box_spec in CODED_BOXES.get(form, {}).items():
                first_amount = box_spec["rows"][0]["amount"]
                ok, found = _check(document[0], first_amount, "above", box_spec["caption"])
                if not ok:
                    failures.append(
                        f"{form} {name}: {box_spec['line']} caption {box_spec['caption']!r} "
                        f"not above its first row; found {found[-90:]!r}"
                    )
                coded[name] = box_spec
            out["forms"][form] = {"blank": spec["blank"], "fields": entries, "coded_boxes": coded}
        finally:
            document.close()

    return out, failures


def main() -> int:
    mapping, failures = build()
    if failures:
        print("caption check failed; not writing the map:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
        return 1
    path = TEMPLATES / "business_return_fields.json"
    path.write_text(json.dumps(mapping, indent=2) + "\n")
    count = sum(len(form["fields"]) for form in mapping["forms"].values())
    print(f"wrote {path.name}: {count} fields, every box verified against its caption")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
