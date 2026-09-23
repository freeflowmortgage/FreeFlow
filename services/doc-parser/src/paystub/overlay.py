"""Overlay boxes for the underwriter QA split view and document viewer.

The income tool already renders highlights for W-2 and Schedule E from
``formExtracts`` records shaped ``{pageIndex, sourceFieldId, value,
numericValue, box, componentBoxes, ...}`` with ``box`` in 0-1 page
coordinates. This module emits exactly that shape, reusing the ``ps-*`` field
IDs the console maps today, so pay stub highlights light up without a UI
change.

Two rules decide whether a highlight actually appears, and both are enforced
here rather than left to chance:

* ``isUsableOverlayBox`` in the console rejects any box narrower or shorter
  than 0.004. A box drawn tightly around a thin glyph such as ``1`` falls under
  that on a letter page, so :func:`to_overlay` pads every box to a floor above
  the threshold. A box the viewer discards is worse than no box, because the
  field still looks populated while nothing highlights.
* A field is only emitted when a real numeric token was located for it. The
  console claims a field ID as soon as the parser reports it and then skips its
  own word-based fallback, so reporting a field with a zero box permanently
  suppresses the geometry the console could have derived itself.
"""

from __future__ import annotations

from decimal import Decimal

from .models import (
    BASE_CATEGORIES,
    EarningCategory,
    OverlayBox,
    PaystubResult,
    Token,
)

MIN_SPAN = 0.006
"""Floor for box width and height in 0-1 units, above the console's 0.004
rejection threshold with room for rounding."""

FORM = "Paystub"

# The console and the Form 1084 math expect these spellings.
_FREQUENCY_LABELS = {
    "weekly": "Weekly",
    "biweekly": "Biweekly",
    "semimonthly": "SemiMonthly",
    "monthly": "Monthly",
}


def to_overlay(token: Token, width: float, height: float) -> OverlayBox | None:
    """Normalize a token's pixel box to a 0-1 overlay box the console accepts."""
    if width <= 0 or height <= 0:
        return None

    x0, x1 = token.x0 / width, token.x1 / width
    y0, y1 = token.y0 / height, token.y1 / height
    return _padded(x0, y0, x1, y1)


def union(boxes: list[OverlayBox]) -> OverlayBox | None:
    """Smallest box covering all of ``boxes``, for a value spanning several cells."""
    if not boxes:
        return None
    return _padded(
        min(b.x for b in boxes),
        min(b.y for b in boxes),
        max(b.x + b.w for b in boxes),
        max(b.y + b.h for b in boxes),
    )


def _padded(x0: float, y0: float, x1: float, y1: float) -> OverlayBox:
    w, h = x1 - x0, y1 - y0
    if w < MIN_SPAN:
        x0 -= (MIN_SPAN - w) / 2
        w = MIN_SPAN
    if h < MIN_SPAN:
        y0 -= (MIN_SPAN - h) / 2
        h = MIN_SPAN
    x0 = min(max(x0, 0.0), 1.0 - MIN_SPAN)
    y0 = min(max(y0, 0.0), 1.0 - MIN_SPAN)
    return OverlayBox(
        x=round(x0, 6),
        y=round(y0, 6),
        w=round(min(w, 1.0 - x0), 6),
        h=round(min(h, 1.0 - y0), 6),
    )


def _record(
    *,
    page_index: int,
    source_id: str,
    box_label: str,
    field_label: str,
    line_num: str,
    category: str,
    value: str,
    numeric: Decimal,
    box: OverlayBox,
    components: list[OverlayBox] | None = None,
) -> dict:
    record = {
        "pageIndex": page_index,
        "form": FORM,
        "sourceFieldId": source_id,
        "boxLabel": box_label,
        "fieldLabel": field_label,
        "lineNum": line_num,
        "category": category,
        "value": value,
        "numericValue": float(numeric),
        "box": box.as_dict(),
        "entityId": f"paystub-p{page_index}",
    }
    if components and len(components) > 1:
        record["componentBoxes"] = [component.as_dict() for component in components]
    return record


def income_fields(result: PaystubResult) -> list[dict]:
    """Build ``formExtracts`` records for the income tool from a parsed stub.

    Only fields backed by a located numeric token are emitted. A value the
    parser computed but could not point at on the page is left out, so the
    console falls back to its own word-based geometry instead of being blocked
    by a field it cannot highlight.
    """
    page = result.page_index
    records: list[dict] = []

    def aggregate(
        source_id: str,
        box_label: str,
        field_label: str,
        line_num: str,
        total: Decimal,
        lines: list,
    ) -> None:
        boxes = [l.ytd_amount_box for l in lines if l.ytd_amount_box]
        merged = union(boxes)
        if merged is None or total == 0:
            return
        records.append(
            _record(
                page_index=page,
                source_id=source_id,
                box_label=box_label,
                field_label=field_label,
                line_num=line_num,
                category="wages",
                value=f"{total:,.2f}",
                numeric=total,
                box=merged,
                components=boxes,
            )
        )

    income = result.income

    # Current-period base pay: the sum of this period's base rows, highlighted
    # across every cell that contributed.
    current_lines = [l for l in result.lines if l.is_base and l.amount and l.amount_box]
    current_total = sum((l.amount for l in current_lines), Decimal("0"))
    current_boxes = [l.amount_box for l in current_lines if l.amount_box]
    merged_current = union(current_boxes)
    if merged_current and current_total:
        records.append(
            _record(
                page_index=page,
                source_id="ps-current-base",
                box_label="Current",
                field_label="Current Period Base Pay",
                line_num="Current",
                category="wages",
                value=f"{current_total:,.2f}",
                numeric=current_total,
                box=merged_current,
                components=current_boxes,
            )
        )

    aggregate(
        "ps-base-ytd",
        "YTD",
        "Base Wages YTD",
        "YTD",
        income.base_ytd,
        [l for l in result.lines if l.category in BASE_CATEGORIES],
    )

    for source_id, box_label, field_label, group, total in (
        ("ps-ot-ytd", "OT YTD", "Overtime Income YTD", "overtime", income.overtime_ytd),
        ("ps-bonus-ytd", "Bonus YTD", "Bonus Income YTD", "bonus", income.bonus_ytd),
        (
            "ps-commission-ytd",
            "Commission YTD",
            "Commission YTD",
            "commission",
            income.commission_ytd,
        ),
        ("ps-tips-ytd", "Tips YTD", "Tips YTD", "tips", income.tips_ytd),
        ("ps-rsu-ytd", "RSU YTD", "RSU / Stock Award YTD", "rsu", income.rsu_ytd),
    ):
        aggregate(
            source_id,
            box_label,
            field_label,
            box_label,
            total,
            [
                l
                for l in result.lines
                if l.category is EarningCategory.VARIABLE and l.variable_group == group
            ],
        )

    # Rate and hours highlight the printed figure in their own column, not the
    # row's amount, so the underwriter sees the cell being verified.
    rate_line = next(
        (l for l in result.lines if l.is_base and l.rate == income.hourly_rate and l.rate_box),
        None,
    )
    if rate_line and income.hourly_rate:
        records.append(
            _record(
                page_index=page,
                source_id="ps-hourly-rate",
                box_label="Rate",
                field_label="Hourly Rate of Pay",
                line_num="Rate",
                category="wages",
                value=str(income.hourly_rate),
                numeric=income.hourly_rate,
                box=rate_line.rate_box,
            )
        )

    hour_boxes = [l.hours_box for l in result.lines if l.is_base and l.hours and l.hours_box]
    merged_hours = union(hour_boxes)
    if merged_hours and income.weekly_hours:
        records.append(
            _record(
                page_index=page,
                source_id="ps-hours-week",
                box_label="Hours",
                field_label="Standard Weekly Hours",
                line_num="Hours",
                category="wages",
                value=str(income.weekly_hours),
                numeric=income.weekly_hours,
                box=merged_hours,
                components=hour_boxes,
            )
        )

    if result.identity.employer and result.identity.employer_box:
        records.append(
            _record(
                page_index=page,
                source_id="ps-employer-name",
                box_label="Employer",
                field_label="Employer Name",
                line_num="Employer",
                category="identity",
                value=result.identity.employer,
                numeric=Decimal("0"),
                box=result.identity.employer_box,
            )
        )

    # Frequency is derived from the period dates, so the highlight points at
    # the pay period end the underwriter would check it against.
    if income.pay_frequency and result.identity.period_end_box:
        records.append(
            _record(
                page_index=page,
                source_id="ps-pay-frequency",
                box_label="Frequency",
                field_label="Pay Frequency",
                line_num="Frequency",
                category="identity",
                value=_FREQUENCY_LABELS.get(income.pay_frequency, income.pay_frequency),
                numeric=Decimal(income.periods_per_year or 0),
                box=result.identity.period_end_box,
            )
        )

    return records
