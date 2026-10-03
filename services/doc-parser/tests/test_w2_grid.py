"""Form W-2 Copy B grid from fw2.pdf."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from w2_grid import (  # noqa: E402
    TEMPLATE_DIR,
    extract_w2_pages,
    generate_template_map,
    is_w2_instruction_page,
    load_template_map,
    parse_adp_reported_wages,
    parse_unified_w2_matrix,
    parse_w2_from_ocr_words,
    validate_medicare_tax,
    _wage_from_clip,
)

TEMPLATE_PDF = TEMPLATE_DIR / "fw2.pdf"


def _paint(page, box: list[float], text: str, fontsize: float = 8) -> None:
    page.insert_text((box[0] + 2, box[1] + 9), text, fontsize=fontsize)


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official fw2.pdf blank is required")
def test_template_map_has_box5_on_copy_b() -> None:
    mapping = generate_template_map()
    top = mapping["forms"][0]["boxes"]
    assert set(top) >= {"employer_ein", "employer_name", "box1", "box5"}
    assert top["box5"][1] > top["box1"][1]
    assert top["box5"][0] > top["employer_name"][0]


@pytest.mark.skipif(not TEMPLATE_PDF.exists(), reason="official fw2.pdf blank is required")
def test_extracts_box5_and_employer_from_copy_b() -> None:
    import fitz

    mapping = load_template_map()
    src = fitz.open(str(TEMPLATE_PDF))
    copy_b = next(
        index
        for index, page in enumerate(src)
        if any("CopyB" in ((widget.field_name or "")) for widget in (page.widgets() or []))
    )
    out = fitz.open()
    out.insert_pdf(src, from_page=copy_b, to_page=copy_b)
    page = out[0]
    values = {
        "f2_02[0]": "41-0255900",
        "f2_03[0]": "US Bank National Assoc.",
        "f2_09[0]": "120000.00",
        "f2_13[0]": "121500.00",
    }
    for widget in page.widgets() or []:
        name = widget.field_name or ""
        for suffix, value in values.items():
            if "CopyB_Top" in name and name.endswith(suffix):
                widget.field_value = value
                widget.update()
    boxes = mapping["forms"][0]["boxes"]
    _paint(page, boxes["employer_ein"], "41-0255900")
    _paint(page, boxes["employer_name"], "US Bank National Assoc.", 9)
    _paint(page, boxes["box1"], "120000.00")
    _paint(page, boxes["box5"], "121500.00")
    data = out.tobytes()
    src.close()
    out.close()

    extracts = extract_w2_pages(data)
    assert extracts
    row = next(item for item in extracts if item.get("box5"))
    assert row["ein"] == "41-0255900"
    assert "US Bank" in row["employerName"]
    assert row["box5"] == 121500.0
    assert row["box1"] == 120000.0


def test_supplied_converter_words_do_not_trigger_a_second_ocr_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    import fitz
    import w2_grid

    doc = fitz.open()
    doc.new_page(width=612, height=792)
    data = doc.tobytes()
    doc.close()
    supplied = SimpleNamespace(
        index=0,
        words=[{"text": "Uniform Residential Loan Application", "x": 0.1, "y": 0.1, "w": 0.4, "h": 0.03}],
    )

    def unexpected_second_ocr(_page):
        raise AssertionError("converter-supplied OCR words must be reused")

    monkeypatch.setattr(w2_grid, "ocr_page_words", unexpected_second_ocr)

    assert extract_w2_pages(data, ocr_pages=[supplied]) == []


class _Rect:
    width = 612.0
    height = 792.0


class _Page:
    rect = _Rect()


def test_ocr_words_fill_box5_off_the_irs_grid() -> None:
    words = [
        {"x0": 40, "y0": 50, "x1": 180, "y1": 62, "text": "41-0255900"},
        {"x0": 40, "y0": 80, "x1": 280, "y1": 92, "text": "Employer's name, address, and ZIP code"},
        {"x0": 40, "y0": 96, "x1": 240, "y1": 108, "text": "US Bank National Assoc."},
        {"x0": 320, "y0": 140, "x1": 520, "y1": 152, "text": "1 Wages, tips, other compensation"},
        {"x0": 430, "y0": 154, "x1": 510, "y1": 166, "text": "120,000.00"},
        {"x0": 320, "y0": 200, "x1": 520, "y1": 212, "text": "5 Medicare wages and tips"},
        {"x0": 430, "y0": 214, "x1": 510, "y1": 226, "text": "121,500.00"},
    ]
    parsed = parse_w2_from_ocr_words(_Page(), words, page_index=0)
    assert parsed is not None
    assert parsed["box5"] == 121500.0
    assert parsed["box1"] == 120000.0
    assert "US Bank" in parsed["employerName"]
    assert parsed["ein"] == "41-0255900"


def test_ocr_uses_copy_b_and_box5_not_box6_on_same_row() -> None:
    words = [
        {"x0": 40, "y0": 80, "x1": 280, "y1": 92, "text": "c Employer's name, address, and ZIP code"},
        {"x0": 40, "y0": 96, "x1": 240, "y1": 108, "text": "US Bank National Assoc."},
        {"x0": 40, "y0": 50, "x1": 140, "y1": 62, "text": "41-0255900"},
        {"x0": 300, "y0": 200, "x1": 430, "y1": 212, "text": "5 Medicare wages and tips"},
        {"x0": 440, "y0": 200, "x1": 510, "y1": 212, "text": "168,641.08"},
        {"x0": 520, "y0": 200, "x1": 600, "y1": 212, "text": "6 Medicare tax withheld"},
        {"x0": 610, "y0": 200, "x1": 670, "y1": 212, "text": "2,445.30"},
        {"x0": 300, "y0": 520, "x1": 430, "y1": 532, "text": "5 Medicare wages and tips"},
        {"x0": 440, "y0": 520, "x1": 510, "y1": 532, "text": "168,641.08"},
    ]
    parsed = parse_w2_from_ocr_words(_Page(), words, page_index=0)
    assert parsed is not None
    assert parsed["box5"] == 168641.08
    assert parsed["box6"] == 2445.30


def test_instruction_reverse_is_not_a_w2_form_page() -> None:
    text = (
        "Notice to Employee. In order for the information on this form to be effectively keypunched, "
        "it must be read upright. THIS W-2 IS ACCEPTABLE FOR FILING WITH YOUR FEDERAL, STATE, AND LOCALITY "
        "INCOME TAX RETURNS. Instructions for Employee. Form W-2 Wage and Tax Statement."
    )
    assert is_w2_instruction_page(text) is True
    assert is_w2_instruction_page("Wage and Tax Statement 5 Medicare wages and tips 168,641.08 1 Wages 159,550.98") is False


def test_zip_and_ein_digits_are_not_wages() -> None:
    assert _wage_from_clip("MN 55422") == 0.0
    assert _wage_from_clip("55422") == 0.0
    assert _wage_from_clip("31-0841368") == 0.0
    assert _wage_from_clip("168641.08") == 168641.08
    assert _wage_from_clip("159,550.98") == 159550.98


def test_four_up_reads_copy_b_box5_below_label_not_the_zip() -> None:
    words = [
        {"x0": 20, "y0": 8, "x1": 90, "y1": 20, "text": "Copy B"},
        {"x0": 330, "y0": 8, "x1": 400, "y1": 20, "text": "Copy 2"},
        {"x0": 20, "y0": 410, "x1": 90, "y1": 422, "text": "Copy C"},
        {"x0": 40, "y0": 50, "x1": 140, "y1": 62, "text": "31-0841368"},
        {"x0": 40, "y0": 80, "x1": 220, "y1": 92, "text": "c Employer's name, address, and ZIP code"},
        {"x0": 40, "y0": 96, "x1": 220, "y1": 108, "text": "US Bank National Assoc."},
        {"x0": 40, "y0": 112, "x1": 180, "y1": 124, "text": "4000 W Broadway"},
        {"x0": 40, "y0": 128, "x1": 160, "y1": 140, "text": "Robbinsdale, MN 55422"},
        {"x0": 160, "y0": 118, "x1": 250, "y1": 130, "text": "5 Medicare wages and tips"},
        {"x0": 175, "y0": 134, "x1": 250, "y1": 146, "text": "168641.08"},
        {"x0": 340, "y0": 118, "x1": 430, "y1": 130, "text": "5 Medicare wages and tips"},
        {"x0": 400, "y0": 134, "x1": 450, "y1": 146, "text": "55422"},
    ]
    parsed = parse_w2_from_ocr_words(_Page(), words, page_index=0)
    assert parsed is not None
    assert parsed["box5"] == 168641.08
    assert "US Bank" in parsed["employerName"]
    assert parsed["ein"] == "31-0841368"


def _nates_unlabeled_words(*, merge_box5_6: bool = False) -> list[dict[str, str | float]]:
    """nates.pdf stream: SSN+wages, EIN between rows, no Medicare label on Box 5."""
    words: list[dict[str, str | float]] = [
        {"x0": 20, "y0": 8, "x1": 90, "y1": 20, "text": "Copy B"},
        {"x0": 330, "y0": 8, "x1": 400, "y1": 20, "text": "Copy 2"},
        {"x0": 20, "y0": 410, "x1": 90, "y1": 422, "text": "Copy C"},
        {"x0": 40, "y0": 30, "x1": 220, "y1": 42, "text": "Wage and Tax Statement"},
        {"x0": 40, "y0": 50, "x1": 130, "y1": 62, "text": "900-00-0001"},
        {"x0": 160, "y0": 50, "x1": 230, "y1": 62, "text": "159550.98"},
        {"x0": 240, "y0": 50, "x1": 300, "y1": 62, "text": "25494.40"},
        {"x0": 40, "y0": 70, "x1": 120, "y1": 82, "text": "310841368"},
        {"x0": 160, "y0": 100, "x1": 230, "y1": 112, "text": "142800.00"},
        {"x0": 240, "y0": 100, "x1": 300, "y1": 112, "text": "8853.60"},
        {"x0": 40, "y0": 140, "x1": 220, "y1": 152, "text": "US Bank National Assoc"},
        {"x0": 40, "y0": 200, "x1": 90, "y1": 212, "text": "C"},
        {"x0": 100, "y0": 200, "x1": 150, "y1": 212, "text": "54.08"},
        {"x0": 40, "y0": 220, "x1": 90, "y1": 232, "text": "D"},
        {"x0": 100, "y0": 220, "x1": 160, "y1": 232, "text": "9090.10"},
        {"x0": 40, "y0": 260, "x1": 70, "y1": 272, "text": "AZ"},
        {"x0": 80, "y0": 260, "x1": 150, "y1": 272, "text": "159550.98"},
        {"x0": 160, "y0": 260, "x1": 220, "y1": 272, "text": "4307.86"},
    ]
    if merge_box5_6:
        words.append({"x0": 160, "y0": 130, "x1": 300, "y1": 142, "text": "168641.08 2445.30"})
    else:
        words.extend(
            [
                {"x0": 160, "y0": 130, "x1": 230, "y1": 142, "text": "168641.08"},
                {"x0": 240, "y0": 130, "x1": 300, "y1": 142, "text": "2445.30"},
            ]
        )
    return words


def test_medicare_ratio_confirms_nates_box5() -> None:
    assert validate_medicare_tax(168641.08, 2445.30) is True
    assert validate_medicare_tax(23500.00, 340.75) is True
    assert validate_medicare_tax(23500.00, 25000.00) is False


def test_unlabeled_matrix_skips_ein_and_fills_box5() -> None:
    parsed = parse_w2_from_ocr_words(_Page(), _nates_unlabeled_words(), page_index=0)
    assert parsed is not None
    assert parsed["box1"] == 159550.98
    assert parsed["box2"] == 25494.40
    assert parsed["box3"] == 142800.00
    assert parsed["box4"] == 8853.60
    assert parsed["box5"] == 168641.08
    assert parsed["box6"] == 2445.30
    assert parsed["isMedicareValidated"] is True
    matrix = parse_unified_w2_matrix(_Page(), _nates_unlabeled_words())
    assert matrix is not None
    assert matrix["box3"] != 310841368


def test_merged_box5_box6_token_splits() -> None:
    parsed = parse_w2_from_ocr_words(_Page(), _nates_unlabeled_words(merge_box5_6=True), page_index=0)
    assert parsed is not None
    assert parsed["box5"] == 168641.08
    assert parsed["box6"] == 2445.30


def test_matrix_rejects_when_medicare_ratio_fails() -> None:
    words = _nates_unlabeled_words()
    for word in words:
        if word["text"] == "2445.30":
            word["text"] = "8800.00"
    assert parse_unified_w2_matrix(_Page(), words) is None


def test_adp_left_grid_not_gross_pay() -> None:
    words = [
        {"x0": 20, "y0": 8, "x1": 80, "y1": 20, "text": "Form W-2"},
        {"x0": 20, "y0": 24, "x1": 200, "y1": 36, "text": "Wage and Tax Statement"},
        {"x0": 40, "y0": 50, "x1": 130, "y1": 62, "text": "12-3456789"},
        {"x0": 160, "y0": 80, "x1": 230, "y1": 92, "text": "23500.00"},
        {"x0": 240, "y0": 80, "x1": 300, "y1": 92, "text": "1500.00"},
        {"x0": 160, "y0": 110, "x1": 230, "y1": 122, "text": "23500.00"},
        {"x0": 240, "y0": 110, "x1": 300, "y1": 122, "text": "1457.00"},
        {"x0": 160, "y0": 140, "x1": 230, "y1": 152, "text": "23500.00"},
        {"x0": 240, "y0": 140, "x1": 300, "y1": 152, "text": "340.75"},
        {"x0": 160, "y0": 170, "x1": 190, "y1": 182, "text": "W"},
        {"x0": 200, "y0": 170, "x1": 250, "y1": 182, "text": "500.00"},
        {"x0": 160, "y0": 200, "x1": 230, "y1": 212, "text": "23500.00"},
        {"x0": 240, "y0": 200, "x1": 300, "y1": 212, "text": "800.00"},
        {"x0": 330, "y0": 40, "x1": 520, "y1": 52, "text": "W-2 and EARNINGS SUMMARY"},
        {"x0": 330, "y0": 56, "x1": 380, "y1": 68, "text": "Box"},
        {"x0": 382, "y0": 56, "x1": 392, "y1": 68, "text": "1"},
        {"x0": 394, "y0": 56, "x1": 420, "y1": 68, "text": "of W-2"},
        {"x0": 330, "y0": 80, "x1": 400, "y1": 92, "text": "Gross Pay"},
        {"x0": 420, "y0": 80, "x1": 490, "y1": 92, "text": "25000.00"},
        {"x0": 500, "y0": 80, "x1": 560, "y1": 92, "text": "25000.00"},
        {"x0": 330, "y0": 140, "x1": 470, "y1": 152, "text": "Reported W-2 Wages"},
        {"x0": 420, "y0": 140, "x1": 490, "y1": 152, "text": "23500.00"},
        {"x0": 500, "y0": 140, "x1": 560, "y1": 152, "text": "23500.00"},
        {"x0": 570, "y0": 140, "x1": 630, "y1": 152, "text": "23500.00"},
    ]
    parsed = parse_w2_from_ocr_words(_Page(), words, page_index=0)
    assert parsed is not None
    assert parsed["box1"] == 23500.00
    assert parsed["box5"] == 23500.00
    assert parsed["box6"] == 340.75
    assert parsed["box1"] != 25000.00


def test_adp_reported_wages_fill_missing_box5_not_gross_pay() -> None:
    words = [
        {"x0": 20, "y0": 8, "x1": 80, "y1": 20, "text": "Form W-2"},
        {"x0": 20, "y0": 24, "x1": 200, "y1": 36, "text": "Wage and Tax Statement"},
        {"x0": 160, "y0": 80, "x1": 230, "y1": 92, "text": "23500.00"},
        {"x0": 240, "y0": 80, "x1": 300, "y1": 92, "text": "1500.00"},
        {"x0": 330, "y0": 40, "x1": 520, "y1": 52, "text": "W-2 and EARNINGS SUMMARY"},
        {"x0": 330, "y0": 56, "x1": 380, "y1": 68, "text": "Box"},
        {"x0": 382, "y0": 56, "x1": 392, "y1": 68, "text": "1"},
        {"x0": 394, "y0": 56, "x1": 430, "y1": 68, "text": "of W-2"},
        {"x0": 440, "y0": 56, "x1": 490, "y1": 68, "text": "Box"},
        {"x0": 492, "y0": 56, "x1": 502, "y1": 68, "text": "3"},
        {"x0": 504, "y0": 56, "x1": 540, "y1": 68, "text": "of W-2"},
        {"x0": 550, "y0": 56, "x1": 590, "y1": 68, "text": "Box"},
        {"x0": 592, "y0": 56, "x1": 602, "y1": 68, "text": "5"},
        {"x0": 604, "y0": 56, "x1": 640, "y1": 68, "text": "of W-2"},
        {"x0": 330, "y0": 80, "x1": 400, "y1": 92, "text": "Gross Pay"},
        {"x0": 420, "y0": 80, "x1": 470, "y1": 92, "text": "25000.00"},
        {"x0": 500, "y0": 80, "x1": 550, "y1": 92, "text": "25000.00"},
        {"x0": 580, "y0": 80, "x1": 630, "y1": 92, "text": "25000.00"},
        {"x0": 330, "y0": 140, "x1": 470, "y1": 152, "text": "Reported W-2 Wages"},
        {"x0": 420, "y0": 140, "x1": 470, "y1": 152, "text": "23500.00"},
        {"x0": 500, "y0": 140, "x1": 550, "y1": 152, "text": "23500.00"},
        {"x0": 580, "y0": 140, "x1": 630, "y1": 152, "text": "23500.00"},
    ]
    reported = parse_adp_reported_wages(_Page(), words)
    assert reported["box1"] == 23500.00
    assert reported["box5"] == 23500.00
    assert 25000.00 not in reported.values()
    parsed = parse_w2_from_ocr_words(_Page(), words, page_index=0)
    assert parsed is not None
    assert parsed["box5"] == 23500.00
    assert parsed["box1"] == 23500.00
