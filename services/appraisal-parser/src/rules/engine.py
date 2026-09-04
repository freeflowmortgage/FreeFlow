"""Program dispatch for deterministic appraisal rules."""

from __future__ import annotations

from typing import Any, Callable

from . import common, fha, gse, usda, va

RULE_VERSION = "appraisal-rules-2026.09.1"
SUPPORTED_PROGRAMS = ("CONV", "FHA", "VA", "USDA")

Overlay = Callable[[dict[str, Any], str], tuple[list[dict], list[dict]]]

_PROGRAM_OVERLAYS: dict[str, tuple[Overlay, ...]] = {
    "CONV": (gse.evaluate,),
    "FHA": (fha.evaluate,),
    "VA": (va.evaluate,),
    "USDA": (usda.evaluate,),
}


def run_appraisal_rules(
    extracted: dict[str, Any], program: str
) -> tuple[list[dict], list[dict]]:
    normalized = program.upper()
    if normalized not in _PROGRAM_OVERLAYS:
        raise ValueError(f"Unsupported appraisal program: {program}")

    findings, conditions = common.evaluate(extracted, normalized)
    for overlay in _PROGRAM_OVERLAYS[normalized]:
        overlay_findings, overlay_conditions = overlay(extracted, normalized)
        findings.extend(overlay_findings)
        conditions.extend(overlay_conditions)
    return findings, conditions
