"""Geometry helpers that rebuild table structure from token positions."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from decimal import Decimal

import pytest

from paystub.layout import (
    assign_columns,
    cluster_values,
    column_anchors,
    describe,
    is_numeric,
    match_by_right_edge,
    merge_labels,
    parse_decimal,
    split_words,
    tidy_text,
)
from paystub.models import Token


def token(text: str, x0: float, x1: float, y0: float = 0.0, y1: float = 40.0) -> Token:
    return Token(text=text, x0=x0, y0=y0, x1=x1, y1=y1)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("1,663.85", Decimal("1663.85")),
        ("$4,159.65", Decimal("4159.65")),
        ("51.9953", Decimal("51.9953")),
        ("(120.00)", Decimal("-120.00")),
        ("120.00-", Decimal("-120.00")),
        ("0", Decimal("0")),
    ],
)
def test_parse_decimal(text: str, expected: Decimal) -> None:
    assert parse_decimal(text) == expected


@pytest.mark.parametrize("text", ["", "Regular Hourly", "11/20/2022", "-", "n/a"])
def test_parse_decimal_rejects_non_numbers(text: str) -> None:
    assert parse_decimal(text) is None


def test_is_numeric_excludes_dates() -> None:
    assert is_numeric("1,455.89")
    assert not is_numeric("11/27/2022")


def test_split_words_apportions_the_box_by_character_count() -> None:
    """OCR merges adjacent columns; the pieces must land back in their own."""
    merged = token("8 51.9953", x0=1122, x1=1317)
    hours, rate = split_words(merged)

    assert (hours.text, rate.text) == ("8", "51.9953")
    assert hours.x1 < rate.x0
    assert rate.x1 == pytest.approx(1317)
    # The hours piece must stay nearer the hours anchor than the rate anchor.
    assert abs(hours.x1 - 1158) < abs(hours.x1 - 1319)


def test_cluster_values_groups_shared_edges() -> None:
    assert cluster_values([1158.0, 1160.0, 1319.0, 1317.0], tolerance=28.0) == [
        pytest.approx(1159.0),
        pytest.approx(1318.0),
    ]


def test_column_anchors_ignore_synthesized_boxes() -> None:
    """Only single-word tokens define a column; split boxes are approximate."""
    rows = [
        [token("415.97", 1445, 1576), token("2,911.79", 1888, 2048)],
        [token("207.99", 1448, 1578), token("1,455.89", 1888, 2048)],
        [token("32 51.9953", 1100, 1317)],
    ]
    assert column_anchors(rows) == [pytest.approx(1577.0), pytest.approx(2048.0)]


def test_assign_columns_routes_cells_and_keeps_text() -> None:
    anchors = [1158.0, 1319.0, 1578.0, 1795.0, 2048.0]
    row = [
        token("Holiday Pay", 199, 416),
        token("11/20/2022 - 11/26/2022", 536, 954),
        token("8", 1122, 1144),
        token("51.9953", 1165, 1317),
        token("415.97", 1445, 1576),
        token("56", 1738, 1795),
        token("2,911.79", 1888, 2048),
    ]
    cells, leftovers = assign_columns(row, anchors)

    assert [cells[i].text for i in sorted(cells)] == [
        "8",
        "51.9953",
        "415.97",
        "56",
        "2,911.79",
    ]
    assert [t.text for t in leftovers] == ["Holiday Pay", "11/20/2022 - 11/26/2022"]


def test_describe_separates_a_run_together_description_and_dates() -> None:
    description, dates = describe([token("Basic EE Term Life:11/20/2022 - 12/03/2022", 199, 954)])
    assert description == "Basic EE Term Life"
    assert dates == "11/20/2022 - 12/03/2022"


def test_describe_tolerates_a_missing_separator() -> None:
    """OCR frequently loses the thin hyphen between two dates."""
    description, dates = describe([token("Regular Hourly 06/12/2023 06/18/2023", 199, 954)])
    assert description == "Regular Hourly"
    assert dates == "06/12/2023 - 06/18/2023"


def test_match_by_right_edge_handles_a_short_label_over_a_long_value() -> None:
    """'Net Pay' starts to the right of its own value, so bands misattribute it."""
    labels = [token("Post-Tax Deductions", 2391, 2900), token("Net Pay", 3055, 3155)]
    values = [token("179.73", 2621, 2900), token("2,411.07", 3041, 3155)]

    matched = match_by_right_edge(labels, values)
    assert matched["Post-Tax Deductions"].text == "179.73"
    assert matched["Net Pay"].text == "2,411.07"


def test_merge_labels_joins_split_words() -> None:
    row = [token("Pay", 1873, 1950), token("Period", 1960, 2100), token("Begin", 2110, 2250)]
    merged = merge_labels(row, {"payperiodbegin"})

    assert len(merged) == 1
    assert merged[0].text == "Pay Period Begin"
    assert (merged[0].x0, merged[0].x1) == (1873, 2250)


def test_merge_labels_splits_a_welded_header() -> None:
    """OCR returns dense headers as one box; each label needs its own bounds."""
    row = [token("Pay Period Begin Pay Period End Check Date", 1992, 3019)]
    merged = merge_labels(row, {"payperiodbegin", "payperiodend", "checkdate"})

    assert [t.text for t in merged] == [
        "Pay Period Begin",
        "Pay Period End",
        "Check Date",
    ]
    assert merged[0].x1 <= merged[1].x0 and merged[1].x1 <= merged[2].x0


def test_merge_labels_leaves_unrelated_tokens_alone() -> None:
    row = [token("Name", 193, 321), token("Company", 797, 1003)]
    assert [t.text for t in merge_labels(row, {"name", "company"})] == ["Name", "Company"]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("SickPay", "Sick Pay"),
        ("MyHoliday", "My Holiday"),
        ("BasicEETermLife", "Basic EE Term Life"),
        ("NathanJenson", "Nathan Jenson"),
        ("Regular Hourly", "Regular Hourly"),
        ("LTD (ER)", "LTD (ER)"),
        ("US Bank National Assoc", "US Bank National Assoc"),
    ],
)
def test_tidy_text_restores_dropped_spaces(raw: str, expected: str) -> None:
    assert tidy_text(raw) == expected
