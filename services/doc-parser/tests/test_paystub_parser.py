"""End-to-end parsing of a synthetic stub through both extraction paths.

Every case runs twice: once against a PDF with a real text layer, and once
against the same stub flattened to pixels so the OCR path handles it. The two
must agree, because a stub that arrives scanned has to underwrite the same as
one that arrives digital.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import os
from decimal import Decimal

import pytest

from paystub_fixtures import EXPECTED, build_paystub_pdf, build_scanned_paystub_pdf
from paystub import EarningCategory, PaystubResult, parse_paystub


@pytest.fixture(scope="module")
def digital() -> PaystubResult:
    return parse_paystub(build_paystub_pdf())


@pytest.fixture(scope="module")
def scanned() -> PaystubResult:
    return parse_paystub(build_scanned_paystub_pdf())


@pytest.fixture(params=["digital", "scanned"])
def result(request: pytest.FixtureRequest) -> PaystubResult:
    return request.getfixturevalue(request.param)


def line(result: PaystubResult, description: str, index: int = 0):
    matches = [l for l in result.lines if l.description == description]
    assert matches, f"{description!r} not parsed; got {[l.description for l in result.lines]}"
    return matches[index]


def test_extraction_path_is_chosen_per_document(
    digital: PaystubResult, scanned: PaystubResult
) -> None:
    assert digital.text_source == "text"
    assert scanned.text_source == "ocr"


def test_identity(result: PaystubResult) -> None:
    assert result.identity.employer == EXPECTED["employer"]
    assert result.identity.employee == EXPECTED["employee"]
    assert result.identity.employee_id == EXPECTED["employee_id"]
    assert result.identity.period_begin == EXPECTED["period_begin"]
    assert result.identity.period_end == EXPECTED["period_end"]
    assert result.identity.check_date == EXPECTED["check_date"]
    assert result.identity.check_number is None


def test_summary_totals(result: PaystubResult) -> None:
    assert result.totals.gross_current == EXPECTED["gross_current"]
    assert result.totals.gross_ytd == EXPECTED["gross_ytd"]
    assert result.totals.net_current == EXPECTED["net_current"]
    assert result.totals.net_ytd == EXPECTED["net_ytd"]


def test_every_earnings_line_is_recovered(result: PaystubResult) -> None:
    assert len(result.lines) == 7


def test_hours_rate_and_amount(result: PaystubResult) -> None:
    regular = line(result, "Regular Hourly")
    assert regular.hours == Decimal("40")
    assert regular.rate == Decimal("32.5000")
    assert regular.amount == Decimal("1300.00")
    assert regular.ytd_hours == Decimal("800")
    assert regular.ytd_amount == Decimal("26000.00")
    assert regular.dates == "06/05/2023 - 06/11/2023"


def test_description_and_dates_split_when_run_together(result: PaystubResult) -> None:
    imputed = line(result, "Group Term Life")
    assert imputed.dates == "06/05/2023 - 06/18/2023"
    assert imputed.category is EarningCategory.IMPUTED


def test_repeated_code_keeps_its_own_row(result: PaystubResult) -> None:
    """Keying totals by description would drop one of these two segments."""
    segments = [l for l in result.lines if l.description == "Regular Hourly"]
    assert len(segments) == 2
    assert [s.hours for s in segments] == [Decimal("40"), Decimal("24")]
    # Only the first segment carries a YTD balance on this stub.
    assert segments[1].ytd_amount is None


def test_categories(result: PaystubResult) -> None:
    assert line(result, "Bonus").category is EarningCategory.VARIABLE
    assert line(result, "Overtime").category is EarningCategory.VARIABLE
    assert line(result, "Sick Pay").category is EarningCategory.BASE_LEAVE
    assert line(result, "Vacation Pay").category is EarningCategory.BASE_LEAVE
    assert line(result, "Regular Hourly").category is EarningCategory.BASE_WORKED


def test_base_ytd_totals(result: PaystubResult) -> None:
    income = result.income
    assert income.base_worked_ytd == EXPECTED["base_worked_ytd"]
    assert income.base_leave_ytd == EXPECTED["base_leave_ytd"]
    assert income.base_ytd == EXPECTED["base_ytd"]
    assert income.base_ytd_hours == EXPECTED["base_ytd_hours"]


def test_variable_and_imputed_are_kept_out_of_base(result: PaystubResult) -> None:
    assert result.income.variable_ytd == EXPECTED["variable_ytd"]
    assert result.income.imputed_ytd == EXPECTED["imputed_ytd"]
    assert result.income.unknown_ytd == Decimal("0.00")


def test_imputed_income_is_excluded_from_gross(result: PaystubResult) -> None:
    """Group term life prints in the earnings table but is not a wage."""
    reconciliation = result.reconciliation
    assert reconciliation.line_sum_ytd == EXPECTED["footer_ytd"]
    assert reconciliation.cash_sum_ytd == EXPECTED["gross_ytd"]
    assert (
        reconciliation.line_sum_ytd - reconciliation.cash_sum_ytd
        == EXPECTED["imputed_ytd"]
    )


def test_reconciliation_balances(result: PaystubResult) -> None:
    reconciliation = result.reconciliation
    assert reconciliation.earnings_footer_current == EXPECTED["footer_current"]
    assert reconciliation.earnings_footer_ytd == EXPECTED["footer_ytd"]
    assert reconciliation.footer_matches_lines
    assert reconciliation.gross_matches_cash
    assert reconciliation.rate_check_passed
    assert reconciliation.balanced


def test_rate_and_pay_frequency(result: PaystubResult) -> None:
    income = result.income
    assert income.hourly_rate == EXPECTED["hourly_rate"]
    assert income.hours_per_period == EXPECTED["hours_per_period"]
    assert income.pay_frequency == "biweekly"
    assert income.periods_per_year == 26
    assert income.periods_elapsed == EXPECTED["periods_elapsed"]


def test_monthly_income(result: PaystubResult) -> None:
    income = result.income
    assert income.monthly_base_at_current_rate == EXPECTED["monthly_base_at_current_rate"]
    assert income.monthly_base_ytd_average == EXPECTED["monthly_base_ytd_average"]


def test_a_clean_stub_raises_nothing_for_review(result: PaystubResult) -> None:
    assert result.warnings == []
    assert not result.needs_review


def test_corrupt_input_is_reported_not_raised() -> None:
    result = parse_paystub(b"%PDF-1.4 truncated garbage")
    assert result.warnings
    assert result.lines == []


@pytest.mark.skipif(
    not os.environ.get("PAYSTUB_FIXTURE"),
    reason="set PAYSTUB_FIXTURE to a local stub path to check a real document",
)
def test_real_document_reconciles() -> None:
    """Opt-in check against a real stub.

    Points at a path outside the repository on purpose. Real payroll documents
    are never committed, so this stays skipped in CI and is run by hand when
    someone wants to verify a new payroll provider's layout.
    """
    with open(os.environ["PAYSTUB_FIXTURE"], "rb") as handle:
        result = parse_paystub(handle.read())

    assert result.lines
    assert result.reconciliation.balanced
    assert result.income.base_ytd > 0
