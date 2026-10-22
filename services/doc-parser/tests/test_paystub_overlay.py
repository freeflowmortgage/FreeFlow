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
from paystub.models import (
    EarningCategory,
    EarningLine,
    OverlayBox,
    PaystubResult,
    Token,
)
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


def _ytd_row(description: str, category: EarningCategory, amount: str, y: float) -> EarningLine:
    return EarningLine(
        description=description,
        category=category,
        category_reason="test",
        ytd_amount=Decimal(amount),
        ytd_amount_box=OverlayBox(x=0.55, y=y, w=0.05, h=0.01),
        variable_group="overtime" if category is EarningCategory.VARIABLE else None,
    )


def test_a_column_total_reports_the_rows_its_box_covers_but_excludes() -> None:
    """The union of the base rows also covers rows the total leaves out.

    On the sample stub, employer-paid life and an overtime premium print
    between the base rows, so the box around the base YTD figures spans them
    too. Each cell inside that box is reported with whether it is in the total,
    so the viewer can shade only the ones that are.
    """
    result = PaystubResult(
        lines=[
            _ytd_row("Regular Hourly", EarningCategory.BASE_WORKED, "26000.00", 0.30),
            _ytd_row("Group Term Life", EarningCategory.IMPUTED, "41.60", 0.32),
            _ytd_row("Holiday", EarningCategory.BASE_LEAVE, "780.00", 0.34),
            _ytd_row("Overtime", EarningCategory.VARIABLE, "1950.00", 0.36),
            _ytd_row("Vacation Pay", EarningCategory.BASE_LEAVE, "2600.00", 0.38),
        ],
    )
    result.income.base_ytd = Decimal("29380.00")

    base_ytd = next(
        f for f in income_fields(result) if f["sourceFieldId"] == "ps-base-ytd"
    )
    cells = base_ytd["componentCells"]
    assert [cell["included"] for cell in cells] == [True, False, True, False, True]
    assert len([cell for cell in cells if cell["included"]]) == len(
        base_ytd["componentBoxes"]
    )
    for cell in cells:
        assert usable(cell["box"])
        assert set(cell) == {"box", "included"}


def test_column_cells_are_ruled_to_one_width() -> None:
    """A cell per figure width reads as ragged tags, not a ruled column."""
    result = PaystubResult(
        lines=[
            _ytd_row("Regular Hourly", EarningCategory.BASE_WORKED, "26000.00", 0.30),
            _ytd_row("Group Term Life", EarningCategory.IMPUTED, "41.60", 0.32),
            _ytd_row("Vacation Pay", EarningCategory.BASE_LEAVE, "2600.00", 0.34),
        ],
    )
    # A narrower figure, as "41.60" prints against "26,000.00".
    result.lines[1].ytd_amount_box = OverlayBox(x=0.57, y=0.32, w=0.03, h=0.01)
    result.income.base_ytd = Decimal("28600.00")

    base_ytd = next(
        f for f in income_fields(result) if f["sourceFieldId"] == "ps-base-ytd"
    )
    outer = base_ytd["box"]
    for cell in base_ytd["componentCells"]:
        assert cell["box"]["x"] == outer["x"]
        assert cell["box"]["w"] == outer["w"]
    # Each cell still sits on its own row.
    tops = [cell["box"]["y"] for cell in base_ytd["componentCells"]]
    assert tops == sorted(tops) and len(set(tops)) == len(tops)


def test_a_column_total_does_not_claim_cells_outside_its_box() -> None:
    """A row below the last counted row is outside the box, so not a cell of it."""
    result = PaystubResult(
        lines=[
            _ytd_row("Regular Hourly", EarningCategory.BASE_WORKED, "26000.00", 0.30),
            _ytd_row("Vacation Pay", EarningCategory.BASE_LEAVE, "2600.00", 0.32),
            _ytd_row("Bonus", EarningCategory.VARIABLE, "3000.00", 0.40),
        ],
    )
    result.income.base_ytd = Decimal("28600.00")

    base_ytd = next(
        f for f in income_fields(result) if f["sourceFieldId"] == "ps-base-ytd"
    )
    assert [cell["included"] for cell in base_ytd["componentCells"]] == [True, True]


def test_a_single_cell_total_reports_no_grid(fields: list[dict]) -> None:
    """One row is not a grid, and ruling it adds nothing to read."""
    bonus = next(f for f in fields if f["sourceFieldId"] == "ps-bonus-ytd")
    assert "componentCells" not in bonus
    assert "componentBoxes" not in bonus


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
    result.identity.employee_box = None
    result.identity.period_end_box = None

    assert income_fields(result) == []


def test_the_employee_name_is_reported_with_its_cell(fields: list[dict]) -> None:
    employee = next(f for f in fields if f["sourceFieldId"] == "ps-employee-name")
    assert employee["value"] == "Dana Rivera"
    assert employee["category"] == "identity"
    assert usable(employee["box"])


def test_half_a_name_is_not_reported() -> None:
    """A column split mid-name would tie the stub to the wrong person."""
    result = parse_paystub(build_paystub_pdf())
    result.identity.employee = "Dana"
    assert not [f for f in income_fields(result) if f["sourceFieldId"] == "ps-employee-name"]


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
