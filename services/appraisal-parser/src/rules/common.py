"""Rules shared by every appraisal program."""

from __future__ import annotations

from typing import Any


def finding(
    *,
    code: str,
    label: str,
    extracted: str,
    why: str,
    severity: str,
    authority: str,
    program: str,
    page_index: int | None = None,
    box: list[float] | None = None,
) -> dict[str, Any]:
    return {
        "code": code,
        "label": label,
        "extracted": extracted,
        "why": why,
        "severity": severity,
        "authority": authority,
        "program": program,
        "pageIndex": page_index,
        "box": box,
    }


def condition(
    *,
    id: str,
    kind: str,
    text: str,
    authority: str,
    program: str,
) -> dict[str, str]:
    return {
        "id": id,
        "kind": kind,
        "text": text,
        "authority": authority,
        "program": program,
    }


def evaluate(extracted: dict[str, Any], program: str) -> tuple[list[dict], list[dict]]:
    findings: list[dict] = []
    conditions: list[dict] = []
    document = extracted["document"]
    metadata = extracted["metadata"]

    if document["nativeTextPageCount"] == 0 and document["formFieldCount"] == 0:
        findings.append(
            finding(
                code="APPRAISAL_NO_EXTRACTABLE_DATA",
                label="No native appraisal data extracted",
                extracted="No native text or populated AcroForm values",
                why="This service does not perform OCR; review an image-only appraisal manually.",
                severity="warning",
                authority="FreeFlow appraisal ingestion control",
                program=program,
            )
        )

    case_number = metadata.get("caseNumber")
    expected_case = metadata.get("expectedCaseNumber")
    if case_number and expected_case and case_number != expected_case:
        findings.append(
            finding(
                code="APPRAISAL_CASE_NUMBER_MISMATCH",
                label="Case number mismatch",
                extracted=f"Appraisal {case_number}; expected {expected_case}",
                why="The case identifier in the appraisal does not match the request header.",
                severity="error",
                authority="Appraisal identity control",
                program=program,
                page_index=0,
            )
        )
        conditions.append(
            condition(
                id="case-number-mismatch",
                kind="ADMIN",
                text="Resolve the appraisal case-number mismatch before collateral approval.",
                authority="Appraisal identity control",
                program=program,
            )
        )

    commentary = " ".join(extracted.get("commentaryTextBlocks", []))
    hazard_words = [
        word
        for word in ("mold", "dampness", "foundation crack", "structural damage")
        if word in commentary.lower()
    ]
    if hazard_words:
        rendered = ", ".join(hazard_words)
        findings.append(
            finding(
                code="APPRAISAL_COMMENTARY_HAZARD",
                label="Potential property hazard in commentary",
                extracted=rendered,
                why="Appraisal commentary contains terms requiring a qualified review.",
                severity="warning",
                authority="Appraisal condition review",
                program=program,
            )
        )
        conditions.append(
            condition(
                id="commentary-hazard",
                kind="REDFLAG",
                text=f"Review and clear the appraisal commentary hazard terms: {rendered}.",
                authority="Appraisal condition review",
                program=program,
            )
        )

    return findings, conditions
