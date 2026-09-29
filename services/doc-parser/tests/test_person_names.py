"""Whose document is it: the person named on a W-2, K-1, or Schedule C.

The console assigns each document to a borrower on the 1003 by this name, so a
form label or a business name read as a person would file income under the
wrong borrower or none.
"""

from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from irs_form_extract import _person_name, extract_irs_form_fields  # noqa: E402

TEMPLATES = ROOT / "templates"
PERSON_IDS = {"w2-employee-name", "pt-partner-name", "scorp-shareholder-name", "ent1-proprietor"}

pytestmark = pytest.mark.skipif(
    not all((TEMPLATES / name).exists() for name in ("fw2.pdf", "f1065sk1.pdf", "f1120ssk.pdf")),
    reason="official fillable blanks are required",
)


def _fill(blank: str, page_index: int, values: dict[str, str], *, bake: bool = False) -> bytes:
    document = fitz.open(TEMPLATES / blank)
    try:
        for widget in document[page_index].widgets() or []:
            key = widget.field_name.split(".")[-1]
            if key in values:
                widget.field_value = values[key]
                widget.update()
        if bake:
            document.bake()
        return document.tobytes()
    finally:
        document.close()


def _names(pdf: bytes, page_index: int) -> dict[str, str]:
    rows = extract_irs_form_fields(pdf, page_indices=[page_index])
    return {row["sourceFieldId"]: row["value"] for row in rows if row["sourceFieldId"] in PERSON_IDS}


@pytest.mark.parametrize("bake", [False, True])
def test_1065_k1_partner_name_is_the_first_line_of_box_f(bake: bool) -> None:
    pdf = _fill(
        "f1065sk1.pdf",
        0,
        {"f1_7[0]": "Riverbend Holdings LLC\n1 River Rd", "f1_10[0]": "Nathan Jenson\n123 Main St\nPhoenix AZ 85001"},
        bake=bake,
    )
    assert _names(pdf, 0) == {"pt-partner-name": "Nathan Jenson"}


@pytest.mark.parametrize("bake", [False, True])
def test_1120s_k1_shareholder_name(bake: bool) -> None:
    pdf = _fill("f1120ssk.pdf", 0, {"f1_07[0]": "Apex Corp\n1 Way", "f1_12[0]": "Maria L. Jenson\n9 Elm St"}, bake=bake)
    assert _names(pdf, 0) == {"scorp-shareholder-name": "Maria L. Jenson"}


@pytest.mark.parametrize("bake", [False, True])
def test_w2_box_e_joins_first_and_last_name(bake: bool) -> None:
    pdf = _fill("fw2.pdf", 1, {"f1_05[0]": "Nathan W", "f1_06[0]": "Jenson", "f1_08[0]": "123 Main St"}, bake=bake)
    assert _names(pdf, 1)["w2-employee-name"] == "Nathan W Jenson"


@pytest.mark.parametrize("blank,page", [("f1065sk1.pdf", 0), ("f1120ssk.pdf", 0), ("fw2.pdf", 1)])
def test_a_blank_form_names_nobody(blank: str, page: int) -> None:
    assert _names((TEMPLATES / blank).read_bytes(), page) == {}


def _schedule_c(proprietor: str) -> bytes:
    document = fitz.open()
    page = document.new_page(width=612, height=792)
    page.insert_text((36, 40), "SCHEDULE C (Form 1040)  Profit or Loss From Business", fontsize=10)
    page.insert_text((36, 70), "Name of proprietor", fontsize=8)
    if proprietor:
        page.insert_text((130, 70), proprietor, fontsize=9)
    page.insert_text((470, 70), "Social security number (SSN)", fontsize=7)
    page.insert_text((36, 95), "C  Business name. If no separate business name, leave blank.", fontsize=8)
    page.insert_text((36, 107), "Jenson Consulting LLC", fontsize=9)
    page.insert_text((36, 300), "31  Net profit or (loss). Subtract line 30 from line 29", fontsize=8)
    page.insert_text((520, 300), "84,000", fontsize=9)
    data = document.tobytes()
    document.close()
    return data


def test_schedule_c_proprietor_is_read_right_of_its_caption() -> None:
    assert _names(_schedule_c("Maria L Jenson"), 0) == {"ent1-proprietor": "Maria L Jenson"}


def test_schedule_c_without_a_proprietor_names_nobody() -> None:
    assert _names(_schedule_c(""), 0) == {}


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Nathan Jenson\n123 Main St", "Nathan Jenson"),
        ("JENSON, NATHAN W 22911 E Thornton Rd", "JENSON, NATHAN W"),
        ("Riverbend Holdings LLC", None),
        ("Name, address, city, state, and ZIP code", None),
        ("Last name", None),
        ("Nathan", None),
    ],
)
def test_person_name_rules(raw: str, expected: str | None) -> None:
    assert _person_name(raw) == expected
