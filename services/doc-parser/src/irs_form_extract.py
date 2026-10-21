"""Label-anchored IRS field extraction with overlay boxes (Schedule E depth).

Schedule E Page 1 stays in schedule_e_grid.py. This module covers W-2, C, F,
K-1s, 1120, 1040 benefit lines, B/D, 4562, Form 8825, and Schedule L using the
same clip order: content text → widget /V → converter/OCR words.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any, Iterable

from business_return_grid import extract_business_return_page, form_key_for_page
from form_signatures import (
    PAYSTUB_TITLE,
    PRINT_CHROME_LINE,
    W2_FRONT_LABELS,
    W2_TITLE,
    WVOE_NOTICE_PAGE,
    WVOE_TITLE,
)
from ocr_match import pattern_matches
from paystub_row_rules import (
    EXCLUDE_ROW as _PAYSTUB_EXCLUDE_ROW,
    YTD_FIELD_BY_KIND,
    frequency_type as _paystub_frequency_type,
    hours_before_rate as _paystub_hours_before_rate,
    is_primary_rate_row as _is_primary_rate_row,
    pays_per_year as _paystub_pays_per_year,
    row_kind as _paystub_row_kind,
    weekly_from_period_hours as _weekly_from_period_hours,
)
from schedule_e_grid import (
    _clip_text,
    _open_pdf,
    _require_pymupdf,
    convert_relative_words,
    is_schedule_e_page1,
    parse_tax_amount,
    relative_box,
    words_in_box,
)

logger = logging.getLogger("freeflow.irs_extract")

EIN_TOKEN = re.compile(r"\b(\d{2}-\d{7}|\d{9})\b")
_MONTH_NAME = r"jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"
# Vendors spell dates out: Truework prints "March 4, 2023" and, for a hire
# date, "May, 25 2018" with the comma after the month.
DATE_TOKEN = re.compile(
    r"\b(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}"
    rf"|(?:{_MONTH_NAME})[a-z]*\.?,?\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}})\b",
    re.IGNORECASE,
)
_MONTH_INDEX = {name: index + 1 for index, name in enumerate(_MONTH_NAME.split("|"))}
_DURATION_YEARS = re.compile(r"(\d{1,2})\s*(?:yrs?|years?)\b", re.IGNORECASE)
_DURATION_MONTHS = re.compile(r"(\d{1,3})\s*(?:mos?|months?)\b", re.IGNORECASE)
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
    # Labels that repeat on every row ("Taxable amount" on 1040 lines 4b/5b/6b)
    # are only read on the row that starts with one of these labels.
    row_anchor: tuple[str, ...] = ()


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
    FieldSpec(
        "w2-employer-ein",
        "W-2",
        "identity",
        "Box b",
        "Employer Identification Number (EIN)",
        "Box b",
        ("Employer identification number", "Employer's identification", "Employer ID number"),
        "ein",
    ),
    FieldSpec("w2-box2", "W-2", "withholding", "Box 2", "Federal Income Tax Withheld", "Box 2", ("Federal income tax withheld",), "money"),
    FieldSpec("w2-box3", "W-2", "wages", "Box 3", "Social Security Wages", "Box 3", ("Social security wages",), "money"),
    FieldSpec("w2-box4", "W-2", "withholding", "Box 4", "Social Security Tax Withheld (6.2%)", "Box 4", ("Social security tax withheld",), "money"),
    FieldSpec(
        "w2-box5",
        "W-2",
        "wages",
        "Box 5",
        "Medicare Wages and Tips",
        "Box 5",
        ("Medicare wages and tips", "Medicare wages"),
        "money",
    ),
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
    FieldSpec("ps-pay-frequency", "Paystub", "identity", "Frequency", "Pay Frequency", "Frequency", ("Pay frequency",), "text"),
    FieldSpec("ps-hourly-rate", "Paystub", "wages", "Rate", "Hourly Rate of Pay", "Rate", ("Hourly rate", "Rate of pay", "Base rate"), "money"),
    FieldSpec("ps-hours-week", "Paystub", "wages", "Hours", "Standard Weekly Hours", "Hours", ("Hr/Wk", "Hours / Wk", "Weekly hours"), "integer"),
    FieldSpec("ps-current-base", "Paystub", "wages", "Current", "Current Period Base Pay", "Current", ("Current period base", "This period regular"), "money"),
    FieldSpec("ps-base-ytd", "Paystub", "wages", "YTD", "Base Wages YTD", "YTD", ("YTD regular", "YTD base", "Regular YTD", "Base wages YTD"), "money"),
    FieldSpec("ps-bonus-ytd", "Paystub", "wages", "Bonus YTD", "Bonus Income YTD", "Bonus", ("Bonus YTD", "YTD bonus"), "money"),
    FieldSpec("ps-ot-ytd", "Paystub", "wages", "OT YTD", "Overtime Income YTD", "OT", ("Overtime YTD", "YTD overtime"), "money"),
    FieldSpec("ps-tips-ytd", "Paystub", "wages", "Tips YTD", "Tips YTD", "Tips", ("Tips YTD", "YTD tips"), "money"),
    FieldSpec("ps-commission-ytd", "Paystub", "wages", "Commission YTD", "Commission YTD", "Commission", ("Commission YTD", "YTD commission"), "money"),
    FieldSpec("ps-rsu-ytd", "Paystub", "wages", "RSU YTD", "RSU / Stock Award YTD", "RSU", ("RSU", "Restricted stock", "Stock award"), "money"),
    # How much of the year the YTD column covers, and whether any pay period
    # of that year closes after this one, both follow from the period end.
    FieldSpec("ps-period-end", "Paystub", "identity", "Period End", "Pay Period End", "Period End", ("Pay Period End", "Period End", "Period Ending", "Pay Period Ending"), "date"),
    FieldSpec("ps-period-start", "Paystub", "identity", "Period Start", "Pay Period Start", "Period Start", ("Pay Period Begin", "Period Start", "Period Beginning", "Pay Period Beginning"), "date"),
    FieldSpec("ps-pay-date", "Paystub", "identity", "Pay Date", "Pay Date", "Pay Date", ("Check Date", "Pay Date", "Payment Date"), "date"),
)

_WVOE_CURRENT_BASE_LABELS = (
    "Current Gross Base Pay",
    "Current Gross Pay",
    "Employee Rate of Pay",
    "Current base pay",
    "Current Rate of Pay",
    "Rate of Pay",
    "Base Pay Rate",
    "Annual Salary",
)
"""Where the rate of pay is stated, as distinct from the earnings history."""

# A verification states several money columns per earnings figure, so a spec
# that takes one amount from a row cannot say which year it read. The grid
# readers below own every earnings amount; the specs here cover the identity
# and rate-of-pay fields, which are stated one to a row. The ids wvoe-base,
# wvoe-bonus and wvoe-ot keep the meanings the console field map and
# liveHydrate already assume.
#
# Labels cover Form 1005 and the two vendor reports that arrive in its place,
# The Work Number and Truework, which carry the same figures under their own
# wording. The most specific label of a group comes first, because _first_hit
# returns the first one that lands on the page.
WVOE_FIELDS = (
    FieldSpec("wvoe-employer-name", "WVOE", "identity", "Employer", "Employer Name", "Employer", ("Name and address of employer", "Employer Name", "Company Name", "Employer"), "text"),
    FieldSpec("wvoe-base", "WVOE", "wages", "Rate", "Current Gross Base Pay", "Rate", _WVOE_CURRENT_BASE_LABELS, "money"),
    # The unit the rate is quoted in, which is not the paycheck cycle. The
    # readers prefer the word printed alongside the amount itself ("$45.00
    # Hourly"); this label only covers the vendors that give it its own row.
    FieldSpec("wvoe-base-period", "WVOE", "identity", "Rate Basis", "Base Pay Period", "Rate Basis", ("Employee Pay Frequency", "Rate of Pay Frequency", "Salary Frequency"), "text"),
    FieldSpec("wvoe-pay-cycle", "WVOE", "identity", "Pay Cycle", "Paycheck Cycle", "Pay Cycle", ("Pay Cycle", "Paycheck Frequency", "Pay Period Frequency", "Payroll Frequency"), "text"),
    FieldSpec("wvoe-hours-week", "WVOE", "wages", "Hrs/Wk", "Average Hours per Week", "Hrs/Wk", ("average hours per week", "hours per week", "Weekly Hours", "Hours Worked"), "integer"),
    # The Work Number counts hours over the pay period rather than the week.
    FieldSpec("wvoe-hours-period", "WVOE", "wages", "Hrs/Period", "Average Hours per Pay Period", "Hrs/Period", ("Avg. Hrs. Worked / Pay Period", "Hrs. Worked / Pay Period", "Hours Worked Per Pay Period", "Hours Per Pay Period"), "integer"),
    FieldSpec("wvoe-ytd-thru", "WVOE", "identity", "Thru", "Year to Date Through", "Thru", ("Year To Date Thru", "Current As Of", "Data as of", "As of Date", "Verification Date", "Report Date", "Most Recent Pay Date", "Thru", "Through"), "date"),
    FieldSpec("wvoe-hire-date", "WVOE", "identity", "Hire Date", "Date of Employment", "Hire Date", ("Applicant's Date of Employment", "Dates of Employment", "Date of Employment", "Original Hire Date", "Most Recent Start Date", "Employment Start Date", "Date of hire", "Date Hired", "Hire Date", "Start Date"), "date"),
    # Both vendors print the tenure outright, which is a surer read than
    # differencing the hire date against the date the report was struck.
    FieldSpec("wvoe-months", "WVOE", "wages", "Tenure", "Months Employed", "Tenure", ("Total Time With Employer", "Total Length of Employment", "Length of Employment", "Time With Employer"), "duration"),
    # Carries no labels: the grid readers resolve it from the column headings,
    # and the calendar year of the current column is not stated anywhere else.
    FieldSpec("wvoe-ytd-year", "WVOE", "identity", "Year", "Year to Date Year", "Year", (), "integer"),
)

_WVOE_EARNING_SPECS: dict[str, FieldSpec] = {
    "wvoe-base-ytd": FieldSpec("wvoe-base-ytd", "WVOE", "wages", "Base", "Base Pay Year to Date", "Base", (), "money"),
    "wvoe-ot": FieldSpec("wvoe-ot", "WVOE", "wages", "OT", "Overtime Year to Date", "OT", (), "money"),
    "wvoe-bonus": FieldSpec("wvoe-bonus", "WVOE", "wages", "Bonus", "Bonus Year to Date", "Bonus", (), "money"),
    "wvoe-commission": FieldSpec("wvoe-commission", "WVOE", "wages", "Commission", "Commission Year to Date", "Commission", (), "money"),
}
"""Earnings categories, keyed by the field id that holds their current column.

The history columns are emitted as `<id>-prior` and `<id>-prior-2`, so the
two-year average in `annualizeWvoe` reads a column the document actually
printed rather than one inferred from the current year.
"""

_WVOE_GRID_ROWS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("wvoe-base-ytd", ("Total Base Pay", "Base Salary", "Base Pay", "Base earnings", "Regular Pay", "Base")),
    ("wvoe-ot", ("Total Overtime", "Overtime")),
    ("wvoe-bonus", ("Total Bonus", "Bonus")),
    ("wvoe-commission", ("Total Commission", "Commissions", "Commission", "Commision")),
)
"""Row labels of a grid that runs earnings down the page and years across it.

Form 1005 item 12B and Truework's income table are laid out this way. The
trailing bare labels catch Truework, which heads the rows "Base" and
"Commision" -- the misspelling is Truework's own.
"""

_WVOE_CATEGORY_RUNS: dict[str, str | None] = {
    "basesalary": "wvoe-base-ytd",
    "basepay": "wvoe-base-ytd",
    "baseearnings": "wvoe-base-ytd",
    "regularpay": "wvoe-base-ytd",
    "base": "wvoe-base-ytd",
    "salary": "wvoe-base-ytd",
    "overtime": "wvoe-ot",
    "overtimepay": "wvoe-ot",
    "bonus": "wvoe-bonus",
    "bonuses": "wvoe-bonus",
    "commission": "wvoe-commission",
    "commissions": "wvoe-commission",
    "commision": "wvoe-commission",
    "commisions": "wvoe-commission",
    # Anchors for columns that are deliberately not read. Without them the
    # amount under "Other" binds to whichever category column sits nearest,
    # and The Work Number prints both an Other and a Total column.
    "other": None,
    "otherpay": None,
    "total": None,
    "totalpay": None,
    "grosspay": None,
    "grossearnings": None,
    "netpay": None,
    "tips": None,
}
"""Column headings of a grid that runs years down the page and earnings across it.

The Work Number's Annual Income Summary is laid out this way, transposed from
Form 1005: a row per year, a column per category.
"""

_WVOE_BASE_PERIODS: tuple[tuple[str, str], ...] = (
    ("semi-monthly", "SemiMonthly"),
    ("semimonthly", "SemiMonthly"),
    ("semi monthly", "SemiMonthly"),
    ("bi-weekly", "Biweekly"),
    ("biweekly", "Biweekly"),
    ("bi weekly", "Biweekly"),
    ("annual", "Annual"),
    ("yearly", "Annual"),
    ("per year", "Annual"),
    ("monthly", "Monthly"),
    ("per month", "Monthly"),
    ("weekly", "Weekly"),
    ("per week", "Weekly"),
    ("hourly", "Hourly"),
    ("per hour", "Hourly"),
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
    FieldSpec("f1040-ira-total", "Form 1040", "income", "Line 4a", "IRA Distributions", "Line 4a", ("IRA distributions",), "money"),
    FieldSpec("f1040-ira-taxable", "Form 1040", "income", "Line 4b", "Taxable IRA Distributions", "Line 4b", ("Taxable amount",), "money", ("IRA distributions",)),
    FieldSpec("f1040-pensions-total", "Form 1040", "income", "Line 5a", "Pensions and Annuities", "Line 5a", ("Pensions and annuities",), "money"),
    FieldSpec("f1040-pensions-taxable", "Form 1040", "income", "Line 5b", "Taxable Pensions", "Line 5b", ("Taxable amount",), "money", ("Pensions and annuities",)),
    FieldSpec("f1040-ss-total", "Form 1040", "income", "Line 6a", "Social Security Benefits", "Line 6a", ("Social security benefits",), "money"),
    FieldSpec("f1040-ss-taxable", "Form 1040", "income", "Line 6b", "Taxable Social Security", "Line 6b", ("Taxable amount",), "money", ("Social security benefits",)),
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
    # money_last keeps column (d), the end-of-year balance. "money" kept column (b).
    FieldSpec("sch-l-cash", "Form 1120-S", "asset", "Line 1", "Cash (End of Year)", "Line 1d", ("Cash",), "money_last"),
    FieldSpec("sch-l-ar", "Form 1120-S", "asset", "Line 2a", "Accounts Receivable (End of Year)", "Line 2a", ("Trade notes and accounts receivable",), "money_last"),
    FieldSpec("sch-l-securities", "Form 1120-S", "asset", "Line 4", "Tax-Exempt Securities (End of Year)", "Line 4", ("Tax-exempt securities",), "money_last"),
    FieldSpec("sch-l-ap", "Form 1120-S", "asset", "Line 16", "Accounts Payable (End of Year)", "Line 16", ("Accounts payable",), "money_last"),
    FieldSpec("sch-l-notes", "Form 1120-S", "asset", "Line 17", "Mortgages and notes payable in less than 1 year (End of Year)", "Line 17", ("payable in less than 1 year", "less than 1 year"), "money_last"),
    FieldSpec("sch-l-other-current", "Form 1120-S", "asset", "Line 18", "Other Current Liabilities (End of Year)", "Line 18", ("Other current liabilities",), "money_last"),
    FieldSpec("sch-l-current-liabilities", "Form 1120-S", "asset", "Line 18", "Total Current Liabilities (End of Year)", "Line 18d", ("Total current liabilities",), "money_last"),
)

# The K-1 catalogs above cover the borrower's share of an entity. The return
# face carries the entity-level figures a self-employed worksheet adds back:
# depreciation, depletion, amortization, officer compensation. Without these
# the page classified, entered the keep set, and produced nothing.
SCORP_RETURN_FIELDS = (
    FieldSpec("scorp-return-name", "Form 1120-S", "identity", "Name", "Corporation Name", "Name", ("Name of corporation", "Name"), "text"),
    FieldSpec("scorp-return-ein", "Form 1120-S", "identity", "Box B", "Employer Identification Number", "Box B", ("Employer identification number",), "ein"),
    FieldSpec("scorp-return-ord", "Form 1120-S", "income", "Line 22", "Ordinary Business Income (Loss)", "Line 22", ("Ordinary business income (loss)", "Ordinary business income"), "money"),
    FieldSpec("scorp-return-officer-comp", "Form 1120-S", "income", "Line 7", "Compensation of Officers", "Line 7", ("Compensation of officers",), "money"),
    FieldSpec("scorp-return-wages", "Form 1120-S", "income", "Line 8", "Salaries and Wages", "Line 8", ("Salaries and wages",), "money"),
    FieldSpec("scorp-return-dep", "Form 1120-S", "addback", "Line 14", "Depreciation", "Line 14", ("Depreciation not claimed", "Depreciation"), "money"),
    FieldSpec("scorp-return-depletion", "Form 1120-S", "addback", "Line 15", "Depletion", "Line 15", ("Depletion",), "money"),
    FieldSpec("scorp-return-gross", "Form 1120-S", "income", "Line 1c", "Gross Receipts or Sales", "Line 1c", ("Gross receipts or sales",), "money"),
)

PARTNERSHIP_RETURN_FIELDS = (
    FieldSpec("pt-return-name", "Form 1065", "identity", "Name", "Partnership Name", "Name", ("Name of partnership", "Name"), "text"),
    FieldSpec("pt-return-ein", "Form 1065", "identity", "Box D", "Employer Identification Number", "Box D", ("Employer identification number",), "ein"),
    FieldSpec("pt-return-ord", "Form 1065", "income", "Line 23", "Ordinary Business Income (Loss)", "Line 23", ("Ordinary business income (loss)", "Ordinary business income"), "money"),
    FieldSpec("pt-return-gp", "Form 1065", "income", "Line 10", "Guaranteed Payments to Partners", "Line 10", ("Guaranteed payments to partners", "Guaranteed payments"), "money"),
    FieldSpec("pt-return-wages", "Form 1065", "income", "Line 9", "Salaries and Wages", "Line 9", ("Salaries and wages",), "money"),
    # Anchored on the line 16a caption, so it reports the whole depreciation
    # claimed rather than the 16c net. This catalog only runs on a page the
    # template could not read at all, where 16b is not available to add to the
    # net, so the 16a total is the closest figure in reach.
    FieldSpec("pt-return-dep", "Form 1065", "addback", "Line 16a", "Depreciation", "Line 16a", ("Depreciation, if required", "Depreciation"), "money"),
    FieldSpec("pt-return-depletion", "Form 1065", "addback", "Line 17", "Depletion", "Line 17", ("Depletion",), "money"),
    FieldSpec("pt-return-gross", "Form 1065", "income", "Line 1c", "Gross Receipts or Sales", "Line 1c", ("Gross receipts or sales",), "money"),
)

FORM_CATALOGS: tuple[tuple[re.Pattern[str], tuple[FieldSpec, ...]], ...] = (
    (re.compile(r"Schedule C.*Profit or Loss From Business|Profit or Loss From Business", re.I), SCHEDULE_C_FIELDS),
    (re.compile(r"Profit or Loss From Farming", re.I), SCHEDULE_F_FIELDS),
    # K-1 patterns stay ahead of the return faces: a K-1 page often repeats the
    # return title in its header, and the first matching catalog wins.
    (re.compile(r"Schedule K-1\s*\(Form\s*1120-?S\)", re.I), SCORP_FIELDS),
    (re.compile(r"Schedule K-1\s*\(Form\s*1065\)", re.I), PARTNERSHIP_FIELDS),
    (re.compile(r"U\.S\. Income Tax Return for an S Corporation", re.I), SCORP_RETURN_FIELDS),
    (re.compile(r"U\.S\. Return of Partnership Income", re.I), PARTNERSHIP_RETURN_FIELDS),
    (re.compile(r"U\.S\. Corporation Income Tax Return", re.I), FORM_1120_FIELDS),
    (re.compile(r"U\.S\. Individual Income Tax Return", re.I), FORM_1040_FIELDS),
    (re.compile(r"Schedule B.*Interest and Ordinary Dividends", re.I), SCHEDULE_B_FIELDS),
    (re.compile(r"Schedule D.*Capital Gains and Losses", re.I), SCHEDULE_D_FIELDS),
    (re.compile(r"Form 8825.*Rental Real Estate Income|Form\s+8825", re.I), FORM_8825_FIELDS),
    # Returns cite "Form W-2" in their own line captions (Schedule C line 1),
    # so the return titles above claim their pages before the W-2 title can.
    (W2_TITLE, W2_FIELDS),
    # WVOE stays ahead of the pay stub catalog. A Form 1005 reports the same
    # earnings vocabulary a stub does -- gross earnings, year to date, overtime,
    # bonus -- and the first matching catalog wins, so a verification read by the
    # stub catalog had its prior-year column taken for a current one.
    (WVOE_TITLE, WVOE_FIELDS),
    (PAYSTUB_TITLE, PAYSTUB_FIELDS),
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


def _page_width(page: Any) -> float:
    return float(page.rect.width)


def _page_height(page: Any) -> float:
    return float(page.rect.height)


def _clip_right(page: Any, hit: Any, width: float = 220.0) -> list[float]:
    return [
        float(hit.x1) + 2.0,
        float(hit.y0) - 3.0,
        min(_page_width(page) - 12.0, float(hit.x1) + width),
        float(hit.y1) + 3.0,
    ]


def _clip_left(page: Any, hit: Any, width: float = 220.0) -> list[float]:
    return [
        max(8.0, float(hit.x0) - width),
        float(hit.y0) - 3.0,
        max(8.0, float(hit.x0) - 2.0),
        float(hit.y1) + 3.0,
    ]


def _clip_below(page: Any, hit: Any, height: float = 16.0) -> list[float]:
    return [
        float(hit.x0),
        float(hit.y1),
        min(_page_width(page) - 12.0, float(hit.x1) + 140.0),
        min(_page_height(page) - 8.0, float(hit.y1) + height),
    ]


def _clip_above(page: Any, hit: Any, height: float = 24.0) -> list[float]:
    return [
        max(8.0, float(hit.x0) - 28.0),
        max(8.0, float(hit.y0) - height),
        min(_page_width(page) - 12.0, float(hit.x1) + 8.0),
        float(hit.y0) + 1.0,
    ]


def _row_band_text(page: Any, words: list[dict[str, Any]] | None, box: list[float], hit: Any) -> str:
    """Words across ``box`` whose vertical center sits on the label's own row.

    A PDF text clip keeps any glyph that touches the box, which on a tight
    grid includes the bottom of the row above.
    """
    top, bottom = float(hit.y0) - 1.0, float(hit.y1) + 1.0
    found: list[tuple[float, str]] = []
    try:
        native = page.get_text("words") or []
    except Exception:
        native = []
    sources = [(w[0], w[1], w[2], w[3], w[4]) for w in native if len(w) >= 5]
    if not sources and words:
        sources = [(w["x0"], w["y0"], w["x1"], w["y1"], w["text"]) for w in words]
    for x0, y0, x1, y1, text in sources:
        cx, cy = (float(x0) + float(x1)) / 2, (float(y0) + float(y1)) / 2
        if box[0] <= cx <= box[2] and top <= cy <= bottom:
            found.append((float(x0), str(text)))
    return " ".join(text for _x, text in sorted(found))


def _clip_w2_column(page: Any, hit: Any) -> list[float]:
    """IRS W-2 amounts sit in the same cell, under the label, aligned with the box number.

    Clip-right hits the neighboring box number (Box 5 → the '2' of Box 2). Clip-below
    starts at the label text, so it shears '78,500.00' into '8,500.00' and can include
    the next box's amount. Keep the cell: a bit left of a short box-number hit, not
    into the next box. Long OCR labels already span the cell, so do not shift left.
    """
    label_w = float(hit.x1) - float(hit.x0)
    left_pad = 8.0 if label_w > 60.0 else 28.0
    x0 = max(8.0, float(hit.x0) - left_pad)
    x1 = min(_page_width(page) - 12.0, float(hit.x1) + 8.0, x0 + (160.0 if label_w > 60.0 else 130.0))
    y0 = float(hit.y1) - 1.0
    y1 = min(_page_height(page) - 8.0, float(hit.y1) + 24.0)
    return [x0, y0, x1, y1]


def _is_form_box_number(token: str, amount: float) -> bool:
    """Bare 1–2 digit integers are W-2 box numbers, not Medicare wages."""
    stripped = token.strip()
    if not re.fullmatch(r"\d{1,2}", stripped):
        return False
    return amount == int(amount) and 0 <= amount <= 20


_BUSINESS_FORMS = frozenset({"Form 1065", "Form 1120", "Form 1120-S"})
# Captions a name clip reads when the name box is empty. Compared folded,
# because OCR runs them together ("Partnership'semployeridentificationnumber").
_BUSINESS_CAPTION_NEEDLES = (
    "identificationnumber", "effectivedate", "businessactivity", "dateincorporated",
    "totalassets", "nameaddress", "numberstreet", "numberandstreet", "cityortown",
    "checkif", "seeinstructions", "calendaryear", "taxyearbeginning",
)


def _is_business_caption(value: str) -> bool:
    folded = re.sub(r"[^a-z0-9]", "", (value or "").lower())
    if not re.search(r"[a-z]", folded):
        return True
    return any(needle in folded for needle in _BUSINESS_CAPTION_NEEDLES)


def _is_printed_reference(raw: str, amount: float, labels: Iterable[str] = ()) -> bool:
    """A number the blank form prints, read as if it were an entry.

    On an empty line the clip beside a caption holds only the form's own text:
    the line number ("22"), a form it cites ("Form 4562", "Form 1125-A"), or
    the tax year in the header. Entries carry commas or cents, or at least do
    not sit right after the word "Form".
    """
    value = abs(amount)
    text = raw or ""
    spellings = {f"{value:,.2f}", f"{value:.2f}", f"{value:,.1f}", f"{value:.1f}"}
    if value == int(value):
        spellings |= {f"{int(value):,}", str(int(value))}
    if not any(re.search(rf"(?<![\d,.]){re.escape(s)}(?![\d,])", text) for s in spellings):
        # The amount was pieced together from separate numbers on the page
        # ("8 ... 9" read as 8.90, "18 19" as 1,819), so it is not an entry.
        return True
    if value != int(value):
        return False
    number = int(value)
    if any(re.search(rf"(?<!\d){number}(?!\d)", label) for label in labels):
        return True
    if re.search(rf"(?:Forms?|Schedule|section|lines?)\s*\(?{number}\b", text, re.I):
        return True
    if number <= 99:
        return True
    return 1990 <= number <= 2099


def _label_variants(label: str) -> tuple[str, ...]:
    variants = [label, label.replace("'", "’"), label.replace("’", "'"), re.sub(r"['’]", "·", label)]
    seen: list[str] = []
    for item in variants:
        if item and item not in seen:
            seen.append(item)
    return tuple(seen)


def _fold_label(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


@dataclass(frozen=True)
class _Hit:
    x0: float
    y0: float
    x1: float
    y1: float


def _word_items(words: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for word in words or []:
        text = str(word.get("text") or "").strip()
        if not text:
            continue
        items.append(
            {
                "text": text,
                "fold": _fold_label(text),
                "x0": float(word["x0"]),
                "y0": float(word["y0"]),
                "x1": float(word["x1"]),
                "y1": float(word["y1"]),
            }
        )
    return items


def _median(values: list[float], fallback: float) -> float:
    if not values:
        return fallback
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def _cluster_reading_lines(items: list[dict[str, Any]], *, vertical: bool = False) -> list[list[dict[str, Any]]]:
    if not items:
        return []
    if vertical:
        ordered = sorted(items, key=lambda word: ((word["x0"] + word["x1"]) / 2.0, word["y0"]))
        axis = lambda word: (word["x0"] + word["x1"]) / 2.0
        minor = lambda word: word["y0"]
        tolerance = max(4.0, _median([word["x1"] - word["x0"] for word in items], 8.0) * 0.65)
    else:
        ordered = sorted(items, key=lambda word: ((word["y0"] + word["y1"]) / 2.0, word["x0"]))
        axis = lambda word: (word["y0"] + word["y1"]) / 2.0
        minor = lambda word: word["x0"]
        tolerance = max(4.0, _median([word["y1"] - word["y0"] for word in items], 8.0) * 0.7)
    rows: list[list[dict[str, Any]]] = []
    for word in ordered:
        if rows and abs(axis(word) - axis(rows[-1][0])) <= tolerance:
            rows[-1].append(word)
        else:
            rows.append([word])
    for row in rows:
        row.sort(key=minor)
    return rows


def _span_hit(span: list[dict[str, Any]]) -> _Hit:
    return _Hit(
        min(word["x0"] for word in span),
        min(word["y0"] for word in span),
        max(word["x1"] for word in span),
        max(word["y1"] for word in span),
    )


def _find_folded_needle(items: list[dict[str, Any]], needle: str) -> _Hit | None:
    if not needle or not items:
        return None
    short = len(needle) < 5
    for word in items:
        folded = word["fold"]
        if not folded:
            continue
        if short:
            if folded == needle or folded.startswith(needle):
                return _span_hit([word])
            continue
        if needle in folded:
            return _span_hit([word])
    folds = [word["fold"] for word in items]
    for start in range(len(items)):
        acc = ""
        for end in range(start, len(items)):
            acc += folds[end]
            if not acc:
                continue
            if acc == needle or (not short and needle in acc):
                return _span_hit(items[start : end + 1])
            if len(acc) > len(needle) + 18:
                break
    return None


def _hit_from_words(words: list[dict[str, Any]] | None, labels: tuple[str, ...]) -> _Hit | None:
    items = _word_items(words)
    if not items:
        return None
    needles: list[str] = []
    for label in labels:
        for variant in _label_variants(label):
            folded = _fold_label(variant)
            if folded and folded not in needles:
                needles.append(folded)
    needles.sort(key=len, reverse=True)
    groups = _cluster_reading_lines(items) + _cluster_reading_lines(items, vertical=True) + [items]
    for needle in needles:
        for group in groups:
            hit = _find_folded_needle(group, needle)
            if hit is not None:
                return hit
    return None


def _first_hit(page: Any, labels: tuple[str, ...], words: list[dict[str, Any]] | None = None):
    for label in labels:
        for variant in _label_variants(label):
            hits = page.search_for(variant)
            if hits:
                return hits[0]
    return _hit_from_words(words, labels)


def _on_row_right_of(anchor: Any, hit: Any) -> bool:
    anchor_mid = (float(anchor.y0) + float(anchor.y1)) / 2.0
    hit_mid = (float(hit.y0) + float(hit.y1)) / 2.0
    tolerance = max(4.0, (float(anchor.y1) - float(anchor.y0)) * 0.75)
    return abs(hit_mid - anchor_mid) <= tolerance and float(hit.x0) >= float(anchor.x1)


def _row_hit(page: Any, spec: FieldSpec, words: list[dict[str, Any]] | None):
    anchor = _first_hit(page, spec.row_anchor, words)
    if anchor is None:
        return None
    for label in spec.labels:
        for variant in _label_variants(label):
            for hit in page.search_for(variant):
                if _on_row_right_of(anchor, hit):
                    return hit
    row_words = [
        word for word in _word_items(words)
        if _on_row_right_of(anchor, _Hit(word["x0"], word["y0"], word["x1"], word["y1"]))
    ]
    return _hit_from_words(row_words, spec.labels)


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


def _first_visual_line(words: list[dict[str, Any]], box: list[float]) -> str:
    hits = words_in_box(words, box)
    if not hits:
        return ""
    hits.sort(key=lambda word: (float(word["y0"]), float(word["x0"])))
    top = float(hits[0]["y0"])
    line = [word for word in hits if abs(float(word["y0"]) - top) <= 5.0]
    return re.sub(r"\s+", " ", " ".join(str(word["text"]) for word in line)).strip()


def _same_column_money(words: list[dict[str, Any]], box: list[float], hit: Any) -> tuple[str, float] | None:
    """Prefer the amount under the label, not a neighbor in a wide OCR clip."""
    candidates: list[tuple[float, tuple[str, float]]] = []
    for word in words_in_box(words, box):
        parsed = _parse_capture(str(word.get("text") or ""), "money")
        if not parsed:
            continue
        cx = (float(word["x0"]) + float(word["x1"])) / 2.0
        if cx < float(hit.x0) - 12.0 or cx > float(hit.x1) + 12.0:
            continue
        candidates.append((abs(float(word["y0"]) - float(hit.y1)), parsed))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def normalize_date(raw: str) -> str | None:
    """One MM/DD/YYYY spelling for every date form a verification prints."""
    text = re.sub(r"\s+", " ", raw or "").strip().rstrip(".")
    named = re.match(r"([A-Za-z]{3,9})\.?,?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$", text)
    if named:
        month = _MONTH_INDEX.get(named.group(1)[:3].lower())
        return f"{month:02d}/{int(named.group(2)):02d}/{named.group(3)}" if month else None
    iso = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})$", text)
    if iso:
        return f"{int(iso.group(2)):02d}/{int(iso.group(3)):02d}/{iso.group(1)}"
    us = re.match(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$", text)
    if not us:
        return None
    year = int(us.group(3))
    if len(us.group(3)) == 2:
        year += 2000 if year <= 69 else 1900
    month, day = int(us.group(1)), int(us.group(2))
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    return f"{month:02d}/{day:02d}/{year:04d}"


def duration_months(raw: str) -> int | None:
    """Months from a stated tenure: "8 Yrs 7 Months", "2 Years, 9 Months"."""
    years = _DURATION_YEARS.search(raw or "")
    months = _DURATION_MONTHS.search(raw or "")
    if not years and not months:
        return None
    total = (int(years.group(1)) * 12 if years else 0) + (int(months.group(1)) if months else 0)
    return total if 0 < total <= 720 else None


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
            # Dot leaders reach here as "........" or with line numbers mixed
            # in ("3....4.."), which is not a number.
            try:
                amount = parse_tax_amount(text)
            except ValueError:
                return None
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
    if capture == "date":
        match = DATE_TOKEN.search(text)
        if not match:
            return None
        normalized = normalize_date(match.group(0))
        return (normalized, 0.0) if normalized else None
    if capture == "duration":
        months = duration_months(text)
        if months is None:
            return None
        return f"{months:,}", float(months)
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


_WVOE_NOTICE_WORDS = re.compile(
    r"\b(?:consumer report|FCRA|permissible purpose|trademark|subsidiary|copyright"
    r"|all rights reserved|registered|disclaimer|wholly owned)\b",
    re.IGNORECASE,
)


def _is_wvoe_prose(value: str) -> bool:
    """Running text from a verification's FCRA notice, not a field value.

    The Work Number closes its report with a page of notice, and the loose
    "Employer" label that a vendor's two-column table needs also lands on the
    footer line "Employers: workforce@equifax.com" and on "the employer's
    payroll system". A field value is short, starts where a name starts, and
    is not a sentence, a mail address or a link.
    """
    text = (value or "").strip()
    if len(text) > 48 or len(text.split()) > 6:
        return True
    if text[:1].islower():
        return True
    return bool(re.search(r"[@•]|https?:|\bwww\.|\.com\b", text) or _WVOE_NOTICE_WORDS.search(text))


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
    hit = _row_hit(page, spec, words) if spec.row_anchor else _first_hit(page, spec.labels, words)
    if hit is None:
        return None
    boxes: list[list[float]] = []
    # End-of-year column (d) is the last amount on the row. Read that span
    # before a fillable widget, which is often the beginning-of-year box.
    if spec.capture == "money_last":
        boxes.append(
            [
                float(hit.x1) + 2.0,
                float(hit.y0) - 3.0,
                _page_width(page) - 12.0,
                float(hit.y1) + 3.0,
            ]
        )
    if spec.form == "WVOE":
        # A verification is a two-column table and the vendors right-align the
        # value, so the 220pt clip stops short of it. Reaching the page edge
        # along the label's own row is what keeps the fallbacks below from
        # answering with the row above: "Employer" read "Full Name".
        boxes.append(
            [
                float(hit.x1) + 2.0,
                float(hit.y0) - 3.0,
                _page_width(page) - 8.0,
                float(hit.y1) + 3.0,
            ]
        )
    widget_box = _nearest_widget_box(page, hit, pymupdf)
    if widget_box:
        boxes.append(widget_box)
    if spec.form == "W-2":
        boxes.append(_clip_w2_column(page, hit))
    if spec.row_anchor:
        # A blank "b" cell must stay blank, not borrow the "a" amount on its
        # left or the next row's amount below.
        boxes.append(_clip_right(page, hit))
    elif spec.capture == "money_last":
        # Schedule L rows are 12pt apart, so any clip padded past the label's
        # row reaches the amount above or below it; a blank line stays blank.
        pass
    else:
        boxes.extend(
            [
                _clip_right(page, hit),
                _clip_below(page, hit),
                _clip_left(page, hit),
                _clip_above(page, hit),
            ]
        )
    parsed = None
    used_box = boxes[0]
    for index, box in enumerate(boxes):
        if spec.capture == "money_last" and index == 0:
            raw = _row_band_text(page, words, box, hit)
        else:
            raw = _clip_text(
                page,
                pymupdf,
                box,
                words,
                money=spec.capture.startswith("money"),
            )
        if spec.capture == "text" and words:
            raw = _first_visual_line(words, box) or raw
        parsed = _parse_capture(raw, spec.capture)
        if spec.form == "W-2" and spec.capture == "money" and words:
            parsed = _same_column_money(words, box, hit) or parsed
        if parsed and spec.form in _BUSINESS_FORMS and spec.capture.startswith("money"):
            if _is_printed_reference(raw, parsed[1], spec.labels):
                parsed = None
                continue
        if parsed and spec.form in _BUSINESS_FORMS and spec.capture == "text":
            if _is_business_caption(parsed[0]):
                parsed = None
                continue
        if parsed and spec.form == "WVOE" and spec.capture == "text" and _is_wvoe_prose(parsed[0]):
            parsed = None
            continue
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


_PAYSTUB_MONEY_TOKEN = re.compile(
    r"(?:\$\s*)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2,}|\((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2,}\))"
)
_PAYSTUB_ANY_NUMBER = re.compile(
    r"(?:\$\s*)?(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\))"
)


def _parse_paystub_token(raw: str, *, currency_only: bool = True) -> tuple[str, float] | None:
    """Keep $0.00 so a blank current column still reveals the YTD slot.

    Currency tokens require two or more decimal places so rate codes like
    '1.5 Hourly' are not amounts, while pay-rate precision such as 51.9953
    still maps. Overlay lookup may allow integers for hours.
    """
    text = re.sub(r"\s+", " ", raw or "").strip()
    match = (_PAYSTUB_MONEY_TOKEN if currency_only else _PAYSTUB_ANY_NUMBER).search(text)
    if not match:
        return None
    amount = parse_tax_amount(match.group(0))
    return _format_money(amount), amount


def _parse_paystub_row_money(raw: str) -> tuple[str, float] | None:
    return _parse_paystub_token(raw, currency_only=True)


def _paystub_row_clips(page: Any, hit: Any) -> list[list[float]]:
    return [
        [
            float(hit.x1) + 2.0,
            float(hit.y0) - 5.0,
            _page_width(page) - 8.0,
            float(hit.y1) + 5.0,
        ],
        _clip_below(page, hit, height=22.0),
        _clip_left(page, hit, width=260.0),
        _clip_above(page, hit, height=22.0),
    ]


def _money_tokens_in_clip(
    page: Any,
    pymupdf: Any,
    clip: list[float],
    words: list[dict[str, Any]] | None,
    *,
    currency_only: bool = True,
) -> list[tuple[float, str, float, list[float]]]:
    found: list[tuple[float, str, float, list[float]]] = []
    native = page.get_text("words", clip=pymupdf.Rect(clip)) or []
    source: list[tuple[float, float, float, float, str]] = []
    if native:
        source = [(float(word[0]), float(word[1]), float(word[2]), float(word[3]), str(word[4])) for word in native]
    elif words:
        source = [
            (float(word["x0"]), float(word["y0"]), float(word["x1"]), float(word["y1"]), str(word["text"]))
            for word in words_in_box(words, clip)
        ]
    for x0, y0, x1, y1, text in source:
        parsed = _parse_paystub_token(text, currency_only=currency_only)
        if not parsed:
            continue
        value, numeric = parsed
        found.append((x0, value, numeric, [x0, y0, x1, y1]))
    found.sort(key=lambda item: item[0])
    return found


def _row_money_amounts(
    page: Any,
    pymupdf: Any,
    hit: Any,
    words: list[dict[str, Any]] | None = None,
    *,
    currency_only: bool = True,
) -> list[tuple[float, str, float, list[float]]]:
    for clip in _paystub_row_clips(page, hit):
        found = _money_tokens_in_clip(page, pymupdf, clip, words, currency_only=currency_only)
        if found:
            return found
    return []


def _paystub_value_box(
    page: Any,
    pymupdf: Any,
    hit: Any,
    numeric: float,
    words: list[dict[str, Any]] | None = None,
) -> list[float]:
    """Return the printed numeric token, not the earnings-row label."""
    label_box = [float(hit.x0), float(hit.y0), float(hit.x1), float(hit.y1)]
    amounts = _row_money_amounts(page, pymupdf, hit, words)
    matching = [item for item in amounts if abs(item[2] - numeric) <= max(0.005, abs(numeric) * 0.000001)]
    if matching:
        return matching[-1][3]
    amounts = _row_money_amounts(page, pymupdf, hit, words, currency_only=False)
    matching = [item for item in amounts if abs(item[2] - numeric) <= max(0.005, abs(numeric) * 0.000001)]
    if matching:
        return matching[-1][3]
    return label_box


def _wvoe_row_amounts(
    page: Any,
    pymupdf: Any,
    hit: Any,
    words: list[dict[str, Any]] | None,
) -> list[tuple[float, str, float, list[float]]]:
    """Money tokens of one earnings row, left to right.

    A verification is typed by a payroll clerk or rendered by a vendor rather
    than printed by a payroll engine, so cents are often absent. Currency
    tokens are tried first and plain numbers only when the row yielded none,
    which keeps a cent-bearing row from picking up a stray item number.
    """
    amounts = _row_money_amounts(page, pymupdf, hit, words)
    if amounts:
        return amounts
    return _row_money_amounts(page, pymupdf, hit, words, currency_only=False)


_WVOE_YTD_HEADERS = ("yeartodate", "ytd", "currentyear", "thisyear")
_WVOE_PRIOR_HEADERS = ("pastyear", "prioryear", "previousyear", "lastyear")
_YEAR_HEADER_TOKEN = re.compile(r"^\(?(19|20)\d{2}\)?$")
_WVOE_COLUMN_TOLERANCE = 46.0


@dataclass(frozen=True)
class _WvoeColumns:
    """Which earnings year each column holds, and where its heading was printed.

    ``roles`` is ``(x_center, role)`` left to right, where role is ``ytd``,
    ``prior`` or ``prior-2``. Empty roles mean no heading was found, which
    leaves the caller on Form 1005's column order. ``header_bottom`` is the
    baseline below which the grid rows start.
    """

    roles: tuple[tuple[float, str], ...]
    header_bottom: float | None
    ytd_year: int | None = None


def _wvoe_header_rows(items: list[dict[str, Any]]) -> list[list[tuple[float, float, str, int | None]]]:
    """Column headings per reading line, as ``(y_bottom, x_center, kind, year)``.

    A heading splits across words ("Year To Date"), so each token is joined with
    the few after it and the run is tested whole. The x reported is the center
    of the matched run rather than of its first word, because that is what the
    amounts beneath it line up with.
    """
    rows: list[list[tuple[float, float, str, int | None]]] = []
    for line in _cluster_reading_lines(items):
        folded = [(_fold_label(str(item["text"])), item) for item in line]
        found: list[tuple[float, float, str, int | None]] = []
        for index, (token, item) in enumerate(folded):
            if not token:
                continue
            raw = str(item["text"]).strip()
            if _YEAR_HEADER_TOKEN.match(raw):
                center = (float(item["x0"]) + float(item["x1"])) / 2
                found.append((float(item["y1"]), center, "year", int(re.sub(r"\D", "", raw))))
                continue
            run = ""
            for offset, (following, next_item) in enumerate(folded[index : index + 4]):
                run += following
                kind = (
                    "ytd"
                    if run in _WVOE_YTD_HEADERS
                    else "prior"
                    if run in _WVOE_PRIOR_HEADERS
                    else None
                )
                if kind is None:
                    continue
                center = (float(item["x0"]) + float(next_item["x1"])) / 2
                found.append((float(next_item["y1"]), center, kind, None))
                break
        if found:
            rows.append(found)
    return rows


def _wvoe_columns(page: Any, words: list[dict[str, Any]] | None) -> _WvoeColumns:  # noqa: C901
    """Resolve the earnings columns from the headings the document printed.

    Position alone cannot say which year a column holds. Form 1005 runs year to
    date, prior year, then the year before, but a vendor report does not: The
    Work Number and Truework head their income tables with the year itself and
    may run oldest to newest, so the leftmost column there can be the stalest
    figure on the page. Reading the headings is what keeps a two-year-old total
    out of the current-year box.
    """
    items = _wvoe_items(page, words)
    if not items:
        return _WvoeColumns((), None)

    # A lone year in body text ("for tax year 2023") is not a column, so only
    # lines carrying two or more headings are read as the grid header.
    header_rows = [row for row in _wvoe_header_rows(items) if len(row) >= 2]
    if not header_rows:
        return _WvoeColumns((), None)

    # Form 1005 prints its header over two lines, "Year To Date / Past Year /
    # Past Year" above "Thru __ / 2023 / 2022", so headings are merged by x
    # before roles are handed out.
    merged: list[dict[str, Any]] = []
    for y_bottom, x_center, kind, year in sorted(
        (candidate for row in header_rows for candidate in row), key=lambda candidate: candidate[1]
    ):
        if merged and abs(merged[-1]["x"] - x_center) <= _WVOE_COLUMN_TOLERANCE:
            column = merged[-1]
            column["x"] = (column["x"] + x_center) / 2
            column["kinds"].add(kind)
            column["bottom"] = max(column["bottom"], y_bottom)
            if year is not None:
                column["year"] = max(column["year"] or 0, year)
            continue
        merged.append({"x": x_center, "kinds": {kind}, "year": year, "bottom": y_bottom})
    if len(merged) < 2:
        return _WvoeColumns((), None)

    current = next((column for column in merged if "ytd" in column["kinds"]), None)
    if current is not None:
        history = [column for column in merged if column is not current]
        # The history columns run newest first: by printed year when every one
        # carries one, otherwise in Form 1005's left-to-right order.
        if history and all(column["year"] is not None for column in history):
            history.sort(key=lambda column: column["year"], reverse=True)
        ordered = [current, *history]
    else:
        dated = [column for column in merged if column["year"] is not None]
        if len(dated) < 2:
            return _WvoeColumns((), None)
        ordered = sorted(dated, key=lambda column: column["year"], reverse=True)

    roles = tuple(
        (column["x"], role) for column, role in zip(ordered, ("ytd", "prior", "prior-2"))
    )
    return _WvoeColumns(
        tuple(sorted(roles, key=lambda role: role[0])),
        max(column["bottom"] for column in merged),
        ordered[0]["year"],
    )


def _wvoe_assign_columns(
    amounts: list[tuple[float, str, float, list[float]]],
    roles: tuple[tuple[float, str], ...],
) -> list[tuple[str, str, float, list[float]]]:
    """Bind each amount on a row to a column role."""
    if not roles:
        order = ("ytd", "prior", "prior-2")
        return [
            (order[index], value, numeric, box)
            for index, (_, value, numeric, box) in enumerate(amounts[:3])
        ]
    assigned: list[tuple[str, str, float, list[float]]] = []
    claimed: set[str] = set()
    for x0, value, numeric, box in amounts:
        center = (x0 + float(box[2])) / 2 if len(box) > 2 else x0
        role = min(roles, key=lambda item: abs(item[0] - center))[1]
        if role in claimed:
            continue
        claimed.add(role)
        assigned.append((role, value, numeric, box))
    return assigned


def _wvoe_items(page: Any, words: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    native = page.get_text("words") or []
    if native:
        return [
            {"text": str(word[4]), "x0": float(word[0]), "y0": float(word[1]), "x1": float(word[2]), "y1": float(word[3])}
            for word in native
        ]
    return _word_items(words) if words else []


def _wvoe_category_columns(
    items: list[dict[str, Any]],
) -> tuple[list[tuple[float, str | None]], float] | None:
    """Earnings categories across the top, as anchors plus the heading baseline.

    The Work Number transposes the Form 1005 grid: a column per category and a
    row per year. An anchor is kept for the columns the calculation does not
    use, so the amount under "Other" cannot drift into the nearest category it
    does use.
    """
    best: tuple[list[tuple[float, str | None]], float, int] | None = None
    for line in _cluster_reading_lines(items):
        folded = [(_fold_label(str(item["text"])), item) for item in line]
        anchors: list[tuple[float, str | None]] = []
        bottom = 0.0
        for index, (token, item) in enumerate(folded):
            if not token:
                continue
            # Longest run first, so "Base Salary" is one column and not the
            # word "Base" with the column center placed over its first word.
            for length in (3, 2, 1):
                window = folded[index : index + length]
                if len(window) < length:
                    continue
                run = "".join(part for part, _ in window)
                if run not in _WVOE_CATEGORY_RUNS:
                    continue
                last = window[-1][1]
                anchors.append(((float(item["x0"]) + float(last["x1"])) / 2, _WVOE_CATEGORY_RUNS[run]))
                bottom = max(bottom, float(last["y1"]))
                break
        named = len({field_id for _, field_id in anchors if field_id})
        if named >= 2 and (best is None or named > best[2]):
            best = (anchors, bottom, named)
    return (best[0], best[1]) if best else None


def _wvoe_year_rows(
    items: list[dict[str, Any]],
    header_bottom: float,
) -> list[tuple[int, list[dict[str, Any]]]]:
    """Lines under the heading that open with a four-digit year, newest first.

    A redacted sample prints "20XX" where the year belongs. Those rows are
    skipped rather than ordered by position, because nothing on the page then
    says which of them is the current year.
    """
    rows: list[tuple[int, list[dict[str, Any]]]] = []
    for line in _cluster_reading_lines(items):
        ordered = sorted(line, key=lambda item: float(item["x0"]))
        if not ordered or float(ordered[0]["y1"]) <= header_bottom:
            continue
        raw = str(ordered[0]["text"]).strip()
        if not _YEAR_HEADER_TOKEN.match(raw):
            continue
        rows.append((int(re.sub(r"\D", "", raw)), ordered[1:]))
    rows.sort(key=lambda row: row[0], reverse=True)
    return rows[:3]


def _wvoe_grid_hits(page: Any, labels: tuple[str, ...], words: list[dict[str, Any]] | None):
    """Every place an earnings label appears, for the most specific label that lands.

    "Base Pay" is printed twice on Form 1005: once in the current pay item and
    once as a grid row. Taking the first hit reads the rate of pay into the
    year-to-date box, so the caller needs all of them.
    """
    for label in labels:
        hits: list[Any] = []
        for variant in _label_variants(label):
            hits.extend(page.search_for(variant) or [])
        if hits:
            return hits
    hit = _hit_from_words(words, labels)
    return [hit] if hit is not None else []


_WVOE_ROLE_LABELS = {"ytd": "Year to Date", "prior": "Prior Year", "prior-2": "Second Prior Year"}


def _extract_wvoe_grid(
    page: Any,
    pymupdf: Any,
    *,
    page_index: int,
    blob: str,
    words: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Read the rate of pay and the earnings history of a verification.

    Covers Form 1005 items 12A and 12B, Truework's income table, which is laid
    out the same way, and The Work Number's Annual Income Summary, which is the
    same figures transposed.
    """
    extracted: list[dict[str, Any]] = []
    entity_id = f"{_form_slug('WVOE')}-p{page_index}"
    spec_by_id = {spec.source_id: spec for spec in WVOE_FIELDS}
    emitted: set[str] = set()
    last_box: list[float] = [0.0, 0.0, 0.0, 0.0]

    def emit(source_id: str, label: str, value: str, numeric: float, box: list[float]) -> None:
        nonlocal last_box
        if source_id in emitted:
            return
        emitted.add(source_id)
        last_box = box
        spec = spec_by_id.get(source_id) or _WVOE_EARNING_SPECS.get(source_id)
        if spec is None:
            parent = _WVOE_EARNING_SPECS.get(source_id.rsplit("-prior", 1)[0])
            spec = FieldSpec(
                source_id,
                "WVOE",
                "wages",
                parent.box_label if parent else "Earnings",
                label,
                parent.line_num if parent else "Earnings",
                (),
                "money",
            )
        extracted.append(
            _field_record(
                page=page,
                page_index=page_index,
                spec=spec,
                form="WVOE",
                entity_id=entity_id,
                value=value,
                numeric=numeric,
                used_box=box,
            )
        )

    current_hit = _first_hit(page, _WVOE_CURRENT_BASE_LABELS, words)
    if current_hit is not None:
        amounts = _wvoe_row_amounts(page, pymupdf, current_hit, words)
        if amounts:
            _, value, numeric, box = amounts[0]
            emit("wvoe-base", "Current Gross Base Pay", value, numeric, box)
        # Only the rate's own row. The nearby paycheck cycle is a different
        # fact -- The Work Number pairs an hourly rate with a semi-monthly
        # cycle -- and reading it here would quote the rate in the wrong unit.
        row_text = _clip_text(
            page,
            pymupdf,
            [float(current_hit.x0) - 4.0, float(current_hit.y0) - 5.0, _page_width(page) - 8.0, float(current_hit.y1) + 5.0],
            words,
        )
        period = _wvoe_base_period(row_text)
        if period:
            emit(
                "wvoe-base-period",
                "Base Pay Period",
                period,
                0.0,
                [float(current_hit.x0), float(current_hit.y0), float(current_hit.x1), float(current_hit.y1)],
            )

    items = _wvoe_items(page, words)
    transposed = _wvoe_category_columns(items)
    ytd_year: int | None = None
    if transposed is not None:
        anchors, header_bottom = transposed
        rows = _wvoe_year_rows(items, header_bottom)
        for role, (year, cells) in zip(("ytd", "prior", "prior-2"), rows):
            if role == "ytd":
                ytd_year = year
            for cell in cells:
                parsed = _parse_paystub_token(str(cell["text"]))
                if not parsed:
                    continue
                value, numeric = parsed
                center = (float(cell["x0"]) + float(cell["x1"])) / 2
                field_id = min(anchors, key=lambda anchor: abs(anchor[0] - center))[1]
                if field_id is None:
                    continue
                emit(
                    field_id if role == "ytd" else f"{field_id}-{role}",
                    f"{_WVOE_ROLE_LABELS[role]} ({year})",
                    value,
                    numeric,
                    [float(cell["x0"]), float(cell["y0"]), float(cell["x1"]), float(cell["y1"])],
                )
    if transposed is None or not any(field.startswith("wvoe-base-ytd") for field in emitted):
        columns = _wvoe_columns(page, words)
        ytd_year = ytd_year or columns.ytd_year
        for source_id, labels in _WVOE_GRID_ROWS:
            best: tuple[Any, list[tuple[float, str, float, list[float]]]] | None = None
            for hit in _wvoe_grid_hits(page, labels, words):
                if columns.header_bottom is not None and float(hit.y0) < columns.header_bottom:
                    continue
                amounts = _wvoe_row_amounts(page, pymupdf, hit, words)
                if amounts and (best is None or len(amounts) > len(best[1])):
                    best = (hit, amounts)
            if best is None:
                continue
            # The base row shares its label with the rate of pay item, so a row
            # carrying a single amount under no heading is that item instead.
            if source_id == "wvoe-base-ytd" and len(best[1]) < 2 and not columns.roles:
                continue
            for role, value, numeric, box in _wvoe_assign_columns(best[1], columns.roles):
                emit(
                    source_id if role == "ytd" else f"{source_id}-{role}",
                    f"{_WVOE_ROLE_LABELS[role]} ({source_id})",
                    value,
                    numeric,
                    box,
                )

    if ytd_year is not None and extracted:
        emit("wvoe-ytd-year", "Year to Date Year", str(ytd_year), float(ytd_year), last_box)
    return extracted


def _wvoe_base_period(text: str) -> str | None:
    folded = re.sub(r"\s+", " ", (text or "")).lower()
    for needle, label in _WVOE_BASE_PERIODS:
        if needle in folded:
            return label
    return None


def _wvoe_months_record(
    page: Any,
    page_index: int,
    records: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Months employed, derived from the hire date and the date the report was struck.

    The divisor for verified overtime and bonus is bounded by how long the
    borrower has worked there. Both vendors usually print the tenure outright
    and the wvoe-months spec reads it; this covers Form 1005, which states the
    date of hire and the date the year-to-date column was struck but not the
    count between them.
    """
    by_id = {record["sourceFieldId"]: record for record in records}
    if "wvoe-months" in by_id:
        return None
    hire = by_id.get("wvoe-hire-date")
    thru = by_id.get("wvoe-ytd-thru")
    if not hire or not thru:
        return None
    start = _parse_normalized_date(str(hire.get("value") or ""))
    end = _parse_normalized_date(str(thru.get("value") or ""))
    if not start or not end:
        return None
    months = (end[0] - start[0]) * 12 + (end[1] - start[1]) - (1 if end[2] < start[2] else 0)
    if months <= 0 or months > 720:
        return None
    record = _field_record(
        page=page,
        page_index=page_index,
        spec=FieldSpec("wvoe-months", "WVOE", "wages", "Tenure", "Months Employed", "Tenure", (), "integer"),
        form="WVOE",
        entity_id=str(thru["entityId"]),
        value=f"{months:,}",
        numeric=float(months),
        used_box=[0.0, 0.0, 0.0, 0.0],
    )
    record["box"] = thru["box"]
    return record


def _parse_normalized_date(value: str) -> tuple[int, int, int] | None:
    """(year, month, day) from a value already put through normalize_date."""
    match = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", (value or "").strip())
    if not match:
        return None
    return int(match.group(3)), int(match.group(1)), int(match.group(2))


def _merge_wvoe_pages(fields: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One verification spans pages, so its fields belong to one entity.

    Truework puts the employer and the dates on page 1 and the income table on
    page 2; The Work Number runs to three pages. Leaving the parser's per-page
    entity id in place hands the portal two half-filled verifications, neither
    of which can be annualized. Pages are joined only while no field repeats,
    so two different employers' verifications in one packet stay apart.
    """
    by_page: dict[int, list[dict[str, Any]]] = {}
    for row in fields:
        if row.get("form") == "WVOE":
            by_page.setdefault(int(row["pageIndex"]), []).append(row)
    pages = sorted(by_page)
    if len(pages) < 2:
        return fields
    anchors: dict[int, int] = {}
    anchor = pages[0]
    claimed: set[str] = set()
    for index, page in enumerate(pages):
        ids = {row["sourceFieldId"] for row in by_page[page]}
        contiguous = index == 0 or page == pages[index - 1] + 1
        if index and (not contiguous or ids & claimed):
            anchor, claimed = page, set()
        anchors[page] = anchor
        claimed |= ids
    for page, rows in by_page.items():
        entity_id = f"{_form_slug('WVOE')}-p{anchors[page]}"
        for row in rows:
            row["entityId"] = entity_id
    return fields


def _extract_8825_columns(
    page: Any,
    pymupdf: Any,
    *,
    page_index: int,
    words: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Property columns A/B/C… plus totals, matching Schedule E's per-column capture."""
    columns = "ABCDEFGH"
    extracted: list[dict[str, Any]] = []
    entity_id = f"form-8825-p{page_index}"
    for source_id, line_num, labels in _8825_COLUMN_LINES:
        hit = _first_hit(page, labels, words)
        if hit is None:
            continue
        amounts = _row_money_amounts(page, pymupdf, hit, words)
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


_PAYSTUB_SPECS = {spec.source_id: spec for spec in PAYSTUB_FIELDS}


def _paystub_code_label(line: str) -> str:
    """Keep the earning code, including codes that start with a rate like '1.5 Hourly'."""
    label = re.sub(r"(?:\$\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}", " ", line)
    label = re.sub(r"\s+", " ", label).strip(" :-")
    return label or line[:24]


def _assign_paystub_amounts(
    amounts: list[tuple[float, str, float, list[float]]],
    line: str,
    kind: str,
    hours_before_rate: bool = False,
) -> dict[str, tuple[str, float, list[float]]]:
    values = [(value, numeric, box) for _x, value, numeric, box in amounts]
    assigned: dict[str, tuple[str, float, list[float]]] = {}
    if len(values) >= 4:
        if hours_before_rate:
            assigned["hours"] = values[0]
            assigned["rate"] = values[1]
            assigned["current"] = values[2]
            assigned["ytd"] = values[3]
        else:
            assigned["rate"] = values[0]
            assigned["hours"] = values[1]
            assigned["current"] = values[2]
            assigned["ytd"] = values[3]
    elif len(values) == 3 and values[0][1] < 200 and values[1][1] >= 200:
        assigned["rate"] = values[0]
        assigned["current"] = values[1]
        assigned["ytd"] = values[2]
    elif len(values) == 3 and values[0][1] < 200 and values[1][1] < 200:
        if hours_before_rate:
            assigned["hours"] = values[0]
            assigned["rate"] = values[1]
            assigned["current"] = values[2]
        else:
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


def _cluster_visual_word_rows(
    words: list[tuple[float, float, float, float, str]],
) -> list[list[tuple[float, float, float, float, str]]]:
    if not words:
        return []
    rows: list[list[tuple[float, float, float, float, str]]] = []
    for word in sorted(words, key=lambda item: (item[1], item[0])):
        if rows and abs(word[1] - rows[-1][0][1]) <= 4.0:
            rows[-1].append(word)
        else:
            rows.append([word])
    clustered: list[list[tuple[float, float, float, float, str]]] = []
    for row in rows:
        row.sort(key=lambda item: item[0])
        clustered.append(row)
    return clustered


def _join_visual_row(row: list[tuple[float, float, float, float, str]]) -> str:
    return re.sub(r"\s+", " ", " ".join(item[4] for item in row)).strip()


def _paystub_visual_rows(
    page: Any, words: list[dict[str, Any]] | None = None
) -> list[list[tuple[float, float, float, float, str]]]:
    native = list(page.get_text("words") or [])
    if native:
        return _cluster_visual_word_rows(
            [(float(word[0]), float(word[1]), float(word[2]), float(word[3]), str(word[4])) for word in native]
        )
    if words:
        return _cluster_visual_word_rows(
            [
                (float(word["x0"]), float(word["y0"]), float(word["x1"]), float(word["y1"]), str(word["text"]))
                for word in words
                if word.get("text")
            ]
        )
    return []


def _paystub_visual_lines(page: Any, words: list[dict[str, Any]] | None = None) -> list[str]:
    """Cluster native or OCR words by Y so cells on one row stay one earning line."""
    return [text for text in (_join_visual_row(row) for row in _paystub_visual_rows(page, words)) if text]


def _paystub_source_lines(page: Any, blob: str, words: list[dict[str, Any]] | None = None) -> list[str]:
    source = [re.sub(r"\s+", " ", line).strip() for line in blob.splitlines() if line.strip()]
    # Pypdf preserves ordered earnings rows for some generated paystubs while
    # PyMuPDF's visual word order separates their columns. Prefer the ordered
    # text only when it contains a dated regular-pay row.
    if any(re.search(r"regular\s+(?:hourly|pay).*\d{1,2}/\d{1,2}/\d{4}", line, re.I) for line in source):
        return source
    visual = _paystub_visual_lines(page, words)
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


def _paystub_header_employer(
    page: Any,
    blob: str,
    words: list[dict[str, Any]] | None = None,
) -> tuple[str, list[float]] | None:
    """Company name is often the first line of an earnings statement, not 'Employer:'."""
    if re.search(r"employer(?:['’]s)?(?:\s+name)?\s*[:#]", blob, re.I):
        return None
    for line in _paystub_source_lines(page, blob, words)[:6]:
        if re.search(
            r"earnings statement|pay\s*stub|pay statement|pay advice|payroll|employee|pay period|advice",
            line,
            re.I,
        ):
            continue
        if PRINT_CHROME_LINE.search(line):
            continue
        if re.search(r"\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}", line):
            continue
        cleaned = re.sub(r"\s+", " ", line).strip(" ·-|")
        if 3 <= len(cleaned) <= 80:
            hit = _first_hit(page, (cleaned[:24], cleaned), words)
            box = [float(hit.x0), float(hit.y0), float(hit.x1), float(hit.y1)] if hit is not None else [0.0, 0.0, 12.0, 12.0]
            return cleaned, box
    return None


def _hit_for_paystub_label(
    page: Any,
    pymupdf: Any,
    label: str,
    used: set[tuple[float, float]],
    words: list[dict[str, Any]] | None = None,
):
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
    word_hit = _hit_from_words(words, (label,))
    if word_hit is None:
        return None
    key = (round(float(word_hit.x0), 1), round(float(word_hit.y0), 1))
    if key in used:
        return None
    used.add(key)
    return word_hit


def _ordered_row_hit(
    page: Any,
    pymupdf: Any,
    line: str,
    used_hits: set[tuple[float, float]],
    words: list[dict[str, Any]] | None,
) -> tuple[Any, list[float]]:
    ordered_label = _ordered_paystub_label(line)
    hit = _hit_for_paystub_label(page, pymupdf, ordered_label, used_hits, words) if ordered_label else None
    box = (
        [float(hit.x0), float(hit.y0), float(hit.x1), float(hit.y1)]
        if hit is not None
        else [0.0, 0.0, 12.0, 12.0]
    )
    return hit, box


def _emit_assigned_paystub_slots(
    emit: Any,
    kind: str,
    line: str,
    slots: dict[str, tuple[str, float, list[float]]],
    period_hours: float,
    period_hours_box: list[float] | None,
) -> tuple[float, list[float] | None]:
    if kind == "regular":
        if "rate" in slots and _is_primary_rate_row(line):
            emit("ps-hourly-rate", *slots["rate"])
        if "current" in slots:
            emit("ps-current-base", *slots["current"], accumulate=True)
        if "ytd" in slots:
            emit("ps-base-ytd", *slots["ytd"], accumulate=True)
        if "hours" in slots:
            return period_hours + slots["hours"][1], slots["hours"][2]
        return period_hours, period_hours_box
    source_id = YTD_FIELD_BY_KIND.get(kind)
    if source_id and "ytd" in slots:
        emit(source_id, *slots["ytd"], accumulate=True)
    return period_hours, period_hours_box


def _extract_paystub_table(
    page: Any,
    pymupdf: Any,
    *,
    page_index: int,
    blob: str,
    words: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
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
    hours_before_rate = _paystub_hours_before_rate(blob)
    period_hours = 0.0
    period_hours_box: list[float] | None = None
    hours_match = re.search(r"(\d+(?:\.\d+)?)\s*hr/?\s*wk", blob, re.I)
    if hours_match:
        hours = float(hours_match.group(1))
        hit = _first_hit(page, ("hr/wk", "Hr/Wk", hours_match.group(0)), words)
        box = [float(hit.x0), float(hit.y0), float(hit.x1), float(hit.y1)] if hit is not None else [0.0, 0.0, 12.0, 12.0]
        emit("ps-hours-week", f"{int(hours) if hours.is_integer() else hours}", hours, box)

    header = _paystub_header_employer(page, blob, words)
    if header:
        emit("ps-employer-name", header[0], 0.0, header[1])

    frequency = _paystub_frequency_type(blob)
    if frequency:
        freq_hit = _first_hit(
            page,
            (
                "Pay frequency",
                "Semi-monthly",
                "SemiMonthly",
                "Biweekly",
                "Bi-weekly",
                "Weekly",
                "Monthly",
                "Period Start",
                "Period End",
            ),
            words,
        )
        freq_box = (
            [float(freq_hit.x0), float(freq_hit.y0), float(freq_hit.x1), float(freq_hit.y1)]
            if freq_hit is not None
            else [0.0, 0.0, 12.0, 12.0]
        )
        emit("ps-pay-frequency", frequency, 0.0, freq_box)

    source_lines = _paystub_source_lines(page, blob, words)
    ordered_native_rows = any(_dated_regular_pay_slots(line) for line in source_lines)

    def emit_ordered(source_id: str, numeric: float, hit: Any, label_box: list[float], *, accumulate: bool = False) -> None:
        box = _paystub_value_box(page, pymupdf, hit, numeric, words) if hit is not None else label_box
        if source_id == "ps-hours-week":
            emit(source_id, f"{numeric:.2f}".rstrip("0").rstrip("."), numeric, box)
            return
        emit(source_id, _format_money(numeric), numeric, box, accumulate=accumulate)

    def emit_from_amounts(kind: str, line: str, amounts: list[tuple[float, str, float, list[float]]]) -> None:
        nonlocal period_hours, period_hours_box
        slots = _assign_paystub_amounts(amounts, line, kind, hours_before_rate)
        period_hours, period_hours_box = _emit_assigned_paystub_slots(
            emit, kind, line, slots, period_hours, period_hours_box
        )

    if ordered_native_rows:
        for raw_line in source_lines:
            line = re.sub(r"\s+", " ", raw_line).strip()
            kind = _paystub_row_kind(line)
            if kind is None:
                continue
            if kind == "regular":
                ordered_slots = _dated_regular_pay_slots(line) or _ordered_regular_pay_slots(line)
                if ordered_slots:
                    ordered_hit, label_box = _ordered_row_hit(page, pymupdf, line, used_hits, words)
                    if "rate" in ordered_slots and _is_primary_rate_row(line):
                        emit_ordered("ps-hourly-rate", ordered_slots["rate"], ordered_hit, label_box)
                    if ordered_slots.get("current", 0) > 0:
                        emit_ordered("ps-current-base", ordered_slots["current"], ordered_hit, label_box, accumulate=True)
                    if ordered_slots.get("ytd", 0) > 0:
                        emit_ordered("ps-base-ytd", ordered_slots["ytd"], ordered_hit, label_box, accumulate=True)
                    if "hours" in ordered_slots and "ps-hours-week" not in totals:
                        weekly = _weekly_from_period_hours(ordered_slots["hours"], pays_per_year)
                        if weekly:
                            emit_ordered("ps-hours-week", weekly, ordered_hit, label_box)
                    continue
            if kind in YTD_FIELD_BY_KIND:
                ordered_slots = _ordered_regular_pay_slots(line)
                if ordered_slots.get("ytd", 0) > 0:
                    ordered_hit, label_box = _ordered_row_hit(page, pymupdf, line, used_hits, words)
                    emit_ordered(YTD_FIELD_BY_KIND[kind], ordered_slots["ytd"], ordered_hit, label_box, accumulate=True)
                continue
            label = _paystub_code_label(line)
            hit = _hit_for_paystub_label(page, pymupdf, label, used_hits, words) or _first_hit(
                page, (label, line[:18]), words
            )
            if hit is None:
                continue
            amounts = _row_money_amounts(page, pymupdf, hit, words)
            if amounts:
                emit_from_amounts(kind, line, amounts)
    else:
        visual_rows = _paystub_visual_rows(page, words)
        source = visual_rows or [
            [(0.0, 0.0, 12.0, 12.0, line)]
            for line in source_lines
        ]
        for row in source:
            line = _join_visual_row(row)
            kind = _paystub_row_kind(line)
            if kind is None:
                continue
            amounts = []
            for x0, y0, x1, y1, text in row:
                parsed = _parse_paystub_row_money(text)
                if not parsed:
                    continue
                value, numeric = parsed
                amounts.append((x0, value, numeric, [x0, y0, x1, y1]))
            if not amounts:
                label = _paystub_code_label(line)
                hit = _hit_for_paystub_label(page, pymupdf, label, used_hits, words) or _first_hit(
                    page, (label, line[:18]), words
                )
                if hit is None:
                    continue
                amounts = _row_money_amounts(page, pymupdf, hit, words)
            if amounts:
                emit_from_amounts(kind, line, amounts)

    if "ps-hours-week" not in totals and period_hours and period_hours_box:
        weekly = _weekly_from_period_hours(period_hours, pays_per_year)
        if weekly:
            emit("ps-hours-week", f"{weekly:.2f}".rstrip("0").rstrip("."), weekly, period_hours_box)

    if "ps-base-ytd" not in totals and not re.search(r"\bgross\b", blob, re.I):
        hit = _first_hit(page, ("Year to date", "Year-to-date"), words)
        if hit is not None:
            amounts = _row_money_amounts(page, pymupdf, hit, words)
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


def _paystub_fields_from_parser(
    pdf_bytes: bytes | None, page_index: int
) -> list[dict[str, Any]] | None:
    """Extract a pay stub with the dedicated parser in ``src/paystub``.

    Returns ``None`` when that parser cannot vouch for the page, which hands
    the page back to the legacy table reader. The gate is the parser's own
    reconciliation: it only claims a stub when the earnings lines sum to the
    printed earnings total and the cash lines sum to printed gross pay. A page
    it cannot balance is one where its column grid is wrong, and wrong values
    with confident overlay boxes are worse than no fields at all.
    """
    if not pdf_bytes:
        return None
    try:
        from paystub import income_fields, parse_paystub
    except ImportError:  # pragma: no cover - packaged together in the image
        logger.warning("paystub_parser_unavailable")
        return None

    try:
        result = parse_paystub(pdf_bytes, page_index=page_index)
    except Exception:  # pragma: no cover - never fail a packet on one page
        logger.exception("paystub_parser_failed page=%s", page_index)
        return None

    if not result.lines or not result.reconciliation.balanced:
        logger.info(
            "paystub_parser_declined page=%s lines=%s balanced=%s warnings=%s",
            page_index,
            len(result.lines),
            result.reconciliation.balanced,
            len(result.warnings),
        )
        return None

    fields = income_fields(result)
    if not fields:
        return None

    # Everything the parser could not resolve, plus the notes an underwriter has
    # to act on, rides along on the field records so the console can show them.
    # These were previously computed and discarded, which is how an excluded
    # earning code or a non-recurring leave code reached a decision unseen.
    notes = [{"severity": "warning", "message": text} for text in result.warnings]
    notes += [{"severity": "info", "message": text} for text in result.disclosures]
    if notes:
        for field in fields:
            field["reviewNotes"] = notes

    logger.info(
        "paystub_parser_used page=%s fields=%s notes=%s",
        page_index,
        len(fields),
        len(notes),
    )
    return fields


@dataclass(frozen=True)
class _PersonNameSpec:
    """Where a form prints the person it belongs to, relative to the caption.

    The value band starts ``dx0`` points left of the caption's first word and
    ends ``dx1`` points right of it; ``below`` puts the band under the caption,
    otherwise it runs to the right on the caption's own line.
    """

    spec: FieldSpec
    dx0: float
    dx1: float
    below: bool = True


PERSON_NAME_SPECS: dict[int, _PersonNameSpec] = {
    id(W2_FIELDS): _PersonNameSpec(
        FieldSpec("w2-employee-name", "W-2", "identity", "Box e", "Employee Name", "Box e", ("first name and initial",), "person"),
        dx0=-52.0,
        dx1=240.0,
    ),
    id(PARTNERSHIP_FIELDS): _PersonNameSpec(
        FieldSpec(
            "pt-partner-name",
            "Form 1065",
            "identity",
            "Box F",
            "Partner's Name",
            "Box F",
            ("ZIP code for partner", "for partner entered in E", "Partner's name, address", "Partner’s name, address"),
            "person",
        ),
        dx0=-150.0,
        dx1=125.0,
    ),
    id(SCORP_FIELDS): _PersonNameSpec(
        FieldSpec(
            "scorp-shareholder-name",
            "Form 1120-S",
            "identity",
            "Box F",
            "Shareholder's Name",
            "Box F",
            ("Shareholder’s name, address", "Shareholder's name, address", "Shareholder’s name", "Shareholder's name"),
            "person",
        ),
        dx0=-20.0,
        dx1=250.0,
    ),
    id(SCHEDULE_C_FIELDS): _PersonNameSpec(
        FieldSpec("ent1-proprietor", "Schedule C", "identity", "Name", "Name of Proprietor", "Name", ("Name of proprietor",), "person"),
        dx0=0.0,
        dx1=330.0,
        below=False,
    ),
}

_NOT_A_PERSON = re.compile(
    r"\b(?:name|names|address|city|state|zip|code|partner|partnership|shareholder|corporation|employee|employer|"
    r"instructions?|see|entered|initial|last|first|suff|identifying|number|ssn|tin|social|security|copy|form|"
    r"department|treasury|internal|revenue|service|omb|llc|inc|corp|ltd|lp|llp|trust|estate)\b",
    re.I,
)


def _person_name(raw: str) -> str | None:
    """A person's name from the first line of a name-and-address cell, or None."""
    first = next((line.strip() for line in (raw or "").splitlines() if line.strip()), "")
    first = re.split(r"\d", first, maxsplit=1)[0]
    cleaned = re.sub(r"[^A-Za-z.,'’\- ]+", " ", first)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,;:-.")
    if not cleaned or _NOT_A_PERSON.search(cleaned):
        return None
    tokens = [token for token in re.split(r"[\s,]+", cleaned) if re.search(r"[A-Za-z]{2,}", token)]
    if not 2 <= len(tokens) <= 5:
        return None
    return cleaned


def _top_row_text(words: list[dict[str, Any]], band: list[float]) -> str:
    hits = words_in_box(words, band)
    if not hits:
        return ""
    top = min(float(word["y0"]) for word in hits)
    row = sorted((word for word in hits if float(word["y0"]) - top <= 4.0), key=lambda word: float(word["x0"]))
    return re.sub(r"\s+", " ", " ".join(str(word["text"]) for word in row)).strip()


def _band_text(page: Any, pymupdf: Any, band: list[float], words: list[dict[str, Any]] | None) -> str:
    """Printed text in the band, or every filled widget in it read left to right.

    Words are kept whole when their center is in the band, so a name that
    starts a little left of the caption is not clipped, and first and last
    name cells on one row read as one name.
    """
    rect = pymupdf.Rect(band)
    if words:
        line = _top_row_text(words, band)
        if line:
            return line
    native = [
        {"x0": w[0], "y0": w[1], "x1": w[2], "y1": w[3], "text": w[4]}
        for w in page.get_text("words") or []
    ]
    line = _top_row_text(native, band)
    if line:
        return line
    values: list[tuple[float, str]] = []
    for widget in page.widgets() or []:
        value = str(getattr(widget, "field_value", "") or "").strip()
        if not value or (rect & widget.rect).is_empty:
            continue
        # A widget taller than the band holds name and address; keep its first line.
        values.append((float(widget.rect.x0), value.splitlines()[0].strip()))
    return " ".join(value for _, value in sorted(values))


def _person_name_row(
    page: Any,
    pymupdf: Any,
    person: _PersonNameSpec,
    *,
    page_index: int,
    words: list[dict[str, Any]] | None,
) -> dict[str, Any] | None:
    hit = _first_hit(page, person.spec.labels, words)
    if hit is None:
        return None
    width = _page_width(page)
    x0 = max(8.0, float(hit.x0) + person.dx0)
    x1 = min(width - 8.0, float(hit.x0) + person.dx1)
    below_band = [x0, float(hit.y1) + 1.0, x1, float(hit.y1) + 14.0]
    bands = [below_band]
    if not person.below:
        # Plain "Name of proprietor: ..." layouts put the name on the caption's
        # row; the IRS blank prints it in the entry line under the caption.
        bands.insert(0, [float(hit.x1) + 2.0, float(hit.y0) - 3.0, min(width - 8.0, float(hit.x1) + person.dx1), float(hit.y1) + 3.0])
    name = None
    band = bands[0]
    for band in bands:
        name = _person_name(_band_text(page, pymupdf, band, words))
        if name:
            break
    if not name:
        return None
    return _field_record(
        page=page,
        page_index=page_index,
        spec=person.spec,
        form=person.spec.form,
        entity_id=f"{_form_slug(person.spec.form)}-p{page_index}",
        value=name,
        numeric=0.0,
        used_box=band,
    )


def extract_page_fields(
    page: Any,
    *,
    page_index: int,
    words: list[dict[str, Any]] | None = None,
    text: str | None = None,
    pdf_bytes: bytes | None = None,
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
    # Cells whose caption sits where the IRS blank puts it are read from the
    # template first; the label catalogs below fill whatever that leaves.
    form_key = form_key_for_page(blob)
    if form_key is not None:
        located: set[str] = set()
        extracted.extend(
            extract_business_return_page(
                page, pymupdf, form_key=form_key, page_index=page_index, ocr_words=words, located=located
            )
        )
        seen.update(row["sourceFieldId"] for row in extracted)
        seen.update(located)
    catalogs = list(FORM_CATALOGS)
    for matcher, specs in catalogs:
        w2_from_labels = specs is W2_FIELDS and sum(bool(label.search(blob)) for label in W2_FRONT_LABELS) >= 2
        if not pattern_matches(matcher, blob) and not w2_from_labels:
            continue
        if specs is WVOE_FIELDS:
            if WVOE_NOTICE_PAGE.search(blob):
                break
            # The grid reader resolves every earnings amount against the printed
            # column headings, so it runs before the specs and keeps what it
            # read; the specs then fill the identity fields it does not cover.
            for row in _extract_wvoe_grid(
                page, pymupdf, page_index=page_index, blob=row_blob or blob, words=words
            ):
                if row["sourceFieldId"] in seen:
                    continue
                seen.add(row["sourceFieldId"])
                extracted.append(row)
        if specs is PAYSTUB_FIELDS:
            delegated = _paystub_fields_from_parser(pdf_bytes, page_index)
            if delegated is not None:
                # The dedicated parser reconciled this page, so it owns every
                # pay stub field on it. Letting the label-anchored specs below
                # also fire would reintroduce the values it just replaced.
                extracted.extend(delegated)
                seen.update(row["sourceFieldId"] for row in delegated)
                break
            for row in _extract_paystub_table(
                page, pymupdf, page_index=page_index, blob=row_blob or blob, words=words
            ):
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
        if specs is WVOE_FIELDS:
            derived = _wvoe_months_record(page, page_index, extracted)
            if derived is not None and derived["sourceFieldId"] not in seen:
                seen.add(derived["sourceFieldId"])
                extracted.append(derived)
        person = PERSON_NAME_SPECS.get(id(specs))
        if person and person.spec.source_id not in seen:
            row = _person_name_row(page, pymupdf, person, page_index=page_index, words=words)
            if row is not None:
                seen.add(row["sourceFieldId"])
                extracted.append(row)
        if specs is FORM_8825_FIELDS:
            for row in _extract_8825_columns(page, pymupdf, page_index=page_index, words=words):
                if row["sourceFieldId"] in seen:
                    continue
                seen.add(row["sourceFieldId"])
                extracted.append(row)
        if specs is W2_FIELDS and not _plausible_w2_fields(extracted):
            extracted = [row for row in extracted if row["form"] != "W-2"]
        break

    for matcher, specs in SUPPORTING_CATALOGS:
        if not pattern_matches(matcher, blob):
            continue
        for spec in specs:
            row = _extract_spec(page, pymupdf, spec, page_index=page_index, words=words, blob=blob)
            if row is None or row["sourceFieldId"] in seen:
                continue
            seen.add(row["sourceFieldId"])
            extracted.append(row)
    return extracted


class _PageView:
    """Same PDF page, optionally with an upright rect after a 90/270 OCR rotate."""

    def __init__(self, page: Any, rect: Any):
        self._page = page
        self.rect = rect

    def search_for(self, *args: Any, **kwargs: Any):
        return self._page.search_for(*args, **kwargs)

    def get_text(self, *args: Any, **kwargs: Any):
        return self._page.get_text(*args, **kwargs)

    def widgets(self):
        return self._page.widgets()


def _page_ocr_rotation(page_result: Any) -> int:
    flags = list(getattr(page_result, "flags", None) or [])
    if "ocr_rotated_90" in flags:
        return 90
    if "ocr_rotated_270" in flags:
        return 270
    return 0


def _words_to_upright(
    words: list[dict[str, Any]],
    rotation: int,
    page_width: float,
    page_height: float,
) -> tuple[list[dict[str, Any]], float, float]:
    if not rotation:
        return words, page_width, page_height
    upright_w, upright_h = page_height, page_width
    mapped: list[dict[str, Any]] = []
    for word in words:
        ox0 = float(word["x0"]) / page_width
        oy0 = float(word["y0"]) / page_height
        ox1 = float(word["x1"]) / page_width
        oy1 = float(word["y1"]) / page_height
        orig_w, orig_h = ox1 - ox0, oy1 - oy0
        if rotation == 90:
            ux0, uy0, rel_w, rel_h = 1.0 - oy1, ox0, orig_h, orig_w
        else:
            ux0, uy0, rel_w, rel_h = oy0, 1.0 - ox1, orig_h, orig_w
        mapped.append(
            {
                "text": word["text"],
                "x0": ux0 * upright_w,
                "y0": uy0 * upright_h,
                "x1": (ux0 + rel_w) * upright_w,
                "y1": (uy0 + rel_h) * upright_h,
            }
        )
    return mapped, upright_w, upright_h


def _remap_overlay_box(rel: dict[str, float] | None, rotation: int) -> dict[str, float] | None:
    if not rel or not rotation:
        return rel
    x, y, width, height = float(rel["x"]), float(rel["y"]), float(rel["w"]), float(rel["h"])
    if rotation == 90:
        return {"x": y, "y": 1.0 - x - width, "w": height, "h": width}
    if rotation == 270:
        return {"x": 1.0 - y - height, "y": x, "w": height, "h": width}
    return rel


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
    source_bytes = bytes(pdf_input) if isinstance(pdf_input, (bytes, bytearray)) else None
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
            rotation = 0
            extract_page = page
            if convert_page is not None:
                text = convert_page.text()
                rotation = _page_ocr_rotation(convert_page)
                if rotation and page_words:
                    page_words, upright_w, upright_h = _words_to_upright(
                        page_words, rotation, float(page.rect.width), float(page.rect.height)
                    )
                    extract_page = _PageView(page, pymupdf.Rect(0, 0, upright_w, upright_h))
            # One unreadable page must not cost the packet every other page's
            # fields; the caller drops the whole result on an exception.
            try:
                page_fields = extract_page_fields(
                    extract_page,
                    page_index=index,
                    words=page_words,
                    text=text,
                    pdf_bytes=source_bytes,
                )
            except Exception:
                logger.exception("irs_form_extract_page_failed page=%s", index)
                continue
            if rotation:
                for row in page_fields:
                    row["box"] = _remap_overlay_box(row.get("box"), rotation)
            fields.extend(page_fields)
        fields = _merge_wvoe_pages(fields)
        logger.info("irs_form_extract fields=%s", len(fields))
        return fields
    finally:
        doc.close()
