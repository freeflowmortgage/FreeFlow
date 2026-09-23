"""Synthetic pay stub fixtures.

Real stubs are payroll records for a named person, so none is committed here.
These fixtures are generated at test time from invented data and mirror the
layout traits the parser actually depends on: right-aligned numeric columns,
side-by-side tables, a line whose description and dates are run together, an
earning code that repeats with its own year-to-date balance, and an imputed
line sitting inside the earnings table but outside gross pay.

The PDF is emitted by hand rather than with a reporting library so the suite
carries no extra dependency. Courier is the reason it stays short: it is a
base-14 font, so nothing needs embedding, and every glyph is exactly 0.6 em
wide, which makes right-aligning a column arithmetic instead of a font-metrics
lookup.
"""

from __future__ import annotations

import io
from decimal import Decimal

PAGE_WIDTH = 612
PAGE_HEIGHT = 792
FONT_SIZE = 7.0
CHAR_WIDTH = FONT_SIZE * 0.6

# Right edges for the five numeric columns, in PDF points.
COL_HOURS = 300.0
COL_RATE = 350.0
COL_AMOUNT = 420.0
COL_YTD_HOURS = 470.0
COL_YTD_AMOUNT = 545.0

EXPECTED = {
    "employer": "Contoso Freight Inc",
    "employee": "Dana Rivera",
    "employee_id": "991244",
    "period_begin": "06/05/2023",
    "period_end": "06/18/2023",
    "check_date": "06/23/2023",
    "gross_current": Decimal("2746.25"),
    "gross_ytd": Decimal("34330.00"),
    "net_current": Decimal("2065.11"),
    "net_ytd": Decimal("25820.40"),
    "footer_current": Decimal("2749.45"),
    "footer_ytd": Decimal("34371.60"),
    "base_ytd": Decimal("29380.00"),
    "base_worked_ytd": Decimal("26000.00"),
    "base_leave_ytd": Decimal("3380.00"),
    "variable_ytd": Decimal("4950.00"),
    "imputed_ytd": Decimal("41.60"),
    "base_ytd_hours": Decimal("904"),
    "hourly_rate": Decimal("32.5000"),
    "hours_per_period": Decimal("80"),
    "periods_elapsed": Decimal("11.30"),
    "monthly_base_at_current_rate": Decimal("5633.33"),
    "monthly_base_ytd_average": Decimal("5633.33"),
}

# (description, dates, hours, rate, amount, ytd_hours, ytd_amount)
_EARNINGS = [
    # Description and dates deliberately run together, as OCR and some payroll
    # templates emit them, to exercise date extraction from a merged cell.
    ("Group Term Life:06/05/2023 - 06/18/2023", "", "", "", "3.20", "", "41.60"),
    ("Bonus", "", "", "", "", "", "3,000.00"),
    ("Overtime", "06/05/2023 - 06/11/2023", "3", "48.7500", "146.25", "40", "1,950.00"),
    ("Regular Hourly", "06/05/2023 - 06/11/2023", "40", "32.5000", "1,300.00", "800", "26,000.00"),
    # Same code, second weekly segment, no YTD of its own.
    ("Regular Hourly", "06/12/2023 - 06/18/2023", "24", "32.5000", "780.00", "", ""),
    ("Sick Pay", "06/12/2023 - 06/18/2023", "8", "32.5000", "260.00", "24", "780.00"),
    ("Vacation Pay", "06/12/2023 - 06/18/2023", "8", "32.5000", "260.00", "80", "2,600.00"),
]


def _escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


class _Content:
    """Accumulates a PDF text-drawing content stream."""

    def __init__(self) -> None:
        self._ops: list[str] = []

    def left(self, text: str, x: float, y: float) -> None:
        if not text:
            return
        self._ops.append(
            f"BT /F1 {FONT_SIZE} Tf 1 0 0 1 {x:.2f} {PAGE_HEIGHT - y:.2f} Tm "
            f"({_escape(text)}) Tj ET"
        )

    def right(self, text: str, x: float, y: float) -> None:
        """Place ``text`` so its right edge lands on ``x``."""
        if not text:
            return
        self.left(text, x - len(text) * CHAR_WIDTH, y)

    def render(self) -> bytes:
        return "\n".join(self._ops).encode("latin-1")


def _assemble(stream: bytes) -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
        ).encode("latin-1"),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    ]

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n".encode() + body + b"\nendobj\n")

    xref_at = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_at}\n%%EOF\n".encode()
    )
    return out.getvalue()


def build_paystub_pdf() -> bytes:
    """Render the synthetic stub as a single-page PDF with a real text layer."""
    content = _Content()

    identity_labels = [
        ("Name", 40.0),
        ("Company", 150.0),
        ("Employee ID", 290.0),
        ("Pay Period Begin", 360.0),
        ("Pay Period End", 435.0),
        ("Check Date", 500.0),
        ("Check Number", 560.0),
    ]
    for text, x in identity_labels:
        content.left(text, x, 60)
    for text, x in [
        (EXPECTED["employee"], 40.0),
        (EXPECTED["employer"], 150.0),
        (EXPECTED["employee_id"], 290.0),
        (EXPECTED["period_begin"], 360.0),
        (EXPECTED["period_end"], 435.0),
        (EXPECTED["check_date"], 500.0),
    ]:
        content.left(text, x, 74)

    # Summary box: labels and values share a right edge, as on a real stub.
    summary_columns = [
        ("Gross Pay", 230.0, "2,746.25", "34,330.00"),
        ("Pre-Tax Deductions", 320.0, "412.50", "4,161.25"),
        ("Employee Taxes", 400.0, "245.14", "3,242.75"),
        ("Post-Tax Deductions", 490.0, "23.50", "268.10"),
        ("Net Pay", 560.0, "2,065.11", "25,820.40"),
    ]
    for label, right_edge, current, ytd in summary_columns:
        content.right(label, right_edge, 100)
        content.right(current, right_edge, 114)
        content.right(ytd, right_edge, 128)
    content.left("Current", 40.0, 114)
    content.left("YTD", 40.0, 128)

    # Two side-by-side tables. The right-hand one exists so the parser has to
    # clip the earnings block horizontally instead of swallowing tax rows.
    content.left("Earnings", 180.0, 150)
    content.left("Employee Taxes", 480.0, 150)

    header_y = 164.0
    content.left("Description", 40.0, header_y)
    content.left("Dates", 140.0, header_y)
    content.right("Hours", COL_HOURS, header_y)
    content.right("Rate", COL_RATE, header_y)
    content.right("Amount", COL_AMOUNT, header_y)
    content.right("YTD Hours", COL_YTD_HOURS, header_y)
    content.right("YTD Amount", COL_YTD_AMOUNT, header_y)
    content.left("Description", 560.0, header_y)

    row_y = header_y + 14
    for description, dates, hours, rate, amount, ytd_hours, ytd_amount in _EARNINGS:
        content.left(description, 40.0, row_y)
        content.left(dates, 140.0, row_y)
        content.right(hours, COL_HOURS, row_y)
        content.right(rate, COL_RATE, row_y)
        content.right(amount, COL_AMOUNT, row_y)
        content.right(ytd_hours, COL_YTD_HOURS, row_y)
        content.right(ytd_amount, COL_YTD_AMOUNT, row_y)
        row_y += 14

    content.left("Earnings", 40.0, row_y)
    content.right("2,749.45", COL_AMOUNT, row_y)
    content.right("34,371.60", COL_YTD_AMOUNT, row_y)

    return _assemble(content.render())


def build_scanned_paystub_pdf(dpi: int = 300) -> bytes:
    """Flatten the synthetic stub to pixels, as a "Print to PDF" driver would.

    The result has no text layer, which forces the parser down the OCR path.
    """
    import numpy as np
    import pypdfium2 as pdfium
    from PIL import Image

    document = pdfium.PdfDocument(build_paystub_pdf())
    try:
        bitmap = document[0].render(scale=dpi / 72)
        try:
            image = Image.fromarray(np.ascontiguousarray(bitmap.to_numpy()[:, :, :3]))
        finally:
            bitmap.close()
    finally:
        document.close()

    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="PDF", resolution=dpi)
    return buffer.getvalue()
