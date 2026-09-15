"""Form 8825 Line 14 depreciation (and related IRS extract) tests."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from irs_form_extract import (  # noqa: E402
    _dated_regular_pay_slots,
    _ordered_regular_pay_slots,
    _paystub_row_kind,
    extract_irs_form_fields,
    extract_page_fields,
)
from pdf_splitter import SplitResult, pre_split_tax_returns, select_ocr_page_indices  # noqa: E402
from ai_pdf_converter import ConvertResult, PageResult  # noqa: E402


def _form_8825_pdf(*, mention_4562: bool = True) -> bytes:
    """Property columns A/B plus totals. Line 14 last amount is the totals column."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 60), "Form 8825 Rental Real Estate Income and Expenses", fontsize=11)
    if mention_4562:
        page.insert_text((72, 78), "Depreciation (see Form 4562)", fontsize=9)
    page.insert_text((72, 140), "2 Gross rents", fontsize=10)
    page.insert_text((280, 140), "1,000.00", fontsize=10)
    page.insert_text((380, 140), "2,000.00", fontsize=10)
    page.insert_text((480, 140), "12,500.00", fontsize=10)
    page.insert_text((72, 180), "14 Depreciation", fontsize=10)
    page.insert_text((280, 180), "400.00", fontsize=10)
    page.insert_text((380, 180), "600.00", fontsize=10)
    page.insert_text((480, 180), "8,200.00", fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


def test_extracts_form_8825_line_14_depreciation_totals_column() -> None:
    fields = extract_irs_form_fields(_form_8825_pdf())
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert "form-8825-dep" in by_id, fields
    assert by_id["form-8825-dep"]["form"] == "Form 8825"
    assert by_id["form-8825-dep"]["numericValue"] == 8200.0
    assert by_id["form-8825-rents"]["numericValue"] == 12500.0
    assert all(row["sourceFieldId"] != "form-4562-dep" for row in fields)


def test_extracts_form_8825_property_columns_and_identity() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 60), "Form 8825 Rental Real Estate Income and Expenses", fontsize=11)
    page.insert_text((72, 100), "Name of partnership or S corporation Apex Advisory Holdings", fontsize=10)
    page.insert_text((72, 118), "Employer identification number 74-9876543", fontsize=10)
    page.insert_text((72, 140), "2 Gross rents", fontsize=10)
    page.insert_text((280, 140), "1,000.00", fontsize=10)
    page.insert_text((380, 140), "2,000.00", fontsize=10)
    page.insert_text((480, 140), "12,500.00", fontsize=10)
    page.insert_text((72, 180), "14 Depreciation", fontsize=10)
    page.insert_text((280, 180), "400.00", fontsize=10)
    page.insert_text((380, 180), "600.00", fontsize=10)
    page.insert_text((480, 180), "8,200.00", fontsize=10)
    data = doc.tobytes()
    doc.close()

    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert by_id["form-8825-name"]["value"] == "Apex Advisory Holdings"
    assert by_id["form-8825-ein"]["value"] == "74-9876543"
    assert by_id["form-8825-dep-A"]["numericValue"] == 400.0
    assert by_id["form-8825-dep-B"]["numericValue"] == 600.0
    assert by_id["form-8825-dep"]["numericValue"] == 8200.0
    assert by_id["form-8825-rents-A"]["numericValue"] == 1000.0
    assert by_id["form-8825-rents-B"]["numericValue"] == 2000.0
    assert by_id["form-8825-rents"]["numericValue"] == 12500.0
    assert "box" in by_id["form-8825-dep-A"]


def test_splitter_classifies_form_8825() -> None:
    page = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=True,
        plain_text="Form 8825 Rental Real Estate Income and Expenses Line 14 Depreciation 8200",
        words=[],
    )
    split = pre_split_tax_returns(ConvertResult(pages=[page], page_count=1, ocr_page_count=0))
    assert split.target_pages == [0]
    assert "Form 8825 (Corporate Rentals)" in split.classifications[0]


def test_select_ocr_only_keep_set_pages_that_need_it() -> None:
    inspected = [
        SimpleNamespace(index=0, use_ocr=True),
        SimpleNamespace(index=1, use_ocr=True),
        SimpleNamespace(index=2, use_ocr=False),
    ]
    split = SplitResult(
        target_pages=[1, 2],
        classifications={1: ["W-2"], 2: ["Schedule C (Page 1 - Profits)"]},
        statement_refs=[],
        unresolved_statements=[],
    )
    assert select_ocr_page_indices(inspected, split) == {1}


def test_select_ocr_hybrid_form_pages_skips_blank_companion_pages() -> None:
    inspected = [
        SimpleNamespace(index=0, use_ocr=True, flags=["numeric_form_overlay_ocr_bypass"]),
        SimpleNamespace(index=1, use_ocr=True, flags=[]),
        SimpleNamespace(index=2, use_ocr=True, flags=["numeric_form_overlay_ocr_bypass"]),
        SimpleNamespace(index=3, use_ocr=True, flags=[]),
    ]
    split = SplitResult(target_pages=[], classifications={}, statement_refs=[], unresolved_statements=[])
    assert select_ocr_page_indices(inspected, split) == {0, 2}


def test_reads_w2_stacked_box5_not_adjacent_box_number() -> None:
    """IRS W-2 prints Box 5 above the amount and Box 2 in the cell to the right."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 50), "Form W-2 Wage and Tax Statement", fontsize=12)
    page.insert_text((72, 90), "b Employer identification number (EIN)", fontsize=9)
    page.insert_text((72, 106), "74-1234567", fontsize=10)
    page.insert_text((72, 140), "c Employer's name, address, and ZIP code", fontsize=9)
    page.insert_text((72, 156), "Apex Technology Partners LLC", fontsize=10)
    page.insert_text((320, 200), "5 Medicare wages and tips", fontsize=9)
    page.insert_text((320, 218), "78,500.00", fontsize=10)
    page.insert_text((460, 200), "2 Federal income tax withheld", fontsize=9)
    page.insert_text((460, 218), "9,420.00", fontsize=10)
    data = doc.tobytes()
    doc.close()

    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert "w2-box1" not in by_id, fields
    assert by_id["w2-box5"]["numericValue"] == 78500.0, fields
    assert by_id["w2-box5"]["numericValue"] != 2.0
    assert by_id["w2-box5"]["numericValue"] != 8500.0
    assert by_id["w2-box2"]["numericValue"] == 9420.0, fields


def test_reads_w2_box5_from_ocr_labels_when_pdf_text_is_absent() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    words = [
        {"x0": 40, "y0": 40, "x1": 260, "y1": 54, "text": "Form W-2 Wage and Tax Statement"},
        {"x0": 320, "y0": 200, "x1": 440, "y1": 210, "text": "5 Medicare wages and tips"},
        {"x0": 320, "y0": 218, "x1": 390, "y1": 230, "text": "78,500.00"},
    ]
    fields = extract_page_fields(
        page,
        page_index=0,
        words=words,
        text="Form W-2 Wage and Tax Statement 5 Medicare wages and tips 78,500.00",
    )
    doc.close()
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert by_id["w2-box5"]["numericValue"] == 78500.0


def test_reads_live_w2_box5_ein_and_curly_employer_name() -> None:
    """Copy-B style cells: curly apostrophe, EIN/Box 5 under the label, Box 6 to the right."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=396)
    page.insert_text((16, 24), "Form W-2 Wage and Tax Statement", fontsize=12)
    page.insert_text((156, 58), "b Employer identification number (EIN)", fontsize=6.5)
    page.insert_text((156, 74), "94-8765432", fontsize=10)
    page.insert_text((356, 58), "d Control number", fontsize=6.5)
    page.insert_text((356, 74), "W2-2025-0447", fontsize=10)
    page.insert_text((16, 98), "c Employer’s name, address, and ZIP code", fontsize=6.5)
    page.insert_text((16, 114), "Digital Solutions Corp", fontsize=8)
    page.insert_text((356, 232), "5 Medicare wages and tips", fontsize=6.5)
    page.insert_text((356, 248), "78,500.00", fontsize=10)
    page.insert_text((476, 232), "6 Medicare tax withheld", fontsize=6.5)
    page.insert_text((476, 248), "1,138.25", fontsize=10)
    data = doc.tobytes()
    doc.close()

    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert by_id["w2-box5"]["numericValue"] == 78500.0, fields
    assert by_id["w2-box5"]["numericValue"] not in (6.0, 8500.0, 1138.25)
    assert by_id["w2-employer-ein"]["value"] == "94-8765432", fields
    assert by_id["w2-employer-name"]["value"] == "Digital Solutions Corp", fields


def test_reads_w2_same_line_box5() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 60), "Form W-2 Wage and Tax Statement", fontsize=12)
    page.insert_text((72, 100), "Box 1 Wages tips other compensation 150000.00", fontsize=10)
    page.insert_text((72, 140), "Box 5 Medicare wages and tips 78500.00", fontsize=10)
    data = doc.tobytes()
    doc.close()

    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert "w2-box1" not in by_id, fields
    assert by_id["w2-box5"]["numericValue"] == 78500.0, fields


def test_reads_w2_acroform_box5_and_snaps_overlay() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 60), "Form W-2 Wage and Tax Statement", fontsize=12)
    page.insert_text((72, 200), "Medicare wages and tips", fontsize=10)
    widget = fitz.Widget()
    widget.rect = fitz.Rect(320, 190, 460, 212)
    widget.field_name = "w2_box5"
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    widget.field_value = "78500.00"
    page.add_widget(widget)
    data = doc.tobytes()
    doc.close()

    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert "w2-box1" not in by_id, fields
    assert by_id["w2-box5"]["numericValue"] == 78500.0
    box = by_id["w2-box5"]["box"]
    assert 0.4 < box["x"] < 0.8
    assert box["w"] > 0.1
    assert box["h"] > 0.01


def test_extracts_paystub_regular_row_not_gross_ytd() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 60), "Earnings Statement Semi-monthly (24/yr)", fontsize=12)
    page.insert_text((72, 100), "Employer: Hidden Payroll Inc", fontsize=10)
    page.insert_text((72, 130), "Regular", fontsize=10)
    page.insert_text((200, 130), "45.00", fontsize=10)
    page.insert_text((280, 130), "86.67", fontsize=10)
    page.insert_text((360, 130), "3,600.00", fontsize=10)
    page.insert_text((460, 130), "54,000.00", fontsize=10)
    page.insert_text((72, 160), "Overtime", fontsize=10)
    page.insert_text((460, 160), "4,200.00", fontsize=10)
    page.insert_text((72, 190), "Bonus", fontsize=10)
    page.insert_text((460, 190), "12,500.00", fontsize=10)
    page.insert_text((72, 220), "Gross pay", fontsize=10)
    page.insert_text((360, 220), "3,600.00", fontsize=10)
    page.insert_text((460, 220), "70,700.00", fontsize=10)
    page.insert_text((72, 250), "Year to date  70,700.00", fontsize=10)
    page.insert_text((72, 280), "40 hr/wk", fontsize=10)
    data = doc.tobytes()
    doc.close()
    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert by_id["ps-hourly-rate"]["numericValue"] == 45.0
    assert by_id["ps-current-base"]["numericValue"] == 3600.0
    assert by_id["ps-base-ytd"]["numericValue"] == 54000.0
    assert by_id["ps-ot-ytd"]["numericValue"] == 4200.0
    assert by_id["ps-bonus-ytd"]["numericValue"] == 12500.0
    assert by_id["ps-hours-week"]["numericValue"] == 40.0
    assert by_id["ps-employer-name"]["value"] == "Hidden Payroll Inc"


def test_reads_paystub_header_employer_and_pay_advice() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((40, 40), "Apex Technology Partners LLC", fontsize=14)
    page.insert_text((40, 70), "PAY ADVICE", fontsize=12)
    page.insert_text((40, 100), "Regular", fontsize=10)
    page.insert_text((200, 100), "45.00", fontsize=10)
    page.insert_text((280, 100), "86.67", fontsize=10)
    page.insert_text((360, 100), "3,600.00", fontsize=10)
    page.insert_text((460, 100), "54,000.00", fontsize=10)
    data = doc.tobytes()
    doc.close()
    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert by_id["ps-employer-name"]["value"] == "Apex Technology Partners LLC", fields
    assert by_id["ps-base-ytd"]["numericValue"] == 54000.0, fields
    assert by_id["ps-hourly-rate"]["numericValue"] == 45.0


def test_extracts_paystub_ytd_from_labeled_line() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 60), "Earnings Statement", fontsize=12)
    page.insert_text((72, 140), "Year to date  54000.00", fontsize=10)
    page.insert_text((72, 170), "Hourly rate  45.00", fontsize=10)
    data = doc.tobytes()
    doc.close()
    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert by_id["ps-base-ytd"]["numericValue"] == 54000.0
    assert by_id["ps-hourly-rate"]["numericValue"] == 45.0


def test_reads_ordered_dated_regular_paystub_row() -> None:
    assert _dated_regular_pay_slots(
        "Regular Hourly 10/30/2022 - 11/05/2022 40 51.9953 2,079.82 1400 72,568.59"
    ) == {
        "hours": 40.0,
        "rate": 51.9953,
        "current": 2079.82,
        "ytd_hours": 1400.0,
        "ytd": 72568.59,
    }
    assert _ordered_regular_pay_slots("Vacation Pay 0 128 6,585.08") == {
        "current": 0.0,
        "ytd_hours": 128.0,
        "ytd": 6585.08,
    }
    assert _ordered_regular_pay_slots("Overtime Premium 0 0 0.34") == {
        "current": 0.0,
        "ytd_hours": 0.0,
        "ytd": 0.34,
    }


def test_ordered_paystub_overlays_point_to_numeric_tokens() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 40), "Earnings Statement Semi-monthly (24/yr)", fontsize=12)
    # The statement contains a summary row with the same label before the dated
    # earnings row. The overlay must bind to the dated row's numeric cells.
    page.insert_text((72, 75), "Regular Hourly", fontsize=10)
    page.insert_text((430, 75), "0", fontsize=10)
    page.insert_text((485, 75), "168", fontsize=10)
    page.insert_text((525, 75), "8,439.82", fontsize=10)
    page.insert_text((72, 100), "Regular Hourly", fontsize=10)
    page.insert_text((190, 100), "10/30/2022 - 11/05/2022", fontsize=10)
    page.insert_text((350, 100), "40", fontsize=10)
    page.insert_text((380, 100), "51.9953", fontsize=10)
    page.insert_text((430, 100), "2,079.82", fontsize=10)
    page.insert_text((485, 100), "1400", fontsize=10)
    page.insert_text((525, 100), "72,568.59", fontsize=10)
    data = doc.tobytes()
    doc.close()

    by_id = {row["sourceFieldId"]: row for row in extract_irs_form_fields(data)}
    assert by_id["ps-hourly-rate"]["box"]["x"] > 0.55
    assert by_id["ps-current-base"]["box"]["x"] > 0.65
    assert by_id["ps-base-ytd"]["box"]["x"] > 0.80
    assert by_id["ps-hours-week"]["box"]["x"] > 0.50
    assert len(by_id["ps-base-ytd"]["componentBoxes"]) == 2
    assert all(box["x"] > 0.80 for box in by_id["ps-base-ytd"]["componentBoxes"])


def test_paystub_classifies_base_bonus_and_variable_rows() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 40), "Earnings Statement", fontsize=12)
    rows = [
        (80, "Regular", "50,000.00"),
        (100, "Shift Differential", "1,200.00"),
        (120, "PTO", "2,000.00"),
        (140, "Holiday", "500.00"),
        (160, "AIP", "4,000.00"),
        (180, "Bonus", "3,000.00"),
        (200, "Spot Bonus", "9,999.00"),
        (220, "Relocation", "8,888.00"),
        (240, "Tips", "1,800.00"),
        (260, "Commission", "6,000.00"),
        (280, "RSU", "7,500.00"),
    ]
    for y, label, amount in rows:
        page.insert_text((72, y), label, fontsize=10)
        page.insert_text((320, y), "0.00", fontsize=10)
        page.insert_text((420, y), amount, fontsize=10)
    data = doc.tobytes()
    doc.close()
    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert by_id["ps-base-ytd"]["numericValue"] == 53700.0
    assert by_id["ps-bonus-ytd"]["numericValue"] == 7000.0
    assert by_id["ps-tips-ytd"]["numericValue"] == 1800.0
    assert by_id["ps-commission-ytd"]["numericValue"] == 6000.0
    assert by_id["ps-rsu-ytd"]["numericValue"] == 7500.0
    assert all(row["numericValue"] not in (9999.0, 8888.0) for row in fields)


def test_paystub_classifies_ot_double_time_and_worked_holiday() -> None:
    assert _paystub_row_kind("OT") == "ot"
    assert _paystub_row_kind("Overtime") == "ot"
    assert _paystub_row_kind("Double Time") == "ot"
    assert _paystub_row_kind("1.5 Hourly") == "ot"
    assert _paystub_row_kind("Worked Holiday") == "ot"
    assert _paystub_row_kind("Holiday") == "regular"

    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 40), "Earnings Statement", fontsize=12)
    rows = [
        (80, "Regular", "50,000.00"),
        (100, "Holiday", "500.00"),
        (120, "OT", "1,000.00"),
        (140, "Overtime", "800.00"),
        (160, "Double Time", "400.00"),
        (180, "1.5 Hourly", "300.00"),
        (200, "Worked Holiday", "200.00"),
    ]
    for y, label, amount in rows:
        page.insert_text((72, y), label, fontsize=10)
        page.insert_text((320, y), "0.00", fontsize=10)
        page.insert_text((420, y), amount, fontsize=10)
    data = doc.tobytes()
    doc.close()
    fields = extract_irs_form_fields(data)
    by_id = {row["sourceFieldId"]: row for row in fields}
    assert by_id["ps-base-ytd"]["numericValue"] == 50500.0
    assert by_id["ps-ot-ytd"]["numericValue"] == 2700.0


def test_select_ocr_scans_when_majority_need_ocr_and_no_keep_set() -> None:
    inspected = [
        SimpleNamespace(index=0, use_ocr=True),
        SimpleNamespace(index=1, use_ocr=True),
        SimpleNamespace(index=2, use_ocr=False),
    ]
    split = SplitResult(
        target_pages=[],
        classifications={},
        statement_refs=[],
        unresolved_statements=[],
    )
    assert select_ocr_page_indices(inspected, split) == {0, 1}
