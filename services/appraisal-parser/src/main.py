"""Independent, zero-persistence appraisal audit HTTP service."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from appraisal_parser import AppraisalParseError, AppraisalReviewParserV4
    from rules import RULE_VERSION, SUPPORTED_PROGRAMS, run_appraisal_rules
except ImportError:
    from src.appraisal_parser import AppraisalParseError, AppraisalReviewParserV4
    from src.rules import RULE_VERSION, SUPPORTED_PROGRAMS, run_appraisal_rules

SERVICE_VERSION = "4.0.0"
MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024

logging.basicConfig(level=logging.INFO, format="%(name)s %(levelname)s %(message)s")
logger = logging.getLogger("freeflow.appraisal.server")

app = FastAPI(
    title="Zero-Persistence Appraisal Audit Service",
    description="Native PDF and AcroForm extraction with deterministic appraisal rules.",
    version=SERVICE_VERSION,
    docs_url=None,
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    zdr_boundary_active: bool


class FindingResponse(BaseModel):
    code: str
    label: str
    extracted: str
    why: str
    severity: Literal["info", "warning", "error"]
    authority: str
    program: Literal["CONV", "FHA", "VA", "USDA"]
    pageIndex: int | None
    box: list[float] | None


class ConditionResponse(BaseModel):
    id: str
    kind: Literal["REPAIR", "INSPECTION", "ADMIN", "REDFLAG"]
    text: str
    authority: str
    program: Literal["CONV", "FHA", "VA", "USDA"]


class AuditResponse(BaseModel):
    transactionId: str
    loanId: str
    programUsed: Literal["CONV", "FHA", "VA", "USDA"]
    ruleVersion: str
    extractedData: dict[str, Any]
    findings: list[FindingResponse]
    conditions: list[ConditionResponse]


@app.middleware("http")
async def prevent_response_storage(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


@app.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
def health_check() -> HealthResponse:
    return HealthResponse(
        status="HEALTHY",
        service="Appraisal Ingestion and Rules Engine",
        version=SERVICE_VERSION,
        # Documents are parsed from request bytes and never written to a
        # persistent volume. The container also provisions a tmpfs scratch path.
        zdr_boundary_active=True,
    )


@app.post(
    "/api/v1/appraisal/audit",
    response_model=AuditResponse,
    status_code=status.HTTP_200_OK,
)
async def audit_appraisal_document(
    request: Request,
    response: Response,
    x_tenant_id: str | None = Header(None),
    x_underwriter_id: str | None = Header(None),
    x_loan_id: str | None = Header(None),
    x_loan_program: str = Header("CONV"),
    x_document_title: str = Header("appraisal.pdf"),
    x_appraisal_case_number: str | None = Header(None),
) -> AuditResponse:
    transaction_id = str(uuid.uuid4())
    if not x_tenant_id or not x_underwriter_id or not x_loan_id:
        logger.warning("Rejected appraisal request %s: missing tracking headers", transaction_id)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Header Validation Failure: Must declare 'x-tenant-id', "
                "'x-underwriter-id', and 'x-loan-id' tracking headers."
            ),
        )

    program = x_loan_program.upper()
    if program not in SUPPORTED_PROGRAMS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported appraisal program. Use one of: {', '.join(SUPPORTED_PROGRAMS)}.",
        )

    pdf_bytes = await request.body()
    if not pdf_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Empty file stream payload body.",
        )
    if len(pdf_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Inbound payload exceeds the 15 MB appraisal size limit.",
        )

    try:
        extracted = AppraisalReviewParserV4().parse_in_memory_stream(
            pdf_bytes,
            filename=x_document_title,
            expected_case=x_appraisal_case_number,
        )
        findings, conditions = run_appraisal_rules(extracted, program)
    except AppraisalParseError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error
    except Exception as error:
        logger.exception("Appraisal audit %s failed", transaction_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Appraisal processing failed.",
        ) from error

    response.headers["X-Appraisal-Rule-Version"] = RULE_VERSION
    logger.info("Completed appraisal audit %s with program %s", transaction_id, program)
    return AuditResponse(
        transactionId=transaction_id,
        loanId=x_loan_id,
        programUsed=program,
        ruleVersion=RULE_VERSION,
        extractedData=extracted,
        findings=findings,
        conditions=conditions,
    )
