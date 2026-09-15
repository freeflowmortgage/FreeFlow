"""Label-anchored IRS field extraction with overlay boxes (Schedule E depth).

Schedule E Page 1 stays in schedule_e_grid.py. This module covers W-2, C, F,
K-1s, 1120, 1040 benefit lines, B/D, 4562, Form 8825, and Schedule L using the
same clip order: content text → widget /V → converter/OCR words.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, Iterable

from schedule_e_grid import (
    _clip_text,
    _open_pdf,
    _require_pymupdf,
    convert_relative_words,
    is_schedule_e_page1,
    parse_tax_amount,
    relative_box,
)

logger = logging.getLogger("freeflow.irs_extract")

EIN_TOKEN = re.compile(r"\b(\d{2}-\d{7}|\d{9})\b")
PERCENT_TOKEN = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*%")
MONEY_TOKEN = re.compile(
    r"(?:\$\s*)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?|\((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?\))"
)


@dataclass(frozen=True)
class FieldSpec:
    source_id: str
    form: str
    category: str
    box_label: str
    field_label: str
    line_num: str
    labels: tuple[str, ...]
    capture: str = "money"


W2_FIELDS = (
    FieldSpec(
        "w2-employer-name",
        "W-2",
        "identity",
        "Box c",
        "Employer Name",
        "Box c",
        (
            "c Employer's name",
            "c Employer’s name",
            "Employer's name",
            "Employer’s name",
            "Employer name",
            "c Employer",
            "name, address, and ZIP",
        ),
        "text",
    ),
    FieldSpec("w2-employer-ein", "W-2", "identity", "Box b", "Employer Identification Number (EIN)", "Box b", ("Employer identification number",), "ein"),
    FieldSpec("w2-box2", "W-2", "withholding", "Box 2", "Federal Income Tax Withheld", "Box 2", ("Federal income tax withheld",), "money"),
    FieldSpec("w2-box3", "W-2", "wages", "Box 3", "Social Security Wages", "Box 3", ("Social security wages",), "money"),
    FieldSpec("w2-box4", "W-2", "withholding", "Box 4", "Social Security Tax Withheld (6.2%)", "Box 4", ("Social security tax withheld",), "money"),
    FieldSpec("w2-box5", "W-2", "wages", "Box 5", "Medicare Wages and Tips", "Box 5", ("Medicare wages and tips",), "money"),
    FieldSpec("w2-box6", "W-2", "withholding", "Box 6", "Medicare Tax Withheld (1.45%)", "Box 6", ("Medicare tax withheld",), "money"),
)

SCHEDULE_C_FIELDS = (
    FieldSpec("ent1-name", "Schedule C", "identity", "Line C", "Business Name", "Line C", ("Business name",), "text"),
    FieldSpec("ent1-ein", "Schedule C", "identity", "Line B", "Employer Identification Number (EIN)", "Line B", ("EIN", "Employer ID number"), "ein"),
    FieldSpec("ent1-net", "Schedule C", "income", "Line 31", "Net Profit or Loss (Line 31)", "Line 31", ("Net profit or (loss)", "Net profit or loss"), "money"),
    FieldSpec("ent1-dep", "Schedule C", "addback", "Line 13", "Depreciation Expense (Line 13)", "Line 13", ("13 Depreciation", "Depreciation and section 179"), "money"),
    FieldSpec("ent1-depletion", "Schedule C", "addback", "Line 12", "Depletion (Line 12)", "Line 12", ("12 Depletion",), "money"),
    FieldSpec("ent1-meals", "Schedule C", "addback", "Line 24b", "Meals Exclusion (Line 24b)", "Line 24b", ("24b", "Deductible meals"), "money"),
    FieldSpec("ent1-home", "Schedule C", "addback", "Line 30", "Business Use of Home (Line 30)", "Line 30", ("Expenses for business use of your home",), "money"),
    FieldSpec("ent1-miles", "Schedule C", "mileage", "Line 44a", "Business Miles Driven (Line 44a)", "Line 44a", ("Business miles",), "integer"),
    FieldSpec("ent1-other-income", "Schedule C", "income", "Line 6", "Other Income (Line 6)", "Line 6", ("6 Other income", "Other income, including federal"), "money"),
    FieldSpec("ent1-amort", "Schedule C", "addback", "Line 27a", "Amortization / Casualty (Line 27a)", "Line 27a", ("27a Other expenses", "Amortization"), "money"),
)

PAYSTUB_FIELDS = (
    FieldSpec("ps-employer-name", "Paystub", "identity", "Employer", "Employer Name", "Employer", ("Employer", "Company"), "text"),
    FieldSpec("ps-hourly-rate", "Paystub", "wages", "Rate", "Hourly Rate of Pay", "Rate", ("Hourly rate", "Rate of pay", "Base rate"), "money"),
    FieldSpec("ps-hours-week", "Paystub", "wages", "Hours", "Standard Weekly Hours", "Hours", ("Hr/Wk", "Hours / Wk", "Weekly hours"), "integer"),
    FieldSpec("ps-current-base", "Paystub", "wages", "Current", "Current Period Base Pay", "Current", ("Current period base", "This period regular"), "money"),
    FieldSpec("ps-base-ytd", "Paystub", "wages", "YTD", "Base Wages YTD", "YTD", ("YTD regular", "YTD base", "Regular YTD", "Base wages YTD"), "money"),
    FieldSpec("ps-bonus-ytd", "Paystub", "wages", "Bonus YTD", "Bonus Income YTD", "Bonus", ("Bonus YTD", "YTD bonus"), "money"),
    FieldSpec("ps-ot-ytd", "Paystub", "wages", "OT YTD", "Overtime Income YTD", "OT", ("Overtime YTD", "YTD overtime"), "money"),
    FieldSpec("ps-tips-ytd", "Paystub", "wages", "Tips YTD", "Tips YTD", "Tips", ("Tips YTD", "YTD tips"), "money"),
    FieldSpec("ps-commission-ytd", "Paystub", "wages", "Commission YTD", "Commission YTD", "Commission", ("Commission YTD", "YTD commission"), "money"),
    FieldSpec("ps-rsu-ytd", "Paystub", "wages", "RSU YTD", "RSU / Stock Award YTD", "RSU", ("RSU", "Restricted stock", "Stock award"), "money"),
)

WVOE_FIELDS = (
    FieldSpec("wvoe-base", "WVOE", "wages", "Base", "WVOE Base Pay", "Base", ("Base pay", "Current base"), "money"),
    FieldSpec("wvoe-bonus", "WVOE", "wages", "Bonus", "WVOE Bonus History", "Bonus", ("Bonus", "Commission"), "money"),
    FieldSpec("wvoe-ot", "WVOE", "wages", "OT", "WVOE Overtime History", "OT", ("Overtime",), "money"),
)

SCHEDULE_F_FIELDS = (
    FieldSpec("schedule-f-name", "Schedule F", "identity", "Line C", "Farm Name", "Line C", ("Farm name",), "text"),
    FieldSpec("schedule-f-ein", "Schedule F", "identity", "EIN", "Employer Identification Number (EIN)", "EIN", ("Employer ID number", "EIN"), "ein"),
    FieldSpec("schedule-f-net", "Schedule F", "farm", "Line 34", "Net Farm Profit or Loss", "Line 34", ("Net farm profit or (loss)", "Net farm profit or loss"), "money"),
    FieldSpec("schedule-f-coop-ccc", "Schedule F", "farm", "Lines 3, 4, 6", "Cooperative / CCC Payments", "Lines 3, 4, 6", ("Cooperative distributions", "CCC loans", "Commodity Credit Corporation"), "money"),
    FieldSpec("schedule-f-other", "Schedule F", "farm", "Lines 5c & 8", "Other Farm Income", "Lines 5c & 8", ("Other income",), "money"),
    FieldSpec("schedule-f-depreciation", "Schedule F", "addback", "Line 14", "Depreciation", "Line 14", ("14 Depreciation",), "money"),
    FieldSpec("schedule-f-other-expense", "Schedule F", "addback", "Line 32", "Other Expenses", "Line 32", ("32 Other expenses",), "money"),
    FieldSpec("schedule-f-home", "Schedule F", "addback", "Line 32", "Business Use of Home", "Line 32", ("business use of your home", "Expenses for business use of your home"), "money"),
    FieldSpec("schedule-f-amort", "Schedule F", "addback", "Line 34", "Amortization / Casualty / Depletion", "Add-back", ("Amortization", "Casualty", "34 Depreciation and section 179"), "money"),
)

SCORP_FIELDS = (
    FieldSpec("scorp-name", "Form 1120-S", "identity", "Box B", "Corporation's Name", "Box B", ("Corporation's name",), "text"),
    FieldSpec("scorp-ein", "Form 1120-S", "identity", "Box A", "Corporation's EIN", "Box A", ("Employer identification number",), "ein"),
    FieldSpec("scorp-ord", "Form 1120-S", "income", "Box 1", "Ordinary Business Income", "Box 1", ("Ordinary business income",), "money"),
    FieldSpec("scorp-rre", "Form 1120-S", "income", "Box 2", "Net Rental Real Estate Income", "Box 2", ("Net rental real estate income",), "money"),
    FieldSpec("scorp-onr", "Form 1120-S", "income", "Box 3", "Other Net Rental Income", "Box 3", ("Other net rental income",), "money"),
    FieldSpec("scorp-179", "Form 1120-S", "addback", "Box 11", "Section 179 Deduction", "Box 11", ("Section 179 deduction", "Section 179"), "money"),
    FieldSpec("scorp-dist", "Form 1120-S", "income", "Box 16D", "Distributions (Box 16 Code D)", "Box 16D", ("Distributions",), "money"),
    FieldSpec("scorp-own-pct", "Form 1120-S", "income", "Item", "End-of-Year Stock Ownership %", "Ownership %", ("Percentage of stock ownership",), "percent"),
    FieldSpec("scorp-depletion", "Form 1120-S", "addback", "Box 15c", "Depletion", "Box 15c", ("Depletion",), "money"),
    FieldSpec("scorp-meals", "Form 1120-S", "addback", "M-1", "Non-Deductible Meals", "M-1", ("Travel and entertainment", "Meals and entertainment"), "money"),
)

PARTNERSHIP_FIELDS = (
    FieldSpec("pt-name", "Form 1065", "identity", "Box B", "Partnership's Name", "Box B", ("Partnership's name",), "text"),
    FieldSpec("pt-ein", "Form 1065", "identity", "Box A", "Partnership's EIN", "Box A", ("Employer identification number",), "ein"),
    FieldSpec("pt-ord", "Form 1065", "income", "Box 1", "Ordinary Business Income", "Box 1", ("Ordinary business income",), "money"),
    FieldSpec("pt-rre", "Form 1065", "income", "Box 2", "Net Rental Real Estate Income", "Box 2", ("Net rental real estate income",), "money"),
    FieldSpec("pt-onr", "Form 1065", "income", "Box 3", "Other Net Rental Income", "Box 3", ("Other net rental income",), "money"),
    FieldSpec("pt-gp", "Form 1065", "income", "Box 4", "Guaranteed Payments", "Box 4", ("Guaranteed payments",), "money"),
    FieldSpec("pt-179", "Form 1065", "addback", "Box 12", "Section 179 Deduction", "Box 12", ("Section 179 deduction", "Section 179"), "money"),
    FieldSpec("pt-dist", "Form 1065", "income", "Box 19A", "Distributions (Box 19 Code A)", "Box 19A", ("Distributions",), "money"),
    FieldSpec("pt-profit-pct", "Form 1065", "income", "Item J", "End-of-Year Profit %", "Item J · Profit", ("Profit",), "percent"),
    FieldSpec("pt-capital-pct", "Form 1065", "income", "Item J", "End-of-Year Capital %", "Item J · Capital", ("Capital",), "percent"),
    FieldSpec("pt-depletion", "Form 1065", "addback", "Box 17", "Depletion", "Box 17", ("Depletion",), "money"),
    FieldSpec("pt-meals", "Form 1065", "addback", "M-1", "Non-Deductible Meals", "M-1", ("Travel and entertainment", "Meals and entertainment"), "money"),
)

FORM_1120_FIELDS = (
    FieldSpec("c1120-name", "Form 1120", "identity", "Name", "Corporation Name", "Name", ("Name of corporation", "Legal name of corporation"), "text"),
    FieldSpec("c1120-ein", "Form 1120", "identity", "EIN", "Employer Identification Number (EIN)", "EIN", ("Employer identification number",), "ein"),
    FieldSpec("c1120-taxable", "Form 1120", "income", "Line 30", "Taxable Income", "Line 30", ("Taxable income",), "money"),
    FieldSpec("c1120-tax", "Form 1120", "income", "Line 31", "Total Tax", "Line 31", ("Total tax",), "money"),
    FieldSpec("c1120-dep", "Form 1120", "addback", "Line 20", "Depreciation", "Line 20", ("20 Depreciation",), "money"),
    FieldSpec("c1120-depletion", "Form 1120", "addback", "Line 21", "Depletion", "Line 21", ("21 Depletion",), "money"),
    FieldSpec("c1120-amort", "Form 1120", "addback", "Line 26", "Amortization", "Line 26", ("26 Other deductions", "Amortization"), "money"),
    FieldSpec("c1120-meals", "Form 1120", "addback", "M-1", "Non-Deductible Meals", "M-1", ("Travel and entertainment", "Meals and entertainment"), "money"),
    FieldSpec("c1120-nol", "Form 1120", "addback", "Line 29b", "NOL / Special Deductions", "Line 29b", ("29b Special deductions", "Net operating loss"), "money"),
)

FORM_1040_FIELDS = (
    FieldSpec("f1040-wages", "Form 1040", "wages", "Line 1z", "Wages, Salaries, Tips", "Line 1z", ("1z Add lines 1a through 1h", "Wages, salaries, tips, etc."), "money"),
    FieldSpec("f1040-ss-total", "Form 1040", "income", "Line 6a", "Social Security Benefits", "Line 6a", ("Social security benefits",), "money"),
    FieldSpec("f1040-ss-taxable", "Form 1040", "income", "Line 6b", "Taxable Social Security", "Line 6b", ("Taxable amount",), "money"),
    FieldSpec("f1040-pensions-total", "Form 1040", "income", "Line 5a", "Pensions and Annuities", "Line 5a", ("IRA distributions", "Pensions and annuities"), "money"),
    FieldSpec("f1040-pensions-taxable", "Form 1040", "income", "Line 5b", "Taxable Pensions", "Line 5b", ("Taxable amount",), "money"),
)

SCHEDULE_B_FIELDS = (
    FieldSpec("schedule-b-interest", "Schedule B", "asset", "Part I · Line 4", "Taxable Interest Income", "Line 4", ("Total interest", "Taxable interest"), "money"),
    FieldSpec("schedule-b-dividends", "Schedule B", "asset", "Part II · Line 6", "Ordinary Dividend Income", "Line 6", ("Total ordinary dividends",), "money"),
)

SCHEDULE_D_FIELDS = (
    FieldSpec("schedule-d-capital-gain-loss", "Schedule D", "asset", "Line 16", "Net Capital Gain or Loss", "Line 16", ("Combine lines 7 and 15", "Net long-term capital"), "money"),
)

FORM_4562_FIELDS = (
    FieldSpec("form-4562-179", "Form 1120-S", "addback", "Line 12", "Form 4562 Section 179", "Line 12", ("Section 179 expense deduction",), "money"),
    FieldSpec("form-4562-dep", "Form 1120-S", "addback", "Line 22", "Form 4562 Depreciation", "Line 22", ("Total depreciation",), "money"),
)

FORM_8825_FIELDS = (
    FieldSpec(
        "form-8825-name",
        "Form 8825",
        "identity",
        "Name",
        "Partnership or S Corporation Name",
        "Name",
        ("Name of partnership or S corporation", "Name of partnership", "Name of S corporation"),
        "text",
    ),
    FieldSpec(
        "form-8825-ein",
        "Form 8825",
        "identity",
        "EIN",
        "Employer Identification Number (EIN)",
        "EIN",
        ("Employer identification number",),
        "ein",
    ),
    FieldSpec(
        "form-8825-rents",
        "Form 8825",
        "rental",
        "Line 2",
        "Form 8825 Gross Rents (Line 2)",
        "Line 2",
        ("2 Gross rents", "Gross rents"),
        "money_last",
    ),
    FieldSpec(
        "form-8825-dep",
        "Form 8825",
        "addback",
        "Line 14",
        "Form 8825 Depreciation (Line 14)",
        "Line 14",
        ("14 Depreciation", "Depreciation (see instructions)"),
        "money_last",
    ),
    FieldSpec(
        "form-8825-total-exp",
        "Form 8825",
        "rental",
        "Line 16",
        "Form 8825 Total Expenses (Line 16)",
        "Line 16",
        ("16 Total expenses", "Total expenses"),
        "money_last",
    ),
    FieldSpec(
        "form-8825-net",
        "Form 8825",
        "rental",
        "Line 21",
        "Form 8825 Net Income or Loss (Line 21)",
        "Line 21",
        ("21 Net income", "Net income (loss)", "Income or (loss)"),
        "money_last",
    ),
)

SCHEDULE_L_FIELDS = (
    FieldSpec("sch-l-cash", "Form 1120-S", "asset", "Line 1", "Cash", "Line 1", ("Cash",), "money"),
    FieldSpec("sch-l-securities", "Form 1120-S", "asset", "Line 4", "Tax-Exempt Securities", "Line 4", ("Tax-exempt securities",), "money"),
    FieldSpec("sch-l-ar", "Form 1120-S", "asset", "Line 2a", "Accounts Receivable", "Line 2a", ("Trade notes and accounts receivable",), "money"),
    FieldSpec("sch-l-ap", "Form 1120-S", "asset", "Line 16", "Accounts Payable", "Line 16", ("Accounts payable",), "money"),
)

FORM_CATALOGS: tuple[tuple[re.Pattern[str], tuple[FieldSpec, ...]], ...] = (
    (re.compile(r"Wage and Tax Statement|Form\s+W-2", re.I), W2_FIELDS),
    (re.compile(r"Schedule C.*Profit or Loss From Business|Profit or Loss From Business", re.I), SCHEDULE_C_FIELDS),
    (re.compile(r"Profit or Loss From Farming", re.I), SCHEDULE_F_FIELDS),
    (re.compile(r"Schedule K-1\s*\(Form\s*1120-?S\)", re.I), SCORP_FIELDS),
    (re.compile(r"Schedule K-1\s*\(Form\s*1065\)", re.I), PARTNERSHIP_FIELDS),
    (re.compile(r"U\.S\. Corporation Income Tax Return", re.I), FORM_1120_FIELDS),
    (re.compile(r"U\.S\. Individual Income Tax Return", re.I), FORM_1040_FIELDS),
    (re.compile(r"Schedule B.*Interest and Ordinary Dividends", re.I), SCHEDULE_B_FIELDS),
    (re.compile(r"Schedule D.*Capital Gains and Losses", re.I), SCHEDULE_D_FIELDS),
    (re.compile(r"Form 8825.*Rental Real Estate Income|Form\s+8825", re.I), FORM_8825_FIELDS),
    (
        re.compile(
            r"earnings statement|pay\s*stub|paystub|payroll statement|pay\s+statement|pay\s+advice|"
            r"year[- ]to[- ]date\s+(?:gross|earnings)|current period|net pay",
            re.I,
        ),
        PAYSTUB_FIELDS,
    ),
    (re.compile(r"written verification of employment|verification of employment|the work number|\bWVOE\b", re.I), WVOE_FIELDS),
)

W2_FRONT_LABELS = (
    re.compile(r"Wages[,\s]+tips", re.I),
    re.compile(r"Medicare\s+wages", re.I),
    re.compile(r"Social\s+security\s+wages", re.I),
    re.compile(r"Federal\s+income\s+tax", re.I),
)

SUPPORTING_CATALOGS: tuple[tuple[re.Pattern[str], tuple[FieldSpec, ...]], ...] = (
    (re.compile(r"Form 4562", re.I), FORM_4562_FIELDS),
    (re.compile(r"Schedule L\s+Balance Sheets per Books", re.I), SCHEDULE_L_FIELDS),
)

_8825_COLUMN_LINES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("form-8825-rents", "Line 2", ("2 Gross rents", "Gross rents")),
    ("form-8825-dep", "Line 14", ("14 Depreciation", "Depreciation (see instructions)")),
    ("form-8825-total-exp", "Line 16", ("16 Total expenses", "Total expenses")),
    ("form-8825-net", "Line 21", ("21 Net income", "Net income (loss)")),
)


def _form_slug(form: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", form.lower()).strip("-")


def _format_money(amount: float) -> str:
    return f"${amount:,.2f}"


def _clip_right(page: Any, hit: Any, width: float = 220.0) -> list[float]:
    return [
        float(hit.x1) + 2.0,
        float(hit.y0) - 3.0,
        min(float(page.rect.width) - 12.0, float(hit.x1) + width),
        float(hit.y1) + 3.0,
    ]


def _clip_below(page: Any, hit: Any, height: float = 16.0) -> list[float]:
    return [
        float(hit.x0),
        float(hit.y1),
        min(float(page.rect.width) - 12.0, float(hit.x1) + 140.0),
        min(float(page.rect.height) - 8.0, float(hit.y1) + height),
    ]


def _clip_w2_column(page: Any, hit: Any) -> list[float]:
    """IRS W-2 amounts sit in the same cell, under the label, aligned with the box number.

    Clip-right hits the neighboring box number (Box 5 → the '2' of Box 2). Clip-below
    starts at the label text, so it shears '78,500.00' into '8,500.00' and can include
    the next box's amount. Keep the cell: a bit left of the label, not into the next box.
    """
    x0 = max(8.0, float(hit.x0) - 28.0)
    x1 = min(float(page.rect.width) - 12.0, float(hit.x1) + 8.0, x0 + 130.0)
    y0 = float(hit.y1) - 1.0
    y1 = min(float(page.rect.height) - 8.0, float(hit.y1) + 24.0)
    return [x0, y0, x1, y1]


def _is_form_box_number(token: str, amount: float) -> bool:
    """Bare 1–2 digit integers are W-2 box numbers, not Medicare wages."""
    stripped = token.strip()
    if not re.fullmatch(r"\d{1,2}", stripped):
        return False
    return amount == int(amount) and 0 <= amount <= 20


def _label_variants(label: str) -> tuple[str, ...]:
    variants = [label, label.replace("'", "’"), label.replace("’", "'"), re.sub(r"['’]", "·", label)]
    seen: list[str] = []
    for item in variants:
        if item and item not in seen:
            seen.append(item)
    return tuple(seen)


def _first_hit(page: Any, labels: tuple[str, ...]):
    for label in labels:
        for variant in _label_variants(label):
            hits = page.search_for(variant)
            if hits:
                return hits[0]
    return None


def _first_ocr_hit(words: list[dict[str, Any]] | None, labels: tuple[str, ...]):
    """Locate a field label in OCR when the PDF has no searchable form chrome."""
    for label in labels:
        for variant in _label_variants(label):
            needle = variant.casefold()
            for word in words or []:
                text = str(word.get("text", ""))
                if needle not in text.casefold():
                    continue
                return SimpleNamespace(
                    x0=float(word["x0"]),
                    y0=float(word["y0"]),
                    x1=float(word["x1"]),
                    y1=float(word["y1"]),
                )
    return None


def _nearest_widget_box(page: Any, hit: Any, pymupdf: Any) -> list[float] | None:
    """Snap a label to the live AcroForm cell in the same column, then right / below."""
    widgets = list(page.widgets() or [])
    if not widgets:
        return None
    column = pymupdf.Rect(
        max(8.0, float(hit.x0) - 28.0),
        float(hit.y1) - 2.0,
        min(float(page.rect.width) - 8.0, float(hit.x1) + 8.0, float(hit.x0) + 130.0),
        min(float(page.rect.height) - 8.0, float(hit.y1) + 28.0),
    )
    right = pymupdf.Rect(
        float(hit.x1),
        float(hit.y0) - 4.0,
        min(float(page.rect.width) - 8.0, float(hit.x1) + 260.0),
        float(hit.y1) + 4.0,
    )
    below = pymupdf.Rect(
        float(hit.x0),
        float(hit.y1),
        min(float(page.rect.width) - 8.0, float(hit.x1) + 180.0),
        min(float(page.rect.height) - 8.0, float(hit.y1) + 22.0),
    )
    best = None
    best_score = 0.0
    for widget in widgets:
        rect = widget.rect
        for target, weight in ((column, 4.0), (right, 2.0), (below, 1.0)):
            overlap = target & rect
            if overlap.is_empty:
                continue
            score = overlap.get_area() * weight
            if score > best_score:
                best_score = score
                best = rect
    if best is None:
        return None
    return [float(best.x0), float(best.y0), float(best.x1), float(best.y1)]


def _parse_capture(raw: str, capture: str) -> tuple[str, float] | None:
    text = re.sub(r"\s+", " ", raw or "").strip()
    if not text:
        return None
    if capture == "money" or capture == "money_last":
        matches = [
            match
            for match in MONEY_TOKEN.finditer(text)
            if not _is_form_box_number(match.group(0), parse_tax_amount(match.group(0)))
        ]
        if not matches:
            amount = parse_tax_amount(text)
            if abs(amount) <= 0.005 or _is_form_box_number(text, amount):
                return None
            return _format_money(amount), amount
        chosen = matches[-1] if capture == "money_last" else matches[0]
        amount = parse_tax_amount(chosen.group(0))
        if abs(amount) <= 0.005:
            return None
        return _format_money(amount), amount
    if capture == "ein":
        match = EIN_TOKEN.search(text)
        if not match:
            return None
        raw_ein = match.group(1)
        value = raw_ein if "-" in raw_ein else f"{raw_ein[:2]}-{raw_ein[2:]}"
        return value, 0.0
    if capture == "percent":
        matches = list(PERCENT_TOKEN.finditer(text))
        if not matches:
            return None
        numeric = float(matches[-1].group(1))
        if numeric > 100:
            return None
        return f"{numeric}% (ending)", numeric
    if capture == "integer":
        match = re.search(r"(\d{1,3}(?:,\d{3})+|\d+)\s*$", text)
        if not match:
            match = re.search(r"(\d{1,3}(?:,\d{3})+|\d+)", text)
        if not match:
            return None
        numeric = float(match.group(1).replace(",", ""))
        return f"{int(numeric):,}", numeric
    first = next((line.strip() for line in (raw or "").splitlines() if line.strip()), text)
    cleaned = re.sub(r"\s+", " ", first).strip()
    cleaned = re.sub(r"^(?:address|name|ein)[:\s]*", "", cleaned, flags=re.I).strip(" ,;:-")
    cleaned = re.sub(
        r"^(?:,?\s*)?(?:address(?:\s*,?\s*and\s+zip\s*code)?|and zip code)\s*$",
        "",
        cleaned,
        flags=re.I,
    ).strip(" ,;:-")
    if len(cleaned) < 2:
        return None
    if re.search(r"address.*zip|zip code", cleaned, re.I):
        return None
    letters = re.findall(r"[A-Za-z]+", cleaned)
    if letters and all(len(token) <= 2 for token in letters):
        return None
    return cleaned, 0.0


def _corporate_form(text: str, default: str) -> str:
    if re.search(r"Form\s+1065|Partnership", text, re.I):
        return "Form 1065"
    if re.search(r"Form\s+1120(?!\s*-?\s*S)|C-Corporation", text, re.I):
        return "Form 1120"
    if re.search(r"1120-?S|S Corporation", text, re.I):
        return "Form 1120-S"
    return default


def _field_record(
    *,
    page: Any,
    page_index: int,
    spec: FieldSpec,
    form: str,
    entity_id: str,
    value: str,
    numeric: float,
    used_box: list[float],
) -> dict[str, Any]:
    rel = relative_box(page, used_box) or {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
    return {
        "pageIndex": page_index,
        "form": form,
        "sourceFieldId": spec.source_id,
        "boxLabel": spec.box_label,
        "fieldLabel": spec.field_label,
        "lineNum": spec.line_num,
        "category": spec.category,
        "value": value,
        "numericValue": numeric,
        "box": rel,
        "entityId": entity_id,
    }


def _extract_spec(
    page: Any,
    pymupdf: Any,
    spec: FieldSpec,
    *,
    page_index: int,
    words: list[dict[str, Any]] | None,
    blob: str,
) -> dict[str, Any] | None:
    form = spec.form
    entity_id = f"{_form_slug(form)}-p{page_index}"
    if spec.source_id.startswith("sch-l-") or spec.source_id.startswith("form-4562-"):
        form = _corporate_form(blob, spec.form)
        entity_id = f"{_form_slug(form)}-p{page_index}"
    hit = _first_hit(page, spec.labels) or _first_ocr_hit(words, spec.labels)
    if hit is None:
        return None
    boxes: list[list[float]] = []
    widget_box = _nearest_widget_box(page, hit, pymupdf)
    if widget_box:
        boxes.append(widget_box)
    if spec.form == "W-2":
        boxes.append(_clip_w2_column(page, hit))
    if spec.capture == "money_last":
        boxes.append(
            [
                float(hit.x1) + 2.0,
                float(hit.y0) - 3.0,
                float(page.rect.width) - 12.0,
                float(hit.y1) + 3.0,
            ]
        )
    boxes.extend([_clip_right(page, hit), _clip_below(page, hit)])
    parsed = None
    used_box = boxes[0]
    for box in boxes:
        raw = _clip_text(
            page,
            pymupdf,
            box,
            words,
            money=spec.capture.startswith("money"),
        )
        parsed = _parse_capture(raw, spec.capture)
        if parsed:
            used_box = box
            break
    if not parsed:
        return None
    value, numeric = parsed
    return _field_record(
        page=page,
        page_index=page_index,
        spec=spec,
        form=form,
        entity_id=entity_id,
        value=value,
        numeric=numeric,
        used_box=used_box,
    )


def _parse_paystub_row_money(raw: str) -> tuple[str, float] | None:
    """Keep $0.00 and pay-rate precision beyond standard currency cents."""
    text = re.sub(r"\s+", " ", raw or "").strip()
    match = re.search(
        r"(?:\$\s*)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\))",
        text,
    )
    if not match:
        return None
    amount = parse_tax_amount(match.group(0))
    return _format_money(amount), amount


def _row_money_amounts(page: Any, pymupdf: Any, hit: Any) -> list[tuple[float, str, float, list[float]]]:
    clip = [
        float(hit.x1) + 2.0,
        float(hit.y0) - 5.0,
        float(page.rect.width) - 8.0,
        float(hit.y1) + 5.0,
    ]
    rect = pymupdf.Rect(clip)
    found: list[tuple[float, str, float, list[float]]] = []
    for word in page.get_text("words", clip=rect) or []:
        x0, y0, x1, y1, text = word[0], word[1], word[2], word[3], word[4]
        parsed = _parse_paystub_row_money(str(text))
        if not parsed:
            continue
        value, numeric = parsed
        found.append((float(x0), value, numeric, [float(x0), float(y0), float(x1), float(y1)]))
    found.sort(key=lambda item: item[0])
    return found


def _paystub_value_box(page: Any, pymupdf: Any, hit: Any, numeric: float) -> list[float]:
    """Return the printed numeric token, not the earnings-row label."""
    label_box = [float(hit.x0), float(hit.y0), float(hit.x1), float(hit.y1)]
    amounts = _row_money_amounts(page, pymupdf, hit)
    matching = [item for item in amounts if abs(item[2] - numeric) <= max(0.005, abs(numeric) * 0.000001)]
    if matching:
        return matching[-1][3]
    return label_box


def _extract_8825_columns(page: Any, pymupdf: Any, *, page_index: int) -> list[dict[str, Any]]:
    """Property columns A/B/C… plus totals, matching Schedule E's per-column capture."""
    columns = "ABCDEFGH"
    extracted: list[dict[str, Any]] = []
    entity_id = f"form-8825-p{page_index}"
    for source_id, line_num, labels in _8825_COLUMN_LINES:
        hit = _first_hit(page, labels)
        if hit is None:
            continue
        amounts = _row_money_amounts(page, pymupdf, hit)
        if len(amounts) < 2:
            continue
        *properties, total = amounts
        for index, (_x, value, numeric, box) in enumerate(properties):
            if index >= len(columns):
                break
            col = columns[index]
            rel = relative_box(page, box) or {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
            extracted.append(
                {
                    "pageIndex": page_index,
                    "form": "Form 8825",
                    "sourceFieldId": f"{source_id}-{col}",
                    "boxLabel": f"{line_num} · {col}",
                    "fieldLabel": f"Form 8825 {line_num} Column {col}",
                    "lineNum": f"{line_num} · {col}",
                    "category": "rental" if "dep" not in source_id else "addback",
                    "value": value,
                    "numericValue": numeric,
                    "box": rel,
                    "entityId": entity_id,
                    "column": col,
                }
            )
        _x, value, numeric, box = total
        rel = relative_box(page, box) or {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
        extracted.append(
            {
                "pageIndex": page_index,
                "form": "Form 8825",
                "sourceFieldId": source_id,
                "boxLabel": f"{line_num} · Totals",
                "fieldLabel": f"Form 8825 {line_num} Totals",
                "lineNum": line_num,
                "category": "addback" if "dep" in source_id else "rental",
                "value": value,
                "numericValue": numeric,
                "box": rel,
                "entityId": entity_id,
                "column": "Totals",
            }
        )
    return extracted


_PAYSTUB_EXCLUDE_ROW = re.compile(
    r"spot\s*bonus|\breloc(?:ation)?\b|^(gross|net\b|total|federal|social security|medicare|401|"
    r"deduct|tax|health|dental|pre[- ]tax|after[- ]tax|sick)\b",
    re.I,
)
_PAYSTUB_BASE_ROW = re.compile(
    r"\b(regular|reg(?:ular)?(?:\s+pay)?|base(?:\s+pay)?(?!\s+rate)|salary|hourly(?!\s+rate)|"
    r"straight\s*time|sunday|weekend(?:\s+premium)?|night(?:\s+diff(?:erential)?)?|"
    r"shift(?:\s+diff(?:erential)?)?|pto|holiday|leave|vacation|retro(?:\s+pay)?)\b",
    re.I,
)
_PAYSTUB_PRIMARY_RATE_ROW = re.compile(
    r"\b(regular|reg(?:ular)?(?:\s+pay)?|base(?:\s+pay)?(?!\s+rate)|salary|hourly(?!\s+rate)|straight\s*time)\b",
    re.I,
)
_PAYSTUB_BONUS_ROW = re.compile(r"\b(aip|annual\s+incentive|quarterly|annual\s+pay|incentive|bonus)\b", re.I)
_PAYSTUB_OT_ROW = re.compile(
    r"\bover\s*time\b|\bot(?:[- ]?1\.5(?:0+)?)?\b|\bdouble\s*time\b|\bdbl\s*time\b|"
    r"\b1\.5(?:0+)?\s*(?:x|hourly|hours?|ot)\b|"
    r"\btime\s+and\s+a\s+half\b|\bworked\s+holiday\b|\bholiday\s+worked\b",
    re.I,
)
_PAYSTUB_TIPS_ROW = re.compile(r"\btips?\b|\bgratuity\b", re.I)
_PAYSTUB_COMMISSION_ROW = re.compile(r"\bcommission", re.I)
_PAYSTUB_RSU_ROW = re.compile(r"\brsu\b|restricted\s+stock|stock\s+unit|stock\s+award", re.I)
_PAYSTUB_SPECS = {spec.source_id: spec for spec in PAYSTUB_FIELDS}


def _paystub_pays_per_year(blob: str) -> int | None:
    if re.search(r"semi[- ]?month", blob, re.I):
        return 24
    if re.search(r"bi[- ]?week", blob, re.I):
        return 26
    if re.search(r"\bweekly\b", blob, re.I):
        return 52
    if re.search(r"\bmonthly\b", blob, re.I):
        return 12
    return None


def _paystub_row_kind(label: str) -> str | None:
    stripped = re.sub(r"[\$0-9,.\-—/]+", " ", label)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    if not stripped or _PAYSTUB_EXCLUDE_ROW.search(stripped):
        return None
    # Match OT on the original label so "1.5 Hourly" is not stripped down to base "hourly".
    if _PAYSTUB_OT_ROW.search(label) or _PAYSTUB_OT_ROW.search(stripped):
        return "ot"
    if _PAYSTUB_RSU_ROW.search(stripped):
        return "rsu"
    if _PAYSTUB_TIPS_ROW.search(stripped):
        return "tips"
    if _PAYSTUB_COMMISSION_ROW.search(stripped):
        return "commission"
    if _PAYSTUB_BONUS_ROW.search(stripped):
        return "bonus"
    if _PAYSTUB_BASE_ROW.search(stripped):
        return "regular"
    return None


def _weekly_from_period_hours(period_hours: float, pays_per_year: int | None) -> float | None:
    if 20 <= period_hours <= 50:
        return period_hours
    if pays_per_year:
        return round((period_hours * pays_per_year) / 52.0, 2)
    return None


def _paystub_code_label(line: str) -> str:
    """Keep the earning code, including codes that start with a rate like '1.5 Hourly'."""
    label = re.sub(r"(?:\$\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}", " ", line)
    label = re.sub(r"\s+", " ", label).strip(" :-")
    return label or line[:24]


def _assign_paystub_amounts(
    amounts: list[tuple[float, str, float, list[float]]],
    line: str,
    kind: str,
) -> dict[str, tuple[str, float, list[float]]]:
    values = [(value, numeric, box) for _x, value, numeric, box in amounts]
    assigned: dict[str, tuple[str, float, list[float]]] = {}
    if len(values) >= 4:
        assigned["rate"] = values[0]
        assigned["hours"] = values[1]
        assigned["current"] = values[2]
        assigned["ytd"] = values[3]
    elif len(values) == 3 and values[0][1] < 200 and values[1][1] >= 200:
        assigned["rate"] = values[0]
        assigned["current"] = values[1]
        assigned["ytd"] = values[2]
    elif len(values) == 3 and values[0][1] < 200 and values[1][1] < 200:
        assigned["rate"] = values[0]
        assigned["hours"] = values[1]
        assigned["current"] = values[2]
    elif len(values) >= 2:
        assigned["current"] = values[0]
        assigned["ytd"] = values[-1]
    elif len(values) == 1:
        if kind in ("bonus", "ot", "tips", "commission", "rsu") or re.search(r"ytd|year[- ]to[- ]date", line, re.I):
            assigned["ytd"] = values[0]
        else:
            assigned["current"] = values[0]
    return assigned


def _paystub_visual_lines(page: Any) -> list[str]:
    """Cluster native words by Y so PDFKit/OCR cells on one row stay one earning line."""
    words = list(page.get_text("words") or [])
    if not words:
        return []
    rows: list[list[Any]] = []
    for word in sorted(words, key=lambda item: (float(item[1]), float(item[0]))):
        if rows and abs(float(word[1]) - float(rows[-1][0][1])) <= 4.0:
            rows[-1].append(word)
        else:
            rows.append([word])
    lines: list[str] = []
    for row in rows:
        row.sort(key=lambda item: float(item[0]))
        text = re.sub(r"\s+", " ", " ".join(str(item[4]) for item in row)).strip()
        if text:
            lines.append(text)
    return lines


def _paystub_source_lines(page: Any, blob: str) -> list[str]:
    source = [re.sub(r"\s+", " ", line).strip() for line in blob.splitlines() if line.strip()]
    # Pypdf preserves ordered earnings rows for some generated paystubs while
    # PyMuPDF's visual word order separates their columns. Prefer the ordered
    # text only when it contains a dated regular-pay row.
    if any(re.search(r"regular\s+(?:hourly|pay).*\d{1,2}/\d{1,2}/\d{4}", line, re.I) for line in source):
        return source
    visual = _paystub_visual_lines(page)
    if visual:
        return visual
    return source


def _dated_regular_pay_slots(line: str) -> dict[str, float]:
    """Read ordered Hours/Rate/Amount/YTD columns from a dated regular-pay row."""
    if not re.search(r"regular\s+(?:hourly|pay).*\d{1,2}/\d{1,2}/\d{4}", line, re.I):
        return {}
    without_dates = re.sub(r"\d{1,2}/\d{1,2}/\d{4}\s*-\s*\d{1,2}/\d{1,2}/\d{4}", " ", line)
    values = [
        parse_tax_amount(match.group(0))
        for match in re.finditer(r"-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?", without_dates)
    ]
    if len(values) < 3:
        return {}
    slots = {"hours": values[-3], "rate": values[-2], "current": values[-1]}
    if len(values) >= 5:
        slots = {"hours": values[-5], "rate": values[-4], "current": values[-3], "ytd_hours": values[-2], "ytd": values[-1]}
    if not (0 < slots["hours"] <= 200 and 0 < slots["rate"] < 1000 and slots["current"] > 0):
        return {}
    return slots


def _ordered_regular_pay_slots(line: str) -> dict[str, float]:
    """Read current/YTD columns from an ordered non-dated base-pay row."""
    label = re.match(r".*?(?=\s-?(?:\d|\$))", line)
    remainder = line[label.end() :] if label else line
    values = [
        parse_tax_amount(match.group(0))
        for match in re.finditer(r"-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?", remainder)
    ]
    if len(values) >= 3:
        return {"current": values[-3], "ytd_hours": values[-2], "ytd": values[-1]}
    if len(values) == 2:
        return {"current": values[0], "ytd": values[1]}
    return {}


def _ordered_paystub_label(line: str) -> str:
    match = re.match(r".*?(?=\s-?(?:\d|\$))", line)
    return (match.group(0) if match else line).strip(" :-")


def _paystub_header_employer(page: Any, blob: str) -> tuple[str, list[float]] | None:
    """Company name is often the first line of an earnings statement, not 'Employer:'."""
    if re.search(r"employer(?:['’]s)?(?:\s+name)?\s*[:#]", blob, re.I):
        return None
    for line in _paystub_source_lines(page, blob)[:6]:
        if re.search(
            r"earnings statement|pay\s*stub|pay statement|pay advice|payroll|employee|pay period|advice",
            line,
            re.I,
        ):
            continue
        if re.search(r"\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}", line):
            continue
        cleaned = re.sub(r"\s+", " ", line).strip(" ·-|")
        if 3 <= len(cleaned) <= 80:
            hit = _first_hit(page, (cleaned[:24], cleaned))
            box = [float(hit.x0), float(hit.y0), float(hit.x1), float(hit.y1)] if hit is not None else [0.0, 0.0, 12.0, 12.0]
            return cleaned, box
    return None


def _hit_for_paystub_label(page: Any, pymupdf: Any, label: str, used: set[tuple[float, float]]):
    for hit in page.search_for(label) or []:
        key = (round(float(hit.x0), 1), round(float(hit.y0), 1))
        if key in used:
            continue
        left = page.get_text(
            "text",
            clip=pymupdf.Rect(max(0.0, float(hit.x0) - 80.0), float(hit.y0) - 2.0, float(hit.x1), float(hit.y1) + 2.0),
        )
        probe = f"{left} {label}"
        if _PAYSTUB_EXCLUDE_ROW.search(probe):
            continue
        used.add(key)
        return hit
    return None


def _extract_paystub_table(page: Any, pymupdf: Any, *, page_index: int, blob: str) -> list[dict[str, Any]]:
    """Earnings-table rows: base (incl. shift/PTO), bonus, OT, tips, commission, RSU."""
    extracted: list[dict[str, Any]] = []
    seen: set[str] = set()
    totals: dict[str, tuple[str, float, list[float], list[list[float]]]] = {}
    pays_per_year = _paystub_pays_per_year(blob)
    entity_id = f"paystub-p{page_index}"

    def emit(source_id: str, value: str, numeric: float, box: list[float], *, accumulate: bool = False) -> None:
        spec = _PAYSTUB_SPECS.get(source_id)
        if spec is None:
            return
        if accumulate and source_id in totals:
            _prev_value, prev_numeric, prev_box, component_boxes = totals[source_id]
            totals[source_id] = (
                _format_money(prev_numeric + numeric),
                prev_numeric + numeric,
                prev_box,
                [*component_boxes, box],
            )
            return
        if source_id in totals or source_id in seen:
            return
        totals[source_id] = (value, numeric, box, [box])

    def flush() -> None:
        for source_id, (value, numeric, box, component_boxes) in totals.items():
            if source_id in seen:
                continue
            spec = _PAYSTUB_SPECS.get(source_id)
            if spec is None:
                continue
            seen.add(source_id)
            row = _field_record(
                    page=page,
                    page_index=page_index,
                    spec=spec,
                    form="Paystub",
                    entity_id=entity_id,
                    value=value,
                    numeric=numeric,
                    used_box=box,
                )
            if len(component_boxes) > 1:
                row["componentBoxes"] = [
                    rel
                    for component in component_boxes
                    if (rel := relative_box(page, component)) is not None
                ]
            extracted.append(row)

    used_hits: set[tuple[float, float]] = set()
    hours_match = re.search(r"(\d+(?:\.\d+)?)\s*hr/?\s*wk", blob, re.I)
    if hours_match:
        hours = float(hours_match.group(1))
        hit = _first_hit(page, ("hr/wk", "Hr/Wk", hours_match.group(0)))
        box = [float(hit.x0), float(hit.y0), float(hit.x1), float(hit.y1)] if hit is not None else [0.0, 0.0, 12.0, 12.0]
        emit("ps-hours-week", f"{int(hours) if hours.is_integer() else hours}", hours, box)

    header = _paystub_header_employer(page, blob)
    if header:
        emit("ps-employer-name", header[0], 0.0, header[1])

    source_lines = _paystub_source_lines(page, blob)
    ordered_native_rows = any(_dated_regular_pay_slots(line) for line in source_lines)
    for raw_line in source_lines:
        line = re.sub(r"\s+", " ", raw_line).strip()
        kind = _paystub_row_kind(line)
        if kind is None:
            continue
        if kind == "regular" and ordered_native_rows:
            ordered_slots = _dated_regular_pay_slots(line) or _ordered_regular_pay_slots(line)
            if ordered_slots:
                ordered_label = _ordered_paystub_label(line)
                ordered_hit = _hit_for_paystub_label(page, pymupdf, ordered_label, used_hits) if ordered_label else None
                label_box = (
                    [float(ordered_hit.x0), float(ordered_hit.y0), float(ordered_hit.x1), float(ordered_hit.y1)]
                    if ordered_hit is not None
                    else [0.0, 0.0, 12.0, 12.0]
                )
                if "rate" in ordered_slots and _PAYSTUB_PRIMARY_RATE_ROW.search(line):
                    emit("ps-hourly-rate", _format_money(ordered_slots["rate"]), ordered_slots["rate"], _paystub_value_box(page, pymupdf, ordered_hit, ordered_slots["rate"]) if ordered_hit is not None else label_box)
                if ordered_slots.get("current", 0) > 0:
                    emit("ps-current-base", _format_money(ordered_slots["current"]), ordered_slots["current"], _paystub_value_box(page, pymupdf, ordered_hit, ordered_slots["current"]) if ordered_hit is not None else label_box, accumulate=True)
                if ordered_slots.get("ytd", 0) > 0:
                    emit("ps-base-ytd", _format_money(ordered_slots["ytd"]), ordered_slots["ytd"], _paystub_value_box(page, pymupdf, ordered_hit, ordered_slots["ytd"]) if ordered_hit is not None else label_box, accumulate=True)
                if "hours" in ordered_slots and "ps-hours-week" not in totals:
                    weekly = _weekly_from_period_hours(ordered_slots["hours"], pays_per_year)
                    if weekly:
                        emit("ps-hours-week", f"{weekly:.2f}".rstrip("0").rstrip("."), weekly, _paystub_value_box(page, pymupdf, ordered_hit, ordered_slots["hours"]) if ordered_hit is not None else label_box)
                continue
        if ordered_native_rows and kind in {"bonus", "ot", "tips", "commission", "rsu"}:
            ordered_slots = _ordered_regular_pay_slots(line)
            source_id = {
                "bonus": "ps-bonus-ytd",
                "ot": "ps-ot-ytd",
                "tips": "ps-tips-ytd",
                "commission": "ps-commission-ytd",
                "rsu": "ps-rsu-ytd",
            }[kind]
            if ordered_slots.get("ytd", 0) > 0:
                ordered_label = _ordered_paystub_label(line)
                ordered_hit = _hit_for_paystub_label(page, pymupdf, ordered_label, used_hits) if ordered_label else None
                label_box = (
                    [float(ordered_hit.x0), float(ordered_hit.y0), float(ordered_hit.x1), float(ordered_hit.y1)]
                    if ordered_hit is not None
                    else [0.0, 0.0, 12.0, 12.0]
                )
                emit(source_id, _format_money(ordered_slots["ytd"]), ordered_slots["ytd"], _paystub_value_box(page, pymupdf, ordered_hit, ordered_slots["ytd"]) if ordered_hit is not None else label_box, accumulate=True)
            continue
        label = _paystub_code_label(line)
        hit = _hit_for_paystub_label(page, pymupdf, label, used_hits) or _first_hit(page, (label, line[:18]))
        if hit is None:
            continue
        if kind == "regular":
            ordered_slots = _dated_regular_pay_slots(line)
            if ordered_slots:
                label_box = [float(hit.x0), float(hit.y0), float(hit.x1), float(hit.y1)]
                if _PAYSTUB_PRIMARY_RATE_ROW.search(line):
                    emit("ps-hourly-rate", _format_money(ordered_slots["rate"]), ordered_slots["rate"], _paystub_value_box(page, pymupdf, hit, ordered_slots["rate"]))
                emit("ps-current-base", _format_money(ordered_slots["current"]), ordered_slots["current"], _paystub_value_box(page, pymupdf, hit, ordered_slots["current"]), accumulate=True)
                if "ytd" in ordered_slots:
                    emit("ps-base-ytd", _format_money(ordered_slots["ytd"]), ordered_slots["ytd"], _paystub_value_box(page, pymupdf, hit, ordered_slots["ytd"]), accumulate=True)
                if "ps-hours-week" not in totals:
                    weekly = _weekly_from_period_hours(ordered_slots["hours"], pays_per_year)
                    if weekly:
                        emit("ps-hours-week", f"{weekly:.2f}".rstrip("0").rstrip("."), weekly, _paystub_value_box(page, pymupdf, hit, ordered_slots["hours"]))
                continue
        amounts = _row_money_amounts(page, pymupdf, hit)
        if not amounts:
            continue
        slots = _assign_paystub_amounts(amounts, line, kind)
        if kind == "regular":
            if "rate" in slots and _PAYSTUB_PRIMARY_RATE_ROW.search(line):
                emit("ps-hourly-rate", *slots["rate"])
            if "current" in slots:
                emit("ps-current-base", *slots["current"], accumulate=True)
            if "ytd" in slots:
                emit("ps-base-ytd", *slots["ytd"], accumulate=True)
            if "hours" in slots and "ps-hours-week" not in totals and _PAYSTUB_PRIMARY_RATE_ROW.search(line):
                weekly = _weekly_from_period_hours(slots["hours"][1], pays_per_year)
                if weekly:
                    emit("ps-hours-week", f"{weekly:.2f}".rstrip("0").rstrip("."), weekly, slots["hours"][2])
        elif kind == "bonus" and "ytd" in slots:
            emit("ps-bonus-ytd", *slots["ytd"], accumulate=True)
        elif kind == "ot" and "ytd" in slots:
            emit("ps-ot-ytd", *slots["ytd"], accumulate=True)
        elif kind == "tips" and "ytd" in slots:
            emit("ps-tips-ytd", *slots["ytd"], accumulate=True)
        elif kind == "commission" and "ytd" in slots:
            emit("ps-commission-ytd", *slots["ytd"], accumulate=True)
        elif kind == "rsu" and "ytd" in slots:
            emit("ps-rsu-ytd", *slots["ytd"], accumulate=True)

    if "ps-base-ytd" not in totals and not re.search(r"\bgross\b", blob, re.I):
        hit = _first_hit(page, ("Year to date", "Year-to-date"))
        if hit is not None:
            amounts = _row_money_amounts(page, pymupdf, hit)
            if amounts:
                emit("ps-base-ytd", amounts[-1][1], amounts[-1][2], amounts[-1][3])
    flush()
    return extracted


def _plausible_w2_fields(rows: list[dict[str, Any]]) -> bool:
    """Reject a blank W-2 copy whose nearby EIN/box-number text impersonates wages.

    A captured Medicare-wage value without either Social Security wages or its
    withholding peer is not enough evidence to establish a wage record.  This
    is deliberately a page-level extraction guard; it does not alter any
    underwriting calculation.
    """
    ids = {str(row.get("sourceFieldId", "")) for row in rows}
    monetary = ids & {"w2-box2", "w2-box3", "w2-box4", "w2-box5", "w2-box6"}
    if not monetary or ids & {"w2-box3", "w2-box4"}:
        return True
    by_id = {str(row.get("sourceFieldId", "")): row for row in rows}
    box5 = float(by_id.get("w2-box5", {}).get("numericValue", 0) or 0)
    box6 = float(by_id.get("w2-box6", {}).get("numericValue", 0) or 0)
    ein_like_box5 = box5.is_integer() and 100_000_000 <= box5 <= 999_999_999
    box_number_like_withholding = box6.is_integer() and 1 <= box6 <= 20
    return not (ein_like_box5 or box_number_like_withholding)


def extract_page_fields(
    page: Any,
    *,
    page_index: int,
    words: list[dict[str, Any]] | None = None,
    text: str | None = None,
) -> list[dict[str, Any]]:
    pymupdf = _require_pymupdf()
    native = page.get_text("text") or ""
    supplied = text or ""
    word_blob = " ".join(word.get("text", "") for word in (words or []) if word.get("text"))
    blob = " ".join(part for part in (supplied, native, word_blob) if part)
    row_blob = supplied or native or blob
    if is_schedule_e_page1(page, words):
        return []

    extracted: list[dict[str, Any]] = []
    seen: set[str] = set()
    catalogs = list(FORM_CATALOGS)
    for matcher, specs in catalogs:
        w2_from_labels = specs is W2_FIELDS and sum(bool(label.search(blob)) for label in W2_FRONT_LABELS) >= 2
        if not matcher.search(blob) and not w2_from_labels:
            continue
        if specs is PAYSTUB_FIELDS:
            for row in _extract_paystub_table(page, pymupdf, page_index=page_index, blob=row_blob or blob):
                if row["sourceFieldId"] in seen:
                    continue
                seen.add(row["sourceFieldId"])
                extracted.append(row)
        for spec in specs:
            row = _extract_spec(page, pymupdf, spec, page_index=page_index, words=words, blob=blob)
            if row is None or row["sourceFieldId"] in seen:
                continue
            seen.add(row["sourceFieldId"])
            extracted.append(row)
        if specs is FORM_8825_FIELDS:
            for row in _extract_8825_columns(page, pymupdf, page_index=page_index):
                if row["sourceFieldId"] in seen:
                    continue
                seen.add(row["sourceFieldId"])
                extracted.append(row)
        if specs is W2_FIELDS and not _plausible_w2_fields(extracted):
            extracted = [row for row in extracted if row["form"] != "W-2"]
        break

    for matcher, specs in SUPPORTING_CATALOGS:
        if not matcher.search(blob):
            continue
        for spec in specs:
            row = _extract_spec(page, pymupdf, spec, page_index=page_index, words=words, blob=blob)
            if row is None or row["sourceFieldId"] in seen:
                continue
            seen.add(row["sourceFieldId"])
            extracted.append(row)
    return extracted


def extract_irs_form_fields(
    pdf_input: bytes,
    *,
    ocr_pages: Iterable[Any] | None = None,
    page_indices: Iterable[int] | None = None,
) -> list[dict[str, Any]]:
    pymupdf = _require_pymupdf()
    allowed_pages = set(page_indices) if page_indices is not None else None
    supplied: dict[int, Any] = {}
    for page_result in ocr_pages or []:
        index = getattr(page_result, "index", None)
        if index is None:
            continue
        supplied[int(index)] = page_result
    doc = _open_pdf(pymupdf, pdf_input)
    try:
        fields: list[dict[str, Any]] = []
        for index, page in enumerate(doc):
            if allowed_pages is not None and index not in allowed_pages:
                continue
            convert_page = supplied.get(index)
            page_words = (
                convert_relative_words(convert_page.words, page.rect.width, page.rect.height)
                if convert_page is not None
                else None
            )
            text = ""
            if convert_page is not None:
                text = convert_page.text()
            fields.extend(extract_page_fields(page, page_index=index, words=page_words, text=text))
        logger.info("irs_form_extract fields=%s", len(fields))
        return fields
    finally:
        doc.close()
