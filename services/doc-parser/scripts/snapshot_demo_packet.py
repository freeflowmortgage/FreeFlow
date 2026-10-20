"""Snapshot the parser's result for each document in the public income demo.

    python scripts/snapshot_demo_packet.py

The public demo cannot call the parser: the preview API sits behind sign-in.
So the sample PDFs in apps/underwriting-console/public/demo-documents ship
with the exact response ``POST /parse`` returns for them, and the console maps
that response through the same code path as a live upload. Rerun this after
any parser change that affects those documents, and commit the JSON with it.

Only the sample PDFs listed in manifest.json are read. They are fabricated
("SAMPLE - FICTIONAL DATA"); never add a real borrower's document here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

PACKET = ROOT.parents[1] / "apps" / "underwriting-console" / "public" / "demo-documents"

# Per-request values that would make every regeneration a diff.
_VOLATILE = ("transaction_id",)


def main() -> None:
    from fastapi.testclient import TestClient

    import server

    manifest = json.loads((PACKET / "manifest.json").read_text())
    client = TestClient(server.app)
    for entry in manifest["documents"]:
        pdf = PACKET / entry["fileName"]
        response = client.post(
            "/parse",
            files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")},
        )
        response.raise_for_status()
        result = response.json()
        result = result.get("result", result)
        for key in _VOLATILE:
            result.pop(key, None)
        out = PACKET / entry["parseFile"]
        out.write_text(json.dumps(result, separators=(",", ":")) + "\n")
        forms = sorted({row.get("form") for row in result.get("formExtracts", [])})
        print(f"{pdf.name}: {len(result.get('formExtracts', []))} fields {forms} -> {out.name}")


if __name__ == "__main__":
    main()
