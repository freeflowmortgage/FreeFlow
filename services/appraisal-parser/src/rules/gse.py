"""Conventional GSE appraisal review overlay."""

from __future__ import annotations

from typing import Any

from .common import condition, finding


def evaluate(extracted: dict[str, Any], program: str) -> tuple[list[dict], list[dict]]:
    findings: list[dict] = []
    conditions: list[dict] = []

    for comparable in extracted.get("comparables", []):
        sale_price = comparable.get("salePrice")
        gross = comparable.get("grossAdjustmentAmount")
        if not sale_price or gross is None:
            continue
        ratio = abs(gross) / sale_price
        if ratio <= 0.10:
            continue
        index = comparable["compIndex"]
        box = comparable["cellCoordinates"]["grossAdjustments"]["box"]
        findings.append(
            finding(
                code=f"GSE_COMP_{index}_GROSS_ADJUSTMENT_REVIEW",
                label=f"Comparable {index} gross adjustment",
                extracted=f"{ratio:.1%} of comparable sale price",
                why="Gross adjustments above the 10% review band require support and reconciliation.",
                severity="warning",
                authority="GSE appraisal quality review",
                program=program,
                page_index=comparable["cellCoordinates"]["grossAdjustments"]["pageIndex"],
                box=box,
            )
        )
        conditions.append(
            condition(
                id=f"gse-comp-{index}-gross-adjustment",
                kind="ADMIN",
                text=f"Support and reconcile Comparable {index}'s {ratio:.1%} gross adjustment.",
                authority="GSE appraisal quality review",
                program=program,
            )
        )

    market = extracted.get("marketConditions1004MC", {})
    current = market.get("medianPriceCurrentQuarter")
    prior = market.get("medianPricePriorYearQuarter")
    trend = (market.get("neighborhoodTrend") or "").upper()
    if current and prior and current < prior * 0.97 and trend == "STABLE":
        decline = 1 - current / prior
        findings.append(
            finding(
                code="GSE_MARKET_TREND_RECONCILIATION",
                label="Neighborhood trend reconciliation",
                extracted=f"Stable selected; median price declined {decline:.1%}",
                why="The narrative trend conflicts with the extracted market data.",
                severity="warning",
                authority="GSE appraisal quality review",
                program=program,
                page_index=0,
            )
        )
        conditions.append(
            condition(
                id="gse-market-trend",
                kind="ADMIN",
                text="Reconcile the stable neighborhood trend with declining market medians.",
                authority="GSE appraisal quality review",
                program=program,
            )
        )

    return findings, conditions
