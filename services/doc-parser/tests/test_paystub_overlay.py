"""Overlay boxes for the underwriter QA split view.

The console drops any box narrower or shorter than 0.004, so these tests
assert against that exact threshold. A box the viewer silently discards is the
failure mode being guarded against: the field still looks populated while
nothing highlights.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from decimal import Decimal

import pytest

from paystub_fixtures import build_paystub_pdf, build_scanned_paystub_pdf
from paystub import income_fields, parse_paystub
from paystub.models import OverlayBox, Token
from paystub.overlay import MIN_SPAN, to_overlay, union

CONSOLE_MIN = 0.004
"""isUsableOverlayBox in apps/underwriting-console/src/overlayBox.ts."""


def usable(box: dict) -> bool:
    return box["w"] > CONSOLE_MIN and box["h"] > CONSOLE_MIN


@pytest.fixture(scope="module")
def fields() -> list[dict]:
    return income_fields(parse_paystub(build_paystub_pdf()))


def test_a_thin_glyph_is_padded_above_the_console_threshold() -> None:
    """A '1' on a letter page is ~0.002 wide, under the viewer's minimum."""
    sliver = Token(text="1", x0=1000.0, y0=500.0, x1=1006.0, y1=530.0)
    box = to_overlay(sliver, width=3400, height=4400)

    assert box is not None
    assert box.w >= MIN_SPAN and box.h >= MIN_SPAN
    assert usable(box.as_dict())


def test_boxes_stay_inside_the_page() -> None:
    corner = Token(text="9", x0=3398.0, y0=4398.0, x1=3400.0, y1=4400.0)
    box = to_overlay(corner, width=3400, height=4400)

    assert box is not None
    assert 0 <= box.x and box.x + box.w <= 1.0
    assert 0 <= box.y and box.y + box.h <= 1.0


def test_union_covers_every_component() -> None:
    merged = union([OverlayBox(0.5, 0.2, 0.05, 0.01), OverlayBox(0.52, 0.30, 0.05, 0.01)])
    assert merged is not None
    assert merged.x <= 0.5
    assert merged.y <= 0.2
    assert merged.x + merged.w >= 0.57
    assert merged.y + merged.h >= 0.31


def test_union_of_nothing_is_none() -> None:
    assert union([]) is None


def test_every_emitted_field_has_a_usable_box(fields: list[dict]) -> None:
    assert fields
    for field in fields:
        assert usable(field["box"]), field["sourceFieldId"]


def test_fields_use_the_ids_the_console_already_maps(fields: list[dict]) -> None:
    """Reusing the ps-* IDs means no console change is needed to show these."""
    ids = {field["sourceFieldId"] for field in fields}
    assert {"ps-base-ytd", "ps-current-base", "ps-employer-name"} <= ids
    assert all(field["form"] == "Paystub" for field in fields)
    assert all(field["entityId"] == "paystub-p0" for field in fields)


def test_records_match_the_formextract_shape(fields: list[dict]) -> None:
    required = {
        "pageIndex",
        "form",
        "sourceFieldId",
        "boxLabel",
        "fieldLabel",
        "lineNum",
        "category",
        "value",
        "numericValue",
        "box",
        "entityId",
    }
    for field in fields:
        assert required <= set(field)
        assert set(field["box"]) == {"x", "y", "w", "h"}


def test_aggregated_fields_carry_their_component_cells(fields: list[dict]) -> None:
    """Base YTD sums several rows; the underwriter needs each source cell."""
    base_ytd = next(f for f in fields if f["sourceFieldId"] == "ps-base-ytd")
    assert len(base_ytd["componentBoxes"]) >= 2
    for component in base_ytd["componentBoxes"]:
        assert usable(component)


def test_rate_highlights_the_rate_column_not_the_amount() -> None:
    result = parse_paystub(build_paystub_pdf())
    rate_field = next(
        f for f in income_fields(result) if f["sourceFieldId"] == "ps-hourly-rate"
    )
    amount_field = next(
        f for f in income_fields(result) if f["sourceFieldId"] == "ps-current-base"
    )
    assert rate_field["box"]["x"] < amount_field["box"]["x"]
    assert rate_field["numericValue"] == float(result.income.hourly_rate)


def test_a_value_with_no_located_cell_is_not_reported() -> None:
    """Reporting a field with a dead box blocks the console's own fallback."""
    result = parse_paystub(build_paystub_pdf())
    for line in result.lines:
        line.ytd_amount_box = None
        line.amount_box = None
        line.rate_box = None
        line.hours_box = None
    result.identity.employer_box = None
    result.identity.period_end_box = None

    assert income_fields(result) == []


def test_scanned_and_digital_agree_on_field_geometry() -> None:
    """The same stub scanned must highlight the same place as the digital one."""
    digital = income_fields(parse_paystub(build_paystub_pdf()))
    scanned = income_fields(parse_paystub(build_scanned_paystub_pdf()))

    by_id = {f["sourceFieldId"]: f for f in scanned}
    for field in digital:
        match = by_id.get(field["sourceFieldId"])
        assert match is not None, field["sourceFieldId"]
        assert match["box"]["x"] == pytest.approx(field["box"]["x"], abs=0.02)
        assert match["box"]["y"] == pytest.approx(field["box"]["y"], abs=0.02)


def test_numeric_value_is_json_safe(fields: list[dict]) -> None:
    """Decimal does not survive json.dumps; the API contract is a float."""
    for field in fields:
        assert isinstance(field["numericValue"], float)
        assert not isinstance(field["numericValue"], Decimal)
