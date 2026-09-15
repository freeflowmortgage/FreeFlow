"""Inspect gate, AcroForm merge, and searchable-mask bypass."""

from __future__ import annotations

import sys
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from ai_pdf_converter import AIPDFConverter, NATIVE_TEXT_CHARS, OcrWord, PageResult  # noqa: E402


def _chrome_pdf(*, wages: str | None = None) -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Form 1040 Department of the Treasury Internal Revenue Service", fontsize=11)
    page.insert_text((72, 96), "U.S. Individual Income Tax Return", fontsize=11)
    if wages:
        page.insert_text((72, 140), f"1z Add lines 1a through 1h  {wages}", fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


def test_irs_chrome_without_amounts_requests_ocr() -> None:
    converter = AIPDFConverter()
    inspected = converter.inspect_pages(_chrome_pdf())
    assert len(inspected) == 1
    assert inspected[0].use_ocr is True
    assert "irs_searchable_mask_bypass" in inspected[0].flags
    assert converter.searchable_mask(_chrome_pdf()) == [False]


def test_content_stream_amounts_skip_ocr() -> None:
    converter = AIPDFConverter()
    inspected = converter.inspect_pages(_chrome_pdf(wages="78,500.00"))
    assert inspected[0].use_ocr is False
    assert "irs_searchable_mask_bypass" not in inspected[0].flags


def test_empty_native_acroform_skips_ocr_and_false_values() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Form 1040 Department of the Treasury Internal Revenue Service", fontsize=11)
    page.insert_text((72, 96), "U.S. Individual Income Tax Return", fontsize=11)
    widget = fitz.Widget()
    widget.rect = fitz.Rect(320, 190, 460, 212)
    widget.field_name = "line_1z"
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    page.add_widget(widget)
    data = doc.tobytes()
    doc.close()

    inspected = AIPDFConverter().inspect_pages(data)

    assert inspected[0].use_ocr is False
    assert inspected[0].fields == []
    assert "blank_acroform_native_text" in inspected[0].flags


def test_irs_native_page_without_widgets_still_requests_ocr() -> None:
    inspected = AIPDFConverter().inspect_pages(_chrome_pdf())
    assert inspected[0].use_ocr is True
    assert "blank_acroform_native_text" not in inspected[0].flags


def test_k1_code_reference_page_skips_ocr() -> None:
    text = (
        "Schedule K-1 (Form 1041) 2024 Page 2 "
        "This list identifies the codes used on Schedule K-1 for beneficiaries "
        "and provides summarized reporting information for beneficiaries."
    )
    use_ocr, flags = AIPDFConverter._page_strategy(text, [])
    assert use_ocr is False
    assert "irs_reference_native_text" in flags


def test_numeric_form_overlay_requests_ocr_for_form_labels() -> None:
    text = "value " * 80 + " 12,000.00 13,000.00 14,000.00 15,000.00"
    use_ocr, flags = AIPDFConverter._page_strategy(text, [])
    assert use_ocr is True
    assert "numeric_form_overlay_ocr_bypass" in flags


def test_label_rich_numeric_page_preserves_native_text() -> None:
    text = (
        "Tax return comparison income deductions adjusted gross exemptions credits payments "
        "filing status taxpayer identification federal state charitable contribution worksheet "
        "current prior difference calendar schedule attachment "
        + "supporting detail " * 20
        + " 12,000.00 13,000.00 14,000.00 15,000.00"
    )
    use_ocr, flags = AIPDFConverter._page_strategy(text, [])
    assert use_ocr is False
    assert "label_rich_native_text" in flags
    assert "numeric_form_overlay_ocr_bypass" not in flags


def test_native_paystub_table_skips_lossy_ocr() -> None:
    text = (
        "Earnings Statement Pay Period Regular Hourly 10/30/2022 - 11/05/2022 "
        "40 51.9953 2,079.82 1400 72,568.59 Employee Taxes " + "detail " * 50
    )
    use_ocr, flags = AIPDFConverter._page_strategy(text, [])
    assert use_ocr is False
    assert "paystub_native_text" in flags


def test_ocr_page_text_includes_native_overlay_and_ocr_labels() -> None:
    page = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=False,
        plain_text="78500.00",
        words=[OcrWord(text="Form W-2", x=0, y=0, w=0, h=0, confidence=99)],
    )
    assert page.text() == "78500.00 Form W-2"


def test_filled_acroform_skips_ocr_and_emits_field_word() -> None:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Form W-2 Wage and Tax Statement", fontsize=12)
    widget = fitz.Widget()
    widget.rect = fitz.Rect(320, 190, 460, 212)
    widget.field_name = "w2_box1"
    widget.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    widget.field_value = "78500.00"
    page.add_widget(widget)
    data = doc.tobytes()
    doc.close()
    converter = AIPDFConverter()
    inspected = converter.inspect_pages(data)
    assert inspected[0].use_ocr is False
    assert any(word.text == "78500.00" for word in inspected[0].fields)
    assert "acroform_merged" in inspected[0].flags


def test_page_strategy_short_unlabeled_page_needs_ocr() -> None:
    use_ocr, flags = AIPDFConverter._page_strategy("x" * (NATIVE_TEXT_CHARS - 1), [])
    assert use_ocr is True
    assert flags == []
