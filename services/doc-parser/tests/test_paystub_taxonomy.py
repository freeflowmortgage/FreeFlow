"""Classification rules for earnings descriptions."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pytest

from paystub import EarningCategory, classify
from paystub.taxonomy import variable_group


@pytest.mark.parametrize(
    ("description", "expected"),
    [
        # Base pay for hours worked.
        ("Regular Hourly", EarningCategory.BASE_WORKED),
        ("REGULAR", EarningCategory.BASE_WORKED),
        ("Reg Pay", EarningCategory.BASE_WORKED),
        ("Salary", EarningCategory.BASE_WORKED),
        # Paid leave at the base rate.
        ("Sick Pay", EarningCategory.BASE_LEAVE),
        ("PTO Sick", EarningCategory.BASE_LEAVE),
        ("Paid Time Off", EarningCategory.BASE_LEAVE),
        ("Vacation Pay", EarningCategory.BASE_LEAVE),
        ("Holiday Pay", EarningCategory.BASE_LEAVE),
        ("Floating Holiday", EarningCategory.BASE_LEAVE),
        ("My Holiday", EarningCategory.BASE_LEAVE),
        ("MyHoliday", EarningCategory.BASE_LEAVE),
        # Paid time an employer schedules and pays at the base rate.
        ("Jury Duty", EarningCategory.BASE_LEAVE),
        ("Bereavement", EarningCategory.BASE_LEAVE),
        ("Bereavement Pay", EarningCategory.BASE_LEAVE),
        ("Education", EarningCategory.BASE_LEAVE),
        ("Education Pay", EarningCategory.BASE_LEAVE),
        ("Training", EarningCategory.BASE_LEAVE),
        ("Training Time", EarningCategory.BASE_LEAVE),
        ("In-Service Training", EarningCategory.BASE_LEAVE),
        ("Continuing Ed", EarningCategory.BASE_LEAVE),
        ("Orientation", EarningCategory.BASE_LEAVE),
        ("Military Leave", EarningCategory.BASE_LEAVE),
        # Variable pay.
        ("Overtime Premium", EarningCategory.VARIABLE),
        ("Double Time", EarningCategory.VARIABLE),
        ("Annual Bonus", EarningCategory.VARIABLE),
        ("Sales Commission", EarningCategory.VARIABLE),
        ("Incentive Pay", EarningCategory.VARIABLE),
        ("Shift Differential", EarningCategory.VARIABLE),
        ("Night Differential", EarningCategory.VARIABLE),
        ("Weekend Premium", EarningCategory.VARIABLE),
        ("Tips", EarningCategory.VARIABLE),
        ("Gratuity", EarningCategory.VARIABLE),
        ("RSU Vest", EarningCategory.VARIABLE),
        ("Restricted Stock", EarningCategory.VARIABLE),
        # Non-cash lines that sit inside the earnings table.
        ("Basic EE Term Life", EarningCategory.IMPUTED),
        ("Group Term Life", EarningCategory.IMPUTED),
        ("LTD (ER)", EarningCategory.IMPUTED),
        ("STD (ER)", EarningCategory.IMPUTED),
        ("Imputed Income", EarningCategory.IMPUTED),
    ],
)
def test_classifies_known_codes(description: str, expected: EarningCategory) -> None:
    category, _ = classify(description)
    assert category is expected


def test_punctuation_and_spacing_do_not_matter() -> None:
    assert classify("VACATION-PAY")[0] is classify("Vacation Pay")[0]
    assert classify("SickPay")[0] is classify("sick pay")[0]


def test_worked_holiday_is_variable_not_leave() -> None:
    """Ordering matters: a broad 'holiday' rule would swallow this premium."""
    assert classify("Holiday Worked")[0] is EarningCategory.VARIABLE
    assert classify("Holiday Pay")[0] is EarningCategory.BASE_LEAVE


def test_employer_paid_suffix_survives_normalization() -> None:
    """'(ER)' carries the meaning but normalization strips its parentheses."""
    assert classify("LTD (ER)")[0] is EarningCategory.IMPUTED
    assert classify("LTD ( ER )")[0] is EarningCategory.IMPUTED


def test_tuition_reimbursement_is_not_treated_as_base_income() -> None:
    """A reimbursement is not wages, even though education time is base pay."""
    assert classify("Education")[0] is EarningCategory.BASE_LEAVE
    assert classify("Tuition Reimbursement")[0] is EarningCategory.VARIABLE


def test_unrecognized_code_is_not_guessed_into_a_bucket() -> None:
    category, reason = classify("Home Mtg Underwr")
    assert category is EarningCategory.UNKNOWN
    assert "review" in reason


@pytest.mark.parametrize(
    ("description", "group"),
    [
        ("Overtime Premium", "overtime"),
        ("Double Time", "overtime"),
        # Shift differential is premium pay on worked hours, so the income tool
        # reports it inside the overtime box rather than as its own line.
        ("Shift Differential", "overtime"),
        ("Night Differential", "overtime"),
        ("Holiday Worked", "overtime"),
        ("Annual Bonus", "bonus"),
        ("Sales Commission", "commission"),
        ("Tips", "tips"),
        ("RSU Vest", "rsu"),
        ("Relocation", "other"),
    ],
)
def test_variable_lines_report_in_the_right_box(description: str, group: str) -> None:
    _, reason = classify(description)
    assert variable_group(reason) == group


def test_shift_differential_carries_its_own_reason() -> None:
    """The disclosure text keys off this reason, so it must stay distinct."""
    from paystub.taxonomy import SHIFT_DIFFERENTIAL_REASON

    assert classify("Shift Differential")[1] == SHIFT_DIFFERENTIAL_REASON
    assert classify("Overtime Premium")[1] != SHIFT_DIFFERENTIAL_REASON


def test_covid_leave_is_flagged_as_non_recurring() -> None:
    from paystub.taxonomy import NON_RECURRING_REASONS

    category, reason = classify("COVID Limited")
    assert category is EarningCategory.BASE_LEAVE
    assert reason in NON_RECURRING_REASONS
