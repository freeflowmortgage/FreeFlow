import io
import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from pdf_splitter import pre_split_tax_returns, CORE_RULES
from ai_pdf_converter import PageResult, ConvertResult, OcrWord
from mismo_xml_exporter import generate_mismo_34_xml


def create_minimal_pdf_bytes(text_lines: list[str]) -> bytes:
    """Helper to build raw PDF bytes with specified text strings."""
    chunks = [b"BT /F1 11 Tf"]
    y = 700
    for line in text_lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        chunks.append(f"1 0 0 1 72 {y} Tm ({safe}) Tj".encode())
        y -= 20
    chunks.append(b"ET")
    stream = b" ".join(chunks)

    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return out.getvalue()


@pytest.mark.asyncio
async def test_health_check():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "HEALTHY"
        assert data["version"] == "5.0.0"


@pytest.mark.asyncio
async def test_parse_invalid_file_extension():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/parse",
            files={"file": ("test.txt", b"Hello text", "text/plain")},
        )
        assert res.status_code == 400
        assert "Only PDF files are authorized" in res.json()["detail"]


@pytest.mark.asyncio
async def test_parse_empty_pdf():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/parse",
            files={"file": ("empty.pdf", b"", "application/pdf")},
        )
        assert res.status_code == 400
        assert "Empty PDF body" in res.json()["detail"]


@pytest.mark.asyncio
async def test_parse_valid_pdf_stream():
    pdf_bytes = create_minimal_pdf_bytes([
        "Form W-2 Wage and Tax Statement 2023",
        "Box 1 Wages tips other compensation 120000.00",
        "Box 2 Federal income tax withheld 15000.00"
    ])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/parse",
            content=pdf_bytes,
            headers={"Content-Type": "application/pdf", "x-document-title": "w2_sample.pdf"}
        )
        assert res.status_code == 200
        body = res.json()
        assert body["original_filename"] == "w2_sample.pdf"
        assert body["total_pages_scanned"] == 1
        assert "W-2" in body["classifications"]["0"]


def test_pdf_splitter_core_rules():
    assert "W-2" in CORE_RULES
    assert "Schedule C (Page 1 - Profits)" in CORE_RULES
    assert "Schedule E (Page 1 - Rentals)" in CORE_RULES
    assert "Schedule F (Farm Income)" in CORE_RULES
    assert "Form 1120S (S-Corporation Return)" in CORE_RULES
    assert "Form 1065 (Partnership Return)" in CORE_RULES

    w2_match = CORE_RULES["W-2"].search("2023 Form W-2 Wage and Tax Statement")
    assert w2_match is not None

    sched_c = CORE_RULES["Schedule C (Page 1 - Profits)"].search("Schedule C Profit or Loss From Business")
    assert sched_c is not None
    sched_f = CORE_RULES["Schedule F (Farm Income)"].search(
        "Schedule F (Form 1040) Profit or Loss From Farming"
    )
    assert sched_f is not None


def test_pdf_splitter_classification():
    p0 = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=True,
        plain_text="Form W-2 Wage and Tax Statement 2023 Box 1 95000.00",
        words=[OcrWord(text="Form", x=0.1, y=0.1, w=0.1, h=0.02, confidence=99.0)]
    )
    p1 = PageResult(
        index=1,
        width_px=612,
        height_px=792,
        is_native_text=True,
        plain_text="Schedule C Profit or Loss From Business Line 31 45000",
        words=[]
    )
    convert_result = ConvertResult(pages=[p0, p1], page_count=2, ocr_page_count=0)
    split_res = pre_split_tax_returns(convert_result)

    assert 0 in split_res.target_pages
    assert 1 in split_res.target_pages
    assert "W-2" in split_res.classifications[0]
    assert "Schedule C (Page 1 - Profits)" in split_res.classifications[1]


def test_pdf_splitter_classifies_schedule_f():
    page = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=True,
        plain_text="Schedule F (Form 1040) Profit or Loss From Farming Line 34 58000",
        words=[],
    )

    split_res = pre_split_tax_returns(
        ConvertResult(pages=[page], page_count=1, ocr_page_count=0)
    )

    assert split_res.target_pages == [0]
    assert "Schedule F (Farm Income)" in split_res.classifications[0]


def test_mismo_xml_generation():
    entities = [
        {
            "entityType": "SCHEDULE_C",
            "annualNetIncome": 84000.00,
            "entityName": "Apex Consulting LLC",
            "ein": "12-3456789",
            "isExcluded": False
        },
        {
            "entityType": "SCHEDULE_E_PART_1",
            "annualNetIncome": 24000.00,
            "entityName": "123 Elm St Rental",
            "isExcluded": False
        }
    ]
    xml_str = generate_mismo_34_xml("LN-100234", "Jane Doe", 9000.00, entities)
    assert "MISMOVersionID=\"3.4.0\"" in xml_str
    assert "<FirstName>Jane</FirstName>" in xml_str
    assert "<LastName>Doe</LastName>" in xml_str
    assert "<LoanIdentifier>LN-100234</LoanIdentifier>" in xml_str
    assert "<QualifyingMonthlyIncomeAmount>9000.00</QualifyingMonthlyIncomeAmount>" in xml_str
    assert "SelfEmployment" in xml_str
    assert "NetRentalIncome" in xml_str
