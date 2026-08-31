"""Thread-safe FastAPI gateway for the in-memory document parser."""

from __future__ import annotations

import logging
import re
import threading
import uuid
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from ai_pdf_converter import MAX_PDF_BYTES, AIPDFConverter
from pdf_splitter import pre_split_tax_returns

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s %(message)s")
logger = logging.getLogger("freeflow.server")
logging.getLogger("freeflow.ocr").setLevel(logging.INFO)
logging.getLogger("freeflow.splitter").setLevel(logging.INFO)

app = FastAPI(
    title="FreeFlow Document Parser",
    description="Thread-safe, non-blocking in-memory document parsing and classification gateway.",
    version="6.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_converter: AIPDFConverter | None = None
_converter_init_lock = threading.Lock()
_parser_lock = threading.Lock()
_ein_pattern = re.compile(
    r"\b(?:employer\s+identification\s+number|ein|employer\s+id)"
    r"\s*[:#-]?\s*(\d{2}-\d{7})\b",
    re.IGNORECASE,
)
_business_name_pattern = re.compile(
    r"(?:name\s+of\s+proprietor|business\s+name|name\s+of\s+corporation)"
    r"\s*[:#-]?\s*([^\n]{2,100})",
    re.IGNORECASE,
)


def get_converter() -> AIPDFConverter:
    global _converter
    if _converter is None:
        with _converter_init_lock:
            if _converter is None:
                _converter = AIPDFConverter()
    return _converter


@app.get("/health", status_code=status.HTTP_200_OK)
def health_check() -> dict[str, Any]:
    return {
        "status": "HEALTHY",
        "service": "FreeFlow Document Processing Engine",
        "version": "6.0.0",
        "resources": {"vCPU": "4.0", "RAM": "16.0 GB"},
    }


async def _read_pdf_bytes(request: Request) -> tuple[bytes, str]:
    content_type = (request.headers.get("content-type") or "").lower()
    if "application/pdf" in content_type:
        data = await request.body()
        name = request.headers.get("x-document-title") or "document.pdf"
        return data, name

    form = await request.form()
    upload = form.get("file")
    if upload is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Expected an application/pdf body or multipart file field.",
        )
    data = await upload.read()
    name = getattr(upload, "filename", None) or "document.pdf"
    return data, name


def _serialize_page(page: Any, form_ids: list[str]) -> dict[str, Any]:
    words = [word.to_dict() for word in page.words]
    return {
        "index": page.index,
        "formIds": form_ids,
        "isNativeText": page.is_native_text,
        "width": page.width_px,
        "height": page.height_px,
        "words": words,
        "plainText": page.text(),
        "meanConfidence": page.mean_confidence,
        "skewDegrees": page.skew_degrees,
        "flags": page.flags,
    }


def _extract_entities(convert_result: Any, classifications: dict[int, list[str]]) -> list[dict[str, Any]]:
    entities: dict[str, dict[str, Any]] = {}
    pages_by_index = {page.index: page for page in convert_result.pages}

    for page_index, page_labels in classifications.items():
        joined_labels = " ".join(page_labels)
        if "Schedule C" in joined_labels:
            entity_type = "SCHEDULE_C"
            default_name = "Sole Proprietorship"
        elif "1120S" in joined_labels or "1120-S" in joined_labels:
            entity_type = "FORM_1120S"
            default_name = "S-Corporation Entity"
        elif "1065" in joined_labels:
            entity_type = "FORM_1065"
            default_name = "Partnership Entity"
        elif "1120" in joined_labels:
            entity_type = "FORM_1120"
            default_name = "C-Corporation Entity"
        else:
            continue

        text = pages_by_index[page_index].text()
        ein_match = _ein_pattern.search(text)
        name_match = _business_name_pattern.search(text)
        ein = ein_match.group(1) if ein_match else None
        business_name = name_match.group(1).strip() if name_match else default_name
        entity_id = ein or f"{entity_type}_{business_name.upper().replace(' ', '_')}"
        entity = entities.setdefault(
            entity_id,
            {
                "entityId": entity_id,
                "entityType": entity_type,
                "businessName": business_name,
                "ein": ein,
                "associatedPages": [],
            },
        )
        entity["associatedPages"].append(page_index)

    return list(entities.values())


def _parse_document(
    pdf_bytes: bytes,
    transaction_id: str,
    original_name: str,
    loan_id: str | None,
    loan_program: str | None,
) -> dict[str, Any]:
    # RapidOCR's shared ONNX session is not guaranteed to be re-entrant.
    with _parser_lock:
        convert_result = get_converter().convert_to_ai_ready(pdf_bytes)
        split_result = pre_split_tax_returns(convert_result)
    del pdf_bytes

    target_pages = set(split_result.target_pages)
    pages = [
        _serialize_page(page, split_result.classifications.get(page.index, []))
        for page in convert_result.pages
        if not target_pages or page.index in target_pages
    ]

    labels = [
        label
        for page_labels in split_result.classifications.values()
        for label in page_labels
    ]
    has_schedule_c = any("Schedule C" in label for label in labels)
    has_corporate_returns = any(
        term in label for label in labels for term in ("1120", "1065")
    )
    is_usda = (loan_program or "").upper() == "USDA"

    if is_usda or has_corporate_returns or convert_result.page_count > 10:
        billing_tier = "MULTI_ENTITY_PORTFOLIO_OR_USDA"
    elif has_schedule_c:
        billing_tier = "SOLE_PROPRIETOR_SINGLE_ENTITY"
    else:
        billing_tier = "W2_WAGE_EARNER"

    classifications = {
        str(page_index): page_labels
        for page_index, page_labels in split_result.classifications.items()
    }
    entities = _extract_entities(convert_result, split_result.classifications)
    unresolved = split_result.to_dict()["unresolved_statements"]
    flags = convert_result.flags + split_result.flags

    # Preserve the v5 fields consumed by Parser Lab while exposing the v6
    # tenant/billing contract from the downloaded server.
    return {
        "transactionId": transaction_id,
        "transaction_id": transaction_id,
        "loanId": loan_id,
        "original_filename": original_name,
        "was_sandwich_applied": False,
        "pageCount": convert_result.page_count,
        "total_pages_scanned": convert_result.page_count,
        "pages_extracted_count": len(split_result.target_pages),
        "extracted_page_indices": split_result.target_pages,
        "ocrPageCount": convert_result.ocr_page_count,
        "ocr_page_count": convert_result.ocr_page_count,
        "isSearchable": convert_result.ocr_page_count == 0,
        "has_business_returns": has_schedule_c or has_corporate_returns,
        "classifications": classifications,
        "entities": entities,
        "flags": flags,
        "unresolved_statements": unresolved,
        "billingTelemetry": {
            "billingTier": billing_tier,
            "isUsda": is_usda,
            "isMultiEntity": has_corporate_returns,
            "isSingleEntity": has_schedule_c,
            "rawPageLength": convert_result.page_count,
        },
        "pages": pages,
    }


@app.post("/parse", status_code=status.HTTP_200_OK)
@app.post("/api/underwrite/process", status_code=status.HTTP_200_OK)
async def process_document(
    request: Request,
    x_tenant_id: str | None = Header(None),
    x_underwriter_id: str | None = Header(None),
    x_loan_id: str | None = Header(None),
    x_loan_program: str | None = Header(None),
) -> JSONResponse:
    transaction_id = str(uuid.uuid4())

    # Keep the local Parser Lab route usable while enforcing tenant metadata on
    # the production-facing route.
    if request.url.path != "/parse" and (not x_tenant_id or not x_underwriter_id):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Inbound requests must declare x-tenant-id and "
                "x-underwriter-id headers."
            ),
        )

    pdf_bytes, original_name = await _read_pdf_bytes(request)
    if not original_name.lower().endswith(".pdf"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are authorized for ingestion.",
        )
    if not pdf_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty PDF body.")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="PDF exceeds parser size limit.",
        )

    try:
        payload = await run_in_threadpool(
            _parse_document,
            pdf_bytes,
            transaction_id,
            original_name,
            x_loan_id,
            x_loan_program,
        )
        logger.info(
            "parse_complete txn=%s pages=%s kept=%s",
            transaction_id,
            payload["pageCount"],
            payload["pages_extracted_count"],
        )
        return JSONResponse(content=payload)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("parse_failed txn=%s", transaction_id)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Document processing failed during in-memory execution.",
        ) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8080)
