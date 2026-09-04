import pytest
from httpx import AsyncClient, ASGITransport

from main import app
from appraisal_parser import AppraisalReviewParserV4


@pytest.mark.asyncio
async def test_appraisal_health_check():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "HEALTHY"
        assert data["service"] == "Appraisal Ingestion and Rules Engine"
        assert data["version"] == "3.0.0"


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
async def test_appraisal_audit_endpoint_with_headers():
    transport = ASGITransport(app=app)
    headers = {
        "x-tenant-id": "tenant-corp-01",
        "x-underwriter-id": "uw-4412",
        "x-loan-id": "LN-988310",
        "Content-Type": "application/pdf"
    }
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/v1/appraisal/audit",
            content=b"%PDF-1.4 dummy appraisal test file",
            headers=headers
        )
        assert res.status_code == 200
        body = res.json()
        assert "metadata" in body
        assert body["metadata"]["loanId"] == "LN-988310"
        assert "comparables" in body
        assert len(body["comparables"]) >= 2
        assert "physicalConditionChecklist" in body
        assert "marketConditions1004MC" in body


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
    
    assert parsed["caseNumber"] == "441-99881-FHA"
    assert parsed["yearBuilt"] == 1985
    assert parsed["contractSalesPrice"] == 450000.0
    assert parsed["priorSalePrice"] == 380000.0
    assert parsed["atticInspected"] is True
    assert parsed["crawlspaceInspected"] is True
    assert len(parsed["comparables"]) == 3
    assert parsed["comparables"][0]["salePrice"] == 455000.0
    assert parsed["comparables"][0]["proximityMiles"] == 0.25
    assert "cellCoordinates" in parsed["comparables"][0]
    assert "proximity" in parsed["comparables"][0]["cellCoordinates"]
