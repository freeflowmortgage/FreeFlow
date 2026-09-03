"""One-page native W-2-style PDF with dollar amounts for local Split View tests."""

from io import BytesIO
from pathlib import Path
import sys

lines = [
    "Form W-2 Wage and Tax Statement",
    "Box 1 Wages tips other compensation 150000.00",
    "Box 2 Federal income tax withheld 18500.00",
    "Box 3 Social security wages 150000.00",
    "Box 4 Social security tax withheld 9300.00",
    "Box 5 Medicare wages and tips 150000.00",
    "Box 6 Medicare tax withheld 2175.00",
]
ops = ["BT /F1 12 Tf 72 720 Td"]
for i, line in enumerate(lines):
    if i:
        ops.append("0 -22 Td")
    ops.append(f"({line}) Tj")
ops.append("ET")
stream = " ".join(ops).encode("ascii")

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
dest = Path(sys.argv[1] if len(sys.argv) > 1 else "live-w2.pdf")
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_bytes(out.getvalue())
print(f"wrote {dest} ({dest.stat().st_size} bytes)")
