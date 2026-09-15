"""Classify tax-form pages from in-memory OCR/native text. No PDF writes."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    from ai_pdf_converter import ConvertResult, PageResult

logger = logging.getLogger("freeflow.splitter")

CORE_RULES = {
    "Form 1040 (Individual Return)": re.compile(r"U\.S\. Individual Income Tax Return", re.IGNORECASE),
    "Schedule B (Interest & Dividends)": re.compile(r"Schedule B.*Interest and Ordinary Dividends", re.IGNORECASE),
    "Schedule C (Page 1 - Profits)": re.compile(r"Schedule C.*Profit or Loss From Business", re.IGNORECASE),
    "Schedule C (Page 2 - Mileage)": re.compile(
        r"Schedule C \(Form 1040\).*Page 2|Part IV.*Information on Your Vehicle|Part V.*Other Expenses",
        re.IGNORECASE,
    ),
    "Schedule D (Capital Gains)": re.compile(r"Schedule D.*Capital Gains and Losses", re.IGNORECASE),
    "Schedule E (Page 1 - Rentals)": re.compile(r"Schedule E.*Supplemental Income and Loss", re.IGNORECASE),
    "Schedule E (Page 2 - K-1s)": re.compile(
        r"Schedule E \(Form 1040\).*Page 2|Part II.*Income or Loss From Partnerships and S Corporations",
        re.IGNORECASE,
    ),
    "Schedule E (Part III Trusts)": re.compile(r"Part III.*Income or Loss From Estates and Trusts", re.IGNORECASE),
    "Schedule F (Farm Income)": re.compile(
        r"Schedule F(?:\s*\(Form 1040\))?.*Profit or Loss From Farming|Profit or Loss From Farming",
        re.IGNORECASE,
    ),
    "Form 1120S (S-Corporation Return)": re.compile(r"U\.S\. Income Tax Return for an S Corporation", re.IGNORECASE),
    "Form 1065 (Partnership Return)": re.compile(r"U\.S\. Return of Partnership Income", re.IGNORECASE),
    "Form 1120 (C-Corporation Return)": re.compile(r"U\.S\. Corporation Income Tax Return", re.IGNORECASE),
    "Schedule K-1 (1065)": re.compile(r"Schedule K-1\s*\(Form\s*1065\)", re.IGNORECASE),
    "Schedule K-1 (1120-S)": re.compile(r"Schedule K-1\s*\(Form\s*1120-?S\)", re.IGNORECASE),
    "Schedule K-1 (1041)": re.compile(r"Schedule K-1\s*\(Form\s*1041\)", re.IGNORECASE),
    "Schedule K-1": re.compile(r"Schedule K-1", re.IGNORECASE),
    "Form 8825 (Corporate Rentals)": re.compile(r"Form 8825.*Rental Real Estate Income and Expenses", re.IGNORECASE),
    "Form 4562 (Depreciation)": re.compile(r"Form 4562", re.IGNORECASE),
    "Schedule L": re.compile(r"Schedule L\s+Balance Sheets per Books", re.IGNORECASE),
    "Schedule M-1": re.compile(r"Schedule M-1", re.IGNORECASE),
    "Schedule M-2": re.compile(r"Schedule M-2", re.IGNORECASE),
    "W-2": re.compile(r"Wage and Tax Statement|Form\s+W-2", re.IGNORECASE),
    "Paystub": re.compile(
        r"Earnings Statement|Pay\s*Stub|Paystub|Payroll Statement|Pay\s+Statement|Pay\s+Advice|"
        r"Year[- ]to[- ]Date\s+(?:Gross|Earnings)|Current Period|Net Pay",
        re.IGNORECASE,
    ),
    "WVOE": re.compile(
        r"Written Verification of Employment|Verification of Employment|The Work Number|\bWVOE\b",
        re.IGNORECASE,
    ),
}

SEE_STATEMENT = re.compile(
    r"\b(?:see|refer\s+to|as\s+per)\s+(?:stmt|stat?e?ment|attached|schedule|sch|continuation)"
    r"(?:\s+\w+)?(?:\s+(?:attached|sheet|\d+))?\b|"
    r"\b(?:stmt|stat?e?ment|schedule|sch)(?:\s+\w+)?\s+attached\b",
    re.IGNORECASE,
)

STMT_TOKEN = re.compile(
    r"\b(?:see|refer\s+to|as\s+per)\s+(?:stmt|statement)\s+(\d+)\b",
    re.IGNORECASE,
)

SUPPLEMENTAL_RULES = {
    "Supporting Statements": re.compile(
        r"(Statement\s+\d+|Supplemental\s+Statement|Supporting\s+Schedule)",
        re.IGNORECASE,
    ),
    "Amortization Add-Backs": re.compile(
        r"Amortization\s+deduction|Casualty\s+Loss|Non-recurring\s+other",
        re.IGNORECASE,
    ),
}

# A W-2 back/instruction page can repeat the form title but contains none of
# the numbered wage/tax cells. Do not send it to extraction merely because its
# header OCR says "Form W-2".
W2_FRONT_SIGNATURE = re.compile(
    r"\b(?:Box\s*[1-6]|Wages[,\s]+tips|Medicare\s+wages|Social\s+security\s+wages|Federal\s+income\s+tax)\b",
    re.IGNORECASE,
)
W2_FRONT_LABELS = (
    re.compile(r"Wages[,\s]+tips", re.IGNORECASE),
    re.compile(r"Medicare\s+wages", re.IGNORECASE),
    re.compile(r"Social\s+security\s+wages", re.IGNORECASE),
    re.compile(r"Federal\s+income\s+tax", re.IGNORECASE),
)
W2_BACK_SIGNATURE = re.compile(
    r"\b(?:Instructions\s+for\s+(?:Employee|Employer)|"
    r"For\s+use\s+in\s+preparing\s+your\s+income\s+tax\s+return)\b",
    re.IGNORECASE,
)


def _has_w2_front_evidence(text: str) -> bool:
    return sum(bool(pattern.search(text)) for pattern in W2_FRONT_LABELS) >= 2


@dataclass
class StatementRef:
    page_index: int
    origin_forms: list[str]
    token: str | None
    snippet: str


@dataclass
class SplitResult:
    target_pages: list[int]
    classifications: dict[int, list[str]]
    statement_refs: list[StatementRef]
    unresolved_statements: list[StatementRef]
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "target_pages": self.target_pages,
            "classifications": {str(k): v for k, v in self.classifications.items()},
            "statement_refs": [
                {
                    "page_index": ref.page_index,
                    "origin_forms": ref.origin_forms,
                    "token": ref.token,
                    "snippet": ref.snippet,
                }
                for ref in self.statement_refs
            ],
            "unresolved_statements": [
                {
                    "page_index": ref.page_index,
                    "origin_forms": ref.origin_forms,
                    "token": ref.token,
                    "snippet": ref.snippet,
                }
                for ref in self.unresolved_statements
            ],
            "flags": self.flags,
        }


def pre_split_tax_returns(convert_result: "ConvertResult", output_pdf_path: str | None = None) -> SplitResult:
    """Classify pages from ConvertResult. output_pdf_path is ignored (ZDR: no sliced PDF)."""
    if output_pdf_path:
        logger.info("split_skip_pdf_write")

    pages: Iterable["PageResult"] = convert_result.pages
    total_pages = convert_result.page_count
    target_pages: set[int] = set()
    classifications: dict[int, list[str]] = {}
    statement_refs: list[StatementRef] = []
    page_texts: dict[int, str] = {}

    for page in pages:
        text = page.text()
        page_texts[page.index] = text
        if not text.strip():
            continue

        matched = [name for name, pattern in CORE_RULES.items() if pattern.search(text)]
        if "W-2" not in matched and _has_w2_front_evidence(text):
            matched.append("W-2")
        if "W-2" in matched and (W2_BACK_SIGNATURE.search(text) or not W2_FRONT_SIGNATURE.search(text)):
            matched.remove("W-2")
            logger.info("split_skip_w2_back index=%s", page.index)
        if "Schedule K-1" in matched:
            specific = [name for name in matched if name.startswith("Schedule K-1 (")]
            if specific:
                matched = [name for name in matched if name != "Schedule K-1"] + specific

        if matched:
            classifications[page.index] = matched
            target_pages.add(page.index)
            if any(term in "".join(matched) for term in ("Schedule C", "Schedule E", "Schedule F", "Form 1065", "Form 1120", "Form 1120S")):
                if SEE_STATEMENT.search(text):
                    token_match = STMT_TOKEN.search(text)
                    snippet = token_match.group(0) if token_match else "see statement"
                    statement_refs.append(
                        StatementRef(
                            page_index=page.index,
                            origin_forms=matched,
                            token=token_match.group(1) if token_match else None,
                            snippet=snippet[:120],
                        )
                    )

    if statement_refs:
        claimed: set[int] = set()
        for page_idx, text in page_texts.items():
            supp = [name for name, pattern in SUPPLEMENTAL_RULES.items() if pattern.search(text)]
            if not supp:
                continue
            target_pages.add(page_idx)
            classifications.setdefault(page_idx, [])
            for name in supp:
                if name not in classifications[page_idx]:
                    classifications[page_idx].append(name)
            claimed.add(page_idx)
            logger.info("statement_page index=%s labels=%s", page_idx, ",".join(supp))

        unresolved = []
        for ref in statement_refs:
            if ref.token:
                needle = re.compile(rf"Statement\s+{re.escape(ref.token)}\b", re.IGNORECASE)
                if not any(needle.search(page_texts.get(idx, "")) for idx in claimed):
                    unresolved.append(ref)
            elif not claimed:
                unresolved.append(ref)
    else:
        unresolved = []

    flags: list[str] = []
    sorted_targets = sorted(target_pages)
    if not sorted_targets:
        flags.append("no_core_forms_detected")
        logger.warning("split_no_targets pages=%s", total_pages)
    if unresolved:
        flags.append("unresolved_see_statement")

    return SplitResult(
        target_pages=sorted_targets,
        classifications=classifications,
        statement_refs=statement_refs,
        unresolved_statements=unresolved,
        flags=flags,
    )


def select_ocr_page_indices(inspected: Iterable[Any], split_result: SplitResult) -> set[int]:
    """OCR only keep-set pages that still need it. Scan packets with no labels OCR all."""
    pages = list(inspected)
    needs = {
        int(getattr(page, "index", index))
        for index, page in enumerate(pages)
        if getattr(page, "use_ocr", False)
    }
    if not needs:
        return set()
    hybrid_form_pages = {
        int(getattr(page, "index", index))
        for index, page in enumerate(pages)
        if "numeric_form_overlay_ocr_bypass" in getattr(page, "flags", [])
    }
    if hybrid_form_pages:
        logger.info("ocr_hybrid_form_pages pages=%s", sorted(hybrid_form_pages))
        return hybrid_form_pages
    kept = set(split_result.target_pages)
    if kept:
        selected = needs & kept
        logger.info("ocr_gated keep=%s ocr=%s skipped=%s", sorted(kept), sorted(selected), sorted(needs - selected))
        return selected
    if len(needs) * 2 >= max(len(pages), 1):
        logger.info("ocr_ungated_scan_packet pages=%s", sorted(needs))
        return needs
    logger.info("ocr_skipped_unrecognized needs=%s", sorted(needs))
    return set()
