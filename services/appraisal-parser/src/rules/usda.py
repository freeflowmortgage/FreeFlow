"""USDA single-family housing appraisal overlay."""

from __future__ import annotations

from typing import Any

from .common import condition, finding


def evaluate(extracted: dict[str, Any], program: str) -> tuple[list[dict], list[dict]]:
    findings: list[dict] = []
    conditions: list[dict] = []
    metadata = extracted["metadata"]
    physical = extracted["physicalConditionChecklist"]

    if (
        metadata.get("yearBuilt")
        and metadata["yearBuilt"] < 1978
        and physical.get("peelingPaintDetected") is True
    ):
        findings.append(
            finding(
                code="USDA_PRE_1978_DEFECTIVE_PAINT",
                label="USDA defective-paint review",
                extracted=f"Built {metadata['yearBuilt']}; defective paint reported",
                why="The reported condition must be corrected for program property acceptability.",
                severity="error",
                authority="USDA SFH Guaranteed Loan Program Technical Handbook",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="usda-defective-paint",
                kind="REPAIR",
                text="Correct defective paint and document property acceptability.",
                authority="USDA SFH Guaranteed Loan Program Technical Handbook",
                program=program,
            )
        )

    if physical.get("utilitiesAreActive") is False:
        findings.append(
            finding(
                code="USDA_UTILITIES_INACTIVE",
                label="Utilities inactive at appraisal",
                extracted="Utilities explicitly reported inactive",
                why="Utilities must be available to verify that property systems operate safely.",
                severity="error",
                authority="USDA SFH Guaranteed Loan Program Technical Handbook",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="usda-utilities-reinspection",
                kind="INSPECTION",
                text="Activate utilities and verify operation of property systems.",
                authority="USDA SFH Guaranteed Loan Program Technical Handbook",
                program=program,
            )
        )

    if physical.get("wellWaterPotabilityTestCleared") is False:
        findings.append(
            finding(
                code="USDA_WELL_POTABILITY_NOT_CLEARED",
                label="Private well potability not cleared",
                extracted="Well-water test explicitly reported failed or not cleared",
                why="Safe potable water is required for property acceptability.",
                severity="error",
                authority="USDA SFH Guaranteed Loan Program Technical Handbook",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="usda-well-potability",
                kind="INSPECTION",
                text="Provide a passing private-well potability test.",
                authority="USDA SFH Guaranteed Loan Program Technical Handbook",
                program=program,
            )
        )

    return findings, conditions
