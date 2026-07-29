"""Core image processing pipeline - orchestrates all components."""
from __future__ import annotations

import gc
import logging
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from config import MAX_OUTPUT_EDGE, JPEG_QUALITY
from translator import MalayTranslator
from ocr_detector import ResidualChineseDetector
from enhancement import ImageQualityEnhancer

LOGGER = logging.getLogger("image_translate.pipeline")


@dataclass
class ProcessingSummary:
    discovered: int = 0
    translated: int = 0
    resized_only: int = 0
    skipped: int = 0
    residual_images: int = 0
    repaired_phrases: int = 0
    enhanced_images: int = 0
    brand_images: int = 0
    removed_brand_phrases: int = 0
    failed_items: list[tuple[str, str]] = field(default_factory=list)

    @property
    def successful(self) -> int:
        return self.translated + self.resized_only


def trim_near_white_border(image: Image.Image, threshold: int = 248) -> Image.Image:
    """Trim near-white borders from the image."""
    import numpy as np
    pixels = np.asarray(image.convert("RGB"))
    h, w = pixels.shape[:2]
    non_white = np.any(pixels < threshold, axis=2)
    rows = np.any(non_white, axis=1)
    cols = np.any(non_white, axis=0)
    if not rows.any() or not cols.any():
        return image
    rmin, rmax = np.where(rows)[0][[0, -1]]
    cmin, cmax = np.where(cols)[0][[0, -1]]
    margin_top = rmin
    margin_bottom = h - 1 - rmax
    margin_left = cmin
    margin_right = w - 1 - cmax
    if max(margin_top, margin_bottom, margin_left, margin_right) < max(h, w) * 0.02:
        return image
    cropped = image.crop((cmin, rmin, cmax + 1, rmax + 1))
    return cropped


def limit_size(image: Image.Image, max_edge: int = MAX_OUTPUT_EDGE) -> Image.Image:
    """Resize image so longest edge <= max_edge, preserving aspect ratio."""
    img = image.convert("RGB")
    w, h = img.size
    longest = max(w, h)
    if longest <= max_edge:
        return img
    scale = max_edge / longest
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))
    return img.resize((new_w, new_h), Image.Resampling.LANCZOS)


def save_high_quality_jpeg(image: Image.Image, path: Path) -> None:
    """Save image as high-quality JPEG."""
    image.convert("RGB").save(path, "JPEG", quality=JPEG_QUALITY, subsampling=0, optimize=True)


class ImagePipeline:
    """Main processing pipeline for image translation."""

    def __init__(self) -> None:
        LOGGER.info("Initializing image pipeline...")
        self.enhancer = ImageQualityEnhancer()
        self.detector = ResidualChineseDetector()
        self.translator = MalayTranslator()
        LOGGER.info(
            "Pipeline ready (qwen_disabled=%s, offline_disabled=%s)",
            self.translator.qwen_disabled,
            self.translator.offline_disabled,
        )

    def process_image(self, source_path: Path, output_path: Path) -> dict:
        """Process a single image. Returns a result dict."""
        try:
            with Image.open(source_path) as opened:
                edited = opened.copy().convert("RGB")

            # Brand removal
            source_brand = self.detector.remove_brands_and_verify(edited)
            edited = source_brand.image

            # Trim white borders
            edited = trim_near_white_border(edited)

            # First pass: detect and translate Chinese text
            source_residual = self.detector.repair_and_verify(
                edited, allow_repair=True, translator=self.translator,
            )

            # Enhancement (only upscale small images, preserve aspect)
            enhancement = self.enhancer.enhance(source_residual.image)

            # Limit output size (preserve aspect ratio, no forced square)
            final = limit_size(enhancement.image)

            # Second pass after resize (may reveal new text)
            final_residual = self.detector.repair_and_verify(
                final, allow_repair=True, translator=self.translator,
            )
            final_brand = self.detector.remove_brands_and_verify(final_residual.image)
            final = final_brand.image

            repaired_count = len(source_residual.repaired) + len(final_residual.repaired)
            removed_brand_count = len(source_brand.repaired) + len(final_brand.repaired)

            # Save output
            output_path.parent.mkdir(parents=True, exist_ok=True)
            save_high_quality_jpeg(final, output_path)

            return {
                "status": "success",
                "translated": repaired_count > 0 or removed_brand_count > 0,
                "repaired_phrases": repaired_count,
                "removed_brands": removed_brand_count,
                "enhanced": enhancement.enhanced,
            }
        except Exception as exc:
            LOGGER.exception("Failed to process %s", source_path)
            return {"status": "failed", "error": "图片处理失败，请检查文件格式"}

    def process_batch(
        self, input_paths: list[Path], output_dir: Path, progress_callback=None,
    ) -> ProcessingSummary:
        """Process a batch of images."""
        summary = ProcessingSummary(discovered=len(input_paths))
        output_dir.mkdir(parents=True, exist_ok=True)

        for index, src in enumerate(input_paths, start=1):
            out_path = output_dir / f"{src.stem}.jpg"
            result = self.process_image(src, out_path)

            if result["status"] == "success":
                if result["translated"]:
                    summary.translated += 1
                else:
                    summary.resized_only += 1
                summary.repaired_phrases += result.get("repaired_phrases", 0)
                summary.removed_brand_phrases += result.get("removed_brands", 0)
                if result.get("enhanced"):
                    summary.enhanced_images += 1
            else:
                summary.failed_items.append((src.name, result.get("error", "unknown")))

            if progress_callback:
                progress_callback(index, len(input_paths))

            if index % 5 == 0:
                gc.collect()

        return summary
