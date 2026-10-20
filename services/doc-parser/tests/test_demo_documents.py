"""The public income demo's sample documents, through the server's parse route.

These PDFs print their amounts as text but draw the form captions as vector
outlines, so the captions exist only in OCR. Each reader has to combine the
two: trusting the text layer alone finds no captions, and trusting OCR alone
merges or garbles amounts.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

DEMO_DOCUMENTS = ROOT.parents[1] / "apps" / "underwriting-console" / "public" / "demo-documents"


@pytest.fixture(scope="module")
def parse():
    from fastapi.testclient import TestClient

    import server

    client = TestClient(server.app)

    def run(name: str) -> dict:
        pdf = (DEMO_DOCUMENTS / name).read_bytes()
        response = client.post("/parse", files={"file": (name, pdf, "application/pdf")})
        assert response.status_code == 200, response.text
        body = response.json()
        return body.get("result", body)

    return run


def test_four_up_w2_reads_each_box_from_its_own_cell(parse) -> None:
    result = parse("w2.pdf")

    assert len(result["w2Extracts"]) == 1
    w2 = result["w2Extracts"][0]
    assert w2["employerName"] == "Example Services LLC"
    assert w2["ein"] == "00-7654321"
    assert {key: w2[key] for key in ("box1", "box2", "box3", "box4", "box5", "box6")} == {
        "box1": 86400.0,
        "box2": 10800.0,
        "box3": 90000.0,
        "box4": 5580.0,
        "box5": 90000.0,
        "box6": 1305.0,
    }
    assert w2["isMedicareValidated"] is True


def test_schedule_e_with_vector_captions_yields_every_property(parse) -> None:
    result = parse("schedule-e.pdf")

    properties = {
        prop["address"]: prop for prop in result["scheduleEProperties"]
    }
    assert sorted(properties) == [
        "101 Example Lane, Example City, AZ 00000",
        "202 Sample Court, Example City, AZ 00000",
        "303 Demo Drive, Example City, AZ 00000",
        "404 Practice Way, Example City, AZ 00000",
        "505 Test Terrace, Example City, AZ 00000",
    ]
    first = properties["101 Example Lane, Example City, AZ 00000"]
    assert first["year"] == 2025
    assert first["fairRentalDays"] == 365
    assert first["financials"]["3"] == 24000.0
    assert first["financials"]["18"] == 5000.0
    assert first["financials"]["20"] == 17800.0
    assert first["financials"]["21"] == 6200.0


def _values(result: dict) -> dict[str, str]:
    return {row["sourceFieldId"]: row["value"] for row in result["formExtracts"]}


def test_blank_schedule_l_lines_do_not_borrow_the_neighbouring_row(parse) -> None:
    values = _values(parse("form-1065.pdf"))

    assert values["pt-return-ord"] == "-$18,000.00"
    assert values["pt-return-dep"] == "$18,000.00"
    assert values["pt-return-gross"] == "$180,000.00"
    assert values["sch-l-cash"] == "$66,000.00"
    assert values["sch-l-ap"] == "$26,400.00"
    assert values["sch-l-notes"] == "$6,000.00"
    # Lines 2a and 17 are blank; the rows above them hold 66000 and 6000.
    assert "sch-l-ar" not in values
    assert "sch-l-other-current" not in values


def test_k1_reads_the_partner_share(parse) -> None:
    values = _values(parse("schedule-k1.pdf"))

    assert values["pt-ord"] == "-$10,800.00"
    assert values["pt-gp"] == "$12,000.00"
    assert values["pt-dist"] == "$11,040.00"
    assert values["pt-profit-pct"] == "60%"
    assert values["pt-partner-name"] == "Jordan Example"
