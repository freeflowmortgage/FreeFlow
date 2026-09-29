"""Data model for a parsed pay stub.

Every value that represents money or hours is a ``Decimal``. Floats are never
used for currency: a binary float cannot represent 0.01 exactly, and the
reconciliation checks in :mod:`paystub.parser` compare sums to the cent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum


class EarningCategory(str, Enum):
    """How a single earnings line counts toward qualifying income."""

    BASE_WORKED = "base_worked"
    """Hours actually worked at the base rate (regular/hourly/salary)."""

    BASE_LEAVE = "base_leave"
    """Paid leave drawn at the base rate (sick, vacation, holiday, PTO)."""

    VARIABLE = "variable"
    """Overtime, bonus, commission, incentive, and other non-guaranteed pay."""

    IMPUTED = "imputed"
    """Employer-paid or non-cash lines that appear in the earnings table but
    are excluded from gross pay (group term life, employer-paid disability)."""

    UNKNOWN = "unknown"
    """No taxonomy match. Never folded into a total; always surfaced for review."""


BASE_CATEGORIES = (EarningCategory.BASE_WORKED, EarningCategory.BASE_LEAVE)


@dataclass(frozen=True, slots=True)
class Token:
    """A run of text recognized on the page, in device pixels."""

    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    confidence: float = 1.0

    @property
    def x_center(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def y_center(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def width(self) -> float:
        return self.x1 - self.x0

    @property
    def height(self) -> float:
        return self.y1 - self.y0


@dataclass(frozen=True, slots=True)
class OverlayBox:
    """A page region in 0-1 coordinates, matching the income tool's overlay contract.

    The console treats a box as unusable below 0.004 on either axis, so a box
    that points at a single thin glyph is discarded before it reaches the
    canvas. :func:`paystub.overlay.to_overlay` enforces a floor above that
    threshold rather than emitting a box the viewer will silently drop.
    """

    x: float
    y: float
    w: float
    h: float

    def as_dict(self) -> dict[str, float]:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}


@dataclass(slots=True)
class EarningLine:
    """One row of the earnings table."""

    description: str
    category: EarningCategory
    category_reason: str
    dates: str | None = None
    hours: Decimal | None = None
    rate: Decimal | None = None
    amount: Decimal | None = None
    ytd_hours: Decimal | None = None
    ytd_amount: Decimal | None = None
    variable_group: str | None = None
    """For variable lines, which income-tool box reports it: overtime, bonus,
    commission, or other. ``None`` for base and imputed lines."""

    hours_box: OverlayBox | None = None
    rate_box: OverlayBox | None = None
    amount_box: OverlayBox | None = None
    ytd_amount_box: OverlayBox | None = None
    label_box: OverlayBox | None = None

    @property
    def is_base(self) -> bool:
        return self.category in BASE_CATEGORIES


@dataclass(slots=True)
class Identity:
    """Who the stub belongs to and which period it covers."""

    employer: str | None = None
    employee: str | None = None
    employee_id: str | None = None
    period_begin: str | None = None
    period_end: str | None = None
    check_date: str | None = None
    check_number: str | None = None
    employer_box: OverlayBox | None = None
    employee_box: OverlayBox | None = None
    period_end_box: OverlayBox | None = None


@dataclass(slots=True)
class Totals:
    """The summary box at the top of the stub."""

    gross_current: Decimal | None = None
    gross_ytd: Decimal | None = None
    net_current: Decimal | None = None
    net_ytd: Decimal | None = None
    pretax_current: Decimal | None = None
    pretax_ytd: Decimal | None = None
    taxes_current: Decimal | None = None
    taxes_ytd: Decimal | None = None
    posttax_current: Decimal | None = None
    posttax_ytd: Decimal | None = None


@dataclass(slots=True)
class Reconciliation:
    """Proof that the line-level classification adds up.

    The classification is only trustworthy if the lines we treated as cash
    wages sum to the stub's own gross pay. When ``balanced`` is false the
    caller must not use the totals for an underwriting decision.
    """

    earnings_footer_current: Decimal | None = None
    earnings_footer_ytd: Decimal | None = None
    line_sum_current: Decimal = Decimal("0")
    line_sum_ytd: Decimal = Decimal("0")
    cash_sum_current: Decimal = Decimal("0")
    cash_sum_ytd: Decimal = Decimal("0")
    gross_current: Decimal | None = None
    gross_ytd: Decimal | None = None
    has_current_column: bool = True
    has_ytd_column: bool = True
    """Which money columns the stub actually prints. A Gusto-style stub with
    only an ``Amount`` column has no YTD figure to check, which is an absent
    check rather than a failed one."""

    footer_matches_lines: bool = False
    gross_matches_cash: bool = False
    rate_lines_checked: int = 0
    """How many lines carried hours, rate, and amount together. Zero on a
    salaried stub, where there is no product to verify."""
    rate_check_passed: bool = False
    """True when no checked line contradicted ``hours x rate``. Vacuously true
    when ``rate_lines_checked`` is zero, so read the two together."""

    @property
    def balanced(self) -> bool:
        return self.footer_matches_lines and self.gross_matches_cash


@dataclass(slots=True)
class IncomeSummary:
    """Base and variable income, expressed monthly."""

    base_ytd: Decimal = Decimal("0")
    base_ytd_hours: Decimal = Decimal("0")
    base_worked_ytd: Decimal = Decimal("0")
    base_leave_ytd: Decimal = Decimal("0")
    variable_ytd: Decimal = Decimal("0")
    imputed_ytd: Decimal = Decimal("0")
    unknown_ytd: Decimal = Decimal("0")

    overtime_ytd: Decimal = Decimal("0")
    """Overtime plus shift differential, which the income tool reports together."""
    bonus_ytd: Decimal = Decimal("0")
    commission_ytd: Decimal = Decimal("0")
    tips_ytd: Decimal = Decimal("0")
    rsu_ytd: Decimal = Decimal("0")
    other_variable_ytd: Decimal = Decimal("0")

    hourly_rate: Decimal | None = None
    hours_per_period: Decimal | None = None
    weekly_hours: Decimal | None = None
    pay_frequency: str | None = None
    periods_per_year: int | None = None
    periods_elapsed: Decimal | None = None

    monthly_base_at_current_rate: Decimal | None = None
    monthly_base_ytd_average: Decimal | None = None
    monthly_variable_ytd_average: Decimal | None = None


@dataclass(slots=True)
class PaystubResult:
    identity: Identity = field(default_factory=Identity)
    totals: Totals = field(default_factory=Totals)
    lines: list[EarningLine] = field(default_factory=list)
    income: IncomeSummary = field(default_factory=IncomeSummary)
    reconciliation: Reconciliation = field(default_factory=Reconciliation)
    warnings: list[str] = field(default_factory=list)
    disclosures: list[str] = field(default_factory=list)
    """Notes for the underwriter to display beneath the income boxes. Distinct
    from ``warnings``, which flag data the parser could not resolve."""
    page_index: int = 0
    text_source: str = "ocr"

    @property
    def needs_review(self) -> bool:
        return bool(self.warnings) or not self.reconciliation.balanced
