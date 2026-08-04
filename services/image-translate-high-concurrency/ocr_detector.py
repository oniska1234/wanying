"""OCR-based residual Chinese text detection and replacement.

Layout-aware rendering: extracts angle, size, color, weight from original text
polygon and pixel data, then replicates the exact same style for translations.
"""
from __future__ import annotations

import logging
import math
import re
from difflib import SequenceMatcher
from collections import Counter
from dataclasses import dataclass
from typing import Optional

import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont
from rapidocr_onnxruntime import RapidOCR

from brand_removal import BrandPolicy, normalize_brand_text
from translator import MalayTranslator, polish_malaysia_ecommerce
from config import FONT_BOLD, FONT_REG, VERTICAL_LAYOUT_MODE
from layout_planner import estimate_foreground_mask, plan_vertical_columns

LOGGER = logging.getLogger("image_translate.ocr")

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
TRANSLATION_BOX_SCALE = 1.18
TRANSLATION_FONT_MAX_SIZE = 80
MIN_READABLE_FONT_SIZE = 18


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


def is_actionable_chinese_hit(hit: ChineseHit) -> bool:
    """Filter low-confidence single-glyph OCR texture hallucinations."""
    chinese_characters = CJK_RE.findall(normalize_text(hit.text))
    return not (len(chinese_characters) == 1 and hit.confidence < 0.85)


def box_overlap_ratio(
    first: tuple[int, int, int, int],
    second: tuple[int, int, int, int],
) -> float:
    """Return intersection divided by the smaller box area."""
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    if right <= left or bottom <= top:
        return 0.0
    intersection = (right - left) * (bottom - top)
    first_area = max(1, (first[2] - first[0]) * (first[3] - first[1]))
    second_area = max(1, (second[2] - second[0]) * (second[3] - second[1]))
    return intersection / min(first_area, second_area)


def is_box_handled(
    box: tuple[int, int, int, int],
    handled_boxes: tuple[tuple[int, int, int, int], ...],
    threshold: float = 0.35,
) -> bool:
    return any(box_overlap_ratio(box, handled) >= threshold for handled in handled_boxes)


def _match_multiline_ocr_hints(
    source_text: str,
    ocr_hints: tuple[ChineseHit, ...],
    *,
    allow_short_containment: bool = False,
) -> list[ChineseHit]:
    """Anchor a vision paragraph to one or more OCR lines in source pixels."""
    normalized_source = normalize_text(source_text)
    if not normalized_source:
        return []

    minimum_fragment = 2 if allow_short_containment else max(
        4, math.ceil(len(normalized_source) * 0.12),
    )
    contained = []
    covered_characters = 0
    for hit in ocr_hints:
        normalized_hit = normalize_text(hit.text)
        if (
            len(normalized_hit) >= minimum_fragment
            and normalized_hit in normalized_source
        ):
            contained.append(hit)
            covered_characters += len(normalized_hit)
    if contained and covered_characters / max(1, len(normalized_source)) >= 0.55:
        return contained

    return [
        hit for hit in ocr_hints
        if SequenceMatcher(
            None,
            normalized_source,
            normalize_text(hit.text),
        ).ratio() >= 0.72
    ]


def _infer_vision_coordinate_scale(
    vision_data: list,
    image_size: tuple[int, int],
) -> float:
    """Detect Qwen's common ~1280px internal coordinate canvas."""
    extents = []
    for item in vision_data:
        box = item.get("box", []) if isinstance(item, dict) else []
        if len(box) == 4:
            try:
                extents.append(max(float(box[2]), float(box[3])))
            except (TypeError, ValueError):
                continue
    vision_extent = max(extents, default=0.0)
    source_extent = float(max(image_size))
    if 850.0 <= vision_extent <= 1600.0 and source_extent / vision_extent >= 1.35:
        return source_extent / vision_extent
    return 1.0


def _scale_vision_box(
    box: tuple[int, int, int, int],
    image_size: tuple[int, int],
    scale: float,
) -> tuple[int, int, int, int]:
    width, height = image_size
    return (
        max(0, min(width, round(box[0] * scale))),
        max(0, min(height, round(box[1] * scale))),
        max(0, min(width, round(box[2] * scale))),
        max(0, min(height, round(box[3] * scale))),
    )


def _deduplicate_anchored_tasks(render_tasks: list[dict]) -> list[dict]:
    """Prevent different translations from occupying the same source region."""
    ranks = {"text": 3, "spatial": 2, "vision": 1}
    retained: list[dict] = []
    for task in render_tasks:
        conflict_index = next(
            (
                index for index, existing in enumerate(retained)
                if box_overlap_ratio(task["source_box"], existing["source_box"]) >= 0.72
            ),
            None,
        )
        if conflict_index is None:
            retained.append(task)
            continue
        existing = retained[conflict_index]
        if ranks.get(task.get("anchor_method"), 0) > ranks.get(existing.get("anchor_method"), 0):
            retained[conflict_index] = task
            kept, dropped = task, existing
        else:
            kept, dropped = existing, task
        LOGGER.warning(
            "Dropped duplicate vision anchor box=%s kept=%s dropped=%s",
            kept["source_box"],
            kept.get("source_text", "")[:30],
            dropped.get("source_text", "")[:30],
        )
    return retained


def _merge_overlapping_horizontal_tasks(
    render_tasks: list[dict],
    image_size: tuple[int, int],
) -> list[dict]:
    """Merge overlapping horizontal regions into one readable text block."""
    horizontal = [
        task for task in render_tasks
        if task["orientation"] == "horizontal" and task["translation"]
    ]
    components: list[list[dict]] = []
    remaining = list(horizontal)
    while remaining:
        component = [remaining.pop(0)]
        changed = True
        while changed:
            changed = False
            for candidate in list(remaining):
                if any(
                    box_overlap_ratio(candidate["box"], member["box"]) >= 0.18
                    and math.dist(
                        candidate["layout"].color,
                        member["layout"].color,
                    ) <= 90
                    for member in component
                ):
                    component.append(candidate)
                    remaining.remove(candidate)
                    changed = True
        components.append(component)

    remove_ids: set[int] = set()
    width, height = image_size
    for component in components:
        if len(component) < 2:
            continue
        ordered = sorted(component, key=lambda task: (task["box"][1], task["box"][0]))
        left = min(task["box"][0] for task in ordered)
        top = min(task["box"][1] for task in ordered)
        right = max(task["box"][2] for task in ordered)
        bottom = max(task["box"][3] for task in ordered)
        pad_x = round(width * 0.008)
        pad_y = round(height * 0.006)
        merged_box = (
            max(0, left - pad_x),
            max(0, top - pad_y),
            min(width, right + pad_x),
            min(height, bottom + pad_y),
        )
        translations: list[str] = []
        for task in ordered:
            text = str(task["translation"]).strip()
            if text and text not in translations:
                translations.append(text)
        primary = ordered[0]
        old_layout = primary["layout"]
        primary["translation"] = "\n".join(translations)
        primary["box"] = merged_box
        primary["layout"] = TextLayout(
            angle=0.0,
            font_size=max(18, min(64, (merged_box[3] - merged_box[1]) // max(2, len(translations)))),
            color=old_layout.color,
            is_bold=old_layout.is_bold,
            box=merged_box,
            line_count=len(translations),
        )
        primary["orientation"] = "horizontal-merged"
        for task in ordered[1:]:
            remove_ids.add(id(task))
        LOGGER.info(
            "Merged %d overlapping horizontal regions into box=%s",
            len(ordered),
            merged_box,
        )
    merged_tasks = [task for task in render_tasks if id(task) not in remove_ids]

    # Adjacent header/body rows can overlap because OCR polygons include
    # shadows and outlines. Keep their different colours, but split the shared
    # vertical strip so the quality gate and renderer see disjoint boxes.
    ordered_tasks = sorted(
        [task for task in merged_tasks if task["orientation"].startswith("horizontal")],
        key=lambda task: ((task["box"][1] + task["box"][3]) / 2, task["box"][0]),
    )
    for upper, lower in zip(ordered_tasks, ordered_tasks[1:]):
        ux1, uy1, ux2, uy2 = upper["box"]
        lx1, ly1, lx2, ly2 = lower["box"]
        horizontal_overlap = max(0, min(ux2, lx2) - max(ux1, lx1))
        minimum_width = max(1, min(ux2 - ux1, lx2 - lx1))
        if (
            uy2 > ly1
            and horizontal_overlap / minimum_width >= 0.40
            and box_overlap_ratio(upper["box"], lower["box"]) >= 0.18
        ):
            boundary = (uy2 + ly1) // 2
            upper_box = (ux1, uy1, ux2, max(uy1 + 12, boundary - 2))
            lower_box = (lx1, min(ly2 - 12, boundary + 2), lx2, ly2)
            for task, new_box in ((upper, upper_box), (lower, lower_box)):
                old_layout = task["layout"]
                task["box"] = new_box
                task["layout"] = TextLayout(
                    angle=old_layout.angle,
                    font_size=old_layout.font_size,
                    color=old_layout.color,
                    is_bold=old_layout.is_bold,
                    box=new_box,
                    line_count=old_layout.line_count,
                )
    return merged_tasks


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
    "手表": "Jam tangan",
    "工厂": "Kilang",
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

    # Small ecommerce badges frequently use text and background from the same
    # pastel palette.  Vision colour estimates can then land on the badge fill
    # rather than the glyph.  Preserve the hue when possible, but enforce a
    # modest contrast floor so the translation remains legible at thumbnail
    # size.  Large headlines and vertical poster copy retain their source
    # colour exactly.
    if box_h <= image.height * 0.065 and abs(angle) % 180 <= 5:
        color = _ensure_readable_color(image, box, color, minimum_ratio=2.5)

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
        _render_horizontal(
            image,
            box,
            text,
            fnt,
            color,
            font_size,
            allow_wrap=(box_h >= image.height * 0.08 or "\n" in text),
        )
    else:
        # Rotated text: render horizontal then rotate
        _render_rotated(image, box, text, color, angle, font_size, font_path)


def _relative_luminance(color: tuple[int, int, int]) -> float:
    channels = []
    for value in color:
        channel = value / 255.0
        channels.append(
            channel / 12.92
            if channel <= 0.04045
            else ((channel + 0.055) / 1.055) ** 2.4
        )
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def _contrast_ratio(first: tuple[int, int, int], second: tuple[int, int, int]) -> float:
    first_lum = _relative_luminance(first)
    second_lum = _relative_luminance(second)
    lighter = max(first_lum, second_lum)
    darker = min(first_lum, second_lum)
    return (lighter + 0.05) / (darker + 0.05)


def _ensure_readable_color(
    image: Image.Image,
    box: tuple[int, int, int, int],
    color: tuple[int, int, int],
    *,
    minimum_ratio: float,
) -> tuple[int, int, int]:
    x1, y1, x2, y2 = box
    region = np.asarray(image.crop((x1, y1, x2, y2)).convert("RGB"))
    if region.size == 0:
        return color
    background = tuple(int(value) for value in np.median(region.reshape(-1, 3), axis=0))
    if _contrast_ratio(color, background) >= minimum_ratio:
        return color

    candidates: list[tuple[int, int, int]] = []
    for factor in (0.78, 0.62, 0.46, 0.30):
        candidates.append(tuple(round(value * factor) for value in color))
    for factor in (0.25, 0.45, 0.65, 0.82):
        candidates.append(tuple(round(value + (255 - value) * factor) for value in color))
    passing = [
        candidate for candidate in candidates
        if _contrast_ratio(candidate, background) >= minimum_ratio
    ]
    if passing:
        return min(
            passing,
            key=lambda candidate: sum(
                (candidate[index] - color[index]) ** 2 for index in range(3)
            ),
        )
    return max(candidates, key=lambda candidate: _contrast_ratio(candidate, background))


def _render_horizontal(
    image: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    fnt: ImageFont.ImageFont,
    color: tuple[int, int, int],
    initial_size: int,
    *,
    allow_wrap: bool = True,
) -> None:
    """Render horizontal text with auto-fit font size."""
    x1, y1, x2, y2 = box
    box_w = x2 - x1
    box_h = y2 - y1
    draw = ImageDraw.Draw(image)

    # Try several word-wrapping layouts and keep the largest readable result.
    words = text.split()
    candidates = [text]
    for line_count in (range(2, min(4, len(words)) + 1) if allow_wrap else ()):
        lines: list[str] = []
        start = 0
        for line_index in range(line_count):
            remaining_words = len(words) - start
            remaining_lines = line_count - line_index
            take = max(1, round(remaining_words / remaining_lines))
            lines.append(" ".join(words[start:start + take]))
            start += take
        candidates.append("\n".join(lines))

    best_text = text
    best_size = 8
    for candidate in candidates:
        size = initial_size
        while size > 8:
            try:
                candidate_font = ImageFont.truetype(str(FONT_BOLD), size=size)
            except OSError:
                break
            spacing = max(2, size // 8)
            bbox = draw.multiline_textbbox((0, 0), candidate, font=candidate_font, spacing=spacing)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            if tw <= box_w - 8 and th <= box_h - 8:
                break
            size -= 2
        if size > best_size:
            best_size = size
            best_text = candidate

    text = best_text
    size = best_size

    try:
        fnt = ImageFont.truetype(str(FONT_BOLD), size=size)
    except OSError:
        fnt = ImageFont.load_default()

    spacing = max(2, size // 8)
    bbox = draw.multiline_textbbox((0, 0), text, font=fnt, spacing=spacing)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    # Center in box
    tx = x1 + (box_w - tw) // 2
    ty = y1 + (box_h - th) // 2

    draw.multiline_text((tx, ty), text, font=fnt, fill=color, spacing=spacing, align="center")


def _render_rotated(
    image: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    color: tuple[int, int, int],
    angle: float,
    initial_size: int,
    font_path: str,
) -> None:
    """Render one continuous line, then rotate it into the source column."""
    x1, y1, x2, y2 = box
    box_w = x2 - x1
    box_h = y2 - y1

    abs_angle = abs(angle) % 180
    if abs_angle > 45:
        avail_w = box_h
        avail_h = box_w
    else:
        avail_w = box_w
        avail_h = box_h

    draw_temp = ImageDraw.Draw(image)
    size = initial_size
    while size > 10:
        try:
            font = ImageFont.truetype(font_path, size=size)
        except OSError:
            font = ImageFont.load_default()
        bounds = draw_temp.textbbox((0, 0), text, font=font)
        text_w = bounds[2] - bounds[0]
        text_h = bounds[3] - bounds[1]
        if text_w <= avail_w - 8 and text_h <= avail_h - 8:
            break
        size -= 2
    try:
        font = ImageFont.truetype(font_path, size=max(10, size))
    except OSError:
        font = ImageFont.load_default()
    bounds = draw_temp.textbbox((0, 0), text, font=font)
    text_w = bounds[2] - bounds[0]
    text_h = bounds[3] - bounds[1]
    padding = 4
    txt_img = Image.new(
        "RGBA",
        (text_w + padding * 2, text_h + padding * 2),
        (0, 0, 0, 0),
    )
    txt_draw = ImageDraw.Draw(txt_img)
    txt_draw.text(
        (padding - bounds[0], padding - bounds[1]),
        text,
        font=font,
        fill=color + (255,),
    )

    # Rotate: PIL rotates counter-clockwise, so negate the angle
    rotated = txt_img.rotate(-angle, expand=True, resample=Image.Resampling.BICUBIC)

    # Paste centered in box
    rw, rh = rotated.size
    paste_x = x1 + (box_w - rw) // 2
    paste_y = y1 + (box_h - rh) // 2

    # Ensure we don't paste outside image
    img_w, img_h = image.size
    if paste_x < 0 or paste_y < 0 or paste_x + rw > img_w or paste_y + rh > img_h:
        crop_x = max(0, -paste_x)
        crop_y = max(0, -paste_y)
        crop_w = min(rw - crop_x, img_w - max(0, paste_x))
        crop_h = min(rh - crop_y, img_h - max(0, paste_y))
        if crop_w > 0 and crop_h > 0:
            rotated = rotated.crop((crop_x, crop_y, crop_x + crop_w, crop_y + crop_h))
            paste_x = max(0, paste_x)
            paste_y = max(0, paste_y)
        else:
            return

    image.paste(rotated, (paste_x, paste_y), rotated)


def _render_stacked_vertical_words(
    image: Image.Image,
    box: tuple[int, int, int, int],
    text: str,
    layout: TextLayout,
) -> None:
    """Render upright Latin words from top to bottom inside a vertical column."""
    words = [word for word in text.split() if word]
    if not words:
        return
    x1, y1, x2, y2 = box
    box_w = max(1, x2 - x1)
    box_h = max(1, y2 - y1)
    draw = ImageDraw.Draw(image)
    font_path = str(FONT_BOLD) if layout.is_bold else str(FONT_REG)

    size = min(layout.font_size, 72)
    while size > MIN_READABLE_FONT_SIZE:
        try:
            font = ImageFont.truetype(font_path, size=size)
        except OSError:
            font = ImageFont.truetype(str(FONT_BOLD), size=size)
        bounds = [draw.textbbox((0, 0), word, font=font) for word in words]
        widths = [bound[2] - bound[0] for bound in bounds]
        heights = [bound[3] - bound[1] for bound in bounds]
        gap = max(8, round(size * 0.75))
        total_height = sum(heights) + gap * (len(words) - 1)
        if max(widths, default=0) <= box_w - 8 and total_height <= box_h - 8:
            break
        size -= 2

    try:
        font = ImageFont.truetype(font_path, size=max(MIN_READABLE_FONT_SIZE, size))
    except OSError:
        font = ImageFont.truetype(str(FONT_BOLD), size=max(MIN_READABLE_FONT_SIZE, size))
    bounds = [draw.textbbox((0, 0), word, font=font) for word in words]
    heights = [bound[3] - bound[1] for bound in bounds]
    usable_top = y1 + round(box_h * 0.15)
    usable_bottom = y2 - round(box_h * 0.15)
    if len(words) == 1:
        centers = [(usable_top + usable_bottom) / 2]
    else:
        step = (usable_bottom - usable_top) / (len(words) - 1)
        centers = [usable_top + index * step for index in range(len(words))]
    for word, bound, height in zip(words, bounds, heights):
        width = bound[2] - bound[0]
        draw.text(
            (
                x1 + (box_w - width) // 2 - bound[0],
                round(centers.pop(0) - height / 2) - bound[1],
            ),
            word,
            font=font,
            fill=layout.color,
        )


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
        self.last_layout_diagnostics: list[dict] = []
        self.last_brand_boxes: list[tuple[int, int, int, int]] = []
        self.last_watermark_diagnostics: list[dict] = []
        self.last_remaining_hits: list[dict] = []

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
        handled_boxes: tuple[tuple[int, int, int, int], ...] = (),
    ) -> ResidualResult:
        detected = self.scan(image)
        repaired: list[ChineseHit] = []
        edited = image.copy().convert("RGB")
        current_hits = tuple(
            hit for hit in detected
            if not is_box_handled(hit.box, handled_boxes)
        )

        if allow_repair:
            for _pass in range(2):
                replacements = self._batch_translate_hits(
                    current_hits, translator, image_size=edited.size,
                )
                if not replacements:
                    break
                for hit, _ in replacements:
                    repaired.append(hit)
                self._apply_replacements(edited, replacements)
                current_hits = tuple(
                    hit for hit in self.scan(edited)
                    if not is_box_handled(hit.box, handled_boxes)
                )

        return ResidualResult(
            image=edited, detected=tuple(detected),
            repaired=tuple(repaired), remaining=current_hits,
        )

    def _batch_translate_hits(
        self, hits: tuple[ChineseHit, ...], translator: MalayTranslator | None,
        *, image_size: tuple[int, int],
    ) -> list[tuple[ChineseHit, str]]:
        """Translate hits using batch API for efficiency."""
        replacements: list[tuple[ChineseHit, str]] = []
        needs_api: list[tuple[ChineseHit, str]] = []

        for hit in hits:
            if self._brand_policy.is_brand_text(
                hit.text,
                confidence=hit.confidence,
                box=hit.box,
                image_size=image_size,
            ):
                replacements.append((hit, ""))
                continue
            normalized = normalize_text(hit.text)
            direct = NORMALIZED_TRANSLATIONS.get(normalized)
            if direct is not None and hit.confidence >= 0.50:
                replacements.append((hit, polish_malaysia_ecommerce(direct, source_text=hit.text)))
                continue
            if hit.confidence < 0.60:
                continue
            center_y = (hit.box[1] + hit.box[3]) / 2
            if (
                len(normalized) <= 3
                and re.fullmatch(r"[㐀-䶿一-鿿]+", normalized)
                and image_size[1] * 0.25 <= center_y <= image_size[1] * 0.75
                and hit.box[3] - hit.box[1] >= image_size[1] * 0.015
            ):
                # A short, isolated, pale OCR fragment in the product area is
                # commonly the only readable part of a long seller watermark.
                # Do not turn it into plausible-looking but wrong Malay copy;
                # leaving it unresolved makes the final gate fail closed.
                LOGGER.warning(
                    "Deferred ambiguous central OCR fragment text=%s box=%s",
                    hit.text,
                    hit.box,
                )
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

    def apply_vision_replacements(
        self,
        image: Image.Image,
        vision_data: list,
        translator: MalayTranslator,
    ) -> tuple[Image.Image, int, tuple[tuple[int, int, int, int], ...]]:
        """Apply translations from Qwen-VL vision analysis with layout-aware rendering.

        Returns (modified_image, count_of_replacements, handled_boxes).
        """
        edited = image.copy().convert("RGB")
        self.last_layout_diagnostics = []
        self.last_brand_boxes = []
        self.last_watermark_diagnostics = []
        count = 0

        hits_to_inpaint: list[ChineseHit] = []
        watermark_regions: list[tuple[tuple[int, int, int, int], tuple[int, int, int]]] = []
        render_tasks: list[dict] = []
        handled_boxes: list[tuple[int, int, int, int]] = []
        ocr_hints = self.scan(edited, minimum_confidence=0.35)
        LOGGER.info("Applying %d vision text regions", len(vision_data))
        img_w, img_h = edited.size
        vision_coordinate_scale = _infer_vision_coordinate_scale(
            vision_data, edited.size,
        )
        if vision_coordinate_scale > 1.0:
            LOGGER.info(
                "Normalized vision coordinate canvas with scale %.3f",
                vision_coordinate_scale,
            )
        foreground_mask: np.ndarray | None = None

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

                source_text = str(item.get("text", ""))
                raw_vision_box = (x1, y1, x2, y2)
                normalized_source = normalize_text(source_text)
                policy_brand = self._brand_policy.is_brand_text(
                    source_text,
                    confidence=0.90,
                    box=raw_vision_box,
                    image_size=edited.size,
                )
                model_reports_watermark = (
                    str(item.get("kind", "")).lower() == "watermark"
                    and contains_chinese(source_text)
                )
                if (
                    model_reports_watermark
                    and not policy_brand
                    and len(CJK_RE.findall(normalized_source)) <= 4
                    and normalized_source not in NORMALIZED_TRANSLATIONS
                ):
                    # A model prompted with OCR hints may echo a short texture
                    # hallucination as a watermark. Unknown short marks are
                    # left untouched and resolved by the final confidence gate.
                    LOGGER.info(
                        "Deferred unverified short model watermark text=%s",
                        source_text,
                    )
                    continue
                source_is_brand = policy_brand or (
                    model_reports_watermark
                    and len(CJK_RE.findall(normalized_source)) >= 5
                )
                text_matches = _match_multiline_ocr_hints(
                    source_text,
                    ocr_hints,
                    allow_short_containment=source_is_brand,
                )
                spatial_anchor_box = (
                    raw_vision_box
                    if source_is_brand
                    else _scale_vision_box(
                        raw_vision_box,
                        edited.size,
                        vision_coordinate_scale,
                    )
                )
                spatial_matches = [
                    hit for hit in ocr_hints
                    if box_overlap_ratio(hit.box, spatial_anchor_box) >= 0.25
                ]
                matched_hits = text_matches or spatial_matches
                anchor_method = (
                    "text" if text_matches
                    else "spatial" if spatial_matches
                    else "vision"
                )
                if (
                    len(CJK_RE.findall(normalized_source)) == 1
                    and matched_hits
                    and max(hit.confidence for hit in matched_hits) < 0.85
                ):
                    LOGGER.info(
                        "Ignored low-confidence single-glyph vision hint text=%s",
                        source_text,
                    )
                    continue
                if matched_hits:
                    # Qwen-VL may report coordinates in its internally resized
                    # image space. RapidOCR polygons are in actual source pixels,
                    # so matching by recognized text is the reliable anchor.
                    matched_box = (
                        min(hit.box[0] for hit in matched_hits),
                        min(hit.box[1] for hit in matched_hits),
                        max(hit.box[2] for hit in matched_hits),
                        max(hit.box[3] for hit in matched_hits),
                    )
                    vision_box = matched_box
                    # Qwen-VL commonly reports coordinates on an internally
                    # resized ~1000px canvas. For long business watermarks OCR
                    # may only recognize a short suffix, so use that suffix as
                    # the vertical anchor while retaining Qwen's scaled width.
                    if (
                        source_is_brand
                        and (raw_vision_box[2] - raw_vision_box[0])
                        > 2 * max(1, raw_vision_box[3] - raw_vision_box[1])
                        and max(raw_coords) <= 1100
                        and max(img_w, img_h) > 1200
                    ):
                        coordinate_scale = max(img_w, img_h) / 1000.0
                        scaled_left = round(raw_vision_box[0] * coordinate_scale)
                        scaled_right = round(raw_vision_box[2] * coordinate_scale)
                        scaled_height = max(
                            matched_box[3] - matched_box[1],
                            round((raw_vision_box[3] - raw_vision_box[1]) * coordinate_scale),
                        )
                        center_y = (matched_box[1] + matched_box[3]) // 2
                        vision_box = (
                            max(0, min(matched_box[0], scaled_left)),
                            max(0, center_y - scaled_height // 2),
                            min(img_w, max(matched_box[2], scaled_right)),
                            min(img_h, center_y + (scaled_height + 1) // 2),
                        )
                    x1, y1, x2, y2 = vision_box
                else:
                    vision_box = (
                        raw_vision_box
                        if source_is_brand
                        else spatial_anchor_box
                    )
                    if (
                        source_is_brand
                        and max(raw_coords) <= 1100
                        and max(img_w, img_h) > 1200
                    ):
                        vision_box = (
                            max(0, round(raw_vision_box[0] * img_w / 1000)),
                            max(0, round(raw_vision_box[1] * img_h / 1000)),
                            min(img_w, round(raw_vision_box[2] * img_w / 1000)),
                            min(img_h, round(raw_vision_box[3] * img_h / 1000)),
                        )
                        x1, y1, x2, y2 = vision_box

                # This product intentionally translates Chinese only. Vision
                # models sometimes return nearby package English; preserve it
                # unless it is explicitly classified as a brand/watermark.
                if not contains_chinese(source_text) and not source_is_brand:
                    continue

                if source_is_brand:
                    translation = ""
                else:
                    translation = translator.validate_vision_translation(
                        source_text,
                        str(item.get("translation", "")),
                    )
                handled_boxes.append(vision_box)

                color = item.get("color", None)
                if isinstance(color, list) and len(color) == 3:
                    fg = tuple(max(0, min(255, int(c))) for c in color)
                else:
                    fg = _sample_text_color_from_image(edited, vision_box) or (30, 30, 30)
                if source_is_brand:
                    self.last_brand_boxes.append(vision_box)
                    if foreground_mask is None:
                        foreground_mask = estimate_foreground_mask(edited, [])
                    region = foreground_mask[y1:y2, x1:x2]
                    foreground_overlap = (
                        float(np.count_nonzero(region)) / max(1, region.size)
                    )
                    normalized_watermark = normalize_text(source_text)
                    extent_uncertain = False
                    local_foreground_overlap = foreground_overlap
                    if len(normalized_watermark) <= 3:
                        local_mask = estimate_foreground_mask(edited, [vision_box])
                        pad_x = max(20, (x2 - x1) * 2)
                        pad_y = max(20, (y2 - y1) * 2)
                        local_left = max(0, x1 - pad_x)
                        local_top = max(0, y1 - pad_y)
                        local_right = min(img_w, x2 + pad_x)
                        local_bottom = min(img_h, y2 + pad_y)
                        local_region = local_mask[
                            local_top:local_bottom,
                            local_left:local_right,
                        ]
                        local_foreground_overlap = (
                            float(np.count_nonzero(local_region))
                            / max(1, local_region.size)
                        )
                        extent_uncertain = local_foreground_overlap >= 0.18
                    unsafe = (
                        extent_uncertain
                        or (
                            (x2 - x1) / max(1, img_w) >= 0.35
                            and foreground_overlap >= 0.18
                        )
                    )
                    self.last_watermark_diagnostics.append({
                        "box": list(vision_box),
                        "foreground_overlap": round(foreground_overlap, 4),
                        "local_foreground_overlap": round(local_foreground_overlap, 4),
                        "extent_uncertain": extent_uncertain,
                        "unsafe": unsafe,
                    })
                    if unsafe:
                        LOGGER.warning(
                            "Deferred watermark crossing foreground box=%s overlap=%.3f",
                            vision_box,
                            foreground_overlap,
                        )
                        continue
                    watermark_regions.append((vision_box, fg))
                    count += 1

                if matched_hits:
                    hits_to_inpaint.extend(matched_hits)
                else:
                    hits_to_inpaint.append(ChineseHit(
                        text=source_text,
                        confidence=0.9,
                        box=vision_box,
                        polygon=((x1, y1), (x2, y1), (x2, y2), (x1, y2)),
                    ))

                if not translation:
                    continue

                # Build layout from vision data
                orientation = item.get("orientation", "horizontal")
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
                    box=vision_box,
                    line_count=1,
                )

                LOGGER.info('Vision render: box=(%d,%d,%d,%d) orient=%s font=%d color=%s text=%s',
                           x1, y1, x2, y2, orientation, font_size, fg, translation[:20])
                render_tasks.append({
                    "box": vision_box,
                    "source_box": vision_box,
                    "source_text": source_text,
                    "translation": translation,
                    "layout": layout,
                    "orientation": orientation,
                    "anchor_method": anchor_method,
                })
            except (ValueError, TypeError, KeyError) as e:
                LOGGER.warning("Vision item parse error: %s", e)
                continue

        render_tasks = _deduplicate_anchored_tasks(render_tasks)
        render_tasks = _merge_overlapping_horizontal_tasks(render_tasks, edited.size)

        # Reflow adjacent vertical Chinese columns into readable horizontal Malay
        # blocks. Long Latin phrases should not be squeezed into a 1-character
        # wide Chinese column.
        vertical = sorted(
            [
                task for task in render_tasks
                if task["orientation"] == "vertical"
                and len(task["translation"].replace(" ", "")) > 12
            ],
            key=lambda task: task["box"][0],
        )
        groups: list[list[dict]] = []
        for task in vertical:
            if not groups:
                groups.append([task])
                continue
            previous = groups[-1][-1]
            previous_box = previous["box"]
            box = task["box"]
            gap = box[0] - previous_box[2]
            vertical_overlap = max(0, min(box[3], previous_box[3]) - max(box[1], previous_box[1]))
            min_height = max(1, min(box[3] - box[1], previous_box[3] - previous_box[1]))
            max_width = max(box[2] - box[0], previous_box[2] - previous_box[0])
            if gap <= max_width and vertical_overlap / min_height >= 0.55:
                groups[-1].append(task)
            else:
                groups.append([task])

        for group in groups if VERTICAL_LAYOUT_MODE == "preserve" else []:
            plan = plan_vertical_columns(
                edited,
                [task["box"] for task in group],
                [task["translation"] for task in group],
            )
            self.last_layout_diagnostics.append({
                "orientation": "vertical-preserved",
                "strategy": plan.strategy,
                "score": plan.score,
                "confidence": plan.confidence,
                "foreground_overlap": plan.foreground_overlap,
                "clearance_ratio": plan.clearance_ratio,
                "boxes": [list(box) for box in plan.boxes],
            })

            # Chinese columns read right-to-left. Put the right source column
            # into the left translated column to match the reference design.
            for task, column_box in zip(reversed(group), plan.boxes):
                old_layout = task["layout"]
                task["box"] = column_box
                task["layout"] = TextLayout(
                    angle=90.0,
                    font_size=plan.font_size,
                    color=old_layout.color,
                    is_bold=False,
                    box=column_box,
                    line_count=1,
                )
                task["orientation"] = "vertical-preserved"
            LOGGER.info(
                "Preserved %d translations with adaptive layout "
                "(strategy=%s confidence=%.3f overlap=%.3f)",
                len(group),
                plan.strategy,
                plan.confidence,
                plan.foreground_overlap,
            )

        for group in groups if VERTICAL_LAYOUT_MODE == "reflow" else []:
            left = min(task["box"][0] for task in group)
            top = min(task["box"][1] for task in group)
            right = max(task["box"][2] for task in group)
            bottom = max(task["box"][3] for task in group)
            original_width = right - left
            reflow_left = max(0, left - round(original_width * 0.15))
            expanded_right = min(
                img_w,
                round(img_w * 0.30),
                left + max(round(original_width * 1.55), round(img_w * 0.22)),
            )
            # Latin copy is denser when stacked near the top of the original
            # vertical group. Keeping it within the left 30% avoids covering
            # the product/person that usually occupies the center of a poster.
            content_bottom = top + round((bottom - top) * 0.58)
            slice_height = max(1, (content_bottom - top) // len(group))
            for index, task in enumerate(group):
                block_box = (
                    reflow_left,
                    top + index * slice_height,
                    expanded_right,
                    content_bottom if index == len(group) - 1 else top + (index + 1) * slice_height,
                )
                old_layout = task["layout"]
                task["box"] = block_box
                task["layout"] = TextLayout(
                    angle=0.0,
                    font_size=max(28, min(64, slice_height // 4)),
                    color=old_layout.color,
                    is_bold=old_layout.is_bold,
                    box=block_box,
                    line_count=2,
                )
                task["orientation"] = "horizontal-reflow"
            LOGGER.info("Reflowed %d vertical regions into horizontal blocks", len(group))

        for group in groups if VERTICAL_LAYOUT_MODE == "stacked" else []:
            left = min(task["box"][0] for task in group)
            top = min(task["box"][1] for task in group)
            right = max(task["box"][2] for task in group)
            bottom = max(task["box"][3] for task in group)
            original_width = right - left
            stack_left = max(0, left - round(original_width * 0.25))
            stack_right = min(
                img_w,
                round(img_w * 0.34),
                right + round(original_width * 0.55),
            )
            column_width = max(1, (stack_right - stack_left) // len(group))
            for index, task in enumerate(group):
                column_box = (
                    stack_left + index * column_width,
                    top,
                    stack_right if index == len(group) - 1 else stack_left + (index + 1) * column_width,
                    bottom,
                )
                old_layout = task["layout"]
                task["box"] = column_box
                task["layout"] = TextLayout(
                    angle=0.0,
                    font_size=max(32, min(72, round(column_width * 0.36))),
                    color=old_layout.color,
                    is_bold=old_layout.is_bold,
                    box=column_box,
                    line_count=len(task["translation"].split()),
                )
                task["orientation"] = "vertical-stacked"
            LOGGER.info("Kept %d translated regions as upright vertical columns", len(group))

        vertical_diagnostic_boxes = {
            tuple(box)
            for diagnostic in self.last_layout_diagnostics
            for box in diagnostic.get("boxes", [])
        }
        for task in render_tasks:
            if tuple(task["box"]) in vertical_diagnostic_boxes:
                continue
            diagnostic = {
                "orientation": task["orientation"],
                "strategy": "source-region",
                "score": 0.0,
                "confidence": 1.0,
                "foreground_overlap": 0.0,
                "clearance_ratio": 1.0,
                "boxes": [list(task["box"])],
            }
            task["_diagnostic"] = diagnostic
            self.last_layout_diagnostics.append(diagnostic)

        # Inpaint all regions first
        if hits_to_inpaint:
            self._inpaint_hits(edited, hits_to_inpaint)
        for task in render_tasks:
            source_box = tuple(task.get("source_box", task["box"]))
            source_width = source_box[2] - source_box[0]
            source_height = source_box[3] - source_box[1]
            needs_stylized_cleanup = (
                task["orientation"].startswith("horizontal")
                and source_width >= img_w * 0.25
                and source_height >= img_h * 0.035
            )
            if not needs_stylized_cleanup:
                continue
            applied, dominance, selected_ratio = self._inpaint_flat_poster_text(
                edited, source_box,
            )
            diagnostic = task.get("_diagnostic")
            if diagnostic is not None:
                diagnostic.update({
                    "source_cleanup_required": True,
                    "source_cleanup_applied": applied,
                    "source_background_dominance": dominance,
                    "source_cleanup_selected_ratio": selected_ratio,
                })
        for watermark_box, watermark_color in watermark_regions:
            self._inpaint_watermark_region(edited, watermark_box, watermark_color)

        # Render with layout
        for task in render_tasks:
            if task["orientation"] == "vertical-stacked":
                _render_stacked_vertical_words(
                    edited,
                    task["box"],
                    task["translation"],
                    task["layout"],
                )
            else:
                render_text_with_layout(
                    edited,
                    task["box"],
                    task["translation"],
                    task["layout"],
                )
            count += 1

        LOGGER.info("Vision replacements applied: %d regions", count)
        return edited, count, tuple(handled_boxes)

    def erase_hits(self, image: Image.Image, hits: list[ChineseHit]) -> None:
        """Erase residual OCR strokes without drawing a duplicate translation."""
        if hits:
            self._inpaint_hits(image, hits)

    def _inpaint_hits(self, image: Image.Image, hits: list[ChineseHit]) -> None:
        pixels = np.asarray(image.convert("RGB")).copy()
        h, w = pixels.shape[:2]
        for hit in hits:
            x1, y1, x2, y2 = hit.box
            pad = max(4, min(18, round(min(y2 - y1, x2 - x1) * 0.18)))
            left = max(0, x1 - pad)
            top = max(0, y1 - pad)
            right = min(w, x2 + pad)
            bottom = min(h, y2 + pad)
            if right <= left or bottom <= top:
                continue
            roi = pixels[top:bottom, left:right]
            polygon_mask = np.zeros(roi.shape[:2], dtype=np.uint8)
            pts = np.array(hit.polygon, dtype=np.int32)
            pts[:, 0] -= left
            pts[:, 1] -= top
            cv2.fillPoly(polygon_mask, [pts], 255)

            # Select likely glyph pixels by contrast against the local border.
            # This preserves watermark/gradient pixels inside a large text box.
            ring = cv2.dilate(polygon_mask, np.ones((9, 9), np.uint8), iterations=1)
            ring = cv2.subtract(ring, polygon_mask)
            ring_pixels = roi[ring > 0]
            if len(ring_pixels) >= 12:
                if self._fill_smooth_text_region(roi, polygon_mask):
                    pixels[top:bottom, left:right] = roi
                    continue
                background = np.median(ring_pixels.astype(np.float32), axis=0)
                background_variation = float(
                    np.mean(np.std(ring_pixels.astype(np.float32), axis=0))
                )
                if background_variation < 14.0:
                    # Flat poster backgrounds are reconstructed more cleanly by
                    # a feathered local fill than by large-area inpainting.
                    alpha = cv2.GaussianBlur(polygon_mask, (0, 0), 1.2).astype(np.float32) / 255.0
                    filled = np.empty_like(roi)
                    filled[:, :] = np.clip(background, 0, 255).astype(np.uint8)
                    roi = (
                        roi.astype(np.float32) * (1.0 - alpha[:, :, None])
                        + filled.astype(np.float32) * alpha[:, :, None]
                    ).astype(np.uint8)
                    pixels[top:bottom, left:right] = roi
                    continue
                distance = np.linalg.norm(roi.astype(np.float32) - background, axis=2)
                ring_distance = np.linalg.norm(ring_pixels.astype(np.float32) - background, axis=1)
                threshold = max(22.0, float(np.percentile(ring_distance, 90)) + 8.0)
                mask = np.where(
                    (polygon_mask > 0) & (distance >= threshold),
                    255,
                    0,
                ).astype(np.uint8)
                selected_ratio = np.count_nonzero(mask) / max(1, np.count_nonzero(polygon_mask))
                if selected_ratio < 0.015:
                    mask = polygon_mask
            else:
                mask = polygon_mask
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
            mask = cv2.dilate(mask, kernel, iterations=1)
            inpainted = cv2.inpaint(roi, mask, 3, cv2.INPAINT_TELEA)
            pixels[top:bottom, left:right] = inpainted
        image.paste(Image.fromarray(pixels, mode="RGB"))

    @staticmethod
    def _fill_smooth_text_region(
        roi: np.ndarray,
        polygon_mask: np.ndarray,
        *,
        feather_sigma: float = 1.2,
    ) -> bool:
        """Reconstruct smooth poster gradients behind dense outlined glyphs.

        Classical inpainting tends to copy a hollow glyph's own white outline
        back into the hole.  A robust colour plane is safer when the perimeter
        proves that the underlying design is smooth; textured/product regions
        fail the residual check and keep the conservative inpainting path.
        """
        height, width = polygon_mask.shape
        if height < 8 or width < 8:
            return False
        ring_radius = max(5, min(12, round(min(height, width) * 0.09)))
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (ring_radius * 2 + 1, ring_radius * 2 + 1),
        )
        outer_mask = cv2.dilate(polygon_mask, kernel, iterations=1)
        fit_ring = (outer_mask > 0) & (polygon_mask == 0)
        if np.count_nonzero(fit_ring) < 48:
            return False

        yy, xx = np.mgrid[0:height, 0:width]
        normalized_x = xx[fit_ring].astype(np.float64) / max(1, width - 1)
        normalized_y = yy[fit_ring].astype(np.float64) / max(1, height - 1)
        design = np.column_stack((
            np.ones(np.count_nonzero(fit_ring), dtype=np.float64),
            normalized_x,
            normalized_y,
            normalized_x * normalized_x,
            normalized_x * normalized_y,
            normalized_y * normalized_y,
        ))
        samples = roi[fit_ring].astype(np.float64)
        try:
            coefficients = np.linalg.lstsq(design, samples, rcond=None)[0]
            residuals = np.linalg.norm(samples - design @ coefficients, axis=1)
            keep = residuals <= np.percentile(residuals, 70)
            if np.count_nonzero(keep) < 36:
                return False
            coefficients = np.linalg.lstsq(
                design[keep], samples[keep], rcond=None,
            )[0]
            residuals = np.linalg.norm(samples - design @ coefficients, axis=1)
        except np.linalg.LinAlgError:
            return False
        if np.percentile(residuals, 70) > 18.0 or np.percentile(residuals, 90) > 35.0:
            return False

        complete_x = xx.ravel().astype(np.float64) / max(1, width - 1)
        complete_y = yy.ravel().astype(np.float64) / max(1, height - 1)
        complete_design = np.column_stack((
            np.ones(height * width, dtype=np.float64),
            complete_x,
            complete_y,
            complete_x * complete_x,
            complete_x * complete_y,
            complete_y * complete_y,
        ))
        prediction = np.clip(
            complete_design @ coefficients, 0, 255,
        ).reshape(height, width, 3).astype(np.uint8)
        glyph_extent = cv2.dilate(
            polygon_mask,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)),
            iterations=1,
        )
        alpha = cv2.GaussianBlur(
            glyph_extent, (0, 0), feather_sigma,
        ).astype(np.float32) / 255.0
        roi[:] = (
            roi.astype(np.float32) * (1.0 - alpha[:, :, None])
            + prediction.astype(np.float32) * alpha[:, :, None]
        ).astype(np.uint8)
        return True

    @staticmethod
    def _inpaint_flat_poster_text(
        image: Image.Image,
        box: tuple[int, int, int, int],
    ) -> tuple[bool, float, float]:
        """Clean large stylized copy when it sits on a dominant poster colour."""
        pixels = np.asarray(image.convert("RGB")).copy()
        height, width = pixels.shape[:2]
        x1, y1, x2, y2 = box
        pad = max(12, round(min(width, height) * 0.016))
        left = max(0, x1 - pad)
        top = max(0, y1 - pad)
        right = min(width, x2 + pad)
        bottom = min(height, y2 + pad)
        if right <= left or bottom <= top:
            return False, 0.0, 0.0

        outer = pixels[top:bottom, left:right]
        inner_left = x1 - left
        inner_top = y1 - top
        inner_right = x2 - left
        inner_bottom = y2 - top
        ring_mask = np.ones(outer.shape[:2], dtype=bool)
        ring_mask[inner_top:inner_bottom, inner_left:inner_right] = False
        ring_pixels = outer[ring_mask]
        if len(ring_pixels) < 24:
            return False, 0.0, 0.0

        quantized = (ring_pixels // 24).astype(np.int16)
        buckets, counts = np.unique(quantized, axis=0, return_counts=True)
        dominant_bucket = buckets[int(np.argmax(counts))]
        dominant_members = ring_pixels[np.all(quantized == dominant_bucket, axis=1)]
        background = np.median(dominant_members.astype(np.float32), axis=0)
        dominance = len(dominant_members) / len(ring_pixels)
        if dominance < 0.30:
            return False, round(dominance, 4), 0.0

        roi = outer[inner_top:inner_bottom, inner_left:inner_right]
        distance = np.linalg.norm(roi.astype(np.float32) - background, axis=2)
        ring_distance = np.linalg.norm(
            ring_pixels.astype(np.float32) - background,
            axis=1,
        )
        threshold = max(30.0, float(np.percentile(ring_distance, 72)) + 8.0)
        mask = np.where(distance >= threshold, 255, 0).astype(np.uint8)
        selected_ratio = np.count_nonzero(mask) / max(1, mask.size)
        # The first-stage smooth-background reconstruction may already have
        # removed every source glyph.  A homogeneous region on a proven
        # dominant background is therefore a successful cleanup, not a low-
        # confidence failure.
        already_clean = selected_ratio < 0.015
        # Hollow, outlined marketplace headlines can legitimately occupy most
        # of their OCR box.  The surrounding-ring dominance check above is the
        # safety signal that proves a reconstructable poster background; allow
        # dense headline artwork while continuing to reject nearly full-frame
        # or product-like regions.
        upper_limit = 0.96 if dominance >= 0.50 else 0.75
        full_mask = np.zeros(outer.shape[:2], dtype=np.uint8)
        # OCR boxes usually follow the coloured inner strokes and omit the
        # outer white outline/drop shadow.  Extend only within the already
        # validated flat-background ring so those recognizable source-shaped
        # scallops do not survive around the translation.
        fill_pad = max(2, min(pad // 2, round((y2 - y1) * 0.12)))
        fill_left = max(0, inner_left - fill_pad)
        fill_top = max(0, inner_top - fill_pad)
        fill_right = min(outer.shape[1], inner_right + fill_pad)
        fill_bottom = min(outer.shape[0], inner_bottom + fill_pad)
        full_mask[fill_top:fill_bottom, fill_left:fill_right] = 255
        feather_sigma = max(4.0, min(10.0, pad * 0.30))

        if not already_clean and selected_ratio > upper_limit:
            # A single-colour distance model classifies nearly every pixel of
            # a smooth gradient as foreground. Before failing closed, prove
            # that the surrounding panel can reconstruct a quadratic colour
            # surface. Product/photo regions retain high residuals and still
            # fail this conservative fallback.
            if ResidualChineseDetector._fill_smooth_text_region(
                outer, full_mask, feather_sigma=feather_sigma,
            ):
                pixels[top:bottom, left:right] = outer
                image.paste(Image.fromarray(pixels, mode="RGB"))
                return True, round(dominance, 4), round(selected_ratio, 4)
            return False, round(dominance, 4), round(selected_ratio, 4)

        # On a proven dominant poster background, replace the complete source
        # title region. Mask-only inpainting of large hollow glyphs can borrow
        # their own outlines and leave recognizable Chinese-shaped ghosts.
        # Prefer a robust linear colour surface so mild poster gradients stay
        # continuous instead of becoming a visible solid rectangle.  The
        # constant dominant-colour fill remains the fallback for truly flat
        # backgrounds or numerically unstable fits.
        if not ResidualChineseDetector._fill_smooth_text_region(
            outer, full_mask, feather_sigma=feather_sigma,
        ):
            alpha = cv2.GaussianBlur(
                full_mask, (0, 0), feather_sigma,
            ).astype(np.float32) / 255.0
            fill = np.empty_like(outer)
            fill[:, :] = np.clip(background, 0, 255).astype(np.uint8)
            outer = (
                outer.astype(np.float32) * (1.0 - alpha[:, :, None])
                + fill.astype(np.float32) * alpha[:, :, None]
            ).astype(np.uint8)
        pixels[top:bottom, left:right] = outer
        image.paste(Image.fromarray(pixels, mode="RGB"))
        return True, round(dominance, 4), round(selected_ratio, 4)

    @staticmethod
    def _inpaint_watermark_region(
        image: Image.Image,
        box: tuple[int, int, int, int],
        color: tuple[int, int, int],
    ) -> None:
        """Remove a faint, long watermark without flattening its full box.

        Marketplace seller watermarks often span most of the image and cross
        several different backgrounds. Filling the whole rectangle damages the
        product, while polygon OCR usually sees only a suffix. This mask keeps
        pixels that both resemble the reported light/dark glyph colour and
        deviate from a locally blurred background.
        """
        pixels = np.asarray(image.convert("RGB")).copy()
        height, width = pixels.shape[:2]
        x1, y1, x2, y2 = box
        pad = max(3, min(16, round((y2 - y1) * 0.08)))
        left = max(0, x1 - pad)
        top = max(0, y1 - pad)
        right = min(width, x2 + pad)
        bottom = min(height, y2 + pad)
        if right <= left or bottom <= top:
            return

        roi = pixels[top:bottom, left:right]
        gray = cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY)
        hsv = cv2.cvtColor(roi, cv2.COLOR_RGB2HSV)
        local_background = cv2.GaussianBlur(gray, (0, 0), 6.0)
        reported_luminance = (
            0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
        )
        if reported_luminance >= 150:
            candidate = (
                (gray.astype(np.int16) - local_background.astype(np.int16) >= 3)
                & (gray >= 145)
                & (hsv[:, :, 1] <= 110)
            )
        else:
            candidate = (
                (local_background.astype(np.int16) - gray.astype(np.int16) >= 4)
                & (gray <= 135)
            )
        mask = np.where(candidate, 255, 0).astype(np.uint8)
        selected_ratio = np.count_nonzero(mask) / max(1, mask.size)
        if selected_ratio < 0.0008 or selected_ratio > 0.24:
            LOGGER.warning(
                "Skipped unsafe watermark mask box=%s ratio=%.4f",
                box,
                selected_ratio,
            )
            return

        close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel, iterations=1)
        mask = cv2.dilate(mask, close_kernel, iterations=1)
        roi = cv2.inpaint(roi, mask, 4, cv2.INPAINT_TELEA)
        pixels[top:bottom, left:right] = roi
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
