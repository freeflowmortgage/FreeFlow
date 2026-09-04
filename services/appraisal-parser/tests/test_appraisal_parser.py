import io

import pytest
from httpx import AsyncClient, ASGITransport
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, TextStringObject

from main import app
from appraisal_parser import AppraisalReviewParserV4

HEADERS = {
    "x-tenant-id": "tenant-corp-01",
    "x-underwriter-id": "uw-4412",
    "x-loan-id": "LN-988310",
    "content-type": "application/pdf",
}


@pytest.mark.asyncio
async def test_appraisal_health_check():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "HEALTHY"
        assert data["service"] == "Appraisal Ingestion and Rules Engine"
        assert data["version"] == "4.0.0"
        assert data["zdr_boundary_active"] is True
        assert res.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_appraisal_missing_headers():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/v1/appraisal/audit",
            content=b"%PDF-1.4 dummy appraisal content",
            headers={"Content-Type": "application/pdf"}
        )
        assert res.status_code == 400
        assert "Header Validation Failure" in res.json()["detail"]


@pytest.mark.asyncio
async def test_appraisal_endpoint_uses_actual_request_bytes():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/api/v1/appraisal/audit",
            content=b"Uniform Residential Appraisal Report\nCase #: CASE-ONE\nYear Built: 1985",
            headers={**HEADERS, "x-loan-program": "CONV"},
        )
        second = await client.post(
            "/api/v1/appraisal/audit",
            content=b"Uniform Residential Appraisal Report\nCase #: CASE-TWO\nYear Built: 2005",
            headers={**HEADERS, "x-loan-program": "CONV"},
        )

    assert first.status_code == second.status_code == 200
    first_body = first.json()
    second_body = second.json()
    assert first_body["loanId"] == "LN-988310"
    assert first_body["programUsed"] == "CONV"
    assert first_body["ruleVersion"].startswith("appraisal-rules-")
    assert first_body["extractedData"]["metadata"]["caseNumber"] == "CASE-ONE"
    assert first_body["extractedData"]["metadata"]["yearBuilt"] == 1985
    assert second_body["extractedData"]["metadata"]["caseNumber"] == "CASE-TWO"
    assert second_body["extractedData"]["metadata"]["yearBuilt"] == 2005
    assert first_body["transactionId"] != second_body["transactionId"]


def test_appraisal_review_parser_v4_core():
    parser = AppraisalReviewParserV4()
    mock_text = """
    Uniform Residential Appraisal Report
    Case #: 441-99881-FHA
    Intended Use: Underwrite mortgage transaction for secondary market delivery
    Year Built: 1985
    Contract Price: $450,000
    Prior Sale or Transfer Date: 01/15/2026
    Prior Sale or Transfer Price: $380,000
    Date of Contract: 08/10/2026
    Neighborhood Commentary: Stable suburban community with low inventory.
    Condition of Improvements: Well maintained single family property.
    Attic Inspected : Yes
    Crawlspace Inspected : Yes
    Comparable Sale #1
    Comp 1 Price: $455,000
    Comp 1 Distance: 0.25
    Comp 1 Net Adj: $5,000
    Comp 1 Gross Adj: $12,000
    Comparable Sale #2
    Comp 2 Price: $440,000
    Comp 2 Distance: 0.40
    Comparable Sale #3
    Comp 3 Price: $460,000
    Comp 3 Distance: 0.60
    """
    parsed = parser.parse_in_memory_stream(mock_text.encode('utf-8'))

    assert parsed["document"]["extractionMethod"] == "text-fixture"
    assert parsed["metadata"]["caseNumber"] == "441-99881-FHA"
    assert parsed["metadata"]["yearBuilt"] == 1985
    assert parsed["transaction"]["contractSalesPrice"] == 450000.0
    assert parsed["transaction"]["priorSalePrice"] == 380000.0
    assert parsed["physicalConditionChecklist"]["atticInspected"] is True
    assert parsed["physicalConditionChecklist"]["crawlspaceInspected"] is True
    assert len(parsed["comparables"]) == 3
    assert parsed["comparables"][0]["salePrice"] == 455000.0
    assert parsed["comparables"][0]["proximityMiles"] == 0.25
    assert "cellCoordinates" in parsed["comparables"][0]
    assert "proximity" in parsed["comparables"][0]["cellCoordinates"]


def test_parser_extracts_populated_acroform_fields_from_real_pdf():
    payload = acroform_pdf(
        {
            "Borrower Name": "Ada Borrower",
            "Case Number": "CASE-ACRO-77",
            "Year Built": "1999",
        }
    )
    parsed = AppraisalReviewParserV4().parse_in_memory_stream(payload, "filled-1004.pdf")

    assert parsed["document"]["extractionMethod"] == "pypdf-native"
    assert parsed["document"]["pageCount"] == 1
    assert parsed["document"]["formFieldCount"] == 3
    assert parsed["formFields"]["Borrower Name"] == "Ada Borrower"
    assert parsed["metadata"]["borrowerName"] == "Ada Borrower"
    assert parsed["metadata"]["caseNumber"] == "CASE-ACRO-77"
    assert parsed["metadata"]["yearBuilt"] == 1999


def test_parser_preserves_explicit_negative_condition_values():
    parsed = AppraisalReviewParserV4().parse_in_memory_stream(
        b"""
        Uniform Residential Appraisal Report
        No peeling paint was observed.
        No evidence of active infestation.
        Solar Panels: No
        """
    )

    physical = parsed["physicalConditionChecklist"]
    assert physical["peelingPaintDetected"] is False
    assert physical["termiteActiveInfestationDetected"] is False
    assert parsed["solar"]["hasSolarPanels"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("program", "expected_code"),
    [
        ("CONV", "GSE_COMP_1_GROSS_ADJUSTMENT_REVIEW"),
        ("FHA", "FHA_PROPERTY_FLIP_REVIEW"),
        ("VA", "VA_ACTIVE_WDI"),
        ("USDA", "USDA_WELL_POTABILITY_NOT_CLEARED"),
    ],
)
async def test_program_specific_agency_overlays(program, expected_code):
    payload = b"""
    Uniform Residential Appraisal Report
    Case #: CASE-AGENCY
    Transaction Type: Purchase
    Year Built: 1974
    Prior Sale or Transfer Date: 07/15/2026
    Date of Contract: 08/01/2026
    Peeling paint
    Utilities inactive
    Active infestation
    Well Potability: No
    Comparable Sale #1
    Comp 1 Price: $400,000
    Comp 1 Gross Adj: $60,000
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/appraisal/audit",
            content=payload,
            headers={**HEADERS, "x-loan-program": program},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["programUsed"] == program
    assert expected_code in {finding["code"] for finding in body["findings"]}
    assert all(finding["program"] == program for finding in body["findings"])
    assert all(condition["program"] == program for condition in body["conditions"])


def acroform_pdf(values: dict[str, str]) -> bytes:
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    annotations = ArrayObject()
    fields = ArrayObject()
    for index, (name, value) in enumerate(values.items()):
        top = 740 - index * 30
        field = DictionaryObject(
            {
                NameObject("/FT"): NameObject("/Tx"),
                NameObject("/Type"): NameObject("/Annot"),
                NameObject("/Subtype"): NameObject("/Widget"),
                NameObject("/T"): TextStringObject(name),
                NameObject("/V"): TextStringObject(value),
                NameObject("/Rect"): ArrayObject(
                    [
                        FloatObject(40),
                        FloatObject(top),
                        FloatObject(300),
                        FloatObject(top + 20),
                    ]
                ),
                NameObject("/F"): FloatObject(4),
            }
        )
        reference = writer._add_object(field)
        annotations.append(reference)
        fields.append(reference)
    page[NameObject("/Annots")] = annotations
    writer._root_object[NameObject("/AcroForm")] = DictionaryObject(
        {NameObject("/Fields"): fields}
    )
    stream = io.BytesIO()
    writer.write(stream)
    return stream.getvalue()
