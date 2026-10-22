"""Snapshot the parser's result for each document in the public income demo.

    python scripts/snapshot_demo_packet.py
    pnpm --filter web exec tsx scripts/build-demo-console-context.ts

The public demo cannot call the parser: the preview API sits behind sign-in.
So the sample PDFs in apps/underwriting-console/public/demo-documents ship
with what the live tool would have stored for them. This script records the
``POST /parse`` response for each; the portal script then runs those through
the same persistence projection a live upload goes through. Rerun both after
any parser change that affects the samples, and commit the output.

Only the documents listed in demo-packet/manifest.json are read. They are
fabricated ("SAMPLE - FICTIONAL DATA"); never add a real borrower's document.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))

CONSOLE = ROOT.parents[1] / "apps" / "underwriting-console"
DOCUMENTS = CONSOLE / "public" / "demo-documents"
PACKET = CONSOLE / "demo-packet"

# The persisted projection never reads OCR words, and the transaction id
# changes every run.
_DROP = ("transaction_id",)


def main() -> None:
    from fastapi.testclient import TestClient

    import server

    manifest = json.loads((PACKET / "manifest.json").read_text())
    out_dir = PACKET / "parse"
    out_dir.mkdir(exist_ok=True)
    client = TestClient(server.app)
    for entry in manifest["documents"]:
        pdf = DOCUMENTS / entry["fileName"]
        response = client.post(
            "/parse",
            files={"file": (pdf.name, pdf.read_bytes(), "application/pdf")},
        )
        response.raise_for_status()
        result = response.json()
        result = result.get("result", result)
        for key in _DROP:
            result.pop(key, None)
        for page in result.get("pages", []):
            page["words"] = []
        out = out_dir / f"{entry['attachmentId']}.json"
        out.write_text(json.dumps(result, indent=1, sort_keys=True) + "\n")
        print(
            f"{pdf.name}: {len(result.get('formExtracts', []))} form fields, "
            f"{len(result.get('w2Extracts', []))} W-2, "
            f"{len(result.get('scheduleEProperties', []))} Schedule E -> {out.name}"
        )


if __name__ == "__main__":
    main()
