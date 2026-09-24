"""The doc-parser pipeline end to end for pay stubs and business returns.

These cover the seam between the service and the dedicated pay stub parser in
``src/paystub``: classification, delegation, the reconciliation gate that
decides whether delegation is trusted, and the overlay geometry the console
consumes.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ai_pdf_converter import AIPDFConverter  # noqa: E402
from irs_form_extract import extract_irs_form_fields  # noqa: E402
from paystub_fixtures import build_paystub_pdf  # noqa: E402
from pdf_splitter import pre_split_tax_returns, select_ocr_page_indices  # noqa: E402

CONSOLE_MIN = 0.004
"""isUsableOverlayBox in apps/underwriting-console/src/overlayBox.ts."""


def flatten(pdf: bytes, dpi: int = 300) -> bytes:
    """Re-render a PDF as pixels, producing an image-only scan."""
    document = pdfium.PdfDocument(pdf)
    try:
        bitmap = document[0].render(scale=dpi / 72)
        image = Image.fromarray(np.ascontiguousarray(bitmap.to_numpy()[:, :, :3]))
        bitmap.close()
    finally:
        document.close()
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PDF", resolution=dpi)
    return buffer.getvalue()


def run_pipeline(pdf: bytes) -> tuple[dict, list[dict]]:
    """Mirror the server's flow: inspect, gate OCR, convert, split, extract."""
    converter = AIPDFConverter()
    inspected = converter.inspect_pages(pdf)
    preview = converter.inspect_as_convert_result(inspected)
    ocr_pages = select_ocr_page_indices(inspected, pre_split_tax_returns(preview))
    converted = converter.convert_to_ai_ready(pdf, ocr_page_indices=ocr_pages)
    split = pre_split_tax_returns(converted)
    fields = extract_irs_form_fields(
        pdf, ocr_pages=converted.pages, page_indices=split.target_pages
    )
    return split.classifications, fields


@pytest.fixture(scope="module")
def digital_paystub() -> tuple[dict, list[dict]]:
    return run_pipeline(build_paystub_pdf())


@pytest.fixture(scope="module")
def scanned_paystub() -> tuple[dict, list[dict]]:
    return run_pipeline(flatten(build_paystub_pdf()))


@pytest.fixture(params=["digital_paystub", "scanned_paystub"])
def paystub(request: pytest.FixtureRequest) -> tuple[dict, list[dict]]:
    return request.getfixturevalue(request.param)


def by_id(fields: list[dict]) -> dict[str, dict]:
    return {field["sourceFieldId"]: field for field in fields}


def test_paystub_page_is_classified(paystub) -> None:
    classifications, _ = paystub
    assert "Paystub" in classifications.get(0, [])


def test_pipeline_returns_the_correct_wage_figures(paystub) -> None:
    """The legacy table reader collapsed the page into one row and produced
    values unrelated to the printed figures."""
    _, fields = paystub
    fields_by_id = by_id(fields)

    assert fields_by_id["ps-base-ytd"]["numericValue"] == pytest.approx(29380.00)
    # Base pay for the period, so the $146.25 of overtime is excluded here and
    # reported under ps-ot-ytd instead. Gross for the period is 2,746.25.
    assert fields_by_id["ps-current-base"]["numericValue"] == pytest.approx(2600.00)
    assert fields_by_id["ps-hourly-rate"]["numericValue"] == pytest.approx(32.5)
    assert fields_by_id["ps-hours-week"]["numericValue"] == pytest.approx(40.0)
    assert fields_by_id["ps-employer-name"]["value"] == "Contoso Freight Inc"
    assert fields_by_id["ps-pay-frequency"]["value"] == "Biweekly"


def test_variable_pay_is_split_into_its_own_boxes(paystub) -> None:
    _, fields = paystub
    fields_by_id = by_id(fields)
    assert fields_by_id["ps-ot-ytd"]["numericValue"] == pytest.approx(1950.00)
    assert fields_by_id["ps-bonus-ytd"]["numericValue"] == pytest.approx(3000.00)


def test_imputed_income_never_reaches_the_wage_fields(paystub) -> None:
    """Group term life prints inside the earnings table but is not a wage."""
    _, fields = paystub
    values = [field["numericValue"] for field in fields]
    assert not any(abs(value - 41.60) < 0.01 for value in values)


def test_every_overlay_box_is_usable_by_the_console(paystub) -> None:
    _, fields = paystub
    assert fields
    for field in fields:
        box = field["box"]
        assert box["w"] > CONSOLE_MIN, field["sourceFieldId"]
        assert box["h"] > CONSOLE_MIN, field["sourceFieldId"]


def test_aggregated_fields_expose_their_source_cells(paystub) -> None:
    _, fields = paystub
    base_ytd = by_id(fields)["ps-base-ytd"]
    assert len(base_ytd["componentBoxes"]) >= 2


def test_fields_carry_the_page_and_entity_the_console_scopes_by(paystub) -> None:
    _, fields = paystub
    for field in fields:
        assert field["pageIndex"] == 0
        assert field["entityId"] == "paystub-p0"
        assert field["form"] == "Paystub"


def test_review_notes_reach_the_console(paystub) -> None:
    """Warnings and disclosures were computed and discarded before this.

    An excluded earning code or a non-recurring leave code could otherwise
    reach an underwriting decision without ever being shown.
    """
    _, fields = paystub
    notes = fields[0].get("reviewNotes") or []

    # The synthetic stub is clean, so it should raise nothing.
    assert notes == []


def test_review_notes_carry_severity_and_message() -> None:
    from irs_form_extract import _paystub_fields_from_parser
    from paystub_variants import LEAVE_CODES

    fields = _paystub_fields_from_parser(LEAVE_CODES.build(), 0)
    assert fields
    notes = fields[0]["reviewNotes"]

    assert {note["severity"] for note in notes} <= {"warning", "info"}
    assert all(note["message"] for note in notes)
    # Shift differential rides in the overtime box and needs a continuance check.
    assert any(
        note["severity"] == "info" and "continuance" in note["message"]
        for note in notes
    )


def test_an_unclassified_earning_is_surfaced_as_a_warning() -> None:
    """Excluded income is the case an underwriter most needs to see."""
    from irs_form_extract import _paystub_fields_from_parser
    from paystub_variants import LEAVE_CODES, Variant

    stub = Variant(
        name="unknown_code",
        description="carries an employer-specific code the taxonomy does not know",
        columns=LEAVE_CODES.columns,
        rows=LEAVE_CODES.rows + [("Widget Allowance", "", {"ytd": "1,500.00"})],
        footer={"amount": "1,050.00", "ytd": "31,800.00"},
        identity=LEAVE_CODES.identity,
        summary=[
            ("Gross Pay", 230.0, "1,050.00", "31,800.00"),
            ("Pre-Tax Deductions", 320.0, "100.00", "3,000.00"),
            ("Employee Taxes", 400.0, "95.00", "2,700.00"),
            ("Post-Tax Deductions", 490.0, "5.00", "150.00"),
            ("Net Pay", 560.0, "850.00", "25,950.00"),
        ],
        expected={},
    )

    fields = _paystub_fields_from_parser(stub.build(), 0)
    assert fields
    notes = fields[0]["reviewNotes"]
    assert any(
        note["severity"] == "warning" and "Widget Allowance" in note["message"]
        for note in notes
    ), notes


def test_delegation_declines_when_the_page_does_not_reconcile() -> None:
    """A page the dedicated parser cannot balance falls back to the old reader.

    Wrong values carrying confident overlay boxes are worse than no fields, so
    the reconciliation result is the gate on trusting the delegation.
    """
    from irs_form_extract import _paystub_fields_from_parser

    assert _paystub_fields_from_parser(b"%PDF-1.4 not a real document", 0) is None
    assert _paystub_fields_from_parser(None, 0) is None


def test_scanned_and_digital_pipelines_agree(
    digital_paystub, scanned_paystub
) -> None:
    digital = by_id(digital_paystub[1])
    scanned = by_id(scanned_paystub[1])

    assert set(digital) == set(scanned)
    for source_id, field in digital.items():
        assert scanned[source_id]["numericValue"] == pytest.approx(
            field["numericValue"], abs=0.01
        ), source_id
