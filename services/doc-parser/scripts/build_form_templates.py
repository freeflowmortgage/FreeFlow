"""Generate form-bound field maps from the official fillable IRS blanks.

    python scripts/build_form_templates.py

Schedule E is the most dependable extractor in this service because
templates/schedule_e_map.json gives it the exact cell for every figure, so OCR
only ever reads inside a known box. Every other business form falls back to
finding a caption and clipping to its right, which is how a W-2 Box 5 can read
the "5" out of its own label and how 1065 salaries can pick up the
guaranteed-payments figure on the next line.

The IRS publishes these forms as fillable AcroForms, so the geometry does not
have to be measured by hand: each input is a named widget with an exact
rectangle. This script reads those widgets and labels each one with the line
number printed to its left on the same row, producing a map in the same spirit
as schedule_e_map.json.

Coordinates are PDF points on the blank. A filled return is the same size and
layout, so a box from the blank locates the same cell on a real return.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"

# Blank file (in templates/) -> form id used in the emitted map.
BLANKS = {
    "f1065.pdf": "1065",
    "f1065sk1.pdf": "1065-k1",
    "f1120s.pdf": "1120s",
    "f1120ssk.pdf": "1120s-k1",
    "f1120.pdf": "1120",
    "f1125e.pdf": "1125e",
}

LINE_LABEL = re.compile(r"^(\d{1,2}[a-z]?)$")
ROW_TOLERANCE = 4.0
"""Points between a widget's vertical centre and its caption's. Form rows are
12 points apart, so this is generous without reaching the neighbouring row."""

MIN_AMOUNT_WIDTH = 40.0
"""Narrower widgets are checkboxes and single-character cells, not amounts."""

SECTION_HEADINGS = (
    "Schedule M-1",
    "Schedule M-2",
    "Schedule M-3",
    "Schedule L",
    "Schedule K",
    "Schedule B",
)
"""Line numbers restart in every schedule, so a line number alone is
ambiguous: the 1065's "4b" is Guaranteed payments (Capital) on Schedule K but
meals and entertainment on Schedule M-1. Each widget is filed under the
nearest heading above it."""


def _section_starts(page: fitz.Page) -> list[tuple[float, str]]:
    starts: list[tuple[float, str]] = []
    for heading in SECTION_HEADINGS:
        for hit in page.search_for(heading):
            starts.append((hit.y0, heading))
    return sorted(starts)


def _section_for(rect: fitz.Rect, starts: list[tuple[float, str]], default: str) -> str:
    current = default
    for y0, heading in starts:
        if y0 <= rect.y0 + 1:
            current = heading
        else:
            break
    return current


def _row_label(rect: fitz.Rect, words: list[tuple]) -> str | None:
    """The nearest line number printed to the left of a widget on its row."""
    centre = (rect.y0 + rect.y1) / 2
    candidates = [
        word
        for word in words
        if abs((word[1] + word[3]) / 2 - centre) < ROW_TOLERANCE
        and word[2] <= rect.x0
        and LINE_LABEL.match(word[4])
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda word: word[0])[4]


def build_map(pdf_path: Path, form_id: str) -> dict:
    document = fitz.open(pdf_path)
    pages: list[dict] = []
    try:
        for page_index, page in enumerate(document):
            words = page.get_text("words")
            starts = _section_starts(page)
            default = "Return" if page_index == 0 else f"Page {page_index + 1}"
            sections: dict[str, dict[str, dict]] = {}
            for widget in page.widgets():
                rect = widget.rect
                if rect.width < MIN_AMOUNT_WIDTH:
                    continue
                label = _row_label(rect, words)
                if label is None:
                    continue
                section = _section_for(rect, starts, default)
                lines = sections.setdefault(section, {})
                entry = {
                    "box": [round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)],
                    "widget": widget.field_name.split(".")[-1],
                }
                # A line can carry an inner sub-amount and a right-hand total
                # (1065 16a/16b feed 16c). Keep the right-most as the line's
                # value and the rest as sub-amounts.
                existing = lines.get(label)
                if existing is None or rect.x0 > existing["box"][0]:
                    if existing is not None:
                        entry.setdefault("inner", []).append(existing)
                    lines[label] = entry
                else:
                    existing.setdefault("inner", []).append(entry)
            if sections:
                pages.append({"page": page_index, "sections": sections})
    finally:
        document.close()

    return {
        "form": form_id,
        "source": pdf_path.name,
        "units": "pdf-points",
        "page_size": [612, 792],
        "pages": pages,
    }


def main() -> int:
    written = 0
    for filename, form_id in BLANKS.items():
        pdf_path = TEMPLATES / filename
        if not pdf_path.exists():
            print(f"skip {filename}: not in templates/", file=sys.stderr)
            continue
        mapping = build_map(pdf_path, form_id)
        out = TEMPLATES / f"{form_id.replace('-', '_')}_map.json"
        out.write_text(json.dumps(mapping, indent=2) + "\n")
        total = sum(
            len(lines) for page in mapping["pages"] for lines in page["sections"].values()
        )
        print(f"{out.name:22} {total:3} labelled lines across {len(mapping['pages'])} page(s)")
        written += 1
    return 0 if written else 1


if __name__ == "__main__":
    raise SystemExit(main())
