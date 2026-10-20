"""Reading 1065 / 1120-S returns and K-1s through the template cell map.

Each test fills the official IRS blank with known figures, runs the full
extraction, and checks the figure came from the template cell rather than the
label catalog.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import fitz
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from business_return_grid import (  # noqa: E402
    extract_business_return_page,
    form_key_for_page,
    locate,
)
from irs_form_extract import extract_irs_form_fields  # noqa: E402

TEMPLATES = ROOT / "templates"
FIELD_MAP = json.loads((TEMPLATES / "business_return_fields.json").read_text())

pytestmark = pytest.mark.skipif(
    not all((TEMPLATES / name).exists() for name in ("f1065.pdf", "f1120s.pdf", "f1065sk1.pdf", "f1120ssk.pdf", "f1040sc.pdf")),
    reason="official fillable blanks are required",
)


def _fill(blank: str, cells: list[tuple[int, list[float], str]]) -> bytes:
    """Put a value in the widget under each (page, box)."""
    document = fitz.open(TEMPLATES / blank)
    try:
        for page_index, box, value in cells:
            target = fitz.Rect(box)
            page = document[page_index]
            widget = max(
                page.widgets() or [],
                key=lambda w: (w.rect & target).get_area(),
                default=None,
            )
            assert widget is not None and (widget.rect & target).get_area() > 0.5 * target.get_area(), (
                blank,
                box,
            )
            widget.field_value = value
            widget.update()
        return document.tobytes()
    finally:
        document.close()


def _field_cells(form: str, values: dict[str, str]) -> list[tuple[int, list[float], str]]:
    fields = FIELD_MAP["forms"][form]["fields"]
    return [(fields[name]["page"], fields[name]["box"], value) for name, value in values.items()]


def _by_id(rows: list[dict]) -> dict[str, dict]:
    return {row["sourceFieldId"]: row for row in rows if row.get("extractor") == "template"}


@pytest.mark.parametrize(
    "form,blank,prefix,meals_page",
    [("1065", "f1065.pdf", "pt-return", 5), ("1120s", "f1120s.pdf", "scorp-return", 4)],
)
def test_return_face_and_m1_are_read_from_their_cells(form, blank, prefix, meals_page) -> None:
    values = {
        "ordinary_income": "515400",
        "gain_4797": "12500",
        "other_income": "8200",
        "depreciation": "64500",
        "meals": "3100",
    }
    rows = _by_id(extract_irs_form_fields(_fill(blank, _field_cells(form, values))))

    assert rows[f"{prefix}-ord"]["numericValue"] == 515400
    assert rows[f"{prefix}-4797"]["numericValue"] == 12500
    assert rows[f"{prefix}-other"]["numericValue"] == 8200
    assert rows[f"{prefix}-dep"]["numericValue"] == 64500
    assert rows[f"{prefix}-meals"]["numericValue"] == 3100
    assert rows[f"{prefix}-meals"]["pageIndex"] == meals_page
    assert rows[f"{prefix}-ord"]["value"] == "$515,400.00"


def _baked(pdf: bytes) -> bytes:
    """Flatten widgets into page text, the way tax software prints a return."""
    document = fitz.open(stream=pdf, filetype="pdf")
    try:
        document.bake()
        return document.tobytes()
    finally:
        document.close()


@pytest.mark.parametrize("form,blank,prefix", [("1065", "f1065.pdf", "pt-return"), ("1120s", "f1120s.pdf", "scorp-return")])
def test_a_printed_return_reads_from_its_text_layer(form, blank, prefix) -> None:
    values = {"ordinary_income": "515,400", "other_income": "8,200", "depreciation": "64,500", "meals": "3,100"}
    pdf = _baked(_fill(blank, _field_cells(form, values)))
    document = fitz.open(stream=pdf, filetype="pdf")
    assert not any(list(page.widgets()) for page in document)
    document.close()

    rows = _by_id(extract_irs_form_fields(pdf))
    assert rows[f"{prefix}-ord"]["numericValue"] == 515400
    assert rows[f"{prefix}-other"]["numericValue"] == 8200
    assert rows[f"{prefix}-dep"]["numericValue"] == 64500
    assert rows[f"{prefix}-meals"]["numericValue"] == 3100
    # Line 6 / 4 was left empty and must stay empty, not become its line number.
    assert f"{prefix}-4797" not in rows
    everything = extract_irs_form_fields(pdf)
    assert not [r for r in everything if r["sourceFieldId"] == f"{prefix}-4797"]


def test_any_other_income_raises_a_review_note() -> None:
    pdf = _fill("f1065.pdf", _field_cells("1065", {"ordinary_income": "100000", "other_income": "1"}))
    rows = _by_id(extract_irs_form_fields(pdf, page_indices=[0]))
    notes = rows["pt-return-ord"].get("reviewNotes") or []
    assert len(notes) == 1
    assert "line 7" in notes[0]["message"] and "$1.00" in notes[0]["message"]


def test_no_other_income_means_no_note() -> None:
    pdf = _fill("f1065.pdf", _field_cells("1065", {"ordinary_income": "100000"}))
    rows = _by_id(extract_irs_form_fields(pdf, page_indices=[0]))
    assert "reviewNotes" not in rows["pt-return-ord"]


def test_1065_k1_ownership_guaranteed_payments_and_code_a_distributions() -> None:
    k1 = FIELD_MAP["forms"]["1065-k1"]
    rows = k1["coded_boxes"]["distributions"]["rows"]
    cells = _field_cells(
        "1065-k1",
        {
            "ordinary_income": "90000",
            "guaranteed_payments_services": "24000",
            "guaranteed_payments_capital": "6000",
            "profit_pct_end": "50",
            "capital_pct_end": "30",
        },
    ) + [
        (0, rows[0]["code"], "A"),
        (0, rows[0]["amount"], "40000"),
        (0, rows[1]["code"], "C"),
        (0, rows[1]["amount"], "7000"),
    ]
    found = _by_id(extract_irs_form_fields(_fill("f1065sk1.pdf", cells), page_indices=[0]))

    assert found["pt-ord"]["numericValue"] == 90000
    everything = extract_irs_form_fields(_fill("f1065sk1.pdf", cells), page_indices=[0])
    # Box 2 is empty. Its "above" clip reaches Box 1's figure.
    assert not [r for r in everything if r["sourceFieldId"] == "pt-rre"]
    assert found["pt-gp"]["numericValue"] == 30000
    assert found["pt-profit-pct"]["numericValue"] == 50
    assert found["pt-capital-pct"]["numericValue"] == 30
    # Code C is other property, not a cash distribution.
    assert found["pt-dist"]["numericValue"] == 40000
    assert found["pt-dist"]["lineNum"] == "Box 19A"


def test_1120s_k1_counts_only_code_d_in_box_16() -> None:
    rows = FIELD_MAP["forms"]["1120s-k1"]["coded_boxes"]["distributions"]["rows"]
    cells = _field_cells("1120s-k1", {"ordinary_income": "150000", "allocation_pct": "60"}) + [
        (0, rows[0]["code"], "A"),
        (0, rows[0]["amount"], "900"),
        (0, rows[1]["code"], "C"),
        (0, rows[1]["amount"], "1200"),
        (0, rows[2]["code"], "D"),
        (0, rows[2]["amount"], "85000"),
    ]
    found = _by_id(extract_irs_form_fields(_fill("f1120ssk.pdf", cells), page_indices=[0]))

    assert found["scorp-ord"]["numericValue"] == 150000
    assert found["scorp-own-pct"]["numericValue"] == 60
    assert found["scorp-dist"]["numericValue"] == 85000
    assert found["scorp-dist"]["lineNum"] == "Box 16D"


_1065_LINE_16 = {
    "16a": [410.4, 414.0, 481.65, 426.0],
    "16b": [410.4, 426.0, 481.65, 438.0],
    "16c": [504.0, 426.0, 576.0, 438.0],
}


def _1065_depreciation(line_16: dict[str, str]) -> dict[str, tuple[str, float]]:
    """Every depreciation row a 1065 with this line 16 yields, by line."""
    cells = [(0, _1065_LINE_16[line], value) for line, value in line_16.items()]
    cells += _field_cells("1065", {"ordinary_income": "515400"})
    rows = _by_id(extract_irs_form_fields(_fill("f1065.pdf", cells), page_indices=[0]))
    return {
        row["lineNum"]: (row["sourceFieldId"], row["numericValue"])
        for row in rows.values()
        if row["sourceFieldId"].startswith("pt-return-dep")
    }


def test_depreciation_deducted_through_cost_of_goods_sold_is_added_back() -> None:
    """16b and 16c are disjoint parts of 16a and both reduced line 23.

    A partnership that ran $14,500 of its depreciation through Form 1125-A
    reports $64,500 on 16a, $14,500 on 16b and the $50,000 remainder on 16c.
    Reading 16c alone left $14,500 of a non-cash expense out of the addback.
    """
    rows = _1065_depreciation({"16a": "64500", "16b": "14500", "16c": "50000"})
    assert rows == {
        "Line 16c": ("pt-return-dep", 50000),
        "Line 16b": ("pt-return-dep-1125a", 14500),
    }


def test_depreciation_on_16a_alone_is_read() -> None:
    """With nothing in cost of goods sold, preparers leave the 16c net blank."""
    assert _1065_depreciation({"16a": "64500"}) == {"Line 16a": ("pt-return-dep", 64500)}


def test_the_16a_total_is_not_added_to_the_cost_of_goods_sold_part() -> None:
    """16a already contains 16b, so the two must never both be added back."""
    rows = _1065_depreciation({"16a": "64500", "16b": "14500"})
    assert rows == {"Line 16a": ("pt-return-dep", 64500)}


def test_only_the_16c_net_is_read_when_that_is_all_the_form_carries() -> None:
    """A substitute form that prints just the net is still worth reading."""
    assert _1065_depreciation({"16c": "50000"}) == {"Line 16c": ("pt-return-dep", 50000)}


def test_an_unclaimed_depreciation_line_stays_empty() -> None:
    """No cell on line 16 may be filled with the line number printed beside it."""
    assert _1065_depreciation({}) == {}


def test_dot_leaders_do_not_abort_the_packet() -> None:
    """A '3....4..' dot leader used to raise, and the caller dropped every field."""
    pdf = _fill("f1065.pdf", _field_cells("1065", {"ordinary_income": "70000"}))
    rows = extract_irs_form_fields(pdf)
    assert any(row["sourceFieldId"] == "pt-return-ord" for row in rows)


@pytest.mark.parametrize("blank", ["f1065.pdf", "f1120.pdf", "f1120s.pdf", "f1065sk1.pdf", "f1120ssk.pdf"])
def test_an_empty_return_yields_no_amounts(blank: str) -> None:
    """Line numbers, "Form 4562" and the tax year are not entries."""
    rows = extract_irs_form_fields((TEMPLATES / blank).read_bytes())
    assert [(r["sourceFieldId"], r["value"]) for r in rows if r["form"] != "Paystub" and r["numericValue"]] == []


def test_form_1120_pages_are_not_pay_stubs() -> None:
    """Page 3 says "undistributed earnings"; that is not a pay stub title."""
    rows = extract_irs_form_fields((TEMPLATES / "f1120.pdf").read_bytes())
    assert [r for r in rows if r["form"] == "Paystub"] == []


def test_an_entry_beats_the_printed_line_number() -> None:
    pdf = _fill("f1065.pdf", _field_cells("1065", {"ordinary_income": "22"}))
    rows = _by_id(extract_irs_form_fields(pdf, page_indices=[0]))
    assert rows["pt-return-ord"]["numericValue"] == 22


SCHEDULE_C_VALUES = {
    "business_name": "Venture Consulting LLC",
    "ein": "824471065",
    "depreciation": "8,500",
    "meals": "1,800",
    "net_profit": "115,000",
}
PROPRIETOR_BOX = [36.0, 94.0, 445.6, 108.0]


def _schedule_c(*, baked: bool) -> bytes:
    cells = [
        *_field_cells("schc", SCHEDULE_C_VALUES),
        *_field_cells("schc-2", {"business_miles": "4,500"}),
        (0, PROPRIETOR_BOX, "Sarah K. Vance"),
    ]
    pdf = _fill("f1040sc.pdf", cells)
    return _baked(pdf) if baked else pdf


@pytest.mark.parametrize("baked", [False, True])
def test_schedule_c_is_read_from_the_official_blank(baked: bool) -> None:
    everything = extract_irs_form_fields(_schedule_c(baked=baked))
    rows = _by_id(everything)
    assert rows["ent1-name"]["value"] == "Venture Consulting LLC"
    assert rows["ent1-ein"]["value"] == "82-4471065"
    assert rows["ent1-dep"]["numericValue"] == 8500
    assert rows["ent1-meals"]["numericValue"] == 1800
    assert rows["ent1-net"]["numericValue"] == 115000
    assert rows["ent1-net"]["fieldLabel"] == "Net Profit or Loss (Line 31)"
    assert rows["ent1-miles"]["value"] == "4,500"
    assert rows["ent1-miles"]["pageIndex"] == 1
    by_id = {row["sourceFieldId"]: row for row in everything}
    assert by_id["ent1-proprietor"]["value"] == "Sarah K. Vance"
    # Lines 6, 12 and 30 were left blank; their printed line numbers and
    # instructions ("enter on line 30") are not amounts.
    assert not {"ent1-other-income", "ent1-depletion", "ent1-home"} & set(by_id)
    # Line 1 cites "Form W-2", which must not hand the page to the W-2 catalog.
    assert not [row for row in everything if row["form"] == "W-2"]


def test_a_page_without_the_caption_yields_nothing() -> None:
    """A substitute form or another revision falls back to the label catalog."""
    document = fitz.open()
    page = document.new_page(width=612, height=792)
    page.insert_text((72, 72), "U.S. Return of Partnership Income")
    page.insert_text((504, 520), "515,400")
    try:
        assert form_key_for_page(page.get_text()) == "1065"
        assert extract_business_return_page(page, fitz, form_key="1065", page_index=0) == []
    finally:
        document.close()


def test_a_scan_a_few_points_off_is_re_anchored_on_its_caption() -> None:
    box = [504.0, 510.0, 576.0, 522.0]
    words = [
        {"x0": 60.0, "y0": 511.0 + 5, "x1": 180.0, "y1": 521.0 + 5, "text": "Ordinary"},
        {"x0": 182.0, "y0": 511.0 + 5, "x1": 300.0, "y1": 521.0 + 5, "text": "business income"},
    ]
    assert locate(words, box, [["left", "Ordinary business income"]]) == [504.0, 515.0, 576.0, 527.0]
    # Past the drift limit the neighbouring line's caption would start to match.
    far = [dict(word, y0=word["y0"] + 20, y1=word["y1"] + 20) for word in words]
    assert locate(far, box, [["left", "Ordinary business income"]]) is None


@pytest.mark.parametrize(
    "text,key",
    [
        ("Schedule K-1 (Form 1065) Partner's Share", "1065-k1"),
        ("ScheduleK-1(Form1065) Partner'sShareofIncome", "1065-k1"),
        ("Schedule K-1 (Form 1120-S) Shareholder's Share", "1120s-k1"),
        ("Form 1065 (2025) Page 5 Schedule M-1 Reconciliation", "1065"),
        ("Form 1120-S (2025) Page 4 Schedule M-1", "1120s"),
        ("SCHEDULE C (Form 1040) 2025 Profit or Loss From Business", "schc"),
        ("Schedule C (Form 1040) 2025\nPage 2\nPart III Cost of Goods Sold", "schc-2"),
        ("Schedule E Supplemental Income and Loss", None),
    ],
)
def test_form_key_for_page(text: str, key: str | None) -> None:
    assert form_key_for_page(text) == key
