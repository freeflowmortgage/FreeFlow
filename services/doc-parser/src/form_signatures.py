"""Shared form-title and W-2 front/back signatures for split and extract."""

from __future__ import annotations

import re

W2_TITLE_PATTERN = r"Wage and Tax Statement|Form\s+W-2"
PAYSTUB_TITLE_PATTERN = (
    r"Earnings Statement|Pay\s*Stub|Paystub|Payroll Statement|Pay\s+Statement|Pay\s+Advice|"
    r"Year[- ]to[- ]Date\s+(?:Gross|Earnings)|Current Period|Net Pay"
)
WVOE_TITLE_PATTERN = (
    r"Written Verification of Employment|Verification of Employment|The Work Number|\bWVOE\b"
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
