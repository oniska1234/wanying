"""OCR-based residual Chinese text detection and replacement.

Layout-aware rendering: extracts angle, size, color, weight from original text
polygon and pixel data, then replicates the exact same style for translations.
"""
from __future__ import annotations

import logging
import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Optional

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
TRANSLATION_FONT_MAX_SIZE = 80


@dataclass(frozen=True)
class ChineseHit:
    text: str
    confidence: float
    box: tuple[int, int, int, int]
    polygon: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class TextLayout:
    """Extracted layout properties from original text region."""
    angle: float          # rotation angle in degrees (0 = horizontal)
    font_size: int        # character height in pixels
    color: tuple[int, int, int]  # RGB text color
    is_bold: bool         # whether text appears bold
    box: tuple[int, int, int, int]  # bounding box
    line_count: int       # number of text lines detected


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


# Common phrase translations
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
    "拉长身材比例": "MEMANJANGKAN PERKADARAN TUBUH",
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


# ═══════════════════════════════════════════════════════════════════════
# LAYOUT EXTRACTION - Analyze original text to get all visual properties
# ═══════════════════════════════════════════════════════════════════════

def extract_layout(image: Image.Image, hit: ChineseHit) -> TextLayout:
    """Extract complete layout properties from original text region.

    Uses polygon geometry for angle/size, pixel analysis for color/weight.
    """
    polygon = hit.polygon
    box = hit.box

    # 1. ANGLE: computed from polygon top edge vector
    # polygon points are typically: top-left, top-right, bottom-right, bottom-left
    if len(polygon) >= 2:
        dx = polygon[1][0] - polygon[0][0]
        dy = polygon[1][1] - polygon[0][1]
        angle = math.degrees(math.atan2(dy, dx))
    else:
        angle = 0.0

    # Normalize angle: if text is vertical (angle ~90 or ~-90), keep it
    # If angle is close to 0 or 180, it's horizontal
    # For vertical Chinese text, the polygon top edge goes downward
    # so angle will be ~90 or ~-90

    # 2. FONT SIZE: from polygon height (perpendicular to text direction)
    # For horizontal text: height = polygon[3][1] - polygon[0][1]
    # For vertical text: width = polygon[1][0] - polygon[0][0]
    # General: use the shorter dimension of the polygon as char height
    if len(polygon) >= 4:
        # Width along text direction (top edge length)
        top_len = math.hypot(polygon[1][0] - polygon[0][0], polygon[1][1] - polygon[0][1])
        # Height perpendicular to text (left edge length)
        left_len = math.hypot(polygon[3][0] - polygon[0][0], polygon[3][1] - polygon[0][1])
    else:
        top_len = box[2] - box[0]
        left_len = box[3] - box[1]

    # Determine if vertical: if the text direction is more vertical than horizontal
    abs_angle = abs(angle) % 180
    is_vertical = abs_angle > 45  # text reads top-to-bottom

    if is_vertical:
        # For vertical text: each character's height ≈ top_len / num_chars
        # and character width ≈ left_len
        cjk_count = max(1, len(CJK_RE.findall(hit.text)))
        # Check if multiple columns: if left_len > 2 * char_width_estimate
        char_h_from_top = top_len / cjk_count if cjk_count > 0 else left_len
        # The font size for vertical text = the column width (left_len)
        # because that's how big each character is rendered
        font_size = int(left_len * 0.9)
    else:
        # Horizontal text: font_size ≈ line height
        font_size = int(left_len * 0.85)

    font_size = max(10, min(TRANSLATION_FONT_MAX_SIZE, font_size))

    # 3. COLOR: sample text pixels from the region
    color = _sample_text_color_from_image(image, box)
    if color is None:
        color = (30, 30, 30)  # default dark

    # 4. BOLDNESS: analyze stroke width in the text region
    is_bold = _detect_boldness(image, box)

    # 5. LINE COUNT: estimate from polygon and text
    if is_vertical:
        # For vertical text, check if multiple columns
        cjk_count = max(1, len(CJK_RE.findall(hit.text)))
        est_char_size = font_size
        num_cols = max(1, round(left_len / est_char_size)) if est_char_size > 0 else 1
        line_count = num_cols
    else:
        line_count = 1

    return TextLayout(
        angle=angle,
        font_size=font_size,
        color=color,
        is_bold=is_bold,
        box=box,
        line_count=line_count,
    )


def _sample_text_color_from_image(image: Image.Image, box: tuple[int, int, int, int]) -> Optional[tuple[int, int, int]]:
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


def _detect_boldness(image: Image.Image, box: tuple[int, int, int, int]) -> bool:
    """Detect if text is bold by analyzing stroke width ratio."""
    x1, y1, x2, y2 = box
    w, h = image.size
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 - x1 < 10 or y2 - y1 < 10:
        return False
    region = np.asarray(image.crop((x1, y1, x2, y2)).convert("L"))
    # Binarize
    _, binary = cv2.threshold(region, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # Distance transform to estimate stroke width
    dist = cv2.distanceTransform(binary, cv2.DIST_L2, 3)
    # Mean stroke radius of text pixels
    text_mask = binary > 0
    if text_mask.sum() < 10:
        return False
    mean_radius = float(dist[text_mask].mean())
    # Character height estimate
    char_h = y2 - y1
    # Bold if stroke radius > 12% of character height
    return mean_radius > char_h * 0.12


# ═══════════════════════════════════════════════════════════════════════
# LAYOUT-AWARE RENDERING - Render text matching extracted layout
# ═══════════════════════════════════════════════════════════════════════

def render_text_with_layout(
    image: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    layout: TextLayout,
) -> None:
    """Render translated text matching the original layout properties.

    Handles any angle (horizontal, vertical, diagonal) by:
    1. Rendering text horizontally on a transparent canvas
    2. Rotating to match original angle
    3. Compositing onto the image at the correct position
    """
    LOGGER.debug('render_text_with_layout: box=%s angle=%.1f font_size=%d color=%s bold=%s text=%s', box, layout.angle, layout.font_size, layout.color, layout.is_bold, text[:30])
    if not text:
        return

    x1, y1, x2, y2 = box
    box_w = x2 - x1
    box_h = y2 - y1

    angle = layout.angle
    font_size = layout.font_size
    color = layout.color
    is_bold = layout.is_bold

    # Choose font
    font_path = str(FONT_BOLD) if is_bold else str(FONT_REG)
    try:
        fnt = ImageFont.truetype(font_path, size=font_size)
    except OSError:
        try:
            fnt = ImageFont.truetype(str(FONT_BOLD), size=font_size)
        except OSError:
            fnt = ImageFont.load_default()

    # Determine if we need rotation
    abs_angle = abs(angle) % 180
    needs_rotation = abs_angle > 5 and abs(abs_angle - 180) > 5

    if not needs_rotation:
        # Horizontal text: render directly with auto-fit
        _render_horizontal(image, box, text, fnt, color, font_size)
    else:
        # Rotated text: render horizontal then rotate
        _render_rotated(image, box, text, fnt, color, angle, font_size)


def _render_horizontal(
    image: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    fnt: ImageFont.ImageFont,
    color: tuple[int, int, int],
    initial_size: int,
) -> None:
    """Render horizontal text with auto-fit font size."""
    x1, y1, x2, y2 = box
    box_w = x2 - x1
    box_h = y2 - y1
    draw = ImageDraw.Draw(image)

    # Auto-fit: reduce font size until text fits
    size = initial_size
    while size > 8:
        try:
            fnt = ImageFont.truetype(str(FONT_BOLD), size=size)
        except OSError:
            break
        bbox = draw.multiline_textbbox((0, 0), text, font=fnt, spacing=2)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if tw <= box_w - 4 and th <= box_h - 4:
            break
        size -= 2

    try:
        fnt = ImageFont.truetype(str(FONT_BOLD), size=size)
    except OSError:
        fnt = ImageFont.load_default()

    bbox = draw.multiline_textbbox((0, 0), text, font=fnt, spacing=2)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    # Center in box
    tx = x1 + (box_w - tw) // 2
    ty = y1 + (box_h - th) // 2

    draw.multiline_text((tx, ty), text, font=fnt, fill=color, spacing=2, align="center")


def _render_rotated(
    image: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    fnt: ImageFont.ImageFont,
    color: tuple[int, int, int],
    angle: float,
    initial_size: int,
) -> None:
    """Render text at an angle by drawing on transparent canvas and rotating.

    The text is first rendered horizontally, then rotated to match the
    original text angle, then composited onto the image centered in the box.
    """
    x1, y1, x2, y2 = box
    box_w = x2 - x1
    box_h = y2 - y1

    # For rotated text, the available space after rotation:
    # If angle ~90 (vertical): horizontal text width must fit in box_h,
    #                          horizontal text height must fit in box_w
    # General formula using rotation matrix bounds:
    rad = math.radians(abs(angle))
    cos_a = abs(math.cos(rad))
    sin_a = abs(math.sin(rad))
    # Available width for horizontal text = box_w * cos + box_h * sin (approx)
    # Available height for horizontal text = box_w * sin + box_h * cos (approx)
    # But simpler: for ~90 deg, swap w and h
    abs_angle = abs(angle) % 180
    if abs_angle > 45:
        # Mostly vertical: text length fits in box_h, text height fits in box_w
        avail_w = box_h
        avail_h = box_w
    else:
        avail_w = box_w
        avail_h = box_h

    # Auto-fit font size for the rotated case
    draw_temp = ImageDraw.Draw(image)
    size = initial_size
    while size > 8:
        try:
            fnt = ImageFont.truetype(str(FONT_BOLD), size=size)
        except OSError:
            break
        bbox = draw_temp.textbbox((0, 0), text, font=fnt)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        if tw <= avail_w - 4 and th <= avail_h - 4:
            break
        size -= 2

    try:
        fnt = ImageFont.truetype(str(FONT_BOLD), size=size)
    except OSError:
        fnt = ImageFont.load_default()

    # Render text on transparent canvas
    bbox = draw_temp.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    padding = 4
    txt_img = Image.new("RGBA", (tw + padding * 2, th + padding * 2), (0, 0, 0, 0))
    txt_draw = ImageDraw.Draw(txt_img)
    txt_draw.text(
        (padding - bbox[0], padding - bbox[1]),
        text, font=fnt, fill=color + (255,),
    )

    # Rotate: PIL rotates counter-clockwise, so negate the angle
    # For Chinese vertical text (angle ~90), we want the text to read top-to-bottom
    # which means rotating -90 (clockwise 90)
    rotated = txt_img.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC)

    # Paste centered in box
    rw, rh = rotated.size
    paste_x = x1 + (box_w - rw) // 2
    paste_y = y1 + (box_h - rh) // 2

    # Ensure we don't paste outside image
    img_w, img_h = image.size
    if paste_x < 0 or paste_y < 0 or paste_x + rw > img_w or paste_y + rh > img_h:
        # Clip
        crop_x = max(0, -paste_x)
        crop_y = max(0, -paste_y)
        crop_w = min(rw - crop_x, img_w - max(0, paste_x))
        crop_h = min(rh - crop_y, img_h - max(0, paste_y))
        rotated = rotated.crop((crop_x, crop_y, crop_x + crop_w, crop_y + crop_h))
        paste_x = max(0, paste_x)
        paste_y = max(0, paste_y)

    image.paste(rotated, (paste_x, paste_y), rotated)


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


# ═══════════════════════════════════════════════════════════════════════
# MAIN DETECTOR CLASS
# ═══════════════════════════════════════════════════════════════════════

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

    def _apply_replacements(self, image: Image.Image, replacements: list[tuple[ChineseHit, str]]) -> None:
        """Apply translations using layout-aware rendering."""
        # Extract layout BEFORE inpainting (need original pixels)
        layouts = {}
        for hit, translation in replacements:
            if translation:
                layouts[hit.box] = extract_layout(image, hit)

        # Inpaint all regions
        self._inpaint_hits(image, [hit for hit, _ in replacements])

        # Render with extracted layout
        for hit, translation in replacements:
            if not translation:
                continue
            layout = layouts.get(hit.box)
            if layout:
                render_text_with_layout(image, hit.box, translation, layout)
            else:
                # Fallback: horizontal rendering
                box_h = hit.box[3] - hit.box[1]
                max_size = max(10, min(TRANSLATION_FONT_MAX_SIZE, int(box_h * 0.82)))
                expanded_box = self._expand_box(hit.box, image.size)
                draw_text_box(image, expanded_box, translation, fill=(30, 30, 30), max_size=max_size)

    def apply_vision_replacements(self, image: Image.Image, vision_data: list) -> tuple:
        """Apply translations from Qwen-VL vision analysis with layout-aware rendering.

        Returns (modified_image, count_of_replacements).
        """
        edited = image.copy().convert("RGB")
        count = 0

        hits_to_inpaint = []
        render_tasks = []
        LOGGER.info('Vision data raw: %s', vision_data)
        img_w, img_h = edited.size

        for item in vision_data:
            try:
                box = item.get("box", [])
                if len(box) != 4:
                    continue
                # Qwen-VL returns pixel coordinates directly
                raw_coords = [int(v) for v in box]
                x1, y1, x2, y2 = raw_coords
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(img_w, x2), min(img_h, y2)
                if x2 <= x1 or y2 <= y1:
                    continue

                translation = item.get("translation", "")
                if not translation:
                    hits_to_inpaint.append(ChineseHit(
                        text=item.get("text", ""),
                        confidence=0.9,
                        box=(x1, y1, x2, y2),
                        polygon=((x1, y1), (x2, y1), (x2, y2), (x1, y2)),
                    ))
                    continue

                # Build layout from vision data
                orientation = item.get("orientation", "horizontal")
                color = item.get("color", None)
                if isinstance(color, list) and len(color) == 3:
                    fg = tuple(int(c) for c in color)
                else:
                    fg = _sample_text_color_from_image(edited, (x1, y1, x2, y2)) or (30, 30, 30)

                # Derive font_size from box dimensions (more reliable than Qwen-VL's value)
                box_w_px = x2 - x1
                box_h_px = y2 - y1
                if orientation == "vertical":
                    # For vertical text: font_size = column width (each char fills the width)
                    font_size = int(box_w_px * 0.85)
                else:
                    # For horizontal text: font_size = box height * 0.8
                    font_size = int(box_h_px * 0.8)
                font_size = max(14, min(200, font_size))

                # Determine angle from orientation
                if orientation == "vertical":
                    angle = 90.0
                else:
                    angle = 0.0

                is_bold = _detect_boldness(edited, (x1, y1, x2, y2))

                layout = TextLayout(
                    angle=angle,
                    font_size=int(font_size),
                    color=fg,
                    is_bold=is_bold,
                    box=(x1, y1, x2, y2),
                    line_count=1,
                )

                hits_to_inpaint.append(ChineseHit(
                    text=item.get("text", ""),
                    confidence=0.9,
                    box=(x1, y1, x2, y2),
                    polygon=((x1, y1), (x2, y1), (x2, y2), (x1, y2)),
                ))
                LOGGER.info('Vision render: box=(%d,%d,%d,%d) orient=%s font=%d color=%s text=%s',
                           x1, y1, x2, y2, orientation, font_size, fg, translation[:20])
                render_tasks.append(((x1, y1, x2, y2), translation, layout))
            except (ValueError, TypeError, KeyError) as e:
                LOGGER.warning("Vision item parse error: %s", e)
                continue

        # Inpaint all regions first
        if hits_to_inpaint:
            self._inpaint_hits(edited, hits_to_inpaint)

        # Render with layout
        for box, translation, layout in render_tasks:
            render_text_with_layout(edited, box, translation, layout)
            count += 1

        LOGGER.info("Vision replacements applied: %d regions", count)
        return edited, count

    def _inpaint_hits(self, image: Image.Image, hits: list[ChineseHit]) -> None:
        pixels = np.asarray(image.convert("RGB")).copy()
        h, w = pixels.shape[:2]
        for hit in hits:
            x1, y1, x2, y2 = hit.box
            pad = max(5, min(30, round(max(y2 - y1, x2 - x1) * 0.2)))
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
