"""The content-derived document id used to recognize resubmissions.

``transaction_id`` is a random UUID per request, which correlates logs but
cannot tell a resubmission from a new document. ``document_id`` is derived
from the bytes, so the same file always produces the same id.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import server  # noqa: E402
from paystub_fixtures import build_paystub_pdf  # noqa: E402


def test_same_bytes_produce_the_same_id() -> None:
    pdf = build_paystub_pdf()
    assert server._document_id(pdf) == server._document_id(bytes(pdf))


def test_different_bytes_produce_different_ids() -> None:
    assert server._document_id(b"%PDF-1.4 a") != server._document_id(b"%PDF-1.4 b")


def test_id_is_a_one_way_digest_not_the_document() -> None:
    """Retaining the id must not retain content."""
    pdf = build_paystub_pdf()
    document_id = server._document_id(pdf)

    algorithm, _, digest = document_id.partition(":")
    assert algorithm in {"sha256", "hmac-sha256"}
    assert len(digest) == 64
    assert pdf[:32] not in document_id.encode()


def test_key_changes_the_id_so_an_outsider_cannot_reproduce_it(monkeypatch) -> None:
    """An unkeyed SHA-256 lets anyone holding the same file confirm it was parsed."""
    pdf = build_paystub_pdf()
    unkeyed = server._document_id(pdf)

    monkeypatch.setattr(server, "DOCUMENT_ID_HMAC_KEY", b"a-production-secret")
    keyed = server._document_id(pdf)

    assert keyed != unkeyed
    assert keyed.startswith("hmac-sha256:")
    assert unkeyed.startswith("sha256:")

    monkeypatch.setattr(server, "DOCUMENT_ID_HMAC_KEY", b"a-different-secret")
    assert server._document_id(pdf) != keyed


@pytest.mark.asyncio
async def test_parse_response_carries_both_ids() -> None:
    transport = ASGITransport(app=server.app)
    pdf = build_paystub_pdf()
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/parse", content=pdf, headers={"content-type": "application/pdf"}
        )
        second = await client.post(
            "/parse", content=pdf, headers={"content-type": "application/pdf"}
        )

    assert first.status_code == 200 and second.status_code == 200
    first_body, second_body = first.json(), second.json()

    # Same document resubmitted: stable id, so the caller can skip re-billing.
    assert first_body["document_id"] == second_body["document_id"]
    # Distinct requests remain individually traceable.
    assert first_body["transaction_id"] != second_body["transaction_id"]
