"""In-memory PDF OCR (v3).

Bytes in, structured words/boxes out. No sandwich PDF, no Poppler, no Tesseract
temp files. Page bitmaps are released after each page.
"""

from __future__ import annotations

import io
import logging
import re
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
DESKEW_DEADZONE_DEGREES = 0.8

_IRS_CHROME = re.compile(
    r"Department of the Treasury|Internal Revenue Service|"
    r"U\.S\.\s+(?:Individual Income Tax Return|Income Tax Return for an S Corporation|"
    r"Return of Partnership Income|Corporation Income Tax Return)|"
    r"Form\s+1040|Form\s+W-2|Form\s+1120|Form\s+1065|Form\s+4562|Form\s+8825|"
    r"Schedule\s+[B-F]\s*\(Form|Schedule\s+K-1|Wage and Tax Statement|"
    r"Supplemental Income and Loss|Profit or Loss From (?:Business|Farming)",
    re.IGNORECASE,
)
_CONTENT_AMOUNT = re.compile(
    r"\$\s*\d|"
    r"\d{1,3}(?:,\d{3})+(?:\.\d{2})?|"
    r"\(\s*\d{1,3}(?:,\d{3})+|"
    r"\d+\.\d{2}"
)


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
class PageInspect:
    text: str
    rotation: int
    fields: list[OcrWord]
    use_ocr: bool
    flags: list[str] = field(default_factory=list)
    index: int = 0


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
        word_text = " ".join(word.text for word in self.words if word.text)
        # OCR pages can retain a native value overlay. Keep that evidence, but
        # include the OCR labels so form classification sees the rendered form.
        if not self.is_native_text and word_text:
            return " ".join(part for part in (self.plain_text.strip(), word_text) if part)
        return self.plain_text.strip() or word_text

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


def _pdf_str(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "get_object"):
        try:
            value = value.get_object()
        except Exception:
            pass
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace").strip()
    text = str(value).strip()
    if text.startswith("/") and " " not in text:
        text = text[1:]
    if text.lower() in {"none", "null", "off", ""}:
        return ""
    return text


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


class AIPDFConverter:
    """Native text + AcroForm, with RapidOCR fallback. Returns relative [0,1] boxes."""

    def __init__(self) -> None:
        self._ocr = None

    def _engine(self):
        if self._ocr is None:
            self._ocr = _load_ocr_engine()
        return self._ocr

    def warmup(self) -> None:
        """Load ONNX weights so the first /parse is not a cold start."""
        try:
            self._engine()
        except Exception:
            logger.warning("ocr_warmup_skipped")

    def searchable_mask(self, pdf_bytes: bytes) -> list[bool]:
        """True when the page can be read without OCR (native and/or AcroForm)."""
        return [not page.use_ocr for page in self._inspect_pages(pdf_bytes)]

    def is_searchable(self, pdf_input: bytes | str) -> bool:
        pdf_bytes = self._coerce_bytes(pdf_input)
        mask = self.searchable_mask(pdf_bytes)
        return bool(mask) and all(mask)

    def inspect_pages(self, pdf_bytes: bytes) -> list[PageInspect]:
        return self._inspect_pages(self._coerce_bytes(pdf_bytes))

    def inspect_as_convert_result(self, inspected: list[PageInspect]) -> ConvertResult:
        """Cheap ConvertResult for the splitter: native text + AcroForm, no render/OCR."""
        pages: list[PageResult] = []
        for info in inspected:
            field_text = " ".join(word.text for word in info.fields)
            pages.append(
                PageResult(
                    index=info.index,
                    width_px=612,
                    height_px=792,
                    is_native_text=not info.use_ocr,
                    words=list(info.fields),
                    plain_text=" ".join(part for part in (info.text, field_text) if part).strip(),
                    flags=list(info.flags),
                )
            )
        return ConvertResult(pages=pages, page_count=len(pages), ocr_page_count=0)

    def convert_to_ai_ready(
        self,
        pdf_input: bytes | str,
        *,
        inspected: list[PageInspect] | None = None,
        ocr_page_indices: set[int] | None = None,
    ) -> ConvertResult:
        pdf_bytes = self._coerce_bytes(pdf_input)
        if len(pdf_bytes) > MAX_PDF_BYTES:
            raise ValueError(f"PDF exceeds {MAX_PDF_BYTES} byte limit")

        inspected = inspected if inspected is not None else self._inspect_pages(pdf_bytes)
        page_count = len(inspected)
        if page_count > MAX_PAGES:
            raise ValueError(f"PDF exceeds {MAX_PAGES} page limit")

        pages: list[PageResult] = []
        ocr_count = 0
        flags: list[str] = []
        skipped_ocr = 0

        pdf = pdfium.PdfDocument(pdf_bytes)
        try:
            pdfium_count = len(pdf)
            if pdfium_count != page_count:
                logger.warning("page_count_mismatch pypdf=%s pdfium=%s", page_count, pdfium_count)
                flags.append("page_count_mismatch")
                page_count = min(page_count, pdfium_count)
                inspected = inspected[:page_count]
            for index in range(page_count):
                pdf_page = pdf[index]
                info = inspected[index]
                try:
                    gated = info.use_ocr and ocr_page_indices is not None and index not in ocr_page_indices
                    if info.use_ocr and not gated:
                        ocr_count += 1
                        pages.append(self._ocr_page(pdf_page, index, info))
                    else:
                        page = self._native_page(pdf_page, index, info)
                        if gated:
                            skipped_ocr += 1
                            page.flags = [*page.flags, "ocr_skipped_not_in_keep_set"]
                        pages.append(page)
                finally:
                    if hasattr(pdf_page, "close"):
                        pdf_page.close()
        finally:
            pdf.close()

        if ocr_count:
            flags.append("ocr_applied")
            logger.info("ocr_complete pages=%s ocr_pages=%s", page_count, ocr_count)
        if skipped_ocr:
            flags.append("ocr_gated_by_splitter")
            logger.info("ocr_gated skipped=%s ran=%s", skipped_ocr, ocr_count)
        if any(info.fields for info in inspected):
            flags.append("acroform_merged")

        return ConvertResult(
            pages=pages,
            page_count=page_count,
            ocr_page_count=ocr_count,
            flags=flags,
        )

    def _inspect_pages(self, pdf_bytes: bytes) -> list[PageInspect]:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        try:
            pages: list[PageInspect] = []
            for index, page in enumerate(reader.pages):
                try:
                    text = page.extract_text() or ""
                except Exception:
                    text = ""
                rotation = int(getattr(page, "rotation", 0) or 0) % 360
                fields = self._widget_words(page)
                filled = [word for word in fields if word.text.strip()]
                use_ocr, page_flags = self._page_strategy(text, filled)
                if filled:
                    page_flags.append("acroform_merged")
                pages.append(
                    PageInspect(
                        text=text,
                        rotation=rotation,
                        fields=filled,
                        use_ocr=use_ocr,
                        flags=page_flags,
                        index=index,
                    )
                )
            return pages
        finally:
            if hasattr(reader, "close"):
                reader.close()

    @staticmethod
    def _page_strategy(text: str, filled_fields: list[OcrWord]) -> tuple[bool, list[str]]:
        stripped = text.strip()
        has_amounts = bool(_CONTENT_AMOUNT.search(stripped))
        amount_count = len(_CONTENT_AMOUNT.findall(stripped))
        irs_chrome = bool(_IRS_CHROME.search(stripped))
        flags: list[str] = []
        if filled_fields:
            return False, flags
        if has_amounts:
            # Some scanned tax forms have only their filled values encoded as
            # native text. OCR them so the form labels and layout are available
            # to the classifier instead of treating the numeric overlay as a
            # complete searchable document.
            if not irs_chrome and len(stripped) >= 400 and amount_count >= 4:
                flags.append("numeric_form_overlay_ocr_bypass")
                return True, flags
            return False, flags
        if len(stripped) >= NATIVE_TEXT_CHARS and not irs_chrome:
            return False, flags
        if irs_chrome and len(stripped) >= NATIVE_TEXT_CHARS:
            flags.append("irs_searchable_mask_bypass")
        return True, flags

    def _widget_words(self, page: Any) -> list[OcrWord]:
        words: list[OcrWord] = []
        annots = None
        try:
            annots = page.annotations
        except Exception:
            annots = None
        if annots is None:
            try:
                annots = page.get("/Annots")
            except Exception:
                annots = None
        if not annots:
            return words
        visible = self._page_visible_box(page)
        rotation = int(getattr(page, "rotation", 0) or 0) % 360
        for annot in annots:
            try:
                data = annot.get_object() if hasattr(annot, "get_object") else annot
                subtype = str(data.get("/Subtype") or "")
                if subtype not in {"/Widget", "Widget", "/Tx", "/Btn", "/Ch"}:
                    if data.get("/FT") is None and data.get("/V") is None:
                        continue
                value = _pdf_str(data.get("/V"))
                if not value:
                    value = _pdf_str(data.get("/AS"))
                if not value:
                    continue
                rect = data.get("/Rect")
                if rect is None or len(rect) < 4:
                    continue
                x, y, w, h = self._rect_to_relative(rect, visible, rotation)
                if w <= 0 or h <= 0:
                    continue
                words.append(OcrWord(text=value, x=x, y=y, w=w, h=h, confidence=100.0))
            except Exception:
                continue
        return words

    @staticmethod
    def _page_visible_box(page: Any) -> tuple[float, float, float, float]:
        box = getattr(page, "cropbox", None) or page.mediabox
        return float(box.left), float(box.bottom), float(box.right), float(box.top)

    @staticmethod
    def _rect_to_relative(
        rect: Any,
        visible: tuple[float, float, float, float],
        rotation: int,
    ) -> tuple[float, float, float, float]:
        llx, lly, urx, ury = (float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3]))
        vx0, vy0, vx1, vy1 = visible
        src_w = vx1 - vx0
        src_h = vy1 - vy0
        if src_w <= 0 or src_h <= 0:
            return 0.0, 0.0, 0.0, 0.0
        left, bottom = llx - vx0, lly - vy0
        right, top = urx - vx0, ury - vy0
        rot = rotation % 360

        def rotate(x: float, y: float) -> tuple[float, float]:
            if rot == 90:
                return y, src_w - x
            if rot == 180:
                return src_w - x, src_h - y
            if rot == 270:
                return src_h - y, x
            return x, y

        xs, ys = zip(*(rotate(x, y) for x, y in ((left, bottom), (right, bottom), (left, top), (right, top))))
        disp_w, disp_h = (src_h, src_w) if rot in {90, 270} else (src_w, src_h)
        rleft, rright = min(xs), max(xs)
        rbottom, rtop = min(ys), max(ys)
        return (
            _clamp01(rleft / disp_w),
            _clamp01((disp_h - rtop) / disp_h),
            _clamp01((rright - rleft) / disp_w),
            _clamp01((rtop - rbottom) / disp_h),
        )

    def _ocr_page(self, page: pdfium.PdfPage, index: int, info: PageInspect) -> PageResult:
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

        page_flags = list(info.flags)
        photo = self._looks_like_photo(bgr)
        skew = 0.0
        if photo:
            deskewed, skew = self.deskew_image(bgr)
            del bgr
            gray = self.enhance_grayscale(deskewed)
            del deskewed
            page_flags.append("photo_enhance")
        else:
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            del bgr

        words, mean_conf = self._ocr_numpy(gray)
        used_binarization = False

        if photo and mean_conf < LOW_CONFIDENCE:
            binary = self.sauvola(gray)
            retry_words, retry_conf = self._ocr_numpy(binary)
            if retry_conf > mean_conf:
                words, mean_conf = retry_words, retry_conf
                used_binarization = True
                page_flags.append("sauvola_retry")

        height, width = gray.shape[:2]
        del gray
        if photo and abs(skew) >= DESKEW_DEADZONE_DEGREES:
            words = self._unrotate_ocr_rows(words, width, height, skew)
        relative = self._merge_words(self._to_relative(words, width, height), info.fields)
        width_pt = float(page.get_width())
        height_pt = float(page.get_height())

        logger.info(
            "page_ocr index=%s skew=%.2f words=%s conf=%.1f binarized=%s photo=%s",
            index,
            skew,
            len(relative),
            mean_conf,
            used_binarization,
            photo,
        )

        return PageResult(
            index=index,
            width_px=int(width_pt),
            height_px=int(height_pt),
            is_native_text=False,
            words=relative,
            plain_text=info.text,
            mean_confidence=round(mean_conf, 2),
            skew_degrees=round(skew, 2),
            used_binarization=used_binarization,
            flags=page_flags,
        )

    def _native_page(self, page: pdfium.PdfPage, index: int, info: PageInspect) -> PageResult:
        width_pt = float(page.get_width())
        height_pt = float(page.get_height())
        words = self._merge_words(self._native_words(page), info.fields)
        confidence = 100.0 if info.fields or _CONTENT_AMOUNT.search(info.text or "") else 90.0
        return PageResult(
            index=index,
            width_px=int(width_pt),
            height_px=int(height_pt),
            is_native_text=True,
            words=words,
            plain_text=info.text,
            mean_confidence=confidence,
            flags=list(info.flags),
        )

    @staticmethod
    def _merge_words(base: list[OcrWord], extra: list[OcrWord]) -> list[OcrWord]:
        if not extra:
            return base
        merged = list(base)
        for word in extra:
            duplicate = any(
                item.text == word.text
                and abs(item.x - word.x) < 0.02
                and abs(item.y - word.y) < 0.02
                for item in merged
            )
            if not duplicate:
                merged.append(word)
        return merged

    @staticmethod
    def _native_words(page: pdfium.PdfPage) -> list[OcrWord]:
        """Box every native text run (top-left, 0–1). PDF coords are bottom-left."""
        disp_w = float(page.get_width())
        disp_h = float(page.get_height())
        if disp_w <= 0 or disp_h <= 0:
            return []
        rotation = 0
        if hasattr(page, "get_rotation"):
            try:
                rotation = int(page.get_rotation() or 0) % 360
            except Exception:
                rotation = 0
        src_w, src_h = (disp_h, disp_w) if rotation in {90, 270} else (disp_w, disp_h)
        textpage = page.get_textpage()
        words: list[OcrWord] = []

        def append_rect(left: float, bottom: float, right: float, top: float, snippet: str) -> None:
            x, y, w, h = AIPDFConverter._unrotated_to_relative(
                left, bottom, right, top, src_w, src_h, disp_w, disp_h, rotation
            )
            if w <= 0 or h <= 0 or not snippet:
                return
            words.append(OcrWord(text=snippet, x=x, y=y, w=w, h=h, confidence=100.0))

        try:
            rect_count = textpage.count_rects() if hasattr(textpage, "count_rects") else 0
            for i in range(rect_count):
                left, bottom, right, top = textpage.get_rect(i)
                snippet = textpage.get_text_bounded(left=left, bottom=bottom, right=right, top=top).strip()
                append_rect(left, bottom, right, top, snippet)
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
                append_rect(left, bottom, right, top, text)
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

    @staticmethod
    def _unrotated_to_relative(
        left: float,
        bottom: float,
        right: float,
        top: float,
        src_w: float,
        src_h: float,
        disp_w: float,
        disp_h: float,
        rotation: int,
    ) -> tuple[float, float, float, float]:
        rot = rotation % 360

        def rotate(x: float, y: float) -> tuple[float, float]:
            if rot == 90:
                return y, src_w - x
            if rot == 180:
                return src_w - x, src_h - y
            if rot == 270:
                return src_h - y, x
            return x, y

        xs, ys = zip(*(rotate(x, y) for x, y in ((left, bottom), (right, bottom), (left, top), (right, top))))
        rleft, rright = min(xs), max(xs)
        rbottom, rtop = min(ys), max(ys)
        if disp_w <= 0 or disp_h <= 0:
            return 0.0, 0.0, 0.0, 0.0
        return (
            _clamp01(rleft / disp_w),
            _clamp01((disp_h - rtop) / disp_h),
            _clamp01((rright - rleft) / disp_w),
            _clamp01((rtop - rbottom) / disp_h),
        )

    @staticmethod
    def _looks_like_photo(image: np.ndarray) -> bool:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        white_frac = float((gray > 245).mean())
        return white_frac < 0.62

    def deskew_image(self, image: np.ndarray) -> tuple[np.ndarray, float]:
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            blur = cv2.GaussianBlur(gray, (9, 9), 0)
            thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (30, 5))
            closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
            contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            page_area = float(image.shape[0] * image.shape[1])
            angles: list[float] = []
            for contour in contours:
                area = cv2.contourArea(contour)
                if area < 150 or area > page_area * 0.02:
                    continue
                _center, (rect_w, rect_h), _angle = cv2.minAreaRect(contour)
                short = max(min(rect_w, rect_h), 1.0)
                long = max(rect_w, rect_h)
                if long / short > 12.0:
                    continue
                angles.append(self._normalize_min_area_angle(cv2.minAreaRect(contour)))

            if not angles:
                return image, 0.0

            median_angle = float(np.median(angles))
            if abs(median_angle) > DESKEW_MAX_DEGREES or abs(median_angle) < DESKEW_DEADZONE_DEGREES:
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
        try:
            engine = self._engine()
        except Exception:
            logger.warning("ocr_engine_unavailable")
            return [], 0.0
        if image.ndim == 2:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        else:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        output = engine(image)
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
            if not str(text).strip() or box is None:
                continue
            rows.append({"box": box, "text": str(text).strip(), "confidence": score * (100.0 if score <= 1.0 else 1.0)})
        return rows

    @staticmethod
    def _unrotate_ocr_rows(
        rows: list[dict[str, Any]],
        width: int,
        height: int,
        angle: float,
    ) -> list[dict[str, Any]]:
        """Map deskewed OCR quads back to the unrotated page (pdf.js overlay space)."""
        if not rows or abs(angle) < DESKEW_DEADZONE_DEGREES:
            return rows
        matrix = cv2.getRotationMatrix2D((width / 2.0, height / 2.0), -float(angle), 1.0)
        restored: list[dict[str, Any]] = []
        for row in rows:
            box = np.array(row["box"], dtype=np.float32)
            if box.ndim != 2 or box.shape[1] < 2:
                restored.append(row)
                continue
            ones = np.ones((box.shape[0], 1), dtype=np.float32)
            mapped = (matrix @ np.hstack([box[:, :2], ones]).T).T
            restored.append({**row, "box": mapped})
        return restored

    @staticmethod
    def _to_relative(rows: list[dict[str, Any]], width: int, height: int) -> list[OcrWord]:
        if width <= 0 or height <= 0:
            return []
        words: list[OcrWord] = []
        for row in rows:
            box = np.array(row["box"], dtype=np.float32)
            if box.ndim != 2 or box.shape[1] < 2:
                continue
            xs = box[:, 0]
            ys = box[:, 1]
            x0, x1 = float(xs.min()), float(xs.max())
            y0, y1 = float(ys.min()), float(ys.max())
            words.append(
                OcrWord(
                    text=row["text"],
                    x=_clamp01(x0 / width),
                    y=_clamp01(y0 / height),
                    w=_clamp01((x1 - x0) / width),
                    h=_clamp01((y1 - y0) / height),
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
    def _coerce_bytes(pdf_input: bytes | str) -> bytes:
        if isinstance(pdf_input, (bytes, bytearray, memoryview)):
            return bytes(pdf_input)
        raise TypeError("PDF input must be bytes; path-based conversion is disabled")
