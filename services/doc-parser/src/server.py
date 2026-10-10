"""Stateless in-memory document parse API. No disk, no sandwich PDF, no base64 payload."""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import resource
import threading
import time
import uuid

# Set before any OCR import pulls in ONNX Runtime, which otherwise writes a
# persistent device identifier and a telemetry database to disk.
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s %(message)s")
logger = logging.getLogger("freeflow.server")
logging.getLogger("freeflow.ocr").setLevel(logging.INFO)
logging.getLogger("freeflow.splitter").setLevel(logging.INFO)

# OCR/OpenCV deps are only needed for POST /parse. Import them lazily so
# GET / and /health still bind :8080 when the image or venv is incomplete.
MAX_PDF_BYTES = 40 * 1024 * 1024

DOCUMENT_ID_HMAC_KEY = os.environ.get("DOCUMENT_ID_HMAC_KEY", "").encode()
"""Secret for the content-derived document id.

Set this in production. A bare SHA-256 of a document is a stable fingerprint
that anyone holding a copy of the same file can reproduce, so an unkeyed digest
lets an outsider confirm that a specific document passed through this service.
Keying the digest keeps deduplication working while making the id meaningless
to anyone without the secret. The key must be stable across tasks and
deployments or duplicate submissions will look new.
"""


def _document_id(pdf_bytes: bytes) -> str:
    """Return a deterministic id for this document's contents.

    Unlike ``transaction_id``, which is random per request, this is the same
    for every submission of the same bytes, so the caller can recognize a
    resubmission and avoid charging for it twice. It is derived from the
    document but is not the document: a 32-byte one-way digest that cannot be
    inverted, so retaining it does not retain content.
    """
    if DOCUMENT_ID_HMAC_KEY:
        digest = hmac.new(DOCUMENT_ID_HMAC_KEY, pdf_bytes, hashlib.sha256).hexdigest()
        return f"hmac-sha256:{digest}"
    return f"sha256:{hashlib.sha256(pdf_bytes).hexdigest()}"


AIPDFConverter = None
pre_split_tax_returns = None
extract_irs_form_fields = None
select_ocr_page_indices = None
OcrPageBudgetExceeded = RuntimeError
_engine_error: str | None = None
try:
    from ai_pdf_converter import MAX_PDF_BYTES, AIPDFConverter
    from irs_form_extract import extract_irs_form_fields
    from pdf_splitter import OcrPageBudgetExceeded, pre_split_tax_returns, select_ocr_page_indices
except Exception as exc:
    try:
        from src.ai_pdf_converter import MAX_PDF_BYTES, AIPDFConverter
        from src.irs_form_extract import extract_irs_form_fields
        from src.pdf_splitter import OcrPageBudgetExceeded, pre_split_tax_returns, select_ocr_page_indices
    except Exception:
        extract_irs_form_fields = None  # type: ignore[assignment]
        select_ocr_page_indices = None  # type: ignore[assignment]
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


@app.on_event("startup")
def _harden_process() -> None:
    """Stop the kernel writing a core file containing document bytes.

    A crash dump is the one path by which an in-memory parser can still spill a
    borrower's pay stub onto disk, and it is written by the kernel rather than
    by any code here, so it has to be refused explicitly.
    """
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        logger.warning("core_dumps_not_disabled")
    if not DOCUMENT_ID_HMAC_KEY:
        logger.warning("document_id_unkeyed set DOCUMENT_ID_HMAC_KEY in production")


@app.on_event("startup")
def _warmup_ocr_in_background() -> None:
    def run() -> None:
        try:
            get_converter().warmup()
        except Exception:
            logger.warning("converter_warmup_skipped")

    threading.Thread(target=run, daemon=True, name="ocr-warmup").start()


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


def _parse_multipart_pdf(buffer: bytes, content_type: str) -> tuple[bytes, str] | None:
    match = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type, re.I)
    if not match:
        return None
    boundary = f"--{(match.group(1) or match.group(2)).strip()}".encode()
    cursor = 0
    while cursor < len(buffer):
        start = buffer.find(boundary, cursor)
        if start < 0:
            break
        next_part = buffer.find(boundary, start + len(boundary))
        part = buffer[start + len(boundary) : next_part if next_part >= 0 else len(buffer)]
        cursor = next_part if next_part >= 0 else len(buffer)
        header_end = part.find(b"\r\n\r\n")
        sep_len = 4
        if header_end < 0:
            header_end = part.find(b"\n\n")
            sep_len = 2
        if header_end < 0:
            continue
        header = part[:header_end].decode("utf-8", "ignore")
        if not re.search(r"filename=", header, re.I) and not re.search(r'name="?file"?', header, re.I):
            continue
        filename_match = re.search(r'filename="([^"]+)"', header, re.I) or re.search(r"filename=([^\s;]+)", header, re.I)
        name = filename_match.group(1) if filename_match else "document.pdf"
        part_type = ""
        type_match = re.search(r"content-type:\s*([^\r\n]+)", header, re.I)
        if type_match:
            part_type = type_match.group(1).strip().lower()
        body = part[header_end + sep_len :]
        if body.endswith(b"\r\n"):
            body = body[:-2]
        if body.startswith(b"\r\n"):
            body = body[2:]
        if part_type and part_type != "application/pdf":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Only PDF files are authorized for ingestion.")
        return body, name
    return None


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

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_PDF_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="PDF exceeds parser size limit.")
        body.extend(chunk)
    payload = bytes(body)

    if "application/pdf" in content_type or payload[:5] == b"%PDF-":
        name = request.headers.get("x-document-title") or "document.pdf"
        return payload, name

    if "multipart/form-data" in content_type:
        parsed = _parse_multipart_pdf(payload, content_type)
        if parsed is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Expected application/pdf body or multipart file field.")
        if not parsed[0]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty PDF body.")
        return parsed

    raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Expected application/pdf body or multipart file field.")


@app.post("/parse", status_code=status.HTTP_200_OK)
@app.post("/api/underwrite/process", status_code=status.HTTP_200_OK)
async def process_document(request: Request):
    transaction_id = str(uuid.uuid4())
    request_started = time.perf_counter()
    try:
        pdf_bytes, original_name = await _read_pdf_bytes(request)
        if not original_name.lower().endswith(".pdf"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Only PDF files are authorized for ingestion.")
        if not pdf_bytes:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Empty PDF body.")
        if len(pdf_bytes) > MAX_PDF_BYTES:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail="PDF exceeds parser size limit.")

        return await run_in_threadpool(
            _process_document_sync,
            pdf_bytes,
            original_name,
            transaction_id,
            request_started,
        )
    except HTTPException:
        raise
    except OcrPageBudgetExceeded as exc:
        logger.warning(
            "parse_ocr_budget_exceeded txn=%s required=%s budget=%s",
            transaction_id,
            exc.required,
            exc.budget,
        )
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "DOCUMENT_PROCESSOR_UNAVAILABLE",
                "message": "Document processing is temporarily unavailable for this OCR workload.",
                "retryable": True,
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("parse_failed txn=%s error_type=%s", transaction_id, type(exc).__name__)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Document processing failed during in-memory execution.",
        ) from exc


def _process_document_sync(
    pdf_bytes: bytes,
    original_name: str,
    transaction_id: str,
    request_started: float,
) -> JSONResponse:
    """Run CPU-bound PDF inspection, OCR, and extraction outside the event loop."""

    document_id = _document_id(pdf_bytes)

    schedule_e_properties: list = []
    w2_extracts: list = []
    try:
        from schedule_e_grid import extract_schedule_e_pages
    except ImportError:
        from src.schedule_e_grid import extract_schedule_e_pages
    try:
        from w2_grid import extract_w2_pages
    except ImportError:
        from src.w2_grid import extract_w2_pages

    converter = get_converter()
    inspect_started = time.perf_counter()
    inspected = converter.inspect_pages(pdf_bytes)
    preview = converter.inspect_as_convert_result(inspected)
    preview_split = pre_split_tax_returns(preview)
    inspect_ms = (time.perf_counter() - inspect_started) * 1000
    ocr_indices = select_ocr_page_indices(inspected, preview_split) if select_ocr_page_indices else None
    convert_started = time.perf_counter()
    convert_result = converter.convert_to_ai_ready(
        pdf_bytes,
        inspected=inspected,
        ocr_page_indices=ocr_indices,
    )
    convert_ms = (time.perf_counter() - convert_started) * 1000
    split_result = pre_split_tax_returns(convert_result)
    try:
        from urla_borrowers import extract_urla_borrowers
    except ImportError:
        from src.urla_borrowers import extract_urla_borrowers
    urla_borrowers = (
        extract_urla_borrowers(convert_result.pages)
        if "urla_1003_detected" in split_result.flags
        else []
    )
    schedule_e_started = time.perf_counter()
    has_schedule_e = any(
        any(label.startswith("Schedule E") for label in labels)
        for labels in split_result.classifications.values()
    )
    if has_schedule_e:
        try:
            schedule_e_properties = extract_schedule_e_pages(pdf_bytes, ocr_pages=convert_result.pages)
        except Exception as grid_exc:
            logger.warning("schedule_e_grid_skipped: %s", grid_exc)
    schedule_e_ms = (time.perf_counter() - schedule_e_started) * 1000
    try:
        w2_extracts = extract_w2_pages(pdf_bytes, ocr_pages=convert_result.pages)
        logger.info("w2_grid_complete count=%s", len(w2_extracts))
    except Exception as grid_exc:
        logger.warning("w2_grid_skipped: %s", grid_exc)

    extract_started = time.perf_counter()
    form_extracts: list = []
    if extract_irs_form_fields is not None:
        try:
            form_extracts = extract_irs_form_fields(
                pdf_bytes,
                ocr_pages=convert_result.pages,
                page_indices=split_result.target_pages,
            )
        except Exception as extract_exc:
            logger.warning("irs_form_extract_skipped: %s", extract_exc)
    extract_ms = (time.perf_counter() - extract_started) * 1000

    del pdf_bytes

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
        any(
            label.startswith(("Schedule C", "Schedule E", "Form 1120", "Form 1065", "Schedule K-1", "Form 8825"))
            for label in labels
        )
        for labels in split_result.classifications.values()
    )

    logger.info(
        "parse_complete txn=%s pages=%s kept=%s ocr=%s inspect_ms=%.1f convert_ms=%.1f "
        "schedule_e_ms=%.1f extract_ms=%.1f total_ms=%.1f",
        transaction_id,
        convert_result.page_count,
        len(split_result.target_pages),
        convert_result.ocr_page_count,
        inspect_ms,
        convert_ms,
        schedule_e_ms,
        extract_ms,
        (time.perf_counter() - request_started) * 1000,
    )

    return JSONResponse(
        content={
            "transaction_id": transaction_id,
            "document_id": document_id,
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
            "scheduleEProperties": schedule_e_properties,
            "w2Extracts": w2_extracts,
            "formExtracts": form_extracts,
            "urlaBorrowers": urla_borrowers,
        }
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server:app", host="0.0.0.0", port=8080)
