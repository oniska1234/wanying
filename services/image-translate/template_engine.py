"""Template-based translation for known product image layouts.

Recognizes ~22 known product templates by filename pattern and directly
overwrites Chinese text regions with pre-defined Malay translations at
exact coordinates. Mainly for garbage bag (垃圾袋) product images.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from ocr_detector import draw_text_box

LOGGER = logging.getLogger("image_translate.template")


@dataclass(frozen=True)
class TextRegion:
    """A fixed text region on a template image."""
    box: tuple[int, int, int, int]  # x1, y1, x2, y2
    text: str
    fill: tuple[int, int, int] = (255, 255, 255)
    bg: tuple[int, int, int] | None = None
    max_size: int = 40
    align: str = "center"
    radius: int = 0


@dataclass(frozen=True)
class Template:
    """A known product image template."""
    pattern: re.Pattern
    regions: tuple[TextRegion, ...]
    description: str = ""


# --- Template Definitions ---
# Each template matches a filename pattern and defines fixed text regions
# to overlay with Malay translations.

TEMPLATES: tuple[Template, ...] = (
    Template(
        pattern=re.compile(r"010YLGw", re.IGNORECASE),
        description="垃圾袋 - 白色卷装",
        regions=(
            TextRegion(box=(50, 680, 750, 730), text="BEG SAMPAH BERTALI SERUT", max_size=36),
            TextRegion(box=(100, 735, 700, 775), text="5 GULUNG 75 KEPING", max_size=28),
        ),
    ),
    Template(
        pattern=re.compile(r"01BUTB24", re.IGNORECASE),
        description="垃圾袋 - 黑色加厚",
        regions=(
            TextRegion(box=(80, 650, 720, 700), text="BEG SAMPAH TEBAL", max_size=34),
            TextRegion(box=(150, 710, 650, 750), text="TAHAN LAMA & KALIS BOCOR", max_size=24),
        ),
    ),
    Template(
        pattern=re.compile(r"02YLGw", re.IGNORECASE),
        description="垃圾袋 - 彩色卷装",
        regions=(
            TextRegion(box=(60, 670, 740, 720), text="BEG SAMPAH BERTALI SERUT", max_size=34),
            TextRegion(box=(200, 725, 600, 760), text="MUDAH DIKEMAS", max_size=26),
        ),
    ),
    Template(
        pattern=re.compile(r"03BUTB", re.IGNORECASE),
        description="垃圾袋 - 抽绳式",
        regions=(
            TextRegion(box=(70, 660, 730, 710), text="BEG SAMPAH BERTALI SERUT", max_size=34),
            TextRegion(box=(120, 715, 680, 755), text="TARIK DAN IKAT, MUDAH DIGUNAKAN", max_size=22),
        ),
    ),
    Template(
        pattern=re.compile(r"04YLGw", re.IGNORECASE),
        description="垃圾袋 - 艾草香",
        regions=(
            TextRegion(box=(80, 650, 720, 700), text="BEG SAMPAH HARUMAN MUGWORT", max_size=30),
            TextRegion(box=(150, 705, 650, 745), text="HARUMAN SEGAR, TANPA BAU", max_size=24),
        ),
    ),
    Template(
        pattern=re.compile(r"05BUTB", re.IGNORECASE),
        description="垃圾袋 - 升级版加厚",
        regions=(
            TextRegion(box=(60, 660, 740, 710), text="VERSI DIPERTINGKAT", max_size=34),
            TextRegion(box=(100, 715, 700, 755), text="LEBIH TEBAL & TAHAN LAMA", max_size=26),
        ),
    ),
    Template(
        pattern=re.compile(r"06YLGw", re.IGNORECASE),
        description="垃圾袋 - 免撕款",
        regions=(
            TextRegion(box=(70, 670, 730, 720), text="TEBAL, TANPA KOYAK", max_size=32),
            TextRegion(box=(150, 725, 650, 760), text="MUDAH DIKOYAK", max_size=26),
        ),
    ),
    Template(
        pattern=re.compile(r"07BUTB", re.IGNORECASE),
        description="垃圾袋 - 抗穿刺",
        regions=(
            TextRegion(box=(80, 650, 720, 700), text="TAHAN CUCUK", max_size=36),
            TextRegion(box=(100, 705, 700, 745), text="BAHAN BARU TEBAL, TIDAK MUDAH BOCOR", max_size=20),
        ),
    ),
    Template(
        pattern=re.compile(r"08YLGw", re.IGNORECASE),
        description="垃圾袋 - 自动收口",
        regions=(
            TextRegion(box=(60, 660, 740, 710), text="TUTUP AUTOMATIK", max_size=34),
            TextRegion(box=(120, 715, 680, 755), text="TARIK DAN IKAT", max_size=28),
        ),
    ),
    Template(
        pattern=re.compile(r"09BUTB", re.IGNORECASE),
        description="垃圾袋 - 大容量",
        regions=(
            TextRegion(box=(70, 670, 730, 720), text="BEG SAMPAH BESAR", max_size=34),
            TextRegion(box=(150, 725, 650, 760), text="MEMENUHI KEPERLUAN HARIAN", max_size=22),
        ),
    ),
    Template(
        pattern=re.compile(r"10YLGw", re.IGNORECASE),
        description="垃圾袋 - 家用经济装",
        regions=(
            TextRegion(box=(60, 650, 740, 700), text="BEG SAMPAH EKONOMI", max_size=32),
            TextRegion(box=(100, 705, 700, 745), text="JIMAT & PRAKTIKAL", max_size=26),
        ),
    ),
)


class TemplateEngine:
    """Applies fixed-template translations to known product images."""

    def __init__(self) -> None:
        self._templates = TEMPLATES
        LOGGER.info("Template engine loaded with %d templates", len(self._templates))

    def match(self, filename: str) -> Template | None:
        """Check if a filename matches a known template."""
        for template in self._templates:
            if template.pattern.search(filename):
                return template
        return None

    def apply(self, image: Image.Image, template: Template) -> Image.Image:
        """Apply template text regions to an image."""
        edited = image.copy().convert("RGB")
        for region in template.regions:
            draw_text_box(
                edited,
                region.box,
                region.text,
                fill=region.fill,
                bg=region.bg,
                max_size=region.max_size,
                align=region.align,
                radius=region.radius,
            )
        LOGGER.info("Applied template '%s' with %d regions", template.description, len(template.regions))
        return edited

    def process_file(self, source_path: Path, output_path: Path) -> dict:
        """Process a file if it matches a template. Returns result dict."""
        template = self.match(source_path.name)
        if template is None:
            return {"status": "no_template", "matched": False}

        try:
            with Image.open(source_path) as img:
                edited = self.apply(img, template)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            edited.save(output_path, "JPEG", quality=92, subsampling=0, optimize=True)
            return {
                "status": "success",
                "matched": True,
                "template": template.description,
                "regions": len(template.regions),
            }
        except Exception as exc:
            LOGGER.exception("Template processing failed for %s", source_path.name)
            return {"status": "failed", "matched": True, "error": str(exc)}
