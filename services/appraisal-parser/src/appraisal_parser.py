"""Native-text and AcroForm extraction for residential appraisal PDFs.

This parser intentionally does not perform OCR. Scanned/image-only PDFs are
accepted, but their extraction metadata reports that no native data was found.
"""

from __future__ import annotations

import datetime
import io
import re
from typing import Any, Optional

from pypdf import PdfReader
from pypdf.errors import PdfReadError


class AppraisalParseError(ValueError):
    """Raised when a payload is neither a readable PDF nor a text fixture."""


class AppraisalReviewParserV4:
    """Extract appraisal data from bytes without writing the document to disk."""

    column_layouts = {
        "comp1": {"x": 0.45, "w": 0.15},
        "comp2": {"x": 0.60, "w": 0.15},
        "comp3": {"x": 0.75, "w": 0.15},
    }
    row_layouts = {
        "proximity": {"y": 0.46, "h": 0.02},
        "salePrice": {"y": 0.49, "h": 0.02},
        "gla": {"y": 0.62, "h": 0.02},
        "site": {"y": 0.58, "h": 0.02},
        "view": {"y": 0.60, "h": 0.02},
        "netAdjustments": {"y": 0.82, "h": 0.02},
        "grossAdjustments": {"y": 0.84, "h": 0.02},
    }

    def parse_in_memory_stream(
        self,
        pdf_bytes: bytes,
        filename: str = "appraisal.pdf",
        expected_case: str | None = None,
    ) -> dict[str, Any]:
        if not isinstance(pdf_bytes, bytes) or not pdf_bytes:
            raise AppraisalParseError("The appraisal payload is empty.")

        text, form_fields, extraction = self._extract_source(pdf_bytes)
        searchable_text = "\n".join(
            [text, *(f"{name}: {value}" for name, value in form_fields.items())]
        )

        metadata = {
            "caseNumber": self._text_or_field(
                searchable_text, form_fields, r"(?:case|fha|va)\s*(?:number|no\.?|#)?", r"([\w-]{4,})"
            ),
            "expectedCaseNumber": expected_case,
            "propertyAddress": self._text_or_field(
                searchable_text,
                form_fields,
                r"(?:property|subject|street)\s*address|address",
                r"([^\n]+)",
            ),
            "borrowerName": self._text_or_field(
                searchable_text, form_fields, r"borrower(?:\s*name)?", r"([^\n]+)"
            ),
            "appraiserName": self._text_or_field(
                searchable_text, form_fields, r"appraiser\s*name|^appraiser$", r"([^\n]+)"
            ),
            "appraiserLicense": self._text_or_field(
                searchable_text,
                form_fields,
                r"appraiser.*(?:license|certification)|(?:license|certification).*(?:number|no|#)",
                r"([^\n]+)",
            ),
            "yearBuilt": self._parse_int(
                searchable_text, r"year\s*built\s*[:=]?\s*(\d{4})"
            ),
            "intendedUse": self._capture(
                searchable_text, r"intended\s+use\s*[:=]\s*([^\n]+)"
            ),
            "highestAndBestUse": self._parse_bool(
                searchable_text, form_fields, r"highest.*best.*use"
            ),
            "ownershipType": self._ownership(searchable_text),
            "appraisedValue": self._parse_money(
                searchable_text,
                r"(?:appraised|market|opinion\s+of)\s+value\s*[:=]?\s*\$?([\d,.]+)",
            ),
            "grossLivingArea": self._parse_number(
                searchable_text,
                r"(?:gross\s+living\s+area|gla)\s*[:=]?\s*([\d,.]+)",
            ),
        }

        transaction = {
            "isPurchaseTransaction": self._transaction_type(searchable_text),
            "isNonArmsLengthTransaction": self._keyword_bool(
                searchable_text,
                r"non[-\s]?arm(?:'|’)?s[-\s]?length|family\s+sale|relationship\s+between\s+parties",
            ),
            "priorSaleDate": self._parse_date(
                searchable_text,
                r"prior\s+sale(?:\s+or\s+transfer)?\s+date\s*[:=]?\s*([\d/-]+)",
            ),
            "priorSalePrice": self._parse_money(
                searchable_text,
                r"prior\s+sale(?:\s+or\s+transfer)?\s+(?:price|amount)\s*[:=]?\s*\$?([\d,.]+)",
            ),
            "contractDate": self._parse_date(
                searchable_text,
                r"(?:date\s+of\s+contract|contract\s+date)\s*[:=]?\s*([\d/-]+)",
            ),
            "contractSalesPrice": self._parse_money(
                searchable_text,
                r"(?:contract|purchase|sales?)\s+price\s*[:=]?\s*\$?([\d,.]+)",
            ),
        }

        physical = {
            "atticInspected": self._parse_bool(
                searchable_text, form_fields, r"attic.*inspect"
            ),
            "crawlspaceInspected": self._parse_bool(
                searchable_text, form_fields, r"crawl\s*space.*inspect"
            ),
            "utilitiesAreActive": self._utilities_active(searchable_text, form_fields),
            "septicWellVisualInspectionNoted": self._keyword_bool(
                searchable_text, r"(?:septic|well).*(?:visual|inspect)"
            ),
            "peelingPaintDetected": self._keyword_bool(
                searchable_text, r"peeling\s+paint|chipping\s+paint"
            ),
            "termiteActiveInfestationDetected": self._keyword_bool(
                searchable_text, r"termite\s+activity|active\s+infestation"
            ),
            "wellWaterPotabilityTestCleared": self._parse_bool(
                searchable_text, form_fields, r"(?:well.*potab|potab.*well)"
            ),
        }

        solar = {
            "hasSolarPanels": self._keyword_bool(
                searchable_text, r"solar\s+panels?|photovoltaic"
            ),
            "solarSystemIsLeased": self._keyword_bool(
                searchable_text, r"solar\s+(?:lease|ppa)|leased\s+solar"
            ),
            "solarSystemContributoryValueAdjustment": self._parse_money(
                searchable_text, r"solar\s+(?:value\s+)?adjustment\s*[:=]?\s*\$?([\d,.-]+)"
            ),
            "solarLeaseTransferRestrictionsPresent": self._keyword_bool(
                searchable_text, r"transfer\s+restriction|not\s+transferable"
            ),
        }

        commentary = [
            value
            for value in (
                self._commentary(searchable_text, "Neighborhood Commentary"),
                self._commentary(searchable_text, "Condition of Improvements"),
                self._commentary(searchable_text, "Comparables Commentary"),
                self._commentary(searchable_text, "Reconciliation Commentary"),
            )
            if value
        ]

        return {
            "document": {
                "filename": filename,
                **extraction,
            },
            "metadata": metadata,
            "transaction": transaction,
            "physicalConditionChecklist": physical,
            "solar": solar,
            "marketConditions1004MC": {
                "neighborhoodTrend": self._capture(
                    searchable_text,
                    r"neighborhood\s+trend\s*[:=]?\s*(stable|increasing|declining)",
                ),
                "medianPriceCurrentQuarter": self._parse_money(
                    searchable_text,
                    r"median\s+price\s+current\s+quarter\s*[:=]?\s*\$?([\d,.]+)",
                ),
                "medianPricePriorYearQuarter": self._parse_money(
                    searchable_text,
                    r"median\s+price\s+prior\s+year\s+quarter\s*[:=]?\s*\$?([\d,.]+)",
                ),
                "monthsSupplyCurrentQuarter": self._parse_number(
                    searchable_text,
                    r"months\s+supply\s+current\s+quarter\s*[:=]?\s*([\d.]+)",
                ),
            },
            "comparables": self._comparables(searchable_text),
            "commentaryTextBlocks": commentary,
            "formFields": form_fields,
        }

    def _extract_source(
        self, payload: bytes
    ) -> tuple[str, dict[str, str], dict[str, Any]]:
        if not payload.lstrip().startswith(b"%PDF-"):
            text = self._decode_text_fixture(payload)
            return text, {}, {
                "extractionMethod": "text-fixture",
                "pageCount": 1,
                "nativeTextPageCount": 1 if text.strip() else 0,
                "formFieldCount": 0,
                "warnings": ["non_pdf_text_fixture"],
            }

        try:
            reader = PdfReader(io.BytesIO(payload), strict=False)
            page_text: list[str] = []
            native_pages = 0
            warnings: list[str] = []
            for index, page in enumerate(reader.pages):
                try:
                    extracted = page.extract_text() or ""
                except Exception:
                    extracted = ""
                    warnings.append(f"page_{index + 1}_text_extraction_failed")
                if extracted.strip():
                    native_pages += 1
                page_text.append(extracted)
            fields = self._read_form_fields(reader)
            if native_pages == 0 and not fields:
                warnings.append("no_native_text_or_acroform_values")
            return "\n".join(page_text), fields, {
                "extractionMethod": "pypdf-native",
                "pageCount": len(reader.pages),
                "nativeTextPageCount": native_pages,
                "formFieldCount": len(fields),
                "warnings": warnings,
            }
        except (PdfReadError, OSError, ValueError) as error:
            # Existing unit fixtures historically prefixed plain text with
            # "%PDF-". Keep those tests readable without accepting arbitrary
            # corrupt binary as appraisal text.
            text = self._decode_text_fixture(payload)
            if not re.search(
                r"appraisal|urar|case\s*#|year\s+built|comparable\s+sale",
                text,
                re.IGNORECASE,
            ):
                raise AppraisalParseError(f"Unable to read PDF: {error}") from error
            return text, {}, {
                "extractionMethod": "text-fixture",
                "pageCount": 1,
                "nativeTextPageCount": 1,
                "formFieldCount": 0,
                "warnings": ["invalid_pdf_text_fixture_fallback"],
            }

    @staticmethod
    def _decode_text_fixture(payload: bytes) -> str:
        text = payload.decode("utf-8", errors="ignore").replace("\x00", "")
        printable = sum(char.isprintable() or char.isspace() for char in text)
        if not text or printable / len(text) < 0.85:
            raise AppraisalParseError("Payload is not a readable PDF or text fixture.")
        return text

    @staticmethod
    def _read_form_fields(reader: PdfReader) -> dict[str, str]:
        extracted: dict[str, str] = {}
        try:
            fields = reader.get_fields() or {}
        except Exception:
            fields = {}
        for name, field in fields.items():
            value = field.get("/V")
            if value is None:
                value = field.get("/AS")
            normalized = AppraisalReviewParserV4._normalize_pdf_value(value)
            if normalized is not None:
                extracted[str(name)] = normalized
        return extracted

    @staticmethod
    def _normalize_pdf_value(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, (list, tuple)):
            rendered = ", ".join(
                item for item in (AppraisalReviewParserV4._normalize_pdf_value(v) for v in value) if item
            )
            return rendered or None
        rendered = str(value).strip()
        if rendered.startswith("/"):
            rendered = rendered[1:]
        return rendered or None

    def _text_or_field(
        self,
        text: str,
        fields: dict[str, str],
        field_pattern: str,
        value_pattern: str,
    ) -> str | None:
        for name, value in fields.items():
            if re.search(field_pattern, self._humanize_field_name(name), re.IGNORECASE):
                return value
        label_pattern = field_pattern.strip("^$")
        return self._capture(
            text, rf"(?:{label_pattern})\s*[:=]\s*{value_pattern}"
        )

    def _parse_bool(
        self, text: str, fields: dict[str, str], label_pattern: str
    ) -> bool | None:
        for name, value in fields.items():
            if re.search(label_pattern, self._humanize_field_name(name), re.IGNORECASE):
                parsed = self._bool_value(value)
                if parsed is not None:
                    return parsed
        match = re.search(
            rf"(?:{label_pattern})[^\n:]{{0,40}}[:=]?\s*(yes|no|true|false|checked|unchecked|on|off)",
            text,
            re.IGNORECASE,
        )
        return self._bool_value(match.group(1)) if match else None

    @staticmethod
    def _bool_value(value: str) -> bool | None:
        normalized = value.strip().lower().lstrip("/")
        if normalized in {"yes", "true", "checked", "on", "1"}:
            return True
        if normalized in {"no", "false", "unchecked", "off", "0", "offstate"}:
            return False
        return None

    @staticmethod
    def _humanize_field_name(name: str) -> str:
        return re.sub(r"[_./-]+", " ", name)

    @staticmethod
    def _capture(text: str, pattern: str, flags: int = 0) -> str | None:
        match = re.search(pattern, text, flags | re.IGNORECASE)
        return match.group(1).strip() if match else None

    def _parse_int(self, text: str, pattern: str) -> int | None:
        value = self._capture(text, pattern)
        return int(value) if value else None

    def _parse_number(self, text: str, pattern: str) -> float | None:
        value = self._capture(text, pattern)
        if not value:
            return None
        try:
            return float(value.replace(",", ""))
        except ValueError:
            return None

    def _parse_money(self, text: str, pattern: str) -> float | None:
        return self._parse_number(text, pattern)

    def _parse_date(self, text: str, pattern: str) -> str | None:
        value = self._capture(text, pattern)
        if not value:
            return None
        for date_format in ("%m/%d/%Y", "%m-%d-%Y", "%Y-%m-%d"):
            try:
                return datetime.datetime.strptime(value, date_format).date().isoformat()
            except ValueError:
                continue
        return None

    def _ownership(self, text: str) -> str | None:
        if re.search(r"\bleasehold\b", text, re.IGNORECASE):
            return "LEASEHOLD"
        if re.search(r"\bfee\s+simple\b", text, re.IGNORECASE):
            return "FEE_SIMPLE"
        return None

    def _transaction_type(self, text: str) -> bool | None:
        if re.search(r"transaction\s+type\s*[:=]?\s*refinance", text, re.IGNORECASE):
            return False
        if re.search(r"transaction\s+type\s*[:=]?\s*purchase", text, re.IGNORECASE):
            return True
        return None

    @staticmethod
    def _keyword_bool(text: str, pattern: str) -> bool | None:
        saw_negative = False
        for match in re.finditer(pattern, text, re.IGNORECASE):
            line_start = text.rfind("\n", 0, match.start()) + 1
            line_end = text.find("\n", match.end())
            if line_end < 0:
                line_end = len(text)
            before = text[line_start:match.start()]
            after = text[match.end():line_end]
            negated_before = re.search(
                r"(?:\bno\b|\bnot\b|\bwithout\b)[^.;:\n]{0,30}$",
                before,
                re.IGNORECASE,
            )
            negated_after = re.match(
                r"\s*(?:(?::|=|\bis\b|\bwas\b|\bwere\b)\s*)?"
                r"(?:no|false|none|not\s+(?:present|detected)|absent)\b",
                after,
                re.IGNORECASE,
            )
            if negated_before or negated_after:
                saw_negative = True
                continue
            return True
        return False if saw_negative else None

    def _utilities_active(
        self, text: str, fields: dict[str, str]
    ) -> bool | None:
        explicit = self._parse_bool(text, fields, r"utilit(?:y|ies).*(?:active|on)")
        if explicit is not None:
            return explicit
        if re.search(r"utilities?\s+(?:are\s+)?(?:inactive|off)", text, re.IGNORECASE):
            return False
        if re.search(r"utilities?\s+(?:are\s+)?(?:active|on)", text, re.IGNORECASE):
            return True
        return None

    def _commentary(self, text: str, heading: str) -> str | None:
        return self._capture(
            text,
            rf"{re.escape(heading)}\s*[:=]\s*(.*?)(?=\n\s*\n|\n[A-Z][A-Za-z ]+\s*[:=]|\Z)",
            re.DOTALL,
        )

    def _comparables(self, text: str) -> list[dict[str, Any]]:
        indices = {
            int(value)
            for value in re.findall(
                r"(?:comparable\s+sale\s*#|comp\s*)(\d+)", text, re.IGNORECASE
            )
        }
        comparables: list[dict[str, Any]] = []
        for index in sorted(indices):
            col = self.column_layouts[f"comp{(index - 1) % 3 + 1}"]
            page_index = 1 if index <= 3 else 3
            comparables.append(
                {
                    "compIndex": index,
                    "salePrice": self._parse_money(
                        text, rf"comp\s*{index}\s+price\s*[:=]?\s*\$?([\d,.-]+)"
                    ),
                    "proximityMiles": self._parse_number(
                        text, rf"comp\s*{index}\s+distance\s*[:=]?\s*([\d.]+)"
                    ),
                    "netAdjustmentAmount": self._parse_money(
                        text, rf"comp\s*{index}\s+net\s+adj(?:ustment)?\s*[:=]?\s*\$?([\d,.-]+)"
                    ),
                    "grossAdjustmentAmount": self._parse_money(
                        text, rf"comp\s*{index}\s+gross\s+adj(?:ustment)?\s*[:=]?\s*\$?([\d,.-]+)"
                    ),
                    "cellCoordinates": {
                        name: {
                            "compIndex": index,
                            "field": name,
                            "pageIndex": page_index,
                            "box": [col["x"], row["y"], col["w"], row["h"]],
                        }
                        for name, row in self.row_layouts.items()
                    },
                }
            )
        return comparables
