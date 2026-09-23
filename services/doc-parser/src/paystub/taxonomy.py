"""Classify earnings descriptions into base, variable, and imputed pay.

Matching is done on a normalized description (lowercased, punctuation and
spaces removed) so that ``My Holiday``, ``MyHoliday``, and ``MY-HOLIDAY`` all
land on the same rule. Rules are ordered: the first match wins, so narrow
patterns must precede broad ones. ``Holiday Worked`` has to be tested before
``Holiday`` or worked-holiday premium would be miscounted as leave.

A description that matches nothing is deliberately left ``UNKNOWN`` rather
than guessed into a bucket. Employer-specific codes are common and silently
folding one into base income overstates qualifying income.
"""

from __future__ import annotations

import re

from .models import EarningCategory

_NORMALIZE = re.compile(r"[^a-z0-9]+")

SHIFT_DIFFERENTIAL_REASON = "shift differential, reported within overtime"

SHIFT_DIFFERENTIAL_DISCLOSURE = (
    "Shift differential is included in overtime pay. Confirm continuance and history."
)


def normalize(description: str) -> str:
    return _NORMALIZE.sub("", description.lower())


# Tested against the raw description, because normalization strips the
# parentheses that carry the meaning. "(ER)" marks an employer-paid line;
# its "(EE)" counterpart is an employee deduction, not an earning.
_RAW_RULES: tuple[tuple[str, EarningCategory, str], ...] = (
    (r"\(\s*er\s*\)", EarningCategory.IMPUTED, "employer-paid benefit"),
)

# (pattern, category, reason). Patterns match against the normalized string.
_RULES: tuple[tuple[str, EarningCategory, str], ...] = (
    # Non-cash lines. These sit inside the earnings table on many stubs but are
    # excluded from gross pay, so they must be caught before a base rule claims
    # them.
    (r"termlife|grouptermlife|^gtl|imputed|taxablefringe|fringebenefit",
     EarningCategory.IMPUTED, "non-cash imputed income"),
    (r"employerpaid|ercontrib|erpaid", EarningCategory.IMPUTED, "employer-paid benefit"),

    # Variable pay. Overtime and premium multipliers first.
    (r"doubletime|dbltime|^dt$", EarningCategory.VARIABLE, "double time"),
    (r"overtime|^ot$|otprem|otpay", EarningCategory.VARIABLE, "overtime"),
    (r"holidayworked|workedholiday", EarningCategory.VARIABLE, "worked-holiday premium"),
    (r"bonus|award|spiff|incentive|refer(r)?al", EarningCategory.VARIABLE, "bonus or incentive"),
    (r"commission|^comm$", EarningCategory.VARIABLE, "commission"),
    (r"^tip|tips|gratuity|servicecharge", EarningCategory.VARIABLE, "tips"),
    (r"^rsu|restrictedstock|stockunit|stockaward|equityaward",
     EarningCategory.VARIABLE, "stock award"),
    (r"shiftdiff|shiftprem|nightdiff|nightprem|weekenddiff|weekendprem|differential",
     EarningCategory.VARIABLE, SHIFT_DIFFERENTIAL_REASON),
    (r"oncall|callback|callin|standby", EarningCategory.VARIABLE, "on-call or call-back pay"),
    (r"retro|severance|relocation|expense|reimburse",
     EarningCategory.VARIABLE, "non-recurring payment"),

    # Base pay for hours actually worked.
    (r"regularhourly|regularpay|^regular$|^reghourly$|^regpay$|^reg$",
     EarningCategory.BASE_WORKED, "regular hours worked"),
    (r"^salary|salaried|baseppay|^basepay$|^hourly$|hourlypay",
     EarningCategory.BASE_WORKED, "base salary or hourly"),

    # Paid leave drawn at the base rate.
    (r"vacation|^vac$|annualleave", EarningCategory.BASE_LEAVE, "vacation"),
    (r"ptosick|sickpay|sickleave|^sick|paidsick", EarningCategory.BASE_LEAVE, "sick pay"),
    (r"paidtimeoff|^pto", EarningCategory.BASE_LEAVE, "paid time off"),
    (r"floatingholiday|myholiday|holidaypay|^holiday", EarningCategory.BASE_LEAVE, "holiday"),
    (r"bereavement|funeral|juryduty|^jury|^witness", EarningCategory.BASE_LEAVE,
     "bereavement or jury duty leave"),
    # Education and training hours are scheduled by the employer and paid at
    # the base rate, so they belong in base pay rather than sitting
    # unclassified. Deliberately excludes "tuition", which is nearly always a
    # reimbursement rather than wages, and is caught by the reimbursement rule
    # above before reaching here.
    (r"education|^school|training|inservice|^cme$|continuinged|orientation",
     EarningCategory.BASE_LEAVE, "education or training time"),
    (r"military|^userra", EarningCategory.BASE_LEAVE, "military leave"),
    (r"covid|pandemic|emergencyleave|eppl", EarningCategory.BASE_LEAVE,
     "COVID/emergency paid leave (non-recurring, confirm before using)"),
    (r"parentalleave|maternity|paternity|fmla", EarningCategory.BASE_LEAVE,
     "parental leave (confirm continuance)"),
)

_COMPILED_RAW = tuple((re.compile(p, re.IGNORECASE), c, r) for p, c, r in _RAW_RULES)
_COMPILED = tuple((re.compile(p), c, r) for p, c, r in _RULES)

NON_RECURRING_REASONS = frozenset({
    "COVID/emergency paid leave (non-recurring, confirm before using)",
    "parental leave (confirm continuance)",
})

# Which box on the income tool a variable line belongs in. Shift differential
# is grouped with overtime at the underwriter's request; it is premium pay on
# worked hours, so it behaves like overtime rather than like a bonus.
_VARIABLE_GROUPS = {
    "overtime": "overtime",
    "double time": "overtime",
    "worked-holiday premium": "overtime",
    SHIFT_DIFFERENTIAL_REASON: "overtime",
    "bonus or incentive": "bonus",
    "commission": "commission",
    "tips": "tips",
    "stock award": "rsu",
}

VARIABLE_GROUP_ORDER = ("overtime", "bonus", "commission", "tips", "rsu", "other")


def variable_group(reason: str) -> str:
    """Return the income-tool box a variable line is reported in."""
    return _VARIABLE_GROUPS.get(reason, "other")


def classify(description: str) -> tuple[EarningCategory, str]:
    """Return the category and a human-readable reason for ``description``."""
    key = normalize(description)
    if not key:
        return EarningCategory.UNKNOWN, "empty description"
    for pattern, category, reason in _COMPILED_RAW:
        if pattern.search(description):
            return category, reason
    for pattern, category, reason in _COMPILED:
        if pattern.search(key):
            return category, reason
    return EarningCategory.UNKNOWN, "no taxonomy match; manual review required"
