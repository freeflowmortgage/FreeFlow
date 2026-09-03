"""In-memory PDF OCR (v3).

Bytes in, structured words/boxes out. No sandwich PDF, no Poppler, no Tesseract
temp files. Page bitmaps are released after each page.
"""

from __future__ import annotations

import io
import logging
from dataclasses import asdict, dataclass, field
from typing import Any

import cv2
import numpy as np
import pypdfium2 as pdfium
from pypdf import PdfReader

logger = logging.getLogger("freeflow.ocr")

MAX_PDF_BYTES = 40 * 1024 * 1024
MAX_PAGES = 150
RENDER_DPI = 300
NATIVE_TEXT_CHARS = 40
LOW_CONFIDENCE = 55.0
DESKEW_MAX_DEGREES = 15.0


@dataclass
class OcrWord:
    text: str
    x: float
    y: float
    w: float
    h: float
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PageResult:
    index: int
    width_px: int
    height_px: int
    is_native_text: bool
    words: list[OcrWord] = field(default_factory=list)
    plain_text: str = ""
    mean_confidence: float = 0.0
    skew_degrees: float = 0.0
    used_binarization: bool = False
    flags: list[str] = field(default_factory=list)

    def text(self) -> str:
        if self.plain_text.strip():
            return self.plain_text
        return " ".join(word.text for word in self.words if word.text)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["words"] = [word.to_dict() for word in self.words]
        payload["text"] = self.text()
        return payload


@dataclass
class ConvertResult:
    pages: list[PageResult]
    page_count: int
    ocr_page_count: int
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "page_count": self.page_count,
            "ocr_page_count": self.ocr_page_count,
            "flags": self.flags,
            "pages": [page.to_dict() for page in self.pages],
        }


def _load_ocr_engine():
    try:
        from rapidocr_onnxruntime import RapidOCR

        return RapidOCR()
    except ImportError:
        from rapidocr import RapidOCR

        return RapidOCR()


class AIPDFConverter:
    """Deskew + CLAHE, then RapidOCR. Returns relative [0,1] boxes."""

    def __init__(self) -> None:
        self._ocr = None

    def _engine(self):
        if self._ocr is None:
            self._ocr = _load_ocr_engine()
        return self._ocr

    def searchable_mask(self, pdf_bytes: bytes) -> list[bool]:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        mask: list[bool] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            mask.append(len(text.strip()) >= NATIVE_TEXT_CHARS)
        return mask

    def is_searchable(self, pdf_input: bytes | str) -> bool:
        pdf_bytes = self._coerce_bytes(pdf_input)
        mask = self.searchable_mask(pdf_bytes)
        return bool(mask) and all(mask)

    def convert_to_ai_ready(self, pdf_input: bytes | str) -> ConvertResult:
        pdf_bytes = self._coerce_bytes(pdf_input)
        if len(pdf_bytes) > MAX_PDF_BYTES:
            raise ValueError(f"PDF exceeds {MAX_PDF_BYTES} byte limit")

        native_mask = self.searchable_mask(pdf_bytes)
        native_texts = self._native_texts(pdf_bytes)
        page_count = len(native_mask)
        if page_count > MAX_PAGES:
            raise ValueError(f"PDF exceeds {MAX_PAGES} page limit")

        pages: list[PageResult] = []
        ocr_count = 0
        flags: list[str] = []

        pdf = pdfium.PdfDocument(pdf_bytes)
        try:
            pdfium_count = len(pdf)
            if pdfium_count != page_count:
                page_count = min(page_count, pdfium_count)
                native_mask = native_mask[:page_count]
                native_texts = native_texts[:page_count]
            for index in range(page_count):
                pdf_page = pdf[index]
                try:
                    if native_mask[index]:
                        pages.append(self._native_page(pdf_page, index, native_texts[index]))
                    else:
                        ocr_count += 1
                        pages.append(self._ocr_page(pdf_page, index))
                finally:
                    if hasattr(pdf_page, "close"):
                        pdf_page.close()
        finally:
            pdf.close()

        if ocr_count:
            flags.append("ocr_applied")
            logger.info("ocr_complete pages=%s ocr_pages=%s", page_count, ocr_count)

        return ConvertResult(
            pages=pages,
            page_count=page_count,
            ocr_page_count=ocr_count,
            flags=flags,
        )

    def _ocr_page(self, page: pdfium.PdfPage, index: int) -> PageResult:
        scale = RENDER_DPI / 72.0
        bitmap = page.render(scale=scale)
        try:
            rgb = bitmap.to_numpy()
        finally:
            bitmap.close()

        if rgb.ndim == 2:
            bgr = cv2.cvtColor(rgb, cv2.COLOR_GRAY2BGR)
        elif rgb.shape[2] == 4:
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGBA2BGR)
        else:
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        del rgb

        deskewed, skew = self.deskew_image(bgr)
        del bgr
        gray = self.enhance_grayscale(deskewed)
        del deskewed

        words, mean_conf = self._ocr_numpy(gray)
        used_binarization = False
        page_flags: list[str] = []

        if mean_conf < LOW_CONFIDENCE:
            binary = self.sauvola(gray)
            retry_words, retry_conf = self._ocr_numpy(cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR))
            if retry_conf > mean_conf:
                words, mean_conf = retry_words, retry_conf
                used_binarization = True
                page_flags.append("sauvola_retry")

        height, width = gray.shape[:2]
        del gray
        relative = self._to_relative(words, width, height)

        logger.info(
            "page_ocr index=%s skew=%.2f words=%s conf=%.1f binarized=%s",
            index,
            skew,
            len(relative),
            mean_conf,
            used_binarization,
        )

        return PageResult(
            index=index,
            width_px=width,
            height_px=height,
            is_native_text=False,
            words=relative,
            mean_confidence=round(mean_conf, 2),
            skew_degrees=round(skew, 2),
            used_binarization=used_binarization,
            flags=page_flags,
        )

    def _native_page(self, page: pdfium.PdfPage, index: int, plain_text: str) -> PageResult:
        width_pt = float(page.get_width())
        height_pt = float(page.get_height())
        words = self._native_words(page, width_pt, height_pt)
        return PageResult(
            index=index,
            width_px=int(width_pt),
            height_px=int(height_pt),
            is_native_text=True,
            words=words,
            plain_text=plain_text,
            mean_confidence=100.0,
        )

    @staticmethod
    def _native_words(page: pdfium.PdfPage, width: float, height: float) -> list[OcrWord]:
        """Box every native text run (top-left, 0–1). PDF coords are bottom-left."""
        if width <= 0 or height <= 0:
            return []
        textpage = page.get_textpage()
        words: list[OcrWord] = []
        try:
            rect_count = textpage.count_rects() if hasattr(textpage, "count_rects") else 0
            for i in range(rect_count):
                left, bottom, right, top = textpage.get_rect(i)
                snippet = textpage.get_text_bounded(left=left, bottom=bottom, right=right, top=top).strip()
                if not snippet:
                    continue
                words.append(
                    OcrWord(
                        text=snippet,
                        x=max(0.0, min(1.0, left / width)),
                        y=max(0.0, min(1.0, (height - top) / height)),
                        w=max(0.0, min(1.0, (right - left) / width)),
                        h=max(0.0, min(1.0, (top - bottom) / height)),
                        confidence=100.0,
                    )
                )
            if words:
                return words

            char_count = textpage.count_chars() if hasattr(textpage, "count_chars") else 0
            cluster: list[tuple[str, tuple[float, float, float, float]]] = []

            def flush() -> None:
                if not cluster:
                    return
                text = "".join(item[0] for item in cluster).strip()
                if not text:
                    cluster.clear()
                    return
                left = min(item[1][0] for item in cluster)
                bottom = min(item[1][1] for item in cluster)
                right = max(item[1][2] for item in cluster)
                top = max(item[1][3] for item in cluster)
                words.append(
                    OcrWord(
                        text=text,
                        x=max(0.0, min(1.0, left / width)),
                        y=max(0.0, min(1.0, (height - top) / height)),
                        w=max(0.0, min(1.0, (right - left) / width)),
                        h=max(0.0, min(1.0, (top - bottom) / height)),
                        confidence=100.0,
                    )
                )
                cluster.clear()

            for i in range(char_count):
                ch = textpage.get_text_range(i, i + 1)
                box = textpage.get_charbox(i)
                if ch.isspace() or ch in "\n\r\t":
                    flush()
                    continue
                cluster.append((ch, box))
            flush()
        finally:
            if hasattr(textpage, "close"):
                textpage.close()
        return words

    def deskew_image(self, image: np.ndarray) -> tuple[np.ndarray, float]:
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            blur = cv2.GaussianBlur(gray, (9, 9), 0)
            thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (30, 5))
            closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
            contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            angles: list[float] = []
            for contour in contours:
                if cv2.contourArea(contour) < 150:
                    continue
                angles.append(self._normalize_min_area_angle(cv2.minAreaRect(contour)))
                
            if not angles:
                return image, 0.0
                
            median_angle = float(np.median(angles))
            if abs(median_angle) > DESKEW_MAX_DEGREES or abs(median_angle) < 0.1:
                return image, 0.0
                
            height, width = image.shape[:2]
            matrix = cv2.getRotationMatrix2D((width // 2, height // 2), median_angle, 1.0)
            rotated = cv2.warpAffine(
                image,
                matrix,
                (width, height),
                flags=cv2.INTER_CUBIC, 
                borderMode=cv2.BORDER_REPLICATE,
            )
            return rotated, median_angle
        except Exception:
            logger.exception("deskew_failed")
            return image, 0.0

    def enhance_grayscale(self, image: np.ndarray) -> np.ndarray:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        equalized = clahe.apply(gray)
        return cv2.bilateralFilter(equalized, 9, 75, 75)

    def sauvola(
        self,
        gray: np.ndarray,
        window: int = 25,
        k: float = 0.2,
        r: float = 128.0,
    ) -> np.ndarray:
        if window % 2 == 0:
            window += 1
        gray_f = gray.astype(np.float32)
        mean = cv2.boxFilter(gray_f, ddepth=-1, ksize=(window, window), normalize=True)
        mean_sq = cv2.boxFilter(gray_f * gray_f, ddepth=-1, ksize=(window, window), normalize=True)
        std = np.sqrt(np.maximum(mean_sq - mean * mean, 0.0))
        thresh = mean * (1.0 + k * ((std / r) - 1.0))
        return np.where(gray_f > thresh, 255, 0).astype(np.uint8)

    def _ocr_numpy(self, image: np.ndarray) -> tuple[list[dict[str, Any]], float]:
        if image.ndim == 2:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        else:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        output = self._engine()(image)
        raw = output[0] if isinstance(output, tuple) else output
        rows = self._normalize_ocr_rows(raw)
        if not rows:
            return [], 0.0
        mean_conf = float(np.mean([row["confidence"] for row in rows]))
        return rows, mean_conf

    @staticmethod
    def _normalize_ocr_rows(raw: Any) -> list[dict[str, Any]]:
        if raw is None:
            return []
        if hasattr(raw, "result"):
            raw = raw.result
        rows: list[dict[str, Any]] = []
        for item in raw or []:
            if item is None:
                continue
            if isinstance(item, dict):
                box = item.get("box") or item.get("dt_boxes")
                text = item.get("text") or item.get("rec_txt") or ""
                score = float(item.get("score") or item.get("confidence") or 0.0)
            else:
                box, text, score = item[0], item[1], float(item[2])
            if not str(text).strip():
                continue
            rows.append({"box": box, "text": str(text).strip(), "confidence": score * (100.0 if score <= 1.0 else 1.0)})
        return rows

    @staticmethod
    def _to_relative(rows: list[dict[str, Any]], width: int, height: int) -> list[OcrWord]:
        if width <= 0 or height <= 0:
            return []
        words: list[OcrWord] = []
        for row in rows:
            box = np.array(row["box"], dtype=np.float32)
            xs = box[:, 0]
            ys = box[:, 1]
            x0, x1 = float(xs.min()), float(xs.max())
            y0, y1 = float(ys.min()), float(ys.max())
            words.append(
                OcrWord(
                    text=row["text"],
                    x=max(0.0, min(1.0, x0 / width)),
                    y=max(0.0, min(1.0, y0 / height)),
                    w=max(0.0, min(1.0, (x1 - x0) / width)),
                    h=max(0.0, min(1.0, (y1 - y0) / height)),
                    confidence=round(float(row["confidence"]), 2),
                )
            )
        return words

    @staticmethod
    def _normalize_min_area_angle(rect: tuple) -> float:
        (_center, (rect_w, rect_h), angle) = rect
        angle = float(angle)
        if rect_w < rect_h:
            angle -= 90.0
        while angle <= -45.0:
            angle += 90.0
        while angle > 45.0:
            angle -= 90.0
        return angle

    @staticmethod
    def _native_texts(pdf_bytes: bytes) -> list[str]:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return [(page.extract_text() or "") for page in reader.pages]

    @staticmethod
    def _coerce_bytes(pdf_input: bytes | str) -> bytes:
        if isinstance(pdf_input, (bytes, bytearray, memoryview)):
            return bytes(pdf_input)
        raise TypeError("PDF input must be bytes; path-based conversion is disabled")
