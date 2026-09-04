"""FHA appraisal overlay."""

from __future__ import annotations

import datetime
from typing import Any

from .common import condition, finding


def evaluate(extracted: dict[str, Any], program: str) -> tuple[list[dict], list[dict]]:
    findings: list[dict] = []
    conditions: list[dict] = []
    metadata = extracted["metadata"]
    physical = extracted["physicalConditionChecklist"]
    transaction = extracted["transaction"]

    if (
        metadata.get("yearBuilt")
        and metadata["yearBuilt"] < 1978
        and physical.get("peelingPaintDetected") is True
    ):
        findings.append(
            finding(
                code="FHA_PRE_1978_DEFECTIVE_PAINT",
                label="Pre-1978 defective paint",
                extracted=f"Built {metadata['yearBuilt']}; peeling or chipping paint reported",
                why="Defective paint on a pre-1978 property requires lead-safe correction.",
                severity="error",
                authority="HUD Handbook 4000.1",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="fha-defective-paint",
                kind="REPAIR",
                text="Correct defective paint using lead-safe work practices and provide completion evidence.",
                authority="HUD Handbook 4000.1",
                program=program,
            )
        )

    missing_inspections = [
        label
        for key, label in (
            ("atticInspected", "attic"),
            ("crawlspaceInspected", "crawlspace"),
        )
        if physical.get(key) is False
    ]
    if physical.get("utilitiesAreActive") is False:
        missing_inspections.append("active utilities")
    if missing_inspections:
        rendered = ", ".join(missing_inspections)
        findings.append(
            finding(
                code="FHA_MPR_INSPECTION_INCOMPLETE",
                label="Minimum property inspection incomplete",
                extracted=rendered,
                why="The appraisal explicitly reports incomplete MPR inspection items.",
                severity="error",
                authority="HUD Handbook 4000.1",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="fha-mpr-reinspection",
                kind="INSPECTION",
                text=f"Complete and document the following FHA inspection items: {rendered}.",
                authority="HUD Handbook 4000.1",
                program=program,
            )
        )

    days = _days_between(transaction.get("priorSaleDate"), transaction.get("contractDate"))
    if transaction.get("isPurchaseTransaction") is True and days is not None and 0 <= days < 90:
        findings.append(
            finding(
                code="FHA_PROPERTY_FLIP_REVIEW",
                label="FHA property-flipping review",
                extracted=f"{days} days from prior sale to contract",
                why="A resale within 90 days requires eligibility review for an applicable exception.",
                severity="error",
                authority="HUD Handbook 4000.1",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="fha-property-flip",
                kind="ADMIN",
                text="Document an applicable FHA property-flipping exception or resolve ineligibility.",
                authority="HUD Handbook 4000.1",
                program=program,
            )
        )

    solar = extracted["solar"]
    if (
        solar.get("solarSystemIsLeased") is True
        and (solar.get("solarSystemContributoryValueAdjustment") or 0) != 0
    ):
        findings.append(
            finding(
                code="FHA_LEASED_SOLAR_VALUE",
                label="Leased solar contributory value",
                extracted=f"${solar['solarSystemContributoryValueAdjustment']:,.0f} adjustment",
                why="Leased equipment cannot contribute to the appraised real-property value.",
                severity="error",
                authority="HUD Handbook 4000.1",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="fha-leased-solar-value",
                kind="ADMIN",
                text="Remove contributory value attributable to the leased solar system.",
                authority="HUD Handbook 4000.1",
                program=program,
            )
        )

    return findings, conditions


def _days_between(first: str | None, second: str | None) -> int | None:
    if not first or not second:
        return None
    try:
        return (
            datetime.date.fromisoformat(second) - datetime.date.fromisoformat(first)
        ).days
    except ValueError:
        return None
