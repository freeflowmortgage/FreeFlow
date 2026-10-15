"""The curated 1065 / 1120-S cell map, verified against the official blanks.

These run against the fillable IRS forms in templates/. Each test fills the
real widgets with known figures and reads them back through the same clip
primitive the Schedule E grid uses, so they prove both that a box sits on the
intended cell and that extraction can read it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from build_business_return_fields import build, caption_beside  # noqa: E402
from schedule_e_grid import _clip_text  # noqa: E402

TEMPLATES = ROOT / "templates"
MAP_PATH = TEMPLATES / "business_return_fields.json"

pytestmark = pytest.mark.skipif(
    not (TEMPLATES / "f1065.pdf").exists() or not (TEMPLATES / "f1120s.pdf").exists(),
    reason="official fillable blanks are required",
)


@pytest.fixture(scope="module")
def field_map() -> dict:
    return json.loads(MAP_PATH.read_text())


def test_committed_map_matches_a_fresh_build(field_map: dict) -> None:
    """The JSON on disk is regenerated, not hand-edited."""
    fresh, failures = build()
    assert failures == []
    assert fresh == field_map


@pytest.mark.parametrize("form", ["1065", "1120s"])
def test_every_box_sits_beside_its_caption(field_map: dict, form: str) -> None:
    spec = field_map["forms"][form]
    document = fitz.open(TEMPLATES / spec["blank"])
    try:
        for name, field in spec["fields"].items():
            for cell in (field, *(field.get("fallbacks") or [])):
                caption = caption_beside(document[cell["page"]], cell["box"])
                assert cell["caption"].lower() in caption.lower(), (form, name, cell["line"], caption)
    finally:
        document.close()


def test_the_same_item_sits_on_different_lines_per_form(field_map: dict) -> None:
    """Mapping by line number alone would read 1120-S total income as 4797 gain."""
    forms = field_map["forms"]
    assert forms["1065"]["fields"]["gain_4797"]["line"] == "Line 6"
    assert forms["1120s"]["fields"]["gain_4797"]["line"] == "Line 4"
    assert forms["1065"]["fields"]["other_income"]["line"] == "Line 7"
    assert forms["1120s"]["fields"]["other_income"]["line"] == "Line 5"
    assert forms["1065"]["fields"]["meals"]["line"] == "Schedule M-1 line 4b"
    assert forms["1120s"]["fields"]["meals"]["line"] == "Schedule M-1 line 3b"


def test_ordinary_income_is_past_total_deductions(field_map: dict) -> None:
    """On the 2025 forms line 22 (1065) and 21 (1120-S) are Total deductions."""
    assert field_map["forms"]["1065"]["fields"]["ordinary_income"]["line"] == "Line 23"
    assert field_map["forms"]["1120s"]["fields"]["ordinary_income"]["line"] == "Line 22"


def test_meals_is_on_schedule_m1_not_schedule_k(field_map: dict) -> None:
    """A bare "4b" matched Schedule K Guaranteed payments on the same form."""
    for form in ("1065", "1120s"):
        meals = field_map["forms"][form]["fields"]["meals"]
        assert meals["caption"] == "Travel and entertainment"
        assert meals["page"] > 0


def test_1065_depreciation_covers_every_cell_on_line_16(field_map: dict) -> None:
    """16b and 16c are disjoint parts of 16a, and 16a stands in for a blank 16c.

    Reading 16c alone was short by the depreciation deducted through cost of
    goods sold on 16b, and missed the whole figure on a return that fills 16a
    and leaves the 16c net blank.
    """
    fields = field_map["forms"]["1065"]["fields"]
    assert fields["depreciation"]["line"] == "Line 16c"
    assert [cell["line"] for cell in fields["depreciation"]["fallbacks"]] == ["Line 16a"]
    assert fields["depreciation_1125a"]["line"] == "Line 16b"
    assert "fallbacks" not in fields["depreciation_1125a"]


def test_other_income_is_flagged_for_review(field_map: dict) -> None:
    """Any non-zero other income needs an underwriter decision on inclusion."""
    for form in ("1065", "1120s"):
        assert field_map["forms"][form]["fields"]["other_income"]["use"] == "subtract_with_review"


def _filled_blank(blank: str, fields: dict, values: dict[str, str]) -> bytes:
    """Fill the widgets under each mapped box and return the PDF bytes."""
    document = fitz.open(TEMPLATES / blank)
    try:
        for name, value in values.items():
            field = fields[name]
            target = fitz.Rect(field["box"])
            page = document[field["page"]]
            widget = next(
                (w for w in page.widgets() if (w.rect & target).get_area() > 0.6 * target.get_area()),
                None,
            )
            assert widget is not None, f"no widget under {name} on {blank}"
            widget.field_value = value
            widget.update()
        return document.tobytes()
    finally:
        document.close()


@pytest.mark.parametrize(
    "form,values",
    [
        (
            "1065",
            {
                "ordinary_income": "515400",
                "gain_4797": "12500",
                "other_income": "8200",
                "depreciation": "64500",
                "meals": "3100",
            },
        ),
        (
            "1120s",
            {
                "ordinary_income": "412900",
                "gain_4797": "9800",
                "other_income": "4400",
                "depreciation": "88400",
                "meals": "2750",
            },
        ),
    ],
)
def test_filled_values_read_back_from_each_box(field_map: dict, form: str, values: dict) -> None:
    spec = field_map["forms"][form]
    pdf = _filled_blank(spec["blank"], spec["fields"], values)

    document = fitz.open(stream=pdf, filetype="pdf")
    try:
        for name, expected in values.items():
            field = spec["fields"][name]
            read = _clip_text(document[field["page"]], fitz, field["box"], money=True)
            digits = "".join(ch for ch in read if ch.isdigit())
            assert digits == expected, (form, name, read)
    finally:
        document.close()
