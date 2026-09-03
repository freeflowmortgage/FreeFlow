"""Native-text W-2 + Schedule C smoke PDF with dollar amounts for live box QA."""

from io import BytesIO
from pathlib import Path
import sys


lines_p1 = [
    (72, 720, "Form W-2 Wage and Tax Statement"),
    (72, 700, "Employee Name Jordan Hale"),
    (72, 670, "Box 1 Wages tips other compensation 150000.00"),
    (72, 650, "Box 2 Federal income tax withheld 18500.00"),
    (72, 630, "Box 3 Social security wages 150000.00"),
    (72, 610, "Box 4 Social security tax withheld 9300.00"),
    (72, 590, "Box 5 Medicare wages and tips 150000.00"),
    (72, 570, "Box 6 Medicare tax withheld 2175.00"),
]
lines_p2 = [
    (72, 720, "Schedule C Profit or Loss From Business"),
    (72, 700, "U.S. Individual Income Tax Return Form 1040"),
    (72, 660, "Line 31 Net profit or loss 102000.00"),
    (72, 640, "Line 13 Depreciation 8500.00"),
    (72, 620, "Line 44a Business miles add-back 4500.00"),
]


def tj_stream(rows: list[tuple[int, int, str]]) -> bytes:
    chunks = [b"BT /F1 11 Tf"]
    for x, y, text in rows:
        safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        chunks.append(f"1 0 0 1 {x} {y} Tm ({safe}) Tj".encode())
    chunks.append(b"ET")
    return b" ".join(chunks)


s1 = tj_stream(lines_p1)
s2 = tj_stream(lines_p2)

objs = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    (
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>"
    ),
    b"<< /Length %d >>\nstream\n" % len(s1) + s1 + b"\nendstream",
    (
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>"
    ),
    b"<< /Length %d >>\nstream\n" % len(s2) + s2 + b"\nendstream",
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]

out = BytesIO()
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
dest = Path(sys.argv[1] if len(sys.argv) > 1 else "income-smoke.pdf")
dest.write_bytes(out.getvalue())
print(f"wrote {dest} ({dest.stat().st_size} bytes)")
