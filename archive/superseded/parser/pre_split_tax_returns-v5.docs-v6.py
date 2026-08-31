# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - FORM CLASSIFIER & ENTITY GROUPER (pre_split_tax_returns-v5.py)
# =============================================================================
# Upgraded with Multi-Entity Business Partitioning and Context Boundaries [cite: 30, 38].
# Automatically extracts Business Names/EINs to group associated schedules under distinct entityIds [cite: 38].
# =============================================================================

from __future__ import annotations
import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ai_pdf_converter import ConvertResult, PageResult

logger = logging.getLogger("freeflow.splitter")

# Highly robust, non-backtracking regular expressions for core tax forms [cite: 30, 85]
CORE_RULES = {
    "Form 1040 (Individual Return)": re.compile(r"U\.S\.\s+Individual\s+Income\s+Tax\s+Return", re.IGNORECASE),
    "Schedule B (Interest & Dividends)": re.compile(r"Schedule\s+B.*Interest\s+and\s+Ordinary\s+Dividends", re.IGNORECASE),
    "Schedule C (Page 1 - Profits)": re.compile(r"Schedule\s+C.*Profit\s+or\s+Loss\s+From\s+Business", re.IGNORECASE),
    "Schedule C (Page 2 - Mileage)": re.compile(r"Schedule\s+C\s+\(Form\s+1040\).*Page\s+2|Part\s+IV.*Information\s+on\s+Your\s+Vehicle", re.IGNORECASE),
    "Schedule D (Capital Gains)": re.compile(r"Schedule\s+D.*Capital\s+Gains\s+and\s+Losses", re.IGNORECASE),
    "Schedule E (Page 1 - Rentals)": re.compile(r"Schedule\s+E.*Supplemental\s+Income\s+and\s+Loss", re.IGNORECASE),
    "Schedule E (Page 2 - K-1s)": re.compile(r"Schedule\s+E\s+\(Form\s+1040\).*Page\s+2|Part\s+II.*Income\s+or\s+Loss\s+From\s+Partnerships\s+and\s+S\s+Corporations", re.IGNORECASE),
    "Form 1120S (S-Corporation Return)": re.compile(r"U\.S\.\s+Income\s+Tax\s+Return\s+for\s+an\s+S\s+Corporation", re.IGNORECASE),
    "Form 1065 (Partnership Return)": re.compile(r"U\.S\.\s+Return\s+of\s+Partnership\s+Income", re.IGNORECASE),
    "Form 1120 (C-Corporation Return)": re.compile(r"U\.S\.\s+Corporation\s+Income\s+Tax\s+Return", re.IGNORECASE),
    "Schedule K-1 (1065)": re.compile(r"Schedule\s+K-1\s*\(Form\s+1065\)", re.IGNORECASE),
    "Schedule K-1 (1120-S)": re.compile(r"Schedule\s+K-1\s*\(Form\s+1120-?S\)", re.IGNORECASE),
    "Form 8825 (Corporate Rentals)": re.compile(r"Form\s+8825.*Rental\s+Real\s+Estate\s+Income", re.IGNORECASE),
    "Form 4562 (Depreciation)": re.compile(r"Form\s+4562|Depreciation\s+and\s+Amortization", re.IGNORECASE),
    "Schedule L": re.compile(r"Schedule\s+L\s+Balance\s+Sheets\s+per\s+Books", re.IGNORECASE),
    "W-2": re.compile(r"Wage\s+and\s+Tax\s+Statement|Form\s+W-2", re.IGNORECASE)
}

SEE_STATEMENT = re.compile(
    r"\b(?:see|refer\s+to|as\s+per)\s+(?:stmt|stat?e?ment|attached|schedule|sch|continuation)"
    r"(?:\s+\w+)?(?:\s+(?:attached|sheet|\d+))?\b|"
    r"\b(?:stmt|stat?e?ment|schedule|sch)(?:\s+\w+)?\s+attached\b",
    re.IGNORECASE
)

# Target expressions to extract Business Identity and EINs [cite: 38]
EIN_REGEX = re.compile(r"\b(?:employer\s+identification\s+number|ein|employer\s+id)\s*[:#\-]?\s*(\d{2}\-\d{7})\b", re.IGNORECASE)
BIZ_NAME_REGEX_C = re.compile(r"Name\s+of\s+proprietor\s*(.*?)\n|Principal\s+business\s+or\s+profession\s*(.*?)\n", re.IGNORECASE)
BIZ_NAME_REGEX_CORP = re.compile(r"Form\s+1120S?\s+.*?\s+Name\s*(.*?)\n|Form\s+1065\s+.*?\s+Name\s*(.*?)\n", re.IGNORECASE)

@dataclass
class StatementRef:
    page_index: int
    origin_forms: list[str]
    token: str | None
    snippet: str

@dataclass
class BusinessEntity:
    entity_id: str
    entity_type: str
    name: str
    ein: str | None
    pages: list[int] = field(default_factory=list)
    extracted_data: dict[str, Any] = field(default_factory=dict)

@dataclass
class SplitResult:
    target_pages: list[int]
    classifications: dict[int, list[str]]
    entities: list[dict[str, Any]]
    statement_refs: list[StatementRef]
    unresolved_statements: list[StatementRef]
    flags: list[str] = field(default_factory=list)

def pre_split_tax_returns(convert_result: ConvertResult) -> SplitResult:
    """Classifies pages, identifies statements, and groups associated pages into distinct business entities [cite: 30, 38]."""
    target_pages = []
    classifications = {}
    entities_map: dict[str, BusinessEntity] = {}
    statement_refs = []
    
    logger.info("Initializing multi-entity document taxonomy analysis [cite: 30, 38].")

    for page in convert_result.pages:
        idx = page.index
        text = page.plain_text
        
        # 1. Standard classification matches [cite: 85]
        matched_rules = []
        for name, pattern in CORE_RULES.items():
            if pattern.search(text):
                matched_rules.append(name)
                
        if matched_rules:
            classifications[idx] = matched_rules
            target_pages.append(idx)
            
            # 2. Extract context details to partition separate business entities [cite: 38]
            ein_match = EIN_REGEX.search(text)
            ein = ein_match.group(1) if ein_match else None
            
            entity_type = "UNKNOWN"
            biz_name = "Sole Proprietorship"
            
            if any("Schedule C" in rule for rule in matched_rules):
                entity_type = "SCHEDULE_C"
                name_match = BIZ_NAME_REGEX_C.search(text)
                if name_match:
                    biz_name = name_match.group(1) or name_match.group(2) or "Sole Proprietor Business"
                biz_name = biz_name.strip()
            elif any("1120S" in rule for rule in matched_rules):
                entity_type = "FORM_1120S"
                name_match = BIZ_NAME_REGEX_CORP.search(text)
                biz_name = name_match.group(1) if name_match else "S-Corporation Entity"
                biz_name = biz_name.strip()
            elif any("1065" in rule for rule in matched_rules):
                entity_type = "FORM_1065"
                name_match = BIZ_NAME_REGEX_CORP.search(text)
                biz_name = name_match.group(2) if name_match else "Partnership Entity"
                biz_name = biz_name.strip()
                
            # Create a unique key using either EIN or clean business name [cite: 38]
            entity_key = ein if ein else f"{entity_type}_{biz_name.upper().replace(' ', '_')}"
            
            if entity_type != "UNKNOWN":
                if entity_key not in entities_map:
                    entities_map[entity_key] = BusinessEntity(
                        entity_id=entity_key,
                        entity_type=entity_type,
                        name=biz_name,
                        ein=ein
                    )
                entities_map[entity_key].pages.append(idx)
                
            # 3. Check for 'See Statement' pointers [cite: 30, 86]
            if SEE_STATEMENT.search(text):
                statement_refs.append(StatementRef(
                    page_index=idx,
                    origin_forms=matched_rules,
                    token=None,
                    snippet=text[:100].replace("\n", " ") + "..."
                ))

    # Format mapped entities for standard API output payloads
    formatted_entities = []
    for key, entity in entities_map.items():
        formatted_entities.append({
            "entityId": entity.entity_id,
            "entityType": entity.entity_type,
            "businessName": entity.name,
            "ein": entity.ein,
            "associatedPages": entity.pages
        })

    return SplitResult(
        target_pages=sorted(target_pages),
        classifications=classifications,
        entities=formatted_entities,
        statement_refs=statement_refs,
        unresolved_statements=[],
        flags=["MULTI_ENTITY_PARTITIONING_ENABLED"]
    )
