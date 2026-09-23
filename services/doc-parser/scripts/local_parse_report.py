"""Print the extracted fields for one document from the local parser.

    python scripts/local_parse_report.py /path/to/document.pdf

Reads DOC_PARSER_URL if the service is not on the default port.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

URL = os.environ.get("DOC_PARSER_URL", "http://127.0.0.1:8080/parse")
CONSOLE_MIN = 0.004
"""isUsableOverlayBox in apps/underwriting-console/src/overlayBox.ts."""


def parse(path: str) -> dict:
    with open(path, "rb") as handle:
        payload = handle.read()
    request = urllib.request.Request(
        URL,
        data=payload,
        headers={
            "content-type": "application/pdf",
            "x-document-title": os.path.basename(path),
        },
    )
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.load(response)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    body = parse(sys.argv[1])
    print(f"document_id     : {body.get('document_id')}")
    print(f"transaction_id  : {body.get('transaction_id')}")
    print(f"classifications : {body.get('classifications')}")
    print(f"pages / ocr'd   : {body.get('total_pages_scanned')} / {body.get('ocr_page_count')}")

    extracts = body.get("formExtracts") or []
    if extracts:
        print(f"\nformExtracts ({len(extracts)}):")
        for field in extracts:
            box = field.get("box") or {}
            usable = box.get("w", 0) > CONSOLE_MIN and box.get("h", 0) > CONSOLE_MIN
            cells = len(field.get("componentBoxes") or [])
            print(
                f"  {field['sourceFieldId']:<24} {str(field.get('value'))[:30]:<32}"
                f" overlay={'ok' if usable else 'UNUSABLE'}"
                + (f" cells={cells}" if cells else "")
            )

    properties = body.get("scheduleEProperties") or []
    if properties:
        print(f"\nscheduleEProperties ({len(properties)}):")
        for prop in properties:
            financials = prop.get("financials") or {}
            print(
                f"  column {prop.get('column')}: {prop.get('address')!r}"
                f" rents={financials.get('3')} expenses={financials.get('20')}"
                f" net={financials.get('21')} days={prop.get('fairRentalDays')}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
