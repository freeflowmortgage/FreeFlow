import io
import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from pdf_splitter import pre_split_tax_returns, CORE_RULES
from ai_pdf_converter import PageResult, ConvertResult, OcrWord, PageInspect
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
async def test_root_html_loads_for_browsers():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/", headers={"Accept": "text/html,application/xhtml+xml"})
        assert res.status_code == 200
        assert "text/html" in res.headers["content-type"]
        assert "FreeFlow document parser" in res.text
        assert "localhost:3000/#workspace" in res.text


@pytest.mark.asyncio
async def test_root_json_for_api_clients():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/", headers={"Accept": "application/json"})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "HEALTHY"
        assert data["parse"] == "POST /parse"


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
async def test_parse_rejects_declared_oversize_pdf_before_reading_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/parse",
            content=b"%PDF-1.4\n",
            headers={
                "Content-Type": "application/pdf",
                "Content-Length": str((40 * 1024 * 1024) + 1),
                "x-document-title": "oversize.pdf",
            },
        )
        assert res.status_code == 413
        assert res.json()["detail"] == "PDF exceeds parser size limit."


@pytest.mark.asyncio
async def test_parse_rejects_multipart_content_type_spoofing():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/parse",
            files={"file": ("fake.pdf", b"not a pdf", "text/plain")},
        )
        assert res.status_code == 400
        assert res.json()["detail"] == "Only PDF files are authorized for ingestion."


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


@pytest.mark.asyncio
async def test_parse_returns_form_extracts_from_ocr_scan(monkeypatch):
    pdf_bytes = create_minimal_pdf_bytes([" "])
    ocr_page = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=False,
        plain_text="",
        words=[
            OcrWord(text="FormW-2WageandTaxStatement", x=0.08, y=0.05, w=0.45, h=0.03, confidence=96),
            OcrWord(text="Employer's name", x=0.08, y=0.16, w=0.20, h=0.03, confidence=94),
            OcrWord(text="Arizona Home Care LLC", x=0.08, y=0.20, w=0.30, h=0.03, confidence=94),
            OcrWord(text="Medicare wages and tips", x=0.50, y=0.38, w=0.22, h=0.03, confidence=94),
            OcrWord(text="90064.58", x=0.50, y=0.42, w=0.12, h=0.03, confidence=94),
        ],
    )
    convert_result = ConvertResult(
        pages=[ocr_page],
        page_count=1,
        ocr_page_count=1,
        flags=["ocr_applied"],
    )

    class FakeConverter:
        def inspect_pages(self, _data):
            return [PageInspect(text="", rotation=0, fields=[], use_ocr=True, flags=[], index=0)]

        def inspect_as_convert_result(self, _inspected):
            return convert_result

        def convert_to_ai_ready(self, _data, inspected=None, ocr_page_indices=None):
            return convert_result

    monkeypatch.setattr("server.get_converter", lambda: FakeConverter())

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/parse",
            content=pdf_bytes,
            headers={"Content-Type": "application/pdf", "x-document-title": "20_Locality_name.pdf"},
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "W-2" in body["classifications"]["0"]
    by_id = {row["sourceFieldId"]: row for row in body["formExtracts"]}
    assert by_id["w2-box5"]["numericValue"] == 90064.58
    assert by_id["w2-employer-name"]["value"] == "Arizona Home Care LLC"


def test_pdf_splitter_core_rules():
    assert "W-2" in CORE_RULES
    assert "Schedule C (Page 1 - Profits)" in CORE_RULES
    assert "Schedule E (Page 1 - Rentals)" in CORE_RULES
    assert "Schedule F (Farm Income)" in CORE_RULES
    assert "Form 1120S (S-Corporation Return)" in CORE_RULES
    assert "Form 1065 (Partnership Return)" in CORE_RULES

    w2_match = CORE_RULES["W-2"].search("2023 Form W-2 Wage and Tax Statement")
    assert w2_match is not None
    assert "Paystub" in CORE_RULES
    assert "WVOE" in CORE_RULES
    assert CORE_RULES["WVOE"].search("Written Verification of Employment") is not None
    assert CORE_RULES["Paystub"].search("Earnings Statement  Current Period  Net Pay") is not None
    assert CORE_RULES["Paystub"].search("Form W-2 Wage and Tax Statement") is None
    assert CORE_RULES["Paystub"].search("PAY ADVICE Regular 45.00") is not None
    assert CORE_RULES["Paystub"].search("Pay Statement Current Period") is not None

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


def test_pdf_splitter_ignores_w2_back_or_instruction_page():
    front = PageResult(index=0, width_px=612, height_px=792, is_native_text=True,
        plain_text="Form W-2 Wage and Tax Statement Box 1 Wages tips other compensation 95000.00", words=[])
    back = PageResult(index=1, width_px=612, height_px=792, is_native_text=True,
        plain_text="Form W-2 Wage and Tax Statement Instructions for employee and employer", words=[])
    result = pre_split_tax_returns(ConvertResult(pages=[front, back], page_count=2, ocr_page_count=0))
    assert result.target_pages == [0]
    assert 1 not in result.classifications


def test_pdf_splitter_keeps_copy2_when_copy_c_notice_is_on_the_same_page():
    spaced = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=True,
        plain_text=(
            "Copy 2 To Be Filed With Employee's State, City, or Local Income Tax Return "
            "Form W-2 Wage and Tax Statement "
            "1 Wages, tips, other compensation 159550.98 "
            "3 Social security wages 142800.00 "
            "5 Medicare wages and tips 168641.08 "
            "Copy C For EMPLOYEE'S RECORDS (See Notice to Employee on the back of Copy B.)"
        ),
        words=[],
    )
    glued = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=False,
        plain_text=(
            "FormW-2WageandTaxStatement Copy2 "
            "5Medicarewagesandtips 168641.08 3Socialsecuritywages 142800.00 "
            "CopyC SeeNoticetoEmployeeonthebackofCopyB"
        ),
        words=[],
    )
    for page in (spaced, glued):
        result = pre_split_tax_returns(ConvertResult(pages=[page], page_count=1, ocr_page_count=0))
        assert result.target_pages == [0]
        assert "W-2" in result.classifications[0]


def test_pdf_splitter_keeps_glued_ocr_w2_front_and_drops_glued_instructions():
    front = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=False,
        plain_text="FormW-2WageandTaxStatement 5Medicarewagesandtips 90064.58",
        words=[],
    )
    back = PageResult(
        index=1,
        width_px=612,
        height_px=792,
        is_native_text=False,
        plain_text="FormW-2WageandTaxStatement Instructionsforemployee CopyC",
        words=[],
    )
    result = pre_split_tax_returns(ConvertResult(pages=[front, back], page_count=2, ocr_page_count=2))
    assert result.target_pages == [0]
    assert "W-2" in result.classifications[0]
    assert 1 not in result.classifications


def test_pdf_splitter_classifies_glued_ocr_titles_for_other_forms():
    cases = [
        ("Paystub", "EarningsStatement CurrentPeriod NetPay 1840.22 YeartoDateGross 22000.00"),
        ("Schedule C (Page 1 - Profits)", "ScheduleCProfit or Loss From Business"),
        ("Form 1040 (Individual Return)", "U.S.IndividualIncomeTaxReturn"),
        ("Form 1120S (S-Corporation Return)", "U.S.IncomeTaxReturnforanSCorporation"),
        ("Form 8825 (Corporate Rentals)", "Form8825RentalRealEstateIncomeandExpenses"),
    ]
    for label, text in cases:
        page = PageResult(index=0, width_px=612, height_px=792, is_native_text=False, plain_text=text, words=[])
        split = pre_split_tax_returns(ConvertResult(pages=[page], page_count=1, ocr_page_count=1))
        assert label in split.classifications[0], (label, split.classifications)


@pytest.mark.parametrize(
    ("text", "label"),
    [
        ("Schedule B\n(Form 1040)\nInterest and Ordinary Dividends", "Schedule B (Interest & Dividends)"),
        ("Schedule C\n(Form 1040)\nProfit or Loss From Business", "Schedule C (Page 1 - Profits)"),
    ],
)
def test_pdf_splitter_classifies_native_multiline_form_titles(text: str, label: str) -> None:
    page = PageResult(index=0, width_px=612, height_px=792, is_native_text=True, plain_text=text, words=[])
    result = pre_split_tax_returns(ConvertResult(pages=[page], page_count=1, ocr_page_count=0))
    assert label in result.classifications[0]


def test_pdf_splitter_classifies_schedule_e_page_one_emitted_out_of_visual_order():
    """A preparer suite streams the masthead last, after the Part I body.

    "Schedule E" then sits a page of text away from "Supplemental Income and
    Loss", and the subtitle is reached before the masthead, so neither reading
    order satisfies title-then-subtitle. The rental page went unclassified and
    its property never reached the 1084.
    """
    page = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=True,
        plain_text=(
            "Name(s) shown on return\nSchedule E (Form 1040) 2025 Created 5/6/25\n"
            "Type of Property:\nProperties:\nIncome:\n"
            + "\n".join(str(line) for line in range(3, 27))
            + "\nIncome or Loss From Rental Real Estate and Royalties\n"
            "Physical address of each property (street, city, state, ZIP code)\n"
            "Rents received\nTotal expenses. Add lines 5 through 19\n"
            + ". " * 400
            + "\nSupplemental Income and Loss\n2025\nSCHEDULE E\n13\nPart I\n"
        ),
        words=[],
    )

    result = pre_split_tax_returns(ConvertResult(pages=[page], page_count=1, ocr_page_count=0))

    assert result.target_pages == [0]
    assert "Schedule E (Page 1 - Rentals)" in result.classifications[0]
    assert "Schedule E (Page 2 - K-1s)" not in result.classifications[0]


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


def test_pdf_splitter_classifies_paystub():
    page = PageResult(
        index=0,
        width_px=612,
        height_px=792,
        is_native_text=True,
        plain_text="Earnings Statement Current Period Net Pay 1840.22 Year to Date Gross 22000.00",
        words=[],
    )
    split_res = pre_split_tax_returns(ConvertResult(pages=[page], page_count=1, ocr_page_count=0))
    assert split_res.target_pages == [0]
    assert "Paystub" in split_res.classifications[0]


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
