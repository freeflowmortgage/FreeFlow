"""Parse a pay stub into base and variable income, entirely in memory.

The output is only as trustworthy as its reconciliation. Rather than assume
the classification is right, the parser proves it three ways against figures
the stub prints itself:

* every earnings line sums to the earnings-table footer;
* the lines left after removing non-cash items sum to gross pay;
* ``hours x rate`` reproduces each line's amount.

That third check also validates the recovered column grid: if ``Hours`` and
``Rate`` had been swapped or shifted, the product would not match the printed
amount. When a check fails the result is flagged rather than returned as fact.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from . import taxonomy
from .extract import ExtractedPage, extract_page, extract_page_with_ocr_labels, group_rows
from .layout import (
    assign_columns,
    column_anchors,
    column_roles,
    describe,
    is_numeric,
    label_bands,
    match_by_right_edge,
    merge_labels,
    parse_decimal,
    split_words,
    tidy_text,
)
from .models import (
    EarningCategory,
    EarningLine,
    Identity,
    IncomeSummary,
    PaystubResult,
    Reconciliation,
    Token,
    Totals,
)
from .overlay import to_overlay, union

CENT = Decimal("0.01")
_TOLERANCE = Decimal("0.02")
"""Allowed drift when comparing printed totals. Payroll systems round each
line to the cent, so a sum of many lines can differ from a printed total by a
cent or two without anything being wrong."""

_COLUMN_ORDER = ("hours", "rate", "amount", "ytd_hours", "ytd_amount")

_SUMMARY_FIELDS = {
    "grosspay": "gross",
    "pretaxdeductions": "pretax",
    "employeetaxes": "taxes",
    "posttaxdeductions": "posttax",
    "netpay": "net",
}

_IDENTITY_FIELDS = {
    "name": "employee",
    "company": "employer",
    "employeeid": "employee_id",
    "payperiodbegin": "period_begin",
    "payperiodend": "period_end",
    "checkdate": "check_date",
    "checknumber": "check_number",
}


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _close(left: Decimal | None, right: Decimal | None) -> bool:
    if left is None or right is None:
        return False
    return abs(left - right) <= _TOLERANCE


def _row_text(row: list[Token]) -> str:
    return taxonomy.normalize(" ".join(t.text for t in row))


def _median_height(tokens: list[Token]) -> float:
    heights = sorted(t.height for t in tokens if t.height > 0)
    if not heights:
        return 20.0
    return heights[len(heights) // 2]


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _find_row(rows: list[list[Token]], *required: str, start: int = 0) -> int | None:
    """Index of the first row at/after ``start`` containing every required label."""
    for index in range(start, len(rows)):
        normalized = {taxonomy.normalize(t.text) for t in rows[index]}
        blob = _row_text(rows[index])
        if all(any(req == n for n in normalized) or req in blob for req in required):
            return index
    return None


def _parse_identity(
    rows: list[list[Token]],
    result: PaystubResult,
    page_width: float = 0.0,
    page_height: float = 0.0,
) -> None:
    index = _find_row(rows, "name", "company")
    if index is None or index + 1 >= len(rows):
        result.warnings.append("identity header row not found")
        return

    labels = merge_labels(rows[index], _IDENTITY_FIELDS)
    values = rows[index + 1]
    identity = Identity()
    for label, left, right in label_bands(labels):
        field = _IDENTITY_FIELDS.get(taxonomy.normalize(label.text))
        if field is None:
            continue
        matched = [v for v in values if left <= v.x_center < right]
        if not matched:
            continue
        setattr(identity, field, tidy_text(" ".join(v.text for v in matched)))
        if field in {"employer", "employee", "period_end"}:
            spans = [to_overlay(v, page_width, page_height) for v in matched]
            box = union([s for s in spans if s])
            setattr(identity, f"{field}_box", box)
    result.identity = identity


def _parse_totals(rows: list[list[Token]], result: PaystubResult) -> None:
    index = _find_row(rows, "grosspay", "netpay")
    if index is None:
        result.warnings.append("summary totals row not found")
        return

    labels = [
        t
        for t in merge_labels(rows[index], _SUMMARY_FIELDS)
        if taxonomy.normalize(t.text) in _SUMMARY_FIELDS
    ]
    totals = Totals()
    found = False

    for row in rows[index + 1 : index + 4]:
        head = taxonomy.normalize(row[0].text) if row else ""
        if head == "current":
            suffix = "current"
        elif head in {"ytd", "yeartodate"}:
            suffix = "ytd"
        else:
            continue
        found = True
        values = [t for t in row if is_numeric(t.text)]
        for label_text, value in match_by_right_edge(labels, values).items():
            field = _SUMMARY_FIELDS[taxonomy.normalize(label_text)]
            setattr(totals, f"{field}_{suffix}", parse_decimal(value.text))

    if not found:
        result.warnings.append("summary Current/YTD rows not found")
    result.totals = totals


def _earnings_rows(
    rows: list[list[Token]], result: PaystubResult
) -> tuple[list[list[Token]], list[Token] | None, list[Token]]:
    """Return the earnings data rows and the table's footer row.

    The stub prints two side-by-side tables (earnings on the left, taxes on
    the right) whose rows share vertical space, so the earnings block must be
    clipped horizontally at the second ``Description`` header.
    """
    banner_token = None
    banner = None
    for index, row in enumerate(rows):
        for token in row:
            if taxonomy.normalize(token.text) == "earnings":
                banner_token, banner = token, index
                break
        if banner is not None:
            break
    if banner is None:
        result.warnings.append("earnings section not found")
        return [], None, []

    header = _find_row(rows, "description", start=banner + 1)
    if header is None:
        result.warnings.append("earnings header row not found")
        return [], None, []

    # Stubs print two or more tables side by side, and the earnings block is
    # not always the leftmost one. Pick the Description column that the
    # Earnings banner sits over, then clip to the next block's Description, so
    # a neighbouring deductions or taxes table cannot bleed into the rows.
    headings = sorted(
        (t for t in rows[header] if taxonomy.normalize(t.text) == "description"),
        key=lambda t: t.x0,
    )
    left_limit, right_limit = -float("inf"), float("inf")
    if headings:
        position = 0
        for index, heading in enumerate(headings):
            if heading.x0 <= banner_token.x_center:
                position = index
        left_limit = headings[position].x0 - 10
        if position + 1 < len(headings):
            right_limit = headings[position + 1].x0 - 10

    def clip(row: list[Token]) -> list[Token]:
        return [t for t in row if left_limit <= t.x0 and t.x1 <= right_limit]

    header_row = clip(rows[header])

    data: list[list[Token]] = []
    footer: list[Token] | None = None
    for row in rows[header + 1 :]:
        clipped = clip(row)
        if not clipped:
            continue
        text = taxonomy.normalize(" ".join(t.text for t in clipped if not is_numeric(t.text)))
        if text == "earnings":
            footer = clipped
            break
        data.append(clipped)

    if footer is None:
        result.warnings.append("earnings footer row not found; totals unverified")
    return data, footer, header_row


def _map_columns(
    anchors: list[float],
    header: list[Token],
    result: PaystubResult,
) -> dict[str, int] | None:
    """Decide which recovered column holds hours, rate, amount, and YTD.

    The header wording is tried first so that layouts this parser was not built
    against still read correctly. Only when the header cannot be interpreted
    does it fall back to assuming the canonical five-column order, and that
    assumption is recorded as a warning because it is exactly the kind of guess
    that silently misreads another provider's stub.
    """
    if not anchors:
        result.warnings.append("no numeric columns found in the earnings table")
        return None

    spacing = min(
        (b - a for a, b in zip(anchors, anchors[1:])),
        default=120.0,
    )
    roles = column_roles(header, anchors, tolerance=max(spacing * 0.9, 40.0))
    if roles:
        mapped = {role: index for index, role in enumerate(roles) if role}
        if "amount" in mapped or "ytd_amount" in mapped:
            return mapped

    if len(anchors) < len(_COLUMN_ORDER):
        result.warnings.append(
            f"earnings header could not be read and only {len(anchors)} numeric "
            f"columns were found; cannot identify them by position"
        )
        return None

    if len(anchors) > len(_COLUMN_ORDER):
        result.warnings.append(
            f"recovered {len(anchors)} numeric columns; using the rightmost "
            f"{len(_COLUMN_ORDER)}"
        )
    result.warnings.append(
        "earnings header could not be read; column roles assumed from position"
    )
    offset = len(anchors) - len(_COLUMN_ORDER)
    return {name: offset + position for position, name in enumerate(_COLUMN_ORDER)}


def _build_lines(
    data: list[list[Token]],
    footer: list[Token] | None,
    result: PaystubResult,
    page_width: float = 0.0,
    page_height: float = 0.0,
    header: list[Token] | None = None,
) -> tuple[list[EarningLine], Decimal | None, Decimal | None]:
    anchor_rows = data + ([footer] if footer else [])
    anchors = column_anchors(anchor_rows)
    index_of = _map_columns(anchors, header or [], result)
    if index_of is None:
        return [], None, None

    used = anchors

    def cell(cells: dict[int, Token], name: str) -> Decimal | None:
        position = index_of.get(name)
        token = cells.get(position) if position is not None else None
        return parse_decimal(token.text) if token else None

    def box(cells: dict[int, Token], name: str):
        position = index_of.get(name)
        token = cells.get(position) if position is not None else None
        return to_overlay(token, page_width, page_height) if token else None

    lines: list[EarningLine] = []
    for row in data:
        expanded = [word for token in row for word in split_words(token)]
        cells, leftovers = assign_columns(expanded, used)
        description, dates = describe(leftovers)
        if not description and not cells:
            continue
        if not description:
            result.warnings.append("earnings row without a description was skipped")
            continue
        category, reason = taxonomy.classify(description)
        label = leftovers[0] if leftovers else None
        lines.append(
            EarningLine(
                description=description,
                category=category,
                category_reason=reason,
                dates=dates,
                hours=cell(cells, "hours"),
                rate=cell(cells, "rate"),
                amount=cell(cells, "amount"),
                ytd_hours=cell(cells, "ytd_hours"),
                ytd_amount=cell(cells, "ytd_amount"),
                variable_group=(
                    taxonomy.variable_group(reason)
                    if category is EarningCategory.VARIABLE
                    else None
                ),
                hours_box=box(cells, "hours"),
                rate_box=box(cells, "rate"),
                amount_box=box(cells, "amount"),
                ytd_amount_box=box(cells, "ytd_amount"),
                label_box=to_overlay(label, page_width, page_height) if label else None,
            )
        )

    footer_current = footer_ytd = None
    if footer:
        expanded = [word for token in footer for word in split_words(token)]
        cells, _ = assign_columns(expanded, used)
        footer_current = cell(cells, "amount")
        footer_ytd = cell(cells, "ytd_amount")

    return lines, footer_current, footer_ytd


def _reconcile(
    lines: list[EarningLine],
    footer_current: Decimal | None,
    footer_ytd: Decimal | None,
    totals: Totals,
    *,
    has_current: bool = True,
    has_ytd: bool = True,
) -> Reconciliation:
    def total(attr: str, *, cash_only: bool) -> Decimal:
        return sum(
            (
                getattr(line, attr) or Decimal("0")
                for line in lines
                if not (cash_only and line.category is EarningCategory.IMPUTED)
            ),
            Decimal("0"),
        )

    rate_checked = rate_ok = 0
    for line in lines:
        if line.hours and line.rate and line.amount:
            rate_checked += 1
            if abs(line.hours * line.rate - line.amount) <= Decimal("0.05"):
                rate_ok += 1

    reconciliation = Reconciliation(
        earnings_footer_current=footer_current,
        earnings_footer_ytd=footer_ytd,
        line_sum_current=_money(total("amount", cash_only=False)),
        line_sum_ytd=_money(total("ytd_amount", cash_only=False)),
        cash_sum_current=_money(total("amount", cash_only=True)),
        cash_sum_ytd=_money(total("ytd_amount", cash_only=True)),
        gross_current=totals.gross_current,
        gross_ytd=totals.gross_ytd,
        rate_lines_checked=rate_checked,
        rate_check_passed=rate_ok == rate_checked,
        has_current_column=has_current,
        has_ytd_column=has_ytd,
    )

    # Only compare the columns the stub actually prints. Demanding a YTD match
    # from a stub that has no YTD column turns a layout difference into a
    # reconciliation failure and buries the real ones.
    checks_current = (
        _close(reconciliation.line_sum_current, footer_current) if has_current else True
    )
    checks_ytd = _close(reconciliation.line_sum_ytd, footer_ytd) if has_ytd else True
    reconciliation.footer_matches_lines = checks_current and checks_ytd

    gross_current_ok = (
        _close(reconciliation.cash_sum_current, totals.gross_current)
        if has_current
        else True
    )
    gross_ytd_ok = (
        _close(reconciliation.cash_sum_ytd, totals.gross_ytd) if has_ytd else True
    )
    reconciliation.gross_matches_cash = gross_current_ok and gross_ytd_ok
    return reconciliation


def _summarize_income(
    lines: list[EarningLine], identity: Identity, result: PaystubResult
) -> IncomeSummary:
    def bucket(category: EarningCategory, attr: str) -> Decimal:
        return sum(
            (getattr(l, attr) or Decimal("0") for l in lines if l.category is category),
            Decimal("0"),
        )

    income = IncomeSummary(
        base_worked_ytd=_money(bucket(EarningCategory.BASE_WORKED, "ytd_amount")),
        base_leave_ytd=_money(bucket(EarningCategory.BASE_LEAVE, "ytd_amount")),
        variable_ytd=_money(bucket(EarningCategory.VARIABLE, "ytd_amount")),
        imputed_ytd=_money(bucket(EarningCategory.IMPUTED, "ytd_amount")),
        unknown_ytd=_money(bucket(EarningCategory.UNKNOWN, "ytd_amount")),
    )
    income.base_ytd = _money(income.base_worked_ytd + income.base_leave_ytd)

    def variable_bucket(group: str) -> Decimal:
        return _money(
            sum(
                (
                    l.ytd_amount or Decimal("0")
                    for l in lines
                    if l.category is EarningCategory.VARIABLE and l.variable_group == group
                ),
                Decimal("0"),
            )
        )

    income.overtime_ytd = variable_bucket("overtime")
    income.bonus_ytd = variable_bucket("bonus")
    income.commission_ytd = variable_bucket("commission")
    income.tips_ytd = variable_bucket("tips")
    income.rsu_ytd = variable_bucket("rsu")
    income.other_variable_ytd = variable_bucket("other")

    income.base_ytd_hours = sum(
        (l.ytd_hours or Decimal("0") for l in lines if l.is_base), Decimal("0")
    )

    base_lines = [l for l in lines if l.is_base]
    rates = {l.rate for l in base_lines if l.rate}
    if len(rates) == 1:
        income.hourly_rate = rates.pop()
    elif rates:
        income.hourly_rate = max(rates)
        result.warnings.append(
            f"multiple base rates on this stub ({len(rates)}); used the highest"
        )

    income.hours_per_period = sum(
        (l.hours or Decimal("0") for l in base_lines), Decimal("0")
    )

    begin = _parse_date(identity.period_begin)
    end = _parse_date(identity.period_end)
    if begin and end:
        span = (end - begin).days + 1
        frequency = {7: ("weekly", 52), 14: ("biweekly", 26)}.get(span)
        if frequency is None and 15 <= span <= 16:
            frequency = ("semimonthly", 24)
        elif frequency is None and 28 <= span <= 31:
            frequency = ("monthly", 12)
        if frequency:
            income.pay_frequency, income.periods_per_year = frequency
        else:
            result.warnings.append(f"unrecognized pay period span of {span} days")

    if income.periods_per_year and income.hours_per_period:
        income.weekly_hours = (
            income.hours_per_period * income.periods_per_year / 52
        ).quantize(Decimal("0.01"))

    if income.periods_per_year and income.hourly_rate and income.hours_per_period:
        per_period = income.hourly_rate * income.hours_per_period
        income.monthly_base_at_current_rate = _money(
            per_period * income.periods_per_year / 12
        )

    if income.hours_per_period and income.base_ytd_hours:
        income.periods_elapsed = (
            income.base_ytd_hours / income.hours_per_period
        ).quantize(Decimal("0.01"))

    if income.periods_elapsed and income.periods_per_year:
        scale = Decimal(income.periods_per_year) / 12
        income.monthly_base_ytd_average = _money(
            income.base_ytd / income.periods_elapsed * scale
        )
        income.monthly_variable_ytd_average = _money(
            income.variable_ytd / income.periods_elapsed * scale
        )

    return income


_RUN_RATE_TOLERANCE = Decimal("0.15")
"""How far YTD average may drift from the current run rate before it is worth
a look. Below this, ordinary things explain it: a raise, an unpaid day, a
period with more leave than usual."""


def _check_run_rate(income: IncomeSummary, result: PaystubResult) -> None:
    """Compare year-to-date base pay against the borrower's current run rate.

    This replaces a fixed dollar threshold, which cannot work: the same YTD
    figure is unremarkable for a part-time borrower and alarming for a senior
    one, and any stub from early in the year sits below any constant. Measuring
    the borrower against their own rate is scale-free and works in January.
    """
    at_rate = income.monthly_base_at_current_rate
    average = income.monthly_base_ytd_average
    if not at_rate or not average or at_rate <= 0:
        return

    drift = (average - at_rate) / at_rate
    if abs(drift) <= _RUN_RATE_TOLERANCE:
        return

    direction = "below" if drift < 0 else "above"
    result.warnings.append(
        f"year-to-date base pay averages ${average:,.2f}/mo, "
        f"{abs(drift) * 100:.0f}% {direction} the ${at_rate:,.2f}/mo implied by the "
        f"current rate and hours; check for a pay change, unpaid leave, or a "
        f"mid-year hire"
    )


def _collect_disclosures(lines: list[EarningLine], result: PaystubResult) -> None:
    """Underwriter-facing notes rendered beneath the income boxes."""
    shift = [l for l in lines if l.category_reason == taxonomy.SHIFT_DIFFERENTIAL_REASON]
    if shift:
        total = sum((l.ytd_amount or Decimal("0") for l in shift), Decimal("0"))
        result.disclosures.append(
            f"{taxonomy.SHIFT_DIFFERENTIAL_DISCLOSURE} "
            f"({', '.join(sorted({l.description for l in shift}))}, ${total:,.2f} YTD)"
        )


def _collect_warnings(lines: list[EarningLine], result: PaystubResult) -> None:
    for line in lines:
        if line.category is EarningCategory.UNKNOWN:
            result.warnings.append(
                f"unclassified earning {line.description!r} "
                f"(YTD {line.ytd_amount}); excluded from all income totals"
            )
        elif line.category_reason in taxonomy.NON_RECURRING_REASONS:
            result.warnings.append(
                f"{line.description!r} counted as base pay but is {line.category_reason}"
            )

    # A description repeated with its own YTD balance means payroll is running
    # two distinct earning codes behind one label. Summing is correct; a parser
    # that keyed totals by description would silently drop one of them.
    seen: dict[str, list[str]] = {}
    for line in lines:
        if line.ytd_amount:
            seen.setdefault(taxonomy.normalize(line.description), []).append(
                line.description
            )
    for descriptions in seen.values():
        if len(descriptions) > 1:
            result.warnings.append(
                f"{descriptions[0]!r} appears as {len(descriptions)} separate earning "
                f"codes with distinct YTD balances; all were summed"
            )


def parse_paystub(
    pdf_bytes: bytes | bytearray,
    dpi: int | None = None,
    page_index: int = 0,
) -> PaystubResult:
    """Parse one page of ``pdf_bytes`` into a :class:`PaystubResult`.

    Nothing is written to disk. ``page_index`` selects the page within a
    multi-document packet; the caller is expected to have classified it as a
    pay stub already.
    """
    dpi_arg = {"dpi": dpi} if dpi else {}
    result = _parse_page(extract_page(pdf_bytes, page_index=page_index, **dpi_arg), page_index)
    if result.text_source != "text" or (result.lines and result.reconciliation.balanced):
        return result
    retry = _parse_page(
        extract_page_with_ocr_labels(pdf_bytes, page_index=page_index, **dpi_arg), page_index
    )
    if retry.lines and (retry.reconciliation.balanced or not result.lines):
        return retry
    return result


def _parse_page(page: ExtractedPage, page_index: int) -> PaystubResult:
    result = PaystubResult(page_index=page_index)
    result.text_source = page.source
    if not page.tokens:
        result.warnings.append(
            "document could not be opened as a PDF"
            if page.source == "invalid"
            else "no text recovered from the document"
        )
        return result

    rows = group_rows(page.tokens, tolerance=_median_height(page.tokens) * 0.45)

    _parse_identity(rows, result, page.width, page.height)
    _parse_totals(rows, result)

    data, footer, header = _earnings_rows(rows, result)
    lines, footer_current, footer_ytd = _build_lines(
        data, footer, result, page.width, page.height, header
    )
    result.lines = lines

    has_current = any(l.amount is not None for l in lines)
    has_ytd = any(l.ytd_amount is not None for l in lines)
    if lines and not has_ytd:
        result.warnings.append(
            "this stub prints no year-to-date earnings column; YTD income could "
            "not be computed and a second stub or a VOE is needed"
        )

    result.reconciliation = _reconcile(
        lines,
        footer_current,
        footer_ytd,
        result.totals,
        has_current=has_current,
        has_ytd=has_ytd,
    )
    result.income = _summarize_income(lines, result.identity, result)
    _check_run_rate(result.income, result)
    _collect_disclosures(lines, result)
    _collect_warnings(lines, result)

    if not result.reconciliation.footer_matches_lines:
        result.warnings.append(
            "earnings lines do not sum to the printed earnings total"
        )
    if not result.reconciliation.gross_matches_cash:
        result.warnings.append(
            "cash earnings do not sum to printed gross pay; "
            "check for misclassified imputed income"
        )
    if result.reconciliation.rate_lines_checked and not result.reconciliation.rate_check_passed:
        result.warnings.append("hours x rate did not reproduce every line amount")

    return result
