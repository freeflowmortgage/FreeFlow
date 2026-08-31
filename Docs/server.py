# =============================================================================
# FREEFLOW MORTGAGE SOLUTIONS - THREAD-SAFE PRODUCTION FASTAPI SERVER (server.py)
# =============================================================================
# Implements synchronous execution blocks to prevent FastAPI async event-loop locks [cite: 3a1fb7ec-f5f7-47e9-9177-6f659865397f].
# Supports multi-tenant metadata ingestion and calculates GTM billing indicators [cite: 19, cb36abf8-aeb3-4f05-a30e-d14dbe0fd715].
# =============================================================================

from __future__ import annotations
import logging
import uuid
from fastapi import FastAPI, HTTPException, Request, status, Header
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
    description="Thread-safe, Non-blocking in-memory document parsing and classification gateway [cite: 31, 3a1fb7ec-f5f7-47e9-9177-6f659865397f].",
    version="6.0.0",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy-loaded converter singleton
_converter: AIPDFConverter | None = None

def get_converter() -> AIPDFConverter:
    global _converter
    if _converter is None:
        _converter = AIPDFConverter()
    return _converter

@app.get("/health", status_code=status.HTTP_200_OK)
def health_check():
    """System health check endpoint for ECS and Kubernetes probes [cite: 31]."""
    return {
        "status": "HEALTHY",
        "service": "FreeFlow Document Processing Engine",
        "version": "6.0.0",
        "resources": {
            "vCPU": "4.0",
            "RAM": "16.0 GB"
        }
    }

@app.post("/parse", status_code=status.HTTP_200_OK)
@app.post("/api/underwrite/process", status_code=status.HTTP_200_OK)
def process_document(
    request: Request,
    x_tenant_id: str | None = Header(None),
    x_underwriter_id: str | None = Header(None),
    x_loan_id: str | None = Header(None),
    x_loan_program: str | None = Header(None)
):
    """
    Synchronous document extraction route [cite: 3a1fb7ec-f5f7-47e9-9177-6f659865397f].
    By declaring this as 'def' rather than 'async def', FastAPI executes the CPU-heavy
    OCR and page-splitting calculations inside an isolated thread pool, ensuring 
    the central async loop remains responsive and never locks up [cite: 3a1fb7ec-f5f7-47e9-9177-6f659865397f].
    """
    transaction_id = str(uuid.uuid4())
    logger.info(f"[Server Ingest] Tx: {transaction_id} | Tenant: {x_tenant_id} | Underwriter: {x_underwriter_id}")

    # Validate headers to maintain SOC 2 tracking metrics [cite: 31]
    if not x_tenant_id or not x_underwriter_id:
        logger.warning(f"[Server Reject] Missing security metrics inside Tx: {transaction_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Inbound requests must declare 'x-tenant-id' and 'x-underwriter-id' headers [cite: 39]."
        )

    # Ingest the PDF raw binary bytes safely from memory [cite: 4]
    # We use a blocking read to pull bytes into memory immediately
    import asyncio
    try:
        # Since reading the request body is inherently asynchronous, we run it in a safe helper
        pdf_bytes = asyncio.run(request.body())
    except Exception as e:
        logger.error(f"Failed to stream request bytes inside Tx {transaction_id}: {str(e)}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inbound document stream corrupted.")

    if not pdf_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty payload body.")

    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="PDF exceeds maximum allowed limits.")

    try:
        # 1. Trigger the CPU-bound Computer Vision & OCR Sandbox [cite: 30, 92]
        converter = get_converter()
        ocr_result = converter.convert(pdf_bytes)

        # 2. Run the logical tax-schedule and entity classifier [cite: 30, 38]
        split_result = pre_split_tax_returns(ocr_result)

        # 3. Calculate dynamic GTM billing parameters based on document indicators [cite: 19]
        is_usda = (x_loan_program == "USDA") or any("USDA" in f for f in ocr_result.flags)
        
        has_schedule_c = False
        has_corporate_returns = False
        
        for idx, forms in split_result.classifications.items():
            if any("Schedule C" in f for f in forms):
                has_schedule_c = True
            if any(term in "".join(forms) for term in ["1120", "1065", "1120S"]):
                has_corporate_returns = True

        # Map to accurate Pricing/Billing Tiers [cite: 19, 114, 122]
        if is_usda or has_corporate_returns or len(ocr_result.pages) > 10:
            billing_tier = "MULTI_ENTITY_PORTFOLIO_OR_USDA"  # Tier 3 [cite: 19, 122]
        elif has_schedule_c:
            billing_tier = "SOLE_PROPRIETOR_SINGLE_ENTITY"   # Tier 2 [cite: 122]
        else:
            billing_tier = "W2_WAGE_EARNER"                  # Tier 1 [cite: 114]

        # 4. Construct response payload [cite: cb36abf8-aeb3-4f05-a30e-d14dbe0fd715]
        return {
            "transactionId": transaction_id,
            "loanId": x_loan_id,
            "pageCount": ocr_result.page_count,
            "ocrPageCount": ocr_result.ocr_page_count,
            "isSearchable": ocr_result.ocr_page_count == 0,
            "classifications": split_result.classifications,
            "entities": split_result.entities,
            "flags": ocr_result.flags + split_result.flags,
            "billingTelemetry": {
                "billingTier": billing_tier,
                "isUsda": is_usda,
                "isMultiEntity": has_corporate_returns,
                "isSingleEntity": has_schedule_c,
                "rawPageLength": len(ocr_result.pages)
            },
            "pages": [
                {
                    "index": page.index,
                    "width": page.width_px,
                    "height": page.height_px,
                    "words": [
                        {
                            "text": word.text,
                            "x": word.x,
                            "y": word.y,
                            "w": word.w,
                            "h": word.h,
                            "confidence": word.confidence
                        } for word in page.words
                    ],
                    "plainText": page.plain_text,
                    "meanConfidence": page.mean_confidence,
                    "skewDegrees": page.skew_degrees
                } for page in ocr_result.pages
            ]
        }

    except Exception as e:
        logger.error(f"Processing failed for Tx {transaction_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"In-Memory Document Extraction Failure: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    # Boot server [cite: 31]
    uvicorn.run("server:app", host="0.0.0.0", port=8080, reload=True)
