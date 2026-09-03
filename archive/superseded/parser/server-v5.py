"""Stateless in-memory document parse API. No disk, no sandwich PDF, no base64 payload."""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ai_pdf_converter import MAX_PDF_BYTES, AIPDFConverter
from pdf_splitter import pre_split_tax_returns

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s %(message)s")
logger = logging.getLogger("freeflow.server")
logging.getLogger("freeflow.ocr").setLevel(logging.INFO)
logging.getLogger("freeflow.splitter").setLevel(logging.INFO)

app = FastAPI(
    title="FreeFlow Document Parser",
    description="In-memory OCR + tax-page classification. Returns coordinates and labels only.",
    version="5.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_converter: AIPDFConverter | None = None


def get_converter() -> AIPDFConverter:
    global _converter
    if _converter is None:
        _converter = AIPDFConverter()
    return _converter


@app.get("/health", status_code=status.HTTP_200_OK)
def health_check():
    return {"status": "HEALTHY", "service": "FreeFlow Document Processing Engine", "version": "5.0.0"}


async def _read_pdf_bytes(request: Request) -> tuple[bytes, str]:
    content_type = (request.headers.get("content-type") or "").lower()
    if "application/pdf" in content_type:
        data = await request.body()
        name = request.headers.get("x-document-title") or "document.pdf"
        return data, name

    form = await request.form()
    upload = form.get("file")
    if upload is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Expected application/pdf body or multipart file field.")
    data = await upload.read()
    name = getattr(upload, "filename", None) or "document.pdf"
    return data, name


@app.post("/parse", status_code=status.HTTP_200_OK)
@app.post("/api/underwrite/process", status_code=status.HTTP_200_OK)
async def process_document(request: Request):
    transaction_id = str(uuid.uuid4())
    try:
        pdf_bytes, original_name = await _read_pdf_bytes(request)
        if not original_name.lower().endswith(".pdf"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Only PDF files are authorized for ingestion.")
        if not pdf_bytes:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty PDF body.")
        if len(pdf_bytes) > MAX_PDF_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="PDF exceeds parser size limit.")

        convert_result = get_converter().convert_to_ai_ready(pdf_bytes)
        del pdf_bytes

        split_result = pre_split_tax_returns(convert_result)
        kept = set(split_result.target_pages)
        page_payload = []
        for page in convert_result.pages:
            if page.index not in kept and kept:
                continue
            page_payload.append(
                {
                    "index": page.index,
                    "formIds": split_result.classifications.get(page.index, []),
                    "isNativeText": page.is_native_text,
                    "meanConfidence": page.mean_confidence,
                    "skewDegrees": page.skew_degrees,
                    "words": [word.to_dict() for word in page.words],
                    "flags": page.flags,
                }
            )

        has_business = any(
            any(label.startswith(("Schedule C", "Schedule E", "Form 1120", "Form 1065", "Schedule K-1")) for label in labels)
            for labels in split_result.classifications.values()
        )

        logger.info(
            "parse_complete txn=%s pages=%s kept=%s ocr=%s",
            transaction_id,
            convert_result.page_count,
            len(split_result.target_pages),
            convert_result.ocr_page_count,
        )

        return JSONResponse(
            content={
                "transaction_id": transaction_id,
                "original_filename": original_name,
                "was_sandwich_applied": False,
                "total_pages_scanned": convert_result.page_count,
                "pages_extracted_count": len(split_result.target_pages),
                "extracted_page_indices": split_result.target_pages,
                "has_business_returns": has_business,
                "ocr_page_count": convert_result.ocr_page_count,
                "flags": convert_result.flags + split_result.flags,
                "classifications": {str(k): v for k, v in split_result.classifications.items()},
                "unresolved_statements": split_result.to_dict()["unresolved_statements"],
                "pages": page_payload,
            }
        )
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
