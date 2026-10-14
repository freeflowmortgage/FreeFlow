"""Verification of employment: Form 1005, The Work Number, and Truework."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from form_signatures import PAYSTUB_TITLE, WVOE_TITLE  # noqa: E402
from irs_form_extract import (  # noqa: E402
    duration_months,
    extract_irs_form_fields,
    normalize_date,
)
from ocr_match import pattern_matches  # noqa: E402
from wvoe_fixtures import form_1005_pdf, truework_pdf, work_number_pdf  # noqa: E402


def _by_id(pdf: bytes) -> dict[str, dict]:
    return {row["sourceFieldId"]: row for row in extract_irs_form_fields(pdf)}


def _amounts(pdf: bytes) -> dict[str, float]:
    return {row["sourceFieldId"]: row.get("numericValue") for row in extract_irs_form_fields(pdf)}


def test_form_1005_reads_the_year_to_date_column_not_the_first_one() -> None:
    amounts = _amounts(form_1005_pdf())
    assert amounts["wvoe-base-ytd"] == 46800.0
    assert amounts["wvoe-base-ytd-prior"] == 62400.0
    assert amounts["wvoe-base-ytd-prior-2"] == 58000.0
    assert amounts["wvoe-ot"] == 4500.0
    assert amounts["wvoe-ot-prior"] == 6000.0
    assert amounts["wvoe-bonus"] == 12000.0
    assert amounts["wvoe-bonus-prior"] == 18000.0
    assert amounts["wvoe-commission"] == 0.0


def test_form_1005_rate_of_pay_is_not_read_as_a_year_to_date_total() -> None:
    """"Base Pay" is printed twice: item 12A and the 12B grid row."""
    fields = _by_id(form_1005_pdf())
    assert fields["wvoe-base"]["numericValue"] == 5200.0
    assert fields["wvoe-base-period"]["value"] == "Monthly"
    assert fields["wvoe-base-ytd"]["numericValue"] == 46800.0
    assert fields["wvoe-hours-week"]["numericValue"] == 40.0


def test_form_1005_derives_months_employed_from_hire_date_and_thru_date() -> None:
    fields = _by_id(form_1005_pdf())
    assert fields["wvoe-hire-date"]["value"] == "03/15/2019"
    assert fields["wvoe-ytd-thru"]["value"] == "09/30/2024"
    assert fields["wvoe-months"]["numericValue"] == 66.0
    assert fields["wvoe-employer-name"]["value"] == "Acme Manufacturing Inc"


def test_work_number_binds_each_year_row_by_its_printed_year() -> None:
    """The summary is transposed and its rows run oldest first in the sample."""
    amounts = _amounts(work_number_pdf())
    assert amounts["wvoe-base-ytd"] == 45040.0
    assert amounts["wvoe-base-ytd-prior"] == 35568.0
    assert amounts["wvoe-base-ytd-prior-2"] == 33789.6
    assert amounts["wvoe-ot"] == 14450.46
    assert amounts["wvoe-ot-prior"] == 13005.41
    assert amounts["wvoe-bonus"] == 400.0
    assert amounts["wvoe-bonus-prior"] == 360.0
    assert amounts["wvoe-ytd-year"] == 2024.0


def test_work_number_other_and_total_columns_never_reach_a_category() -> None:
    amounts = _amounts(work_number_pdf())
    banned = {50.0, 45.0, 40.5, 59940.46, 48978.41, 45858.97}
    assert not banned & {value for key, value in amounts.items() if key.startswith("wvoe-")}


def test_work_number_separates_the_rate_basis_from_the_pay_cycle() -> None:
    """$17.42 Hourly over 86 hours a semi-monthly period, not 86 a week."""
    fields = _by_id(work_number_pdf())
    assert fields["wvoe-base"]["numericValue"] == 17.42
    assert fields["wvoe-base-period"]["value"] == "Hourly"
    assert fields["wvoe-pay-cycle"]["value"] == "Semi Monthly"
    assert fields["wvoe-hours-period"]["numericValue"] == 86.0
    assert "wvoe-hours-week" not in fields
    assert fields["wvoe-months"]["numericValue"] == 103.0


def test_truework_joins_the_employment_page_to_the_income_page() -> None:
    rows = extract_irs_form_fields(truework_pdf())
    entities = {row["entityId"] for row in rows}
    assert entities == {"wvoe-p0"}, entities
    assert {row["pageIndex"] for row in rows} == {0, 1}


def test_truework_reads_its_own_wording_and_column_order() -> None:
    fields = _by_id(truework_pdf())
    assert fields["wvoe-employer-name"]["value"] == "Wall Greens"
    assert fields["wvoe-hire-date"]["value"] == "05/25/2018"
    assert fields["wvoe-ytd-thru"]["value"] == "03/04/2023"
    assert fields["wvoe-months"]["numericValue"] == 33.0
    assert fields["wvoe-base"]["numericValue"] == 45.0
    assert fields["wvoe-base-period"]["value"] == "Hourly"
    assert fields["wvoe-pay-cycle"]["value"] == "Monthly"
    # "Average Hours Worked Per Week: N/A" leaves the hourly rate unusable,
    # which the engine reports as a gap rather than a number.
    assert "wvoe-hours-week" not in fields
    assert fields["wvoe-base-ytd"]["numericValue"] == 12300.0
    assert fields["wvoe-base-ytd-prior"]["numericValue"] == 24600.0
    assert fields["wvoe-ot"]["numericValue"] == 900.0
    assert fields["wvoe-bonus"]["numericValue"] == 1500.0
    # "Commision" is Truework's own spelling.
    assert fields["wvoe-commission"]["numericValue"] == 0.0
    assert fields["wvoe-ytd-year"]["numericValue"] == 2020.0


def test_truework_other_and_total_rows_are_left_alone() -> None:
    amounts = set(_amounts(truework_pdf()).values())
    assert 152.25 not in amounts
    assert 14852.25 not in amounts


def test_every_verification_page_classifies_as_wvoe_not_as_a_pay_stub() -> None:
    for blob in (
        "Request for Verification of Employment 12B. Gross Earnings Year To Date",
        "The Work Number Verification of Income (VOI) Annual Income Summary",
        "truework Verification of Income and Employment Current Gross Pay",
        "Walgreens | Verification of Income",
    ):
        assert pattern_matches(WVOE_TITLE, blob), blob


def test_a_pay_stub_is_still_recognised_without_the_year_to_date_catch_all() -> None:
    """The needle that used to carry these also swallowed every Form 1005."""
    for blob in (
        "BANNER HEALTH Period Start 11/13/2022 Period End 11/26/2022 Earnings Hours Rate Current",
        "Earnings Statement Net Pay",
        "Pay Period Beginning 01/01/2024",
    ):
        assert pattern_matches(PAYSTUB_TITLE, blob), blob
    assert not pattern_matches(PAYSTUB_TITLE, "12B. Gross Earnings Year To Date Past Year Past Year")


def test_the_disclosure_page_states_no_fields() -> None:
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((60, 60), "THE WORK NUMBER VERIFICATION OF EMPLOYMENT", fontsize=9)
    page.insert_text((60, 90), "NOTICE: INFORMATION CONTAINED IN THE WORK NUMBER VERIFICATIONS", fontsize=8)
    page.insert_text((60, 104), "SECTION OF THIS REPORT IS CONSUMER REPORT INFORMATION.", fontsize=8)
    page.insert_text((60, 130), "Employers: workforce@equifax.com - workforce.equifax.com", fontsize=8)
    data = doc.tobytes()
    doc.close()
    assert extract_irs_form_fields(data) == []


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("03/15/2019", "03/15/2019"),
        ("3/5/19", "03/05/2019"),
        ("2024-09-30", "09/30/2024"),
        ("March 4, 2023", "03/04/2023"),
        ("May, 25 2018", "05/25/2018"),
        ("Sept. 1, 2021", "09/01/2021"),
        ("20XX", None),
        ("13/45/2019", None),
    ],
)
def test_one_spelling_for_every_date_a_vendor_prints(raw: str, expected: str | None) -> None:
    assert normalize_date(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("8 Yrs 7 Months", 103), ("2 Years, 9 Months", 33), ("11 Mos", 11), ("Data not provided", None)],
)
def test_tenure_is_read_from_the_duration_both_vendors_print(raw: str, expected: int | None) -> None:
    assert duration_months(raw) == expected
