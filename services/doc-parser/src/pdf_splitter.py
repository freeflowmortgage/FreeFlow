"""Classify tax-form pages from in-memory OCR/native text. No PDF writes."""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Iterable

from ocr_match import folded_text, pattern_matches
from form_signatures import (
    PAYSTUB_TITLE,
    W2_BACK_FOLDED,
    W2_BACK_SIGNATURE,
    W2_FRONT_FOLDED,
    W2_FRONT_LABELS,
    W2_FRONT_SIGNATURE,
    W2_TITLE,
    WVOE_TITLE,
)

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
    # Some preparer suites emit page content out of visual order, placing the
    # "SCHEDULE E" masthead after the "Supplemental Income and Loss" subtitle
    # and a page apart in the text stream. Title-then-subtitle then never
    # matches, so the Part I caption is carried as its own signature. It is
    # unique to page 1; page 2 opens Part II on partnerships and S corporations.
    "Schedule E (Page 1 - Rentals)": re.compile(
        r"Schedule E.*Supplemental Income and Loss|"
        r"Income or Loss From Rental Real Estate and Royalties",
        re.IGNORECASE,
    ),
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
    "W-2": W2_TITLE,
    "Paystub": PAYSTUB_TITLE,
    "WVOE": WVOE_TITLE,
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

# URLA/Form 1003 is an origination document, not an income document. Detect it
# after OCR so callers can route it to the separate AI 1003 workflow without
# treating a scanned application as a malformed income extraction.
URLA_1003 = re.compile(
    r"Uniform\s+Residential\s+Loan\s+Application|"
    r"Fannie\s+Mae\s+Form\s+1003|Freddie\s+Mac\s+Form\s+65",
    re.IGNORECASE,
)

# A W-2 back/instruction page can repeat the form title but contains none of
# the numbered wage/tax cells. Do not send it to extraction merely because its
# header OCR says "Form W-2".
def _is_w2_front_page(text: str) -> bool:
    if pattern_matches(W2_FRONT_SIGNATURE, text):
        return True
    folded = folded_text(text)
    return any(needle in folded for needle in W2_FRONT_FOLDED)


def _is_w2_back_page(text: str) -> bool:
    if W2_BACK_SIGNATURE.search(text or ""):
        return True
    folded = folded_text(text)
    return any(needle in folded for needle in W2_BACK_FOLDED)


# The form title "wage and tax statement" is on instruction pages too.
# These four are the numbered wage cells.
_W2_WAGE_BOX_FOLDED = tuple(needle for needle in W2_FRONT_FOLDED if needle != "wageandtaxstatement")


def _has_w2_front_evidence(text: str) -> bool:
    """True when two wage-box labels are present, with or without spaces between words."""
    if sum(bool(pattern.search(text or "")) for pattern in W2_FRONT_LABELS) >= 2:
        return True
    folded = folded_text(text)
    return sum(needle in folded for needle in _W2_WAGE_BOX_FOLDED) >= 2


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
    urla_1003_detected = False

    for page in pages:
        text = page.text()
        page_texts[page.index] = text
        if not text.strip():
            continue

        # Native PDF extraction commonly inserts newlines between a form name
        # and its subtitle. Classifiers describe the visual line, so search a
        # whitespace-normalized view while retaining raw text for glued OCR.
        # Collapse runs of spaces and tabs, but keep line breaks. Folding
        # newlines into spaces let a pattern's `.*` run the length of the page,
        # so Schedule E page 1 matched the page 2 rule on its own instruction
        # text ("report farm rental income ... on page 2, line 40") plus the
        # "Schedule E (Form 1040)" footer, and a rental page was routed onto
        # the partnership tab.
        search_text = re.sub(r"[^\S\n]+", " ", text).strip()
        if pattern_matches(URLA_1003, text) or pattern_matches(URLA_1003, search_text):
            urla_1003_detected = True

        matched = [
            name
            for name, pattern in CORE_RULES.items()
            if pattern_matches(pattern, text) or pattern_matches(pattern, search_text)
        ]
        if "W-2" not in matched and (_has_w2_front_evidence(search_text) or _has_w2_front_evidence(text)):
            matched.append("W-2")
        is_front = _is_w2_front_page(text) or _is_w2_front_page(search_text)
        is_back = _is_w2_back_page(text) or _is_w2_back_page(search_text)
        # Copy C's "Notice to Employee" is often printed on the same sheet as Copy 2.
        # Wage-box labels keep the page. Drop only a real instruction sheet.
        has_wage_boxes = _has_w2_front_evidence(text) or _has_w2_front_evidence(search_text)
        if "W-2" in matched and not has_wage_boxes and (is_back or not is_front):
            matched.remove("W-2")
            logger.info("split_skip_w2_back index=%s", page.index)
        # Schedule E Part II reports income from K-1s and names the forms it
        # accepts, so the page reads like every K-1 at once. It is where K-1
        # income lands, not a K-1 itself, and labelling it as one sent the
        # rental page to the 1065 and 1120-S tabs.
        if "Schedule E (Page 2 - K-1s)" in matched:
            dropped = [name for name in matched if name.startswith("Schedule K-1")]
            if dropped:
                matched = [name for name in matched if not name.startswith("Schedule K-1")]
                logger.info("split_skip_k1_on_schedule_e index=%s dropped=%s", page.index, dropped)

        if "Schedule K-1" in matched:
            # The specific labels are already present; only the generic one is
            # removed. Re-appending them duplicated every K-1 label.
            specific = [name for name in matched if name.startswith("Schedule K-1 (")]
            if specific:
                matched = [name for name in matched if name != "Schedule K-1"]

        if matched:
            classifications[page.index] = matched
            target_pages.add(page.index)
            if any(term in "".join(matched) for term in ("Schedule C", "Schedule E", "Schedule F", "Form 1065", "Form 1120", "Form 1120S")):
                if SEE_STATEMENT.search(search_text):
                    token_match = STMT_TOKEN.search(search_text)
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
            supp = [name for name, pattern in SUPPLEMENTAL_RULES.items() if pattern_matches(pattern, text)]
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
    if urla_1003_detected:
        flags.append("urla_1003_detected")
    if unresolved:
        flags.append("unresolved_see_statement")

    return SplitResult(
        target_pages=sorted_targets,
        classifications=classifications,
        statement_refs=statement_refs,
        unresolved_statements=unresolved,
        flags=flags,
    )


OCR_PAGE_BUDGET = int(os.environ.get("OCR_PAGE_BUDGET", "80"))
"""Ceiling on pages OCR'd in one request, to bound latency on huge packets."""


def select_ocr_page_indices(inspected: Iterable[Any], split_result: SplitResult) -> set[int]:
    """Choose which pages to OCR.

    Every page without a usable text layer is selected. The keep set cannot be
    used to narrow this: it comes from the preview pass, which classifies pages
    from native text only, so an image-only page is never in it. Gating on the
    keep set therefore skipped exactly the pages that needed OCR most, and a
    borrower's scanned return inside an otherwise native packet was dropped
    with nothing but an INFO log to show for it.

    Only the page budget removes work now, and it prefers already-recognized
    pages and reports the shortfall to the caller.
    """
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

    if len(needs) <= OCR_PAGE_BUDGET:
        logger.info("ocr_selected pages=%s", sorted(needs))
        return needs

    kept = set(split_result.target_pages)
    prioritized = sorted(needs & kept) + sorted(needs - kept)
    selected = set(prioritized[:OCR_PAGE_BUDGET])
    logger.warning(
        "ocr_budget_exceeded budget=%s needed=%s skipped=%s",
        OCR_PAGE_BUDGET,
        len(needs),
        sorted(needs - selected),
    )
    return selected
