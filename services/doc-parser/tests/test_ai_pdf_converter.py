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


def test_numeric_form_overlay_requests_ocr_for_form_labels() -> None:
    text = "value " * 80 + " 12,000.00 13,000.00 14,000.00 15,000.00"
    use_ocr, flags = AIPDFConverter._page_strategy(text, [])
    assert use_ocr is True
    assert "numeric_form_overlay_ocr_bypass" in flags


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


def test_ocr_page_text_does_not_duplicate_when_plain_text_is_ocr_words() -> None:
    page = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=False,
        plain_text="Form W-2",
        words=[OcrWord(text="Form W-2", x=0, y=0, w=0, h=0, confidence=99)],
    )
    assert page.text() == "Form W-2"


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
