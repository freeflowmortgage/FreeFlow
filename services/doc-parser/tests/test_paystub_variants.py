"""How far the parser generalizes beyond the layout it was built against.

Each variant changes one thing a different payroll provider would change, and
asserts the totals the stub's own arithmetic requires. A failure here names the
layout that broke rather than reporting a vague accuracy drop.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from decimal import Decimal

import pytest

from paystub import EarningCategory, parse_paystub
from paystub_variants import (
    ADP_STANDARD,
    ALL_VARIANTS,
    GUSTO_NO_YTD,
    LEAVE_CODES,
    RATE_BEFORE_HOURS,
    SALARIED_SEMIMONTHLY,
    WORKDAY_RATE_FIRST,
    build_earnings_on_right_pdf,
)


@pytest.fixture(scope="module", params=ALL_VARIANTS, ids=lambda v: v.name)
def parsed(request: pytest.FixtureRequest):
    return request.param, parse_paystub(request.param.build())


def test_variant_reconciles(parsed) -> None:
    variant, result = parsed
    assert result.reconciliation.balanced is variant.expected["balanced"], result.warnings


def test_variant_totals(parsed) -> None:
    variant, result = parsed
    for attribute, expected in variant.expected.items():
        if attribute in {"balanced", "shift_disclosure"}:
            continue
        assert getattr(result.income, attribute) == expected, attribute


def test_shift_differential_disclosure_presence(parsed) -> None:
    variant, result = parsed
    assert bool(result.disclosures) is variant.expected["shift_disclosure"]


def test_reads_a_layout_with_rate_before_hours() -> None:
    """Column roles come from the header, not from a fixed left-to-right order."""
    result = parse_paystub(RATE_BEFORE_HOURS.build())
    regular = next(l for l in result.lines if l.description == "Regular")
    assert regular.rate == Decimal("30.0000")
    assert regular.hours == Decimal("80")
    assert regular.amount == Decimal("2400.00")


def test_reads_a_stub_with_only_current_and_ytd_columns() -> None:
    """A salaried stub has no hours or rate at all; the rest must still parse."""
    result = parse_paystub(SALARIED_SEMIMONTHLY.build())
    salary = next(l for l in result.lines if l.description == "Salary")
    assert salary.hours is None and salary.rate is None
    assert salary.amount == Decimal("3750.00")
    assert result.income.base_ytd == Decimal("42750.00")


def test_no_hours_means_the_rate_check_is_skipped_not_failed() -> None:
    result = parse_paystub(SALARIED_SEMIMONTHLY.build())
    assert result.reconciliation.rate_lines_checked == 0
    assert "hours x rate" not in " ".join(result.warnings)


def test_education_and_training_count_as_base_income() -> None:
    result = parse_paystub(LEAVE_CODES.build())
    for description in ("Education", "Training", "Jury Duty", "Bereavement"):
        line = next(l for l in result.lines if l.description == description)
        assert line.category is EarningCategory.BASE_LEAVE, description
        assert line.is_base


def test_shift_differential_reports_inside_overtime() -> None:
    result = parse_paystub(LEAVE_CODES.build())
    differential = next(l for l in result.lines if l.description == "Night Differential")
    assert differential.category is EarningCategory.VARIABLE
    assert differential.variable_group == "overtime"
    # 1,300 shift differential, no other overtime code on this stub.
    assert result.income.overtime_ytd == Decimal("1300.00")
    assert result.disclosures == [
        "Shift differential is included in overtime pay. Confirm continuance and "
        "history. (Night Differential, $1,300.00 YTD)"
    ]


def test_adp_and_workday_agree_despite_opposite_column_order() -> None:
    """ADP prints Hours before Rate, Workday prints Rate before Hours."""
    adp = parse_paystub(ADP_STANDARD.build())
    workday = parse_paystub(WORKDAY_RATE_FIRST.build())

    for result in (adp, workday):
        regular = next(l for l in result.lines if l.description == "Regular")
        assert regular.hours == Decimal("80")
        assert regular.rate == Decimal("30.0000")
        assert regular.amount == Decimal("2400.00")
        assert result.income.base_ytd == Decimal("34320.00")


def test_workday_separate_begin_and_end_date_columns() -> None:
    result = parse_paystub(WORKDAY_RATE_FIRST.build())
    regular = next(l for l in result.lines if l.description == "Regular")
    assert regular.dates == "06/05/2023 - 06/18/2023"


def test_a_stub_without_a_ytd_column_is_not_a_reconciliation_failure() -> None:
    """Gusto-style stubs print no YTD column; that is an absent check."""
    result = parse_paystub(GUSTO_NO_YTD.build())

    assert result.reconciliation.has_ytd_column is False
    assert result.reconciliation.has_current_column is True
    assert result.reconciliation.balanced
    assert any("no year-to-date earnings column" in w for w in result.warnings)


def test_earnings_table_on_the_right_is_read_not_the_deductions_table() -> None:
    """The block is located by its banner, not by assuming it is leftmost."""
    result = parse_paystub(build_earnings_on_right_pdf())

    assert [l.description for l in result.lines] == ["Regular", "Vacation"]
    assert result.income.base_ytd == Decimal("34320.00")
    assert result.reconciliation.balanced
    assert result.warnings == []


def test_tips_are_classified_as_variable() -> None:
    result = parse_paystub(LEAVE_CODES.build())
    tips = next(l for l in result.lines if l.description == "Tips")
    assert tips.category is EarningCategory.VARIABLE
    assert result.income.tips_ytd == Decimal("2600.00")


def test_run_rate_drift_is_flagged_against_the_borrowers_own_rate() -> None:
    """Replaces a fixed dollar threshold, which cannot scale across borrowers.

    This borrower now earns $25/hr for 40 hours, implying about $4,333/mo, but
    the 400 year-to-date hours only produced $8,000, an implied $20/hr. That is
    what a mid-year raise looks like, and the underwriter needs to see it
    before averaging the year.
    """
    from paystub_variants import LEAVE_CODES, Variant

    raised = Variant(
        name="run_rate_drift",
        description="year-to-date rate below the current rate, as after a raise",
        columns=LEAVE_CODES.columns,
        rows=[
            ("Regular Hourly", "", {"hours": "40", "rate": "25.0000", "amount": "1,000.00", "ytd_hours": "400", "ytd": "8,000.00"}),
        ],
        footer={"amount": "1,000.00", "ytd": "8,000.00"},
        identity=LEAVE_CODES.identity,
        summary=[
            ("Gross Pay", 230.0, "1,000.00", "8,000.00"),
            ("Pre-Tax Deductions", 320.0, "100.00", "800.00"),
            ("Employee Taxes", 400.0, "95.00", "760.00"),
            ("Post-Tax Deductions", 490.0, "5.00", "40.00"),
            ("Net Pay", 560.0, "800.00", "6,400.00"),
        ],
        expected={},
    )

    result = parse_paystub(raised.build())
    assert result.reconciliation.balanced, result.warnings
    assert any("year-to-date base pay averages" in w for w in result.warnings), result.warnings
    assert any("below" in w for w in result.warnings)


def test_a_consistent_stub_raises_no_run_rate_warning() -> None:
    for variant in (RATE_BEFORE_HOURS, LEAVE_CODES, ADP_STANDARD, WORKDAY_RATE_FIRST):
        result = parse_paystub(variant.build())
        assert not any(
            "year-to-date base pay averages" in w for w in result.warnings
        ), (variant.name, result.warnings)
