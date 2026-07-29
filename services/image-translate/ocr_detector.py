"""OCR-based residual Chinese text detection and replacement."""
from __future__ import annotations

import logging
import math
import re
from collections import Counter
from dataclasses import dataclass

import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from rapidocr_onnxruntime import RapidOCR

from brand_removal import BrandPolicy, normalize_brand_text
from translator import MalayTranslator, polish_malaysia_ecommerce
from config import FONT_BOLD, FONT_REG

LOGGER = logging.getLogger("image_translate.ocr")

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
TRANSLATION_BOX_SCALE = 1.18
TRANSLATION_FONT_MAX_SIZE = 72


@dataclass(frozen=True)
class ChineseHit:
    text: str
    confidence: float
    box: tuple[int, int, int, int]
    polygon: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class ResidualResult:
    image: Image.Image
    detected: tuple[ChineseHit, ...]
    repaired: tuple[ChineseHit, ...]
    remaining: tuple[ChineseHit, ...]


def contains_chinese(text: str) -> bool:
    return bool(CJK_RE.search(text))


def normalize_text(text: str) -> str:
    return re.sub(r"[\s,，、。.!！?？:：;；·()（）\[\]【】_-]", "", text)


# Common phrase translations for product images
PHRASE_TRANSLATIONS = {
    "产品信息": "MAKLUMAT PRODUK",
    "承重力强": "DAYA TAHAN BEBAN KUAT",
    "承重性强": "KUAT MENAMPUNG BEBAN",
    "滴水不漏": "TIDAK BOCOR",
    "抽绳式垃圾袋": "BEG SAMPAH BERTALI SERUT",
    "垃圾袋": "BEG SAMPAH",
    "简易开口设计": "BUKAAN MUDAH",
    "您的居家好伙伴": "RAKAN RUMAH ANDA",
    "生活不将就": "HIDUP BERKUALITI",
    "满足日常所需": "MEMENUHI KEPERLUAN HARIAN",
    "一提一拉": "TARIK DAN IKAT",
    "轻松收纳": "MUDAH DIKEMAS",
    "洁净": "BERSIH",
    "便捷": "MUDAH",
    "新料": "BAHAN BARU",
    "厚实": "TEBAL",
    "不滴漏": "TIDAK BOCOR",
    "防漏水": "TIDAK BOCOR",
    "自动收口": "TUTUP AUTOMATIK",
    "新料厚实": "BAHAN BARU TEBAL",
    "5卷75只": "5 GULUNG 75 KEPING",
    "（5卷75只）": "5 GULUNG 75 KEPING",
    "1卷20只": "1 GULUNG 20 KEPING",
    "艾草香": "HARUMAN MUGWORT",
    "加厚免撕款": "TEBAL, TANPA KOYAK",
    "升级版": "VERSI DIPERTINGKAT",
    "断点易撕开": "MUDAH DIKOYAK",
    "抗穿刺": "TAHAN CUCUK",
    "承重强": "",
    "花香防异味": "",
    "洁又佳": "",
    "好品质就选洁又佳": "KUALITI BAIK",
    "严选用料韧性强": "BAHAN TERPILIH TAHAN LASAK",
    "全新料无异味不易破漏": "BAHAN BARU TIADA BAU, TIDAK MUDAH BOCOR",
    "密封胶泥": "PENGEDAP",
    "防水防漏": "KALIS AIR & TIDAK MUDAH BOCOR",
    "强力吸盘": "CAWAN SEDUT KUAT",
    "可拆卸移位": "BOLEH DITANGGAL & DIALIHKAN",
    "快速上墙无需久等": "TERUS LEKAT PADA DINDING, TAK PERLU MENUNGGU",
    "向右旋转拧紧吸附": "PUTAR KE KANAN UNTUK KUNCI SEDUTAN",
    "向左旋转解锁移动": "PUTAR KE KIRI UNTUK BUKA & ALIHKAN",
    "快速起泡": "CEPAT BERBUIH",
    "决速起泡": "CEPAT BERBUIH",
    "墙壁": "DINDING",
    "裂纹": "RETAK",
    "空调": "PENYAMAN UDARA",
    "孔洞": "LUBANG",
    "干燥": "KERING",
    "清洁": "BERSIH",
    "可塑性强随意塑形": "MUDAH DIBENTUK",
    "与众不同": "REKA BENTUK UNIK",
    "蛋黄鸭家族化设计": "REKA BENTUK ITIK KUNING COMEL",
    "秀出好身材": "TONJOLKAN FIGURA MENAWAN",
    "拉长身材比例": "PANJANGKAN PROPORSI BADAN",
    "修身显瘦": "LANGSING & ANGGUN",
    "高腰收腹": "PINGGANG TINGGI RATAKAN PERUT",
    "提臀塑形": "ANGKAT PUNGGUNG BENTUK BADAN",
    "弹力面料": "FABRIK ANJAL",
    "透气网纱": "JARING BERNAFAS",
    "舒适贴合": "SELESA & MELEKAT",
}

NORMALIZED_TRANSLATIONS = {
    normalize_text(source): translation
    for source, translation in PHRASE_TRANSLATIONS.items()
}


def _analyze_vertical_layout(box: tuple[int, int, int, int], text: str) -> dict | None:
    """Analyze if text is vertical layout. Returns layout info or None.
    
    Returns dict with:
      - columns: number of vertical columns
      - chars_per_col: chars in each column
      - char_size: estimated pixel size of each character
      - is_vertical: True
    """
    x1, y1, x2, y2 = box
    w = x2 - x1
    h = y2 - y1
    if w <= 0 or h <= 0:
        return None

    cjk_chars = CJK_RE.findall(text)
    cjk_count = len(cjk_chars)
    if cjk_count < 2:
        return None

    # Estimate character size: in vertical Chinese text, each char is roughly square
    # If text is vertical with N columns of M chars each:
    #   char_size ≈ h / M  and  w ≈ N * char_size
    # So: M = h / char_size, N = w / char_size
    # And: cjk_count = N * M = (w * h) / char_size^2
    # Therefore: char_size = sqrt(w * h / cjk_count)
    char_size = math.sqrt(w * h / cjk_count)

    # Number of columns = w / char_size (rounded)
    num_cols = max(1, round(w / char_size))
    chars_per_col = max(1, round(h / char_size))

    # Validate: char_size should be reasonable (at least 15px)
    if char_size < 15:
        return None

    # Check if this looks like vertical layout:
    # - Multiple chars stacked (chars_per_col >= 2), OR
    # - Box is taller than wide (single column vertical)
    is_vertical = False
    if chars_per_col >= 2 and char_size >= 20:
        is_vertical = True
    elif h > w * 1.3 and cjk_count >= 2:
        is_vertical = True
        num_cols = 1
        chars_per_col = cjk_count

    if not is_vertical:
        return None

    return {
        "columns": num_cols,
        "chars_per_col": chars_per_col,
        "char_size": char_size,
        "is_vertical": True,
    }


def draw_text_box(
    im: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    *,
    fill: tuple[int, int, int] = (25, 25, 25),
    bg: tuple[int, int, int] | None = None,
    max_size: int = 40,
    min_size: int = 8,
    radius: int = 0,
    align: str = "center",
    pad: int = 4,
    stroke_width: int = 0,
    stroke_fill: tuple[int, int, int] | None = None,
) -> None:
    """Draw text within a bounding box, auto-fitting font size (horizontal)."""
    if not text:
        if bg is not None:
            draw = ImageDraw.Draw(im)
            if radius > 0:
                draw.rounded_rectangle(box, radius=radius, fill=bg)
            else:
                draw.rectangle(box, fill=bg)
        return

    x1, y1, x2, y2 = box
    box_w = max(1, x2 - x1 - pad * 2)
    box_h = max(1, y2 - y1 - pad * 2)
    draw = ImageDraw.Draw(im)

    if bg is not None:
        if radius > 0:
            draw.rounded_rectangle(box, radius=radius, fill=bg)
        else:
            draw.rectangle(box, fill=bg)

    # Binary search for font size
    lo, hi = min_size, max_size
    best_size = min_size
    while lo <= hi:
        mid = (lo + hi) // 2
        try:
            fnt = ImageFont.truetype(str(FONT_BOLD), size=mid)
        except OSError:
            fnt = ImageFont.load_default()
        bbox = draw.multiline_textbbox((0, 0), text, font=fnt, spacing=4, align=align)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if tw <= box_w and th <= box_h:
            best_size = mid
            lo = mid + 1
        else:
            hi = mid - 1

    try:
        fnt = ImageFont.truetype(str(FONT_BOLD), size=best_size)
    except OSError:
        fnt = ImageFont.load_default()

    bbox = draw.multiline_textbbox((0, 0), text, font=fnt, spacing=4, align=align)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    if align == "center":
        tx = x1 + pad + (box_w - tw) // 2
    elif align == "left":
        tx = x1 + pad
    else:
        tx = x2 - pad - tw
    ty = y1 + pad + (box_h - th) // 2

    kwargs: dict = {"font": fnt, "fill": fill, "spacing": 4, "align": align}
    if stroke_width > 0 and stroke_fill:
        kwargs["stroke_width"] = stroke_width
        kwargs["stroke_fill"] = stroke_fill
    draw.multiline_text((tx, ty), text, **kwargs)


def _draw_vertical_columns(
    im: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    layout: dict,
    *,
    fill: tuple[int, int, int],
    stroke_width: int = 0,
    stroke_fill: tuple[int, int, int] | None = None,
) -> None:
    """Render translated text in vertical columns matching original Chinese layout.
    
    Strategy: Split translation words into N columns (matching original column count).
    Each column renders words stacked vertically (one word per line).
    Font size is derived from original character size.
    """
    x1, y1, x2, y2 = box
    box_w = x2 - x1
    box_h = y2 - y1
    num_cols = layout["columns"]
    char_size = layout["char_size"]

    draw = ImageDraw.Draw(im)
    words = text.split()
    if not words:
        return

    # Font size: use original char_size as basis, slightly smaller for Latin text
    # Latin chars are wider than CJK, so use ~70% of char_size
    font_size = max(12, min(TRANSLATION_FONT_MAX_SIZE, int(char_size * 0.70)))
    try:
        fnt = ImageFont.truetype(str(FONT_BOLD), size=font_size)
    except OSError:
        fnt = ImageFont.load_default()

    # Distribute words across columns as evenly as possible
    cols_words: list[list[str]] = [[] for _ in range(num_cols)]
    for i, word in enumerate(words):
        cols_words[i % num_cols].append(word)

    # Column width
    col_w = box_w / num_cols

    # Render each column
    kwargs: dict = {"font": fnt, "fill": fill}
    if stroke_width > 0 and stroke_fill:
        kwargs["stroke_width"] = stroke_width
        kwargs["stroke_fill"] = stroke_fill

    for col_idx, col_words in enumerate(cols_words):
        if not col_words:
            continue
        # Column horizontal center
        col_cx = x1 + int(col_w * col_idx + col_w / 2)

        # Calculate total height of this column's words
        line_heights = []
        line_widths = []
        for word in col_words:
            wbbox = draw.textbbox((0, 0), word, font=fnt)
            line_widths.append(wbbox[2] - wbbox[0])
            line_heights.append(wbbox[3] - wbbox[1])

        spacing = max(4, int(font_size * 0.3))
        total_h = sum(line_heights) + spacing * (len(col_words) - 1)

        # Start Y: vertically centered in box
        cy = y1 + (box_h - total_h) // 2

        for i, word in enumerate(col_words):
            ww = line_widths[i]
            # Horizontally center word within column
            wx = col_cx - ww // 2
            # Clamp to box bounds
            wx = max(x1 + 2, min(wx, x2 - ww - 2))
            draw.text((wx, cy), word, **kwargs)
            cy += line_heights[i] + spacing


class ResidualChineseDetector:
    def __init__(self) -> None:
        self._ocr = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
        self._brand_policy = BrandPolicy()

    def scan(self, image: Image.Image, *, minimum_confidence: float = 0.50) -> tuple[ChineseHit, ...]:
        rgb = image.convert("RGB")
        scale = min(1.0, 1600 / max(rgb.size))
        scan_image = rgb
        if scale < 1.0:
            scan_image = rgb.resize(
                (max(1, round(rgb.width * scale)), max(1, round(rgb.height * scale))),
                Image.Resampling.LANCZOS,
            )
        try:
            result, _ = self._ocr(np.asarray(scan_image))
        except Exception as exc:
            LOGGER.warning("OCR scan failed: %s", exc)
            return ()
        if not result:
            return ()

        hits: list[ChineseHit] = []
        inv_scale = 1.0 / scale if scale < 1.0 else 1.0
        for item in result:
            polygon_raw, text, confidence = item
            if confidence < minimum_confidence:
                continue
            if not contains_chinese(text):
                continue
            polygon = tuple(
                (round(p[0] * inv_scale), round(p[1] * inv_scale))
                for p in polygon_raw
            )
            xs = [p[0] for p in polygon]
            ys = [p[1] for p in polygon]
            box = (min(xs), min(ys), max(xs), max(ys))
            hits.append(ChineseHit(text=text, confidence=confidence, box=box, polygon=polygon))
        return tuple(hits)

    def repair_and_verify(
        self, image: Image.Image, *, allow_repair: bool,
        translator: MalayTranslator | None = None,
    ) -> ResidualResult:
        detected = self.scan(image)
        repaired: list[ChineseHit] = []
        edited = image.copy().convert("RGB")
        current_hits = detected

        if allow_repair:
            for _pass in range(2):
                replacements = self._batch_translate_hits(current_hits, translator)
                if not replacements:
                    break
                for hit, _ in replacements:
                    repaired.append(hit)
                self._apply_replacements(edited, replacements)
                current_hits = self.scan(edited)

        return ResidualResult(
            image=edited, detected=tuple(detected),
            repaired=tuple(repaired), remaining=current_hits,
        )

    def _batch_translate_hits(
        self, hits: tuple[ChineseHit, ...], translator: MalayTranslator | None,
    ) -> list[tuple[ChineseHit, str]]:
        """Translate hits using batch API for efficiency."""
        replacements: list[tuple[ChineseHit, str]] = []
        needs_api: list[tuple[ChineseHit, str]] = []

        for hit in hits:
            normalized = normalize_text(hit.text)
            direct = NORMALIZED_TRANSLATIONS.get(normalized)
            if direct is not None and hit.confidence >= 0.50:
                replacements.append((hit, polish_malaysia_ecommerce(direct, source_text=hit.text)))
                continue
            if hit.confidence < 0.60:
                continue
            source_without_brand = self._brand_policy.remove_known_terms(hit.text)
            if source_without_brand != hit.text:
                if not source_without_brand:
                    replacements.append((hit, ""))
                    continue
                normalized2 = normalize_text(source_without_brand)
                direct2 = NORMALIZED_TRANSLATIONS.get(normalized2)
                if direct2 is not None:
                    replacements.append((hit, polish_malaysia_ecommerce(direct2, source_text=source_without_brand)))
                    continue
            needs_api.append((hit, hit.text))

        if needs_api and translator is not None:
            texts = [src for _, src in needs_api]
            batch_results = translator.translate_batch(texts)
            for hit, src in needs_api:
                translation = batch_results.get(src)
                if translation:
                    replacements.append((hit, translation))
                else:
                    result = translator.translate(hit.text)
                    if result:
                        replacements.append((hit, result))

        return replacements

    def remove_brands_and_verify(self, image: Image.Image) -> ResidualResult:
        detected_all = self.scan(image)
        brand_hits = [
            hit for hit in detected_all
            if self._brand_policy.is_brand_text(
                hit.text, confidence=hit.confidence,
                box=hit.box, image_size=image.size,
            )
        ]
        if not brand_hits:
            return ResidualResult(image=image, detected=(), repaired=(), remaining=())

        edited = image.copy().convert("RGB")
        self._inpaint_hits(edited, brand_hits)
        remaining = self.scan(edited)
        return ResidualResult(
            image=edited, detected=tuple(brand_hits),
            repaired=tuple(brand_hits), remaining=remaining,
        )

    def _translation_for(self, hit: ChineseHit, translator: MalayTranslator | None) -> str | None:
        normalized = normalize_text(hit.text)
        direct = NORMALIZED_TRANSLATIONS.get(normalized)
        if direct is not None and hit.confidence >= 0.50:
            return polish_malaysia_ecommerce(direct, source_text=hit.text)
        if hit.confidence < 0.60:
            return None
        source_without_brand = self._brand_policy.remove_known_terms(hit.text)
        if source_without_brand != hit.text:
            if not source_without_brand:
                return ""
            normalized = normalize_text(source_without_brand)
            direct = NORMALIZED_TRANSLATIONS.get(normalized)
            if direct is not None:
                return polish_malaysia_ecommerce(direct, source_text=source_without_brand)
        if translator is None:
            return None
        result = translator.translate(hit.text)
        return result

    def _apply_replacements(self, image: Image.Image, replacements: list[tuple[ChineseHit, str]]) -> None:
        # Sample text colors BEFORE inpainting
        text_colors = {}
        for hit, translation in replacements:
            if translation:
                text_colors[hit.box] = self._sample_text_color(image, hit.box)

        self._inpaint_hits(image, [hit for hit, _ in replacements])

        for hit, translation in replacements:
            if not translation:
                continue

            box_w = hit.box[2] - hit.box[0]
            box_h = hit.box[3] - hit.box[1]

            bg = self._sample_background(image, hit.box)
            bg_lum = self._luminance(bg)

            # Determine foreground color
            orig_color = text_colors.get(hit.box)
            if orig_color and abs(self._luminance(orig_color) - bg_lum) > 60:
                fg = orig_color
            elif bg_lum >= 145:
                fg = (30, 30, 30)
            else:
                fg = (255, 255, 255)

            # Stroke only if contrast is very poor
            contrast = abs(self._luminance(fg) - bg_lum)
            if contrast < 50:
                stroke_fill = (255, 255, 255) if bg_lum >= 145 else (0, 0, 0)
                stroke_w = 1
            else:
                stroke_w = 0
                stroke_fill = None

            # Check vertical layout
            vlayout = _analyze_vertical_layout(hit.box, hit.text)

            if vlayout:
                # Vertical text: render in columns matching original layout
                _draw_vertical_columns(
                    image, hit.box, translation, vlayout,
                    fill=fg, stroke_width=stroke_w, stroke_fill=stroke_fill,
                )
            else:
                # Horizontal text: standard rendering
                max_size = max(10, min(TRANSLATION_FONT_MAX_SIZE, int(box_h * 0.82)))
                expanded_box = self._expand_box(hit.box, image.size)
                draw_text_box(
                    image, expanded_box, translation, fill=fg, max_size=max_size,
                    min_size=8, pad=4, stroke_width=stroke_w, stroke_fill=stroke_fill,
                )

    @staticmethod
    def _sample_text_color(image: Image.Image, box: tuple[int, int, int, int]) -> tuple[int, int, int] | None:
        """Sample the dominant text color from within the bounding box."""
        x1, y1, x2, y2 = box
        w, h = image.size
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        if x2 <= x1 or y2 <= y1:
            return None
        region = np.asarray(image.crop((x1, y1, x2, y2)).convert("RGB"))
        if region.size == 0:
            return None
        flat = region.reshape(-1, 3)
        luminances = 0.299 * flat[:, 0] + 0.587 * flat[:, 1] + 0.114 * flat[:, 2]
        median_lum = float(np.median(luminances))
        if median_lum >= 128:
            mask = luminances < median_lum * 0.6
        else:
            mask = luminances > median_lum * 1.5
        text_pixels = flat[mask]
        if len(text_pixels) < 3:
            return None
        avg = text_pixels.mean(axis=0).astype(int)
        return (int(avg[0]), int(avg[1]), int(avg[2]))

    def _inpaint_hits(self, image: Image.Image, hits: list[ChineseHit]) -> None:
        pixels = np.asarray(image.convert("RGB")).copy()
        h, w = pixels.shape[:2]
        for hit in hits:
            x1, y1, x2, y2 = hit.box
            pad = max(3, min(10, round((y2 - y1) * 0.15)))
            left = max(0, x1 - pad)
            top = max(0, y1 - pad)
            right = min(w, x2 + pad)
            bottom = min(h, y2 + pad)
            if right <= left or bottom <= top:
                continue
            roi = pixels[top:bottom, left:right]
            mask = np.zeros(roi.shape[:2], dtype=np.uint8)
            pts = np.array(hit.polygon, dtype=np.int32)
            pts[:, 0] -= left
            pts[:, 1] -= top
            cv2.fillPoly(mask, [pts], 255)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            mask = cv2.dilate(mask, kernel, iterations=3)
            inpainted = cv2.inpaint(roi, mask, 5, cv2.INPAINT_NS)
            pixels[top:bottom, left:right] = inpainted
        image.paste(Image.fromarray(pixels, mode="RGB"))

    @staticmethod
    def _expand_box(box: tuple[int, int, int, int], image_size: tuple[int, int]) -> tuple[int, int, int, int]:
        x1, y1, x2, y2 = box
        w, h = x2 - x1, y2 - y1
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        new_w = min(image_size[0], round(w * TRANSLATION_BOX_SCALE))
        new_h = min(image_size[1], round(h * TRANSLATION_BOX_SCALE))
        left = max(0, cx - new_w // 2)
        top = max(0, cy - new_h // 2)
        right = min(image_size[0], left + new_w)
        bottom = min(image_size[1], top + new_h)
        return (left, top, right, bottom)

    @staticmethod
    def _sample_background(image: Image.Image, box: tuple[int, int, int, int]) -> tuple[int, int, int]:
        x1, y1, x2, y2 = box
        w, h = image.size
        pixels = []
        left = max(0, x1 - 5)
        right = min(w - 1, x2 + 5)
        top = max(0, y1 - 5)
        bottom = min(h - 1, y2 + 5)
        for x in range(left, right + 1):
            if top >= 0:
                pixels.append(image.getpixel((x, top))[:3])
            if bottom < h:
                pixels.append(image.getpixel((x, bottom))[:3])
        for y in range(top, bottom + 1):
            if left >= 0:
                pixels.append(image.getpixel((left, y))[:3])
            if right < w:
                pixels.append(image.getpixel((right, y))[:3])
        if not pixels:
            return (255, 255, 255)
        buckets = Counter((r // 16, g // 16, b // 16) for r, g, b in pixels)
        bucket = buckets.most_common(1)[0][0]
        selected = [(r, g, b) for r, g, b in pixels if (r // 16, g // 16, b // 16) == bucket]
        return tuple(sum(c) // len(selected) for c in zip(*selected))

    @staticmethod
    def _luminance(color: tuple[int, int, int]) -> float:
        r, g, b = color
        return 0.299 * r + 0.587 * g + 0.114 * b
