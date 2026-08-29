"""Write a one-page native-text PDF for local parser smoke tests."""

from io import BytesIO
from pathlib import Path
import sys

stream = (
    b"BT /F1 12 Tf 72 720 Td "
    b"(Form W-2 Wage and Tax Statement employee wages tips other compensation) Tj ET"
)
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
dest = Path(sys.argv[1] if len(sys.argv) > 1 else "w2-smoke.pdf")
dest.write_bytes(out.getvalue())
print(f"wrote {dest} ({dest.stat().st_size} bytes)")
