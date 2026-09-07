"""Stateless in-memory document parse API. No disk, no sandwich PDF, no base64 payload."""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s %(message)s")
logger = logging.getLogger("freeflow.server")
logging.getLogger("freeflow.ocr").setLevel(logging.INFO)
logging.getLogger("freeflow.splitter").setLevel(logging.INFO)

# OCR/OpenCV deps are only needed for POST /parse. Import them lazily so
# GET / and /health still bind :8080 when the image or venv is incomplete.
MAX_PDF_BYTES = 40 * 1024 * 1024
AIPDFConverter = None
pre_split_tax_returns = None
_engine_error: str | None = None
try:
    from ai_pdf_converter import MAX_PDF_BYTES, AIPDFConverter
    from pdf_splitter import pre_split_tax_returns
except Exception as exc:
    try:
        from src.ai_pdf_converter import MAX_PDF_BYTES, AIPDFConverter
        from src.pdf_splitter import pre_split_tax_returns
    except Exception:
        _engine_error = str(exc)
        logger.warning("OCR engine unavailable; /parse disabled: %s", _engine_error)

app = FastAPI(
    title="FreeFlow Document Parser",
    description="In-memory OCR + tax-page classification. Returns coordinates and labels only.",
    version="5.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

_LANDING_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FreeFlow Document Parser</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #0f172a; }
    main { max-width: 40rem; margin: 4rem auto; padding: 0 1.25rem; }
    h1 { font-size: 1.35rem; margin: 0 0 .35rem; }
    p { line-height: 1.5; color: #334155; }
    .ok { display: inline-block; background: #d1fae5; color: #065f46; font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: .2rem .55rem; border-radius: 999px; }
    a { color: #047857; font-weight: 600; }
    code { background: #e2e8f0; padding: .1rem .35rem; border-radius: .25rem; font-size: .9em; }
    ul { padding-left: 1.1rem; color: #334155; }
  </style>
</head>
<body>
  <main>
    <span class="ok">Healthy</span>
    <h1>FreeFlow document parser</h1>
    <p>Port <code>8080</code> is the income-document API, not the underwriting UI. This page loading means the parser is up.</p>
    <p>Open the income workspace at <a href="http://localhost:3000/#workspace">http://localhost:3000/#workspace</a>.</p>
    <ul>
      <li><a href="/health">/health</a> — JSON health check</li>
      <li><a href="/docs">/docs</a> — OpenAPI</li>
      <li><code>POST /parse</code> — PDF bytes in, classified pages out</li>
    </ul>
  </main>
</body>
</html>
"""

_converter = None


def get_converter():
    global _converter
    if AIPDFConverter is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"OCR engine is not installed. {_engine_error or 'Install services/doc-parser requirements.'}",
        )
    if _converter is None:
        _converter = AIPDFConverter()
    return _converter


@app.get("/", response_model=None)
def root(request: Request):
    """Browsers opening :8080 used to get FastAPI's empty 404. Serve a real page."""
    accept = (request.headers.get("accept") or "").lower()
    if "text/html" in accept:
        return HTMLResponse(_LANDING_HTML)
    return {
        "status": "HEALTHY",
        "service": "FreeFlow Document Processing Engine",
        "version": "5.0.0",
        "ui": "http://localhost:3000/#workspace",
        "health": "/health",
        "parse": "POST /parse",
    }


@app.get("/health", status_code=status.HTTP_200_OK)
def health_check():
    return {"status": "HEALTHY", "service": "FreeFlow Document Processing Engine", "version": "5.0.0"}


async def _read_pdf_bytes(request: Request) -> tuple[bytes, str]:
    content_type = (request.headers.get("content-type") or "").lower()
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared_bytes = int(content_length)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid Content-Length header.") from exc
        if declared_bytes < 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid Content-Length header.")
        if declared_bytes > MAX_PDF_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="PDF exceeds parser size limit.")

    if "application/pdf" in content_type:
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_PDF_BYTES:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="PDF exceeds parser size limit.")
            body.extend(chunk)
        name = request.headers.get("x-document-title") or "document.pdf"
        return bytes(body), name

    if content_length is None:
        raise HTTPException(
            status.HTTP_411_LENGTH_REQUIRED,
            detail="Content-Length is required for multipart document uploads.",
        )

    form = await request.form(max_files=1, max_fields=0, max_part_size=MAX_PDF_BYTES)
    upload = form.get("file")
    if upload is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Expected application/pdf body or multipart file field.")
    try:
        upload_content_type = (getattr(upload, "content_type", None) or "").lower()
        if upload_content_type != "application/pdf":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Only PDF files are authorized for ingestion.")
        body = bytearray()
        while chunk := await upload.read(1024 * 1024):
            if len(body) + len(chunk) > MAX_PDF_BYTES:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="PDF exceeds parser size limit.")
            body.extend(chunk)
        name = getattr(upload, "filename", None) or "document.pdf"
        return bytes(body), name
    finally:
        await upload.close()


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
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="PDF exceeds parser size limit.")

        convert_result = get_converter().convert_to_ai_ready(pdf_bytes)
        del pdf_bytes

        split_result = pre_split_tax_returns(convert_result)
        kept = set(split_result.target_pages)
        page_payload = []
        for page in convert_result.pages:
            page_payload.append(
                {
                    "index": page.index,
                    "formIds": split_result.classifications.get(page.index, []),
                    "isNativeText": page.is_native_text,
                    "inKeepSet": page.index in kept,
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
        logger.error("parse_failed txn=%s error_type=%s", transaction_id, type(exc).__name__)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Document processing failed during in-memory execution.",
        ) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8080)
