"""Alternate pay stub layouts, for measuring how far the parser generalizes.

The reference stub this parser was built against is one payroll provider's
format. These variants change the things that differ between providers, one
axis at a time, so a regression shows up as a specific broken layout rather
than a vague loss of accuracy:

* column count and order (``Rate`` before ``Hours``; no hours/rate at all);
* column wording (``This Period`` instead of ``Amount``, bare ``YTD``);
* pay frequency (weekly, semi-monthly) and salaried versus hourly;
* earning codes that exercise the taxonomy (shift differential, education,
  training, jury duty, bereavement, commission, tips).

Each variant carries the totals it should produce, so a test asserts against
arithmetic rather than against whatever the parser happens to return.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from decimal import Decimal

from paystub_fixtures import CHAR_WIDTH, _Content, _assemble


class Variant:
    def __init__(
        self,
        name: str,
        description: str,
        columns: list[tuple[str, str, float]],
        rows: list[tuple[str, str, dict[str, str]]],
        footer: dict[str, str],
        identity: dict[str, str],
        summary: list[tuple[str, float, str, str]],
        expected: dict[str, object],
        date_columns: list[tuple[str, float]] | None = None,
    ) -> None:
        self.name = name
        self.description = description
        self.columns = columns
        self.rows = rows
        self.footer = footer
        self.identity = identity
        self.summary = summary
        self.expected = expected
        # Workday prints Begin Date and End Date as two separate columns where
        # ADP prints one Dates column, so the count is configurable.
        self.date_columns = date_columns or [("Dates", 140.0)]

    def build(self) -> bytes:
        content = _Content()

        labels = [
            ("Name", 40.0),
            ("Company", 150.0),
            ("Employee ID", 290.0),
            ("Pay Period Begin", 360.0),
            ("Pay Period End", 435.0),
            ("Check Date", 500.0),
            ("Check Number", 560.0),
        ]
        for text, x in labels:
            content.left(text, x, 60)
        for key, x in [
            ("employee", 40.0),
            ("employer", 150.0),
            ("employee_id", 290.0),
            ("period_begin", 360.0),
            ("period_end", 435.0),
            ("check_date", 500.0),
        ]:
            content.left(self.identity[key], x, 74)

        for label, right_edge, current, ytd in self.summary:
            content.right(label, right_edge, 100)
            content.right(current, right_edge, 114)
            content.right(ytd, right_edge, 128)
        content.left("Current", 40.0, 114)
        content.left("YTD", 40.0, 128)

        content.left("Earnings", 180.0, 150)
        content.left("Employee Taxes", 480.0, 150)

        header_y = 164.0
        content.left("Description", 40.0, header_y)
        for heading, x in self.date_columns:
            content.left(heading, x, header_y)
        for _, heading, right_edge in self.columns:
            content.right(heading, right_edge, header_y)
        content.left("Description", 560.0, header_y)

        row_y = header_y + 14
        for label, dates, cells in self.rows:
            content.left(label, 40.0, row_y)
            for index, (_, x) in enumerate(self.date_columns):
                parts = dates.split("|")
                if index < len(parts) and parts[index]:
                    content.left(parts[index], x, row_y)
            for key, _, right_edge in self.columns:
                content.right(cells.get(key, ""), right_edge, row_y)
            row_y += 14

        content.left("Earnings", 40.0, row_y)
        for key, _, right_edge in self.columns:
            content.right(self.footer.get(key, ""), right_edge, row_y)

        return _assemble(content.render())


_IDENTITY = {
    "employee": "Dana Rivera",
    "employer": "Contoso Freight Inc",
    "employee_id": "991244",
    "period_begin": "06/05/2023",
    "period_end": "06/18/2023",
    "check_date": "06/23/2023",
}


RATE_BEFORE_HOURS = Variant(
    name="rate_before_hours",
    description="Rate printed before Hours, and 'This Period' instead of 'Amount'",
    columns=[
        ("rate", "Rate", 300.0),
        ("hours", "Hours", 360.0),
        ("amount", "This Period", 440.0),
        ("ytd", "Year to Date", 545.0),
    ],
    rows=[
        ("Regular", "", {"rate": "30.0000", "hours": "80", "amount": "2,400.00", "ytd": "31,200.00"}),
        ("Overtime", "", {"rate": "45.0000", "hours": "4", "amount": "180.00", "ytd": "2,340.00"}),
        ("Shift Differential", "", {"amount": "96.00", "ytd": "1,248.00"}),
        ("Vacation", "", {"rate": "30.0000", "hours": "8", "amount": "240.00", "ytd": "3,120.00"}),
    ],
    footer={"amount": "2,916.00", "ytd": "37,908.00"},
    identity=_IDENTITY,
    summary=[
        ("Gross Pay", 230.0, "2,916.00", "37,908.00"),
        ("Pre-Tax Deductions", 320.0, "300.00", "3,900.00"),
        ("Employee Taxes", 400.0, "260.00", "3,380.00"),
        ("Post-Tax Deductions", 490.0, "20.00", "260.00"),
        ("Net Pay", 560.0, "2,336.00", "30,368.00"),
    ],
    expected={
        "base_ytd": Decimal("34320.00"),      # regular 31,200 + vacation 3,120
        "overtime_ytd": Decimal("3588.00"),   # overtime 2,340 + shift diff 1,248
        "hourly_rate": Decimal("30.0000"),
        "balanced": True,
        "shift_disclosure": True,
    },
)


SALARIED_SEMIMONTHLY = Variant(
    name="salaried_semimonthly",
    description="Salaried semi-monthly stub with no Hours or Rate columns",
    columns=[
        ("amount", "Current", 420.0),
        ("ytd", "YTD", 545.0),
    ],
    rows=[
        ("Salary", "", {"amount": "3,750.00", "ytd": "41,250.00"}),
        ("Holiday", "", {"amount": "0.00", "ytd": "1,500.00"}),
        ("Bonus", "", {"ytd": "6,000.00"}),
        ("Commission", "", {"ytd": "9,000.00"}),
        ("Group Term Life", "", {"amount": "4.00", "ytd": "44.00"}),
    ],
    footer={"amount": "3,754.00", "ytd": "57,794.00"},
    identity={**_IDENTITY, "period_begin": "06/01/2023", "period_end": "06/15/2023"},
    summary=[
        ("Gross Pay", 230.0, "3,750.00", "57,750.00"),
        ("Pre-Tax Deductions", 320.0, "400.00", "4,400.00"),
        ("Employee Taxes", 400.0, "330.00", "5,100.00"),
        ("Post-Tax Deductions", 490.0, "25.00", "275.00"),
        ("Net Pay", 560.0, "2,995.00", "47,975.00"),
    ],
    expected={
        "base_ytd": Decimal("42750.00"),      # salary 41,250 + holiday 1,500
        "bonus_ytd": Decimal("6000.00"),
        "commission_ytd": Decimal("9000.00"),
        "imputed_ytd": Decimal("44.00"),
        "pay_frequency": "semimonthly",
        "balanced": True,
        "shift_disclosure": False,
    },
)


LEAVE_CODES = Variant(
    name="leave_codes",
    description="Weekly stub exercising education, training, jury duty and bereavement",
    columns=[
        ("hours", "Hours", 300.0),
        ("rate", "Rate", 350.0),
        ("amount", "Amount", 420.0),
        ("ytd_hours", "YTD Hours", 470.0),
        ("ytd", "YTD Amount", 545.0),
    ],
    rows=[
        ("Regular Hourly", "", {"hours": "24", "rate": "25.0000", "amount": "600.00", "ytd_hours": "960", "ytd": "24,000.00"}),
        ("Education", "", {"hours": "4", "rate": "25.0000", "amount": "100.00", "ytd_hours": "40", "ytd": "1,000.00"}),
        ("Training", "", {"hours": "4", "rate": "25.0000", "amount": "100.00", "ytd_hours": "32", "ytd": "800.00"}),
        ("Jury Duty", "", {"hours": "4", "rate": "25.0000", "amount": "100.00", "ytd_hours": "16", "ytd": "400.00"}),
        ("Bereavement", "", {"hours": "4", "rate": "25.0000", "amount": "100.00", "ytd_hours": "8", "ytd": "200.00"}),
        ("Night Differential", "", {"amount": "50.00", "ytd": "1,300.00"}),
        ("Tips", "", {"ytd": "2,600.00"}),
    ],
    footer={"amount": "1,050.00", "ytd": "30,300.00"},
    identity={**_IDENTITY, "period_begin": "06/12/2023", "period_end": "06/18/2023"},
    summary=[
        ("Gross Pay", 230.0, "1,050.00", "30,300.00"),
        ("Pre-Tax Deductions", 320.0, "100.00", "3,000.00"),
        ("Employee Taxes", 400.0, "95.00", "2,700.00"),
        ("Post-Tax Deductions", 490.0, "5.00", "150.00"),
        ("Net Pay", 560.0, "850.00", "24,450.00"),
    ],
    expected={
        # regular 24,000 + education 1,000 + training 800 + jury 400 + bereavement 200
        "base_ytd": Decimal("26400.00"),
        "overtime_ytd": Decimal("1300.00"),   # night differential groups with overtime
        "pay_frequency": "weekly",
        "balanced": True,
        "shift_disclosure": True,
    },
)


ADP_STANDARD = Variant(
    name="adp_standard",
    description="ADP corporate layout: Hours before Rate, Current Amount, YTD Amount",
    columns=[
        ("hours", "Hours", 300.0),
        ("rate", "Rate", 350.0),
        ("amount", "Current Amount", 440.0),
        ("ytd", "YTD Amount", 545.0),
    ],
    rows=[
        ("Regular", "06/05/2023 - 06/18/2023", {"hours": "80", "rate": "30.0000", "amount": "2,400.00", "ytd": "31,200.00"}),
        ("Overtime", "06/05/2023 - 06/18/2023", {"hours": "4", "rate": "45.0000", "amount": "180.00", "ytd": "2,340.00"}),
        ("Vacation", "06/05/2023 - 06/18/2023", {"hours": "8", "rate": "30.0000", "amount": "240.00", "ytd": "3,120.00"}),
    ],
    footer={"amount": "2,820.00", "ytd": "36,660.00"},
    identity=_IDENTITY,
    summary=[
        ("Gross Pay", 230.0, "2,820.00", "36,660.00"),
        ("Pre-Tax Deductions", 320.0, "300.00", "3,900.00"),
        ("Employee Taxes", 400.0, "260.00", "3,380.00"),
        ("Post-Tax Deductions", 490.0, "20.00", "260.00"),
        ("Net Pay", 560.0, "2,240.00", "29,120.00"),
    ],
    expected={
        "base_ytd": Decimal("34320.00"),
        "overtime_ytd": Decimal("2340.00"),
        "hourly_rate": Decimal("30.0000"),
        "balanced": True,
        "shift_disclosure": False,
    },
)


WORKDAY_RATE_FIRST = Variant(
    name="workday_rate_first",
    description="Workday layout: separate Begin/End Date columns, Rate before Hours",
    columns=[
        ("rate", "Rate", 330.0),
        ("hours", "Hours", 380.0),
        ("amount", "Current Earnings", 460.0),
        ("ytd", "YTD Earnings", 555.0),
    ],
    date_columns=[("Begin Date", 140.0), ("End Date", 215.0)],
    rows=[
        ("Regular", "06/05/2023|06/18/2023", {"rate": "30.0000", "hours": "80", "amount": "2,400.00", "ytd": "31,200.00"}),
        ("Overtime", "06/05/2023|06/18/2023", {"rate": "45.0000", "hours": "4", "amount": "180.00", "ytd": "2,340.00"}),
        ("Vacation", "06/05/2023|06/18/2023", {"rate": "30.0000", "hours": "8", "amount": "240.00", "ytd": "3,120.00"}),
        ("Shift Differential", "", {"amount": "96.00", "ytd": "1,248.00"}),
    ],
    footer={"amount": "2,916.00", "ytd": "37,908.00"},
    identity=_IDENTITY,
    summary=[
        ("Gross Pay", 230.0, "2,916.00", "37,908.00"),
        ("Pre-Tax Deductions", 320.0, "300.00", "3,900.00"),
        ("Employee Taxes", 400.0, "260.00", "3,380.00"),
        ("Post-Tax Deductions", 490.0, "20.00", "260.00"),
        ("Net Pay", 560.0, "2,336.00", "30,368.00"),
    ],
    expected={
        "base_ytd": Decimal("34320.00"),
        "overtime_ytd": Decimal("3588.00"),  # overtime 2,340 + shift differential 1,248
        "hourly_rate": Decimal("30.0000"),
        "balanced": True,
        "shift_disclosure": True,
    },
)


GUSTO_NO_YTD = Variant(
    name="gusto_no_ytd",
    description="Gusto/Paychex salaried: Pay Rate and Amount only, no Hours and no YTD",
    columns=[
        ("rate", "Pay Rate", 380.0),
        ("amount", "Amount", 545.0),
    ],
    rows=[
        ("Salary", "", {"rate": "3,750.0000", "amount": "3,750.00"}),
        ("Bonus", "", {"amount": "500.00"}),
    ],
    footer={"amount": "4,250.00"},
    identity={**_IDENTITY, "period_begin": "06/01/2023", "period_end": "06/15/2023"},
    summary=[
        ("Gross Pay", 230.0, "4,250.00", "46,750.00"),
        ("Pre-Tax Deductions", 320.0, "400.00", "4,400.00"),
        ("Employee Taxes", 400.0, "330.00", "5,100.00"),
        ("Post-Tax Deductions", 490.0, "25.00", "275.00"),
        ("Net Pay", 560.0, "3,495.00", "36,975.00"),
    ],
    expected={
        # No YTD column exists, so no YTD income can be derived from this stub.
        "base_ytd": Decimal("0.00"),
        "pay_frequency": "semimonthly",
        "balanced": True,
        "shift_disclosure": False,
    },
)


def build_earnings_on_right_pdf() -> bytes:
    """Deductions table on the left, the whole earnings table on the right.

    Providers do not agree on which side earnings sit. The block has to be
    located by its own banner rather than by assuming it is leftmost, or the
    parser reads the neighbouring deductions table instead.
    """
    content = _Content()

    for text, x in [
        ("Name", 40.0),
        ("Company", 150.0),
        ("Employee ID", 290.0),
        ("Pay Period Begin", 360.0),
        ("Pay Period End", 435.0),
        ("Check Date", 500.0),
    ]:
        content.left(text, x, 60)
    for text, x in [
        ("Dana Rivera", 40.0),
        ("Contoso Freight Inc", 150.0),
        ("991244", 290.0),
        ("06/05/2023", 360.0),
        ("06/18/2023", 435.0),
        ("06/23/2023", 500.0),
    ]:
        content.left(text, x, 74)

    for label, right_edge, current, ytd in [
        ("Gross Pay", 230.0, "2,640.00", "34,320.00"),
        ("Pre-Tax Deductions", 320.0, "300.00", "3,900.00"),
        ("Employee Taxes", 400.0, "260.00", "3,380.00"),
        ("Post-Tax Deductions", 490.0, "20.00", "260.00"),
        ("Net Pay", 560.0, "2,060.00", "26,780.00"),
    ]:
        content.right(label, right_edge, 100)
        content.right(current, right_edge, 114)
        content.right(ytd, right_edge, 128)
    content.left("Current", 40.0, 114)
    content.left("YTD", 40.0, 128)

    content.left("Pre-Tax Deductions", 90.0, 150)
    content.left("Earnings", 400.0, 150)

    header_y = 164.0
    content.left("Description", 40.0, header_y)
    content.right("Amount", 200.0, header_y)
    content.right("YTD", 290.0, header_y)

    content.left("Description", 320.0, header_y)
    content.left("Dates", 390.0, header_y)
    columns = [
        ("hours", "Hours", 455.0),
        ("rate", "Rate", 495.0),
        ("amount", "Amount", 535.0),
        ("ytd", "YTD Amount", 590.0),
    ]
    for _, heading, right_edge in columns:
        content.right(heading, right_edge, header_y)

    deductions = [("401(k)", "150.00", "1,950.00"), ("Medical", "150.00", "1,950.00")]
    rows = [
        ("Regular", {"hours": "80", "rate": "30.0000", "amount": "2,400.00", "ytd": "31,200.00"}),
        ("Vacation", {"hours": "8", "rate": "30.0000", "amount": "240.00", "ytd": "3,120.00"}),
    ]
    row_y = header_y + 14
    for index in range(max(len(deductions), len(rows))):
        if index < len(deductions):
            label, amount, ytd = deductions[index]
            content.left(label, 40.0, row_y)
            content.right(amount, 200.0, row_y)
            content.right(ytd, 290.0, row_y)
        if index < len(rows):
            label, cells = rows[index]
            content.left(label, 320.0, row_y)
            for key, _, right_edge in columns:
                content.right(cells.get(key, ""), right_edge, row_y)
        row_y += 14

    content.left("Earnings", 320.0, row_y)
    content.right("2,640.00", 535.0, row_y)
    content.right("34,320.00", 590.0, row_y)
    return _assemble(content.render())


ALL_VARIANTS = (
    RATE_BEFORE_HOURS,
    SALARIED_SEMIMONTHLY,
    LEAVE_CODES,
    ADP_STANDARD,
    WORKDAY_RATE_FIRST,
    GUSTO_NO_YTD,
)
