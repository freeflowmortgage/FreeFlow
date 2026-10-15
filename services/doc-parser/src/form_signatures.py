"""Shared form-title and W-2 front/back signatures for split and extract."""

from __future__ import annotations

import re

W2_TITLE_PATTERN = r"Wage and Tax Statement|Form\s+W-2"
# Every phrase is its own top-level alternative. Written as one group,
# "Year to Date (?:Gross|Earnings)", ocr_match.fold_alternatives reduced the
# alternation to a gap and left the bare needle "yeartodate", so any page
# carrying that phrase read as a pay stub. A Form 1005 prints it as a column
# heading over its gross earnings grid, which handed every WVOE to this catalog.
#
# The pay period dates and the earnings table header carry the weight that the
# over-broad needle used to: a stub states the span it covers and prices a row
# by hours and rate, and no verification of employment does either.
PAYSTUB_TITLE_PATTERN = (
    r"Earnings Statement|Pay\s*Stub|Paystub|Payroll Statement|Pay\s+Statement|Pay\s+Advice|"
    r"Year[- ]to[- ]Date\s+Gross|Year[- ]to[- ]Date\s+Earnings|Current Period|Net Pay|"
    r"Period\s+Start|Period\s+End|Period\s+Beginning|Period\s+Ending|Pay\s+Period\s+Begin|"
    r"Hours\s+Rate\s+Current"
)
# A verification rarely arrives on Form 1005 itself. The Work Number and
# Truework issue their own reports carrying the same figures, and neither
# prints the phrase "Verification of Employment" anywhere on the page.
# Spelled out rather than grouped: an optional group survives folding as a
# required literal, so "Verification of Employment(?: and Income)?" would only
# have matched a page that said "and Income".
WVOE_TITLE_PATTERN = (
    r"Written Verification of Employment|"
    r"Verification of Income and Employment|Verification of Employment and Income|"
    r"Verification of Employment|Verification of Income|"
    r"The Work Number|Truework|\bWVOE\b|"
    r"Employment Data Report|Employment and Income Verification|Income Verification Report"
)

# Header and footer a browser adds when printing a page or image to PDF:
# "9/18/26, 5:48 PM", "download (615×498)", "file:///C:/…". Never a company name.
PRINT_CHROME_LINE = re.compile(
    r"^\s*\d{1,2}/\d{1,2}/\d{2,4},?\s*\d{1,2}:\d{2}|\b(?:file|https?|about|blob):/|\(\s*\d{2,5}\s*[×x]\s*\d{2,5}\s*\)",
    re.IGNORECASE,
)

# The page of FCRA disclosure a vendor closes its report with. It states no
# verified fact, so running a field catalog over it can only produce a clause
# of the notice read as a field value.
WVOE_NOTICE_PAGE = re.compile(
    r"NOTICE:\s*INFORMATION CONTAINED IN|NOTICE TO USERS OF CONSUMER REPORTS"
    r"|FAIR CREDIT REPORTING ACT|permissible purpose for which this consumer report",
    re.IGNORECASE,
)

W2_TITLE = re.compile(W2_TITLE_PATTERN, re.IGNORECASE)
PAYSTUB_TITLE = re.compile(PAYSTUB_TITLE_PATTERN, re.IGNORECASE)
WVOE_TITLE = re.compile(WVOE_TITLE_PATTERN, re.IGNORECASE)

W2_FRONT_SIGNATURE = re.compile(
    r"\b(?:Box\s*[1-6]|Wages[,\s]+tips|Medicare\s+wages|Social\s+security\s+wages|Federal\s+income\s+tax)\b",
    re.IGNORECASE,
)
W2_FRONT_LABELS = (
    re.compile(r"Wages[,\s]+tips", re.IGNORECASE),
    re.compile(r"Medicare\s+wages", re.IGNORECASE),
    re.compile(r"Social\s+security\s+wages", re.IGNORECASE),
    re.compile(r"Federal\s+income\s+tax", re.IGNORECASE),
)
W2_BACK_SIGNATURE = re.compile(
    r"\b(?:Instructions\s+for\s+(?:Employee|Employer)|"
    r"For\s+use\s+in\s+preparing\s+your\s+income\s+tax\s+return)\b",
    re.IGNORECASE,
)
W2_FRONT_FOLDED = (
    "medicarewages",
    "socialsecuritywages",
    "wagestips",
    "federalincometax",
    "wageandtaxstatement",
)
W2_BACK_FOLDED = (
    "instructionsforemployee",
    "instructionsforemployer",
    "noticetoemployee",
    "foruseinpreparingyourincometaxreturn",
)
