"""Turn PDF bytes into positioned text tokens without touching the filesystem.

Two paths, tried in order:

1. **Embedded text.** Most payroll providers emit a real text layer. PDFium
   gives us a box per character, which is more accurate and ~50x faster than
   recognizing pixels.
2. **OCR.** Stubs that were scanned or produced by a "Print to PDF" driver
   carry no text at all. Those get rasterized in memory and recognized by
   RapidOCR, whose ONNX weights ship inside the wheel, so recognition is a
   local matrix multiply with no network call and no vendor retention.

Both paths keep the document in RAM: PDFium parses from a bytes buffer, the
raster lands in a NumPy array, and nothing is ever handed a file path.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np
import pypdfium2 as pdfium

from .models import Token

# Must be set before ONNX Runtime loads. Left at its default, the runtime
# writes a persistent device identifier and a telemetry database under
# ~/.cache/Microsoft/DeveloperTools/.onnxruntime, plus a debug log in /tmp.
# None of it contains document bytes, but a document-processing path that
# creates files and a stable machine ID is not one that can claim zero
# retention. setdefault so an operator can still override deliberately.
os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")

RENDER_DPI = 400
"""400 dpi is the knee of the curve for 6-8pt payroll type: 300 starts losing
thousands separators, and 600 doubles the pixels for no accuracy gain."""

_MIN_CHARS_FOR_TEXT_LAYER = 200
"""Below this, treat the page as image-only. A scanned stub often still has a
handful of characters from a footer stamp; that is not a usable text layer."""

_ocr_lock = threading.Lock()
_ocr_engine = None


def _get_ocr_engine():
    """Load RapidOCR once per process. Model init costs ~1s; recognition is ~2s/page."""
    global _ocr_engine
    with _ocr_lock:
        if _ocr_engine is None:
            from rapidocr_onnxruntime import RapidOCR

            _ocr_engine = RapidOCR()
        return _ocr_engine


def _char_tokens(page: pdfium.PdfPage, scale: float) -> list[Token]:
    """Group PDFium character boxes into whitespace-delimited tokens.

    Boxes are requested ``loose``, meaning the glyph's full advance rather than
    its inked bounding box. That distinction decides whether this works: tight
    boxes shrink to almost nothing around a period, so a threshold derived from
    one would split ``1,300.00`` into five tokens. Loose boxes tile edge to
    edge within a word and share a uniform height, which makes both word
    splitting and row grouping fall out of simple geometry.

    PDFium reports points with a bottom-left origin; OCR reports pixels with a
    top-left origin. Everything downstream assumes the latter, so convert here
    and keep the rest of the pipeline unit-agnostic.
    """
    textpage = page.get_textpage()
    try:
        count = textpage.count_chars()
        if count < _MIN_CHARS_FOR_TEXT_LAYER:
            return []

        page_height = page.get_height()
        tokens: list[Token] = []
        run: list[tuple[str, float, float, float, float]] = []

        def flush() -> None:
            if not run:
                return
            text = "".join(c[0] for c in run).strip()
            if text:
                tokens.append(
                    Token(
                        text=text,
                        x0=min(c[1] for c in run),
                        y0=min(c[2] for c in run),
                        x1=max(c[3] for c in run),
                        y1=max(c[4] for c in run),
                    )
                )
            run.clear()

        for index in range(count):
            glyph = textpage.get_text_range(index, 1)
            if not glyph.strip():
                flush()
                continue

            left, bottom, right, top = textpage.get_charbox(index, loose=True)
            char = (
                glyph,
                left * scale,
                (page_height - top) * scale,
                right * scale,
                (page_height - bottom) * scale,
            )

            if run:
                previous = run[-1]
                advance = max(char[3] - char[1], previous[3] - previous[1], 1e-6)
                height = max(char[4] - char[2], 1e-6)
                stepped_across = char[1] - previous[3] > advance * 0.25
                stepped_down = abs(char[2] - previous[2]) > height * 0.5
                if stepped_across or stepped_down:
                    flush()
            run.append(char)
        flush()
        return tokens
    finally:
        textpage.close()


def _ocr_tokens(page: pdfium.PdfPage, scale: float) -> list[Token]:
    """Rasterize in memory and recognize. The bitmap never leaves the process."""
    bitmap = page.render(scale=scale)
    try:
        image = bitmap.to_numpy()
        # RapidOCR wants 3-channel BGR/RGB; PDFium renders BGRA by default.
        if image.ndim == 3 and image.shape[2] == 4:
            image = image[:, :, :3]
        image = np.ascontiguousarray(image)

        result, _ = _get_ocr_engine()(image)
        tokens: list[Token] = []
        for box, text, confidence in result or []:
            xs = [point[0] for point in box]
            ys = [point[1] for point in box]
            cleaned = text.strip()
            if cleaned:
                tokens.append(
                    Token(
                        text=cleaned,
                        x0=float(min(xs)),
                        y0=float(min(ys)),
                        x1=float(max(xs)),
                        y1=float(max(ys)),
                        confidence=float(confidence),
                    )
                )
        return tokens
    finally:
        bitmap.close()


@dataclass(frozen=True, slots=True)
class ExtractedPage:
    """Recognized tokens plus the page size they are measured against.

    Page dimensions travel with the tokens because overlay boxes have to be
    normalized to 0-1 for the income tool, and the divisor is only known here.
    """

    tokens: list[Token]
    source: str
    width: float
    height: float


def extract_page(
    pdf_bytes: bytes | bytearray,
    dpi: int = RENDER_DPI,
    page_index: int = 0,
) -> ExtractedPage:
    """Extract positioned tokens from one page of ``pdf_bytes``.

    ``source`` records which path produced them: ``"text"``, ``"ocr"``,
    ``"empty"``, or ``"invalid"``. A document PDFium cannot open yields no
    tokens rather than raising; a malformed upload is an expected input.
    """
    scale = dpi / 72
    try:
        document = pdfium.PdfDocument(bytes(pdf_bytes))
    except pdfium.PdfiumError:
        return ExtractedPage([], "invalid", 0.0, 0.0)
    try:
        if len(document) <= page_index:
            return ExtractedPage([], "empty", 0.0, 0.0)
        page = document[page_index]
        width = page.get_width() * scale
        height = page.get_height() * scale

        tokens = _char_tokens(page, scale)
        if tokens:
            return ExtractedPage(tokens, "text", width, height)
        return ExtractedPage(_ocr_tokens(page, scale), "ocr", width, height)
    finally:
        document.close()


def iter_rows(tokens: list[Token], tolerance: float) -> Iterator[list[Token]]:
    """Group tokens into visual rows by vertical center.

    Payroll tables pack rows tightly enough that boxes from adjacent rows
    overlap by a pixel or two, so band edges are unreliable; centers are not.
    """
    for row in group_rows(tokens, tolerance):
        yield row


def group_rows(tokens: list[Token], tolerance: float) -> list[list[Token]]:
    rows: list[list[Token]] = []
    for token in sorted(tokens, key=lambda t: (t.y_center, t.x0)):
        if rows and abs(token.y_center - _row_center(rows[-1])) <= tolerance:
            rows[-1].append(token)
        else:
            rows.append([token])
    for row in rows:
        row.sort(key=lambda t: t.x0)
    return rows


def _row_center(row: list[Token]) -> float:
    return sum(t.y_center for t in row) / len(row)
