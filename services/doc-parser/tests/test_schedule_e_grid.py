"""Schedule E grid: every Page 1, columns A/B/C, skip Part II."""

from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from schedule_e_grid import (  # noqa: E402
    TEMPLATE_DIR,
    extract_schedule_e_pages,
    generate_template_map,
    is_schedule_e_page1,
    load_template_map,
    recheck_mismatched_addbacks,
    reconcile_fair_rental_days,
    reconcile_schedule_e_financials,
    rental_months_from_days,
    rotation_twin_amount,
    suspect_expense_lines,
)

TEMPLATE_PDF = TEMPLATE_DIR / "f1040se.pdf"


def _paint(page: fitz.Page, box: list[float], text: str, fontsize: float = 7) -> None:
    page.insert_text((box[0] + 3, box[1] + 10), text, fontsize=fontsize)


def _filled_schedule_e_pdf(*, pages: int = 1, include_page2: bool = False) -> bytes:
    mapping = load_template_map()
    src = fitz.open(str(TEMPLATE_PDF))
    out = fitz.open()
    for index in range(pages):
        out.insert_pdf(src, from_page=0, to_page=0)
        page = out[-1]
        meta = mapping["properties_meta"]
        grid = mapping["financial_grid"]
        _paint(page, meta["A"]["address_box"], f"{100 + index} Main St")
        _paint(page, meta["B"]["address_box"], f"{200 + index} Oak Ave")
        _paint(page, meta["A"]["type_code_box"], "1")
        _paint(page, meta["B"]["type_code_box"], "2")
        _paint(page, meta["A"]["fair_rental_days_box"], "365", 8)
        _paint(page, meta["B"]["fair_rental_days_box"], "200", 8)
        _paint(page, grid["3"]["A"], "24000", 8)
        _paint(page, grid["3"]["B"], "18000", 8)
        _paint(page, grid["20"]["A"], "9000", 8)
        _paint(page, grid["20"]["B"], "7000", 8)
        _paint(page, grid["21"]["A"], "15000", 8)
        _paint(page, grid["21"]["B"], "11000", 8)
    if include_page2 and src.page_count > 1:
        out.insert_pdf(src, from_page=1, to_page=1)
    src.close()
    data = out.tobytes()
    out.close()
    return data


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official f1040se.pdf blank is required")
def test_template_map_has_abc_for_address_and_line_3() -> None:
    boxes = generate_template_map()
    assert set(boxes["properties_meta"]) == {"A", "B", "C"}
    assert set(boxes["financial_grid"]["3"]) == {"A", "B", "C"}
    assert set(boxes["properties_meta"]["A"]) >= {"address_box", "fair_rental_days_box", "type_code_box"}
    assert boxes["properties_meta"]["A"]["address_box"][1] < boxes["properties_meta"]["B"]["address_box"][1]
    assert boxes["financial_grid"]["3"]["A"][0] < boxes["financial_grid"]["3"]["B"][0] < boxes["financial_grid"]["3"]["C"][0]


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official f1040se.pdf blank is required")
def test_extracts_columns_a_and_b_from_one_page() -> None:
    extracts = extract_schedule_e_pages(_filled_schedule_e_pdf(pages=1))
    assert len(extracts) == 2
    by_col = {row["column"]: row for row in extracts}
    assert by_col["A"]["address"] == "100 Main St"
    assert by_col["B"]["address"] == "200 Oak Ave"
    assert by_col["A"]["fairRentalDays"] == 365
    assert by_col["B"]["fairRentalDays"] == 200
    assert by_col["A"]["financials"]["3"] == 24000
    assert by_col["B"]["financials"]["3"] == 18000
    assert by_col["A"]["propertyType"].strip().startswith("1")
    assert by_col["B"]["propertyType"].strip().startswith("2")


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official f1040se.pdf blank is required")
def test_does_not_stop_after_first_schedule_e_page() -> None:
    extracts = extract_schedule_e_pages(_filled_schedule_e_pdf(pages=2))
    addresses = {row["address"] for row in extracts}
    assert addresses == {"100 Main St", "200 Oak Ave", "101 Main St", "201 Oak Ave"}
    assert {row["pageIndex"] for row in extracts} == {0, 1}


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official f1040se.pdf blank is required")
def test_skips_official_page_2() -> None:
    src = fitz.open(str(TEMPLATE_PDF))
    assert src.page_count == 2
    assert not is_schedule_e_page1(src[1])
    blank_only = fitz.open()
    blank_only.insert_pdf(src, from_page=1, to_page=1)
    data = blank_only.tobytes()
    src.close()
    blank_only.close()
    assert extract_schedule_e_pages(data) == []


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official f1040se.pdf blank is required")
def test_page_2_in_package_does_not_drop_page_1_columns() -> None:
    extracts = extract_schedule_e_pages(_filled_schedule_e_pdf(pages=1, include_page2=True))
    assert {row["address"] for row in extracts} == {"100 Main St", "200 Oak Ave"}
    assert all(row["pageIndex"] == 0 for row in extracts)


def _fill_widget(page: fitz.Page, name_tail: str, value: str) -> None:
    for widget in page.widgets() or []:
        if (widget.field_name or "").endswith(name_tail):
            widget.field_value = value
            widget.update()
            return
    raise AssertionError(f"missing widget {name_tail}")


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official f1040se.pdf blank is required")
def test_software_print_address_on_row_b_money_on_column_a() -> None:
    """Drake-style: one property, address sits in official row B, rents stay in column A."""
    mapping = load_template_map()
    src = fitz.open(str(TEMPLATE_PDF))
    out = fitz.open()
    out.insert_pdf(src, from_page=0, to_page=0)
    src.close()
    page = out[0]
    _paint(page, mapping["properties_meta"]["A"]["address_box"], "Physical address of each property (street, city, state, ZIP code)")
    _paint(page, mapping["properties_meta"]["B"]["address_box"], "22911 E Thornton Rd, Queen Creek, AZ 85142")
    _paint(page, mapping["properties_meta"]["B"]["type_code_box"], "1")
    _paint(page, mapping["properties_meta"]["B"]["fair_rental_days_box"], "270")
    _paint(page, mapping["financial_grid"]["3"]["A"], "38677", 8)
    _paint(page, mapping["financial_grid"]["20"]["A"], "56097", 8)
    _paint(page, mapping["financial_grid"]["21"]["A"], "(17420)", 8)
    data = out.tobytes()
    out.close()

    extracts = extract_schedule_e_pages(data)
    assert len(extracts) == 1
    row = extracts[0]
    assert row["column"] == "A"
    assert row["address"] == "22911 E Thornton Rd, Queen Creek, AZ 85142"
    assert row["propertyType"] == "1"
    assert row["fairRentalDays"] == 270
    assert row["financials"]["3"] == 38677
    assert row["financials"]["21"] == -17420


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official f1040se.pdf blank is required")
def test_reads_official_acroform_columns_a_and_b() -> None:
    src = fitz.open(str(TEMPLATE_PDF))
    page = src[0]
    _fill_widget(page, "f1_3[0]", "742 Evergreen Terrace")
    _fill_widget(page, "f1_4[0]", "1600 Pennsylvania Ave")
    _fill_widget(page, "f1_6[0]", "1")
    _fill_widget(page, "f1_7[0]", "2")
    _fill_widget(page, "f1_9[0]", "365")
    _fill_widget(page, "f1_11[0]", "200")
    _fill_widget(page, "f1_16[0]", "24000")
    _fill_widget(page, "f1_17[0]", "18000")
    _fill_widget(page, "f1_68[0]", "9000")
    _fill_widget(page, "f1_69[0]", "7000")
    _fill_widget(page, "f1_71[0]", "15000")
    _fill_widget(page, "f1_72[0]", "11000")
    data = src.tobytes()
    src.close()

    extracts = extract_schedule_e_pages(data)
    by_col = {row["column"]: row for row in extracts}
    assert by_col["A"]["address"] == "742 Evergreen Terrace"
    assert by_col["B"]["address"] == "1600 Pennsylvania Ave"
    assert by_col["A"]["fairRentalDays"] == 365
    assert by_col["B"]["fairRentalDays"] == 200
    assert by_col["A"]["financials"]["3"] == 24000
    assert by_col["B"]["financials"]["3"] == 18000
    assert by_col["A"]["financials"]["21"] == 15000
    assert by_col["B"]["financials"]["21"] == 11000


def test_reconcile_confirms_when_lines_5_to_20_match() -> None:
    financials = {str(line): 0.0 for line in range(3, 22)}
    financials["3"] = 38677
    financials["9"] = 1601
    financials["12"] = 30266
    financials["14"] = 3260
    financials["16"] = 2338
    financials["18"] = 16652
    financials["19"] = 1980
    financials["20"] = 56097
    financials["21"] = -17420
    determination = reconcile_schedule_e_financials(financials)
    assert determination["status"] == "confirmed"
    assert determination["expensesBalanced"] is True
    assert determination["netBalanced"] is True
    assert financials["20"] == 56097
    assert financials["21"] == -17420


def test_reconcile_fills_blank_line_20_from_itemized() -> None:
    financials = {str(line): 0.0 for line in range(3, 22)}
    financials["3"] = 17500
    financials["9"] = 752
    financials["12"] = 9500
    financials["16"] = 1500
    financials["8"] = 970
    determination = reconcile_schedule_e_financials(financials)
    assert determination["status"] == "reconstructed"
    assert determination["line20Source"] == "itemized-sum"
    assert financials["20"] == determination["itemizedExpenses"]
    assert financials["20"] == 752 + 9500 + 1500 + 970
    assert financials["21"] == financials["3"] - financials["20"]


def test_reconcile_keeps_visual_line_20_on_mismatch() -> None:
    financials = {str(line): 0.0 for line in range(3, 22)}
    financials["3"] = 20000
    financials["9"] = 1000
    financials["20"] = 8000
    financials["21"] = 12000
    determination = reconcile_schedule_e_financials(financials)
    assert determination["status"] == "mismatch"
    assert financials["20"] == 8000
    assert determination["itemizedExpenses"] == 1000


def test_fair_rental_days_convert_to_1038_months() -> None:
    assert rental_months_from_days(0) == 12
    assert rental_months_from_days(270) == 9
    assert rental_months_from_days(365) == 12
    accepted = reconcile_fair_rental_days(270, 0)
    assert accepted["daysStatus"] == "accepted"
    assert accepted["rentalMonths"] == 9
    assert reconcile_fair_rental_days(365, 0)["daysStatus"] == "full-year"
    assert reconcile_fair_rental_days(0, 0)["daysStatus"] == "missing"


def _broadway_mismatch() -> dict[str, float]:
    financials = {str(line): 0.0 for line in range(3, 22)}
    financials["3"] = 11700
    financials["6"] = 250
    financials["7"] = 325
    financials["9"] = 6
    financials["12"] = 4900
    financials["14"] = 750
    financials["16"] = 4200
    financials["18"] = 2900
    financials["19"] = 250
    financials["20"] = 14475
    financials["21"] = -2775
    return financials


def test_rotation_twin_006_is_900() -> None:
    assert rotation_twin_amount(6, 900) is True
    assert rotation_twin_amount(900, 6) is True
    assert rotation_twin_amount(875, 900) is False
    assert rotation_twin_amount(0, 14475) is False


def test_suspect_line_is_insurance_when_006_should_be_900() -> None:
    financials = _broadway_mismatch()
    itemized = sum(financials[str(line)] for line in range(5, 20))
    delta = financials["20"] - itemized
    assert delta == 894
    assert suspect_expense_lines(financials, delta) == ["9"]


def test_recheck_accepts_form_bound_900() -> None:
    financials = _broadway_mismatch()
    accepted = recheck_mismatched_addbacks(financials, recheck_line=lambda line: 900 if line == "9" else None)
    assert accepted is not None
    assert accepted["recheckedLine"] == "9"
    assert accepted["recheckedFrom"] == 6
    assert accepted["recheckedTo"] == 900
    assert accepted["recheckSource"] == "form-bound"
    assert financials["9"] == 900
    determination = reconcile_schedule_e_financials(financials)
    assert determination["status"] == "confirmed"
    assert determination["expensesBalanced"] is True


def test_recheck_rejects_value_not_on_the_form() -> None:
    financials = _broadway_mismatch()
    accepted = recheck_mismatched_addbacks(financials, recheck_line=lambda line: 1000 if line == "9" else None)
    assert accepted is None
    assert financials["9"] == 6
    determination = reconcile_schedule_e_financials(financials)
    assert determination["status"] == "mismatch"


def test_recheck_skips_when_line_21_does_not_validate_totals() -> None:
    financials = _broadway_mismatch()
    financials["21"] = -100
    accepted = recheck_mismatched_addbacks(financials, recheck_line=lambda line: 900)
    assert accepted is None
    assert financials["9"] == 6
