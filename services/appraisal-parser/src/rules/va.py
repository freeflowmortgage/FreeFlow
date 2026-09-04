"""VA appraisal and minimum-property-requirements overlay."""

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
                code="VA_PRE_1978_DEFECTIVE_PAINT",
                label="VA defective-paint MPR",
                extracted=f"Built {metadata['yearBuilt']}; defective paint reported",
                why="Defective paint must be corrected before the property meets VA MPRs.",
                severity="error",
                authority="VA Pamphlet 26-7, Minimum Property Requirements",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="va-defective-paint",
                kind="REPAIR",
                text="Correct defective paint and provide evidence for the VA MPR review.",
                authority="VA Pamphlet 26-7",
                program=program,
            )
        )

    incomplete = [
        label
        for key, label in (
            ("atticInspected", "attic"),
            ("crawlspaceInspected", "crawlspace"),
        )
        if physical.get(key) is False
    ]
    if physical.get("utilitiesAreActive") is False:
        incomplete.append("active utilities")
    if incomplete:
        rendered = ", ".join(incomplete)
        findings.append(
            finding(
                code="VA_MPR_INSPECTION_INCOMPLETE",
                label="VA MPR inspection incomplete",
                extracted=rendered,
                why="The appraisal explicitly identifies MPR areas that were not observed or tested.",
                severity="error",
                authority="VA Pamphlet 26-7",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="va-mpr-reinspection",
                kind="INSPECTION",
                text=f"Complete the VA MPR inspection for: {rendered}.",
                authority="VA Pamphlet 26-7",
                program=program,
            )
        )

    if physical.get("termiteActiveInfestationDetected") is True:
        findings.append(
            finding(
                code="VA_ACTIVE_WDI",
                label="Active wood-destroying insect evidence",
                extracted="Active termite or infestation language detected",
                why="Active infestation requires treatment and clearance.",
                severity="error",
                authority="VA Pamphlet 26-7",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="va-wdi-clearance",
                kind="INSPECTION",
                text="Provide treatment and wood-destroying insect clearance.",
                authority="VA Pamphlet 26-7",
                program=program,
            )
        )

    return findings, conditions
