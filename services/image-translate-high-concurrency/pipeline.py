"""Core image processing pipeline - orchestrates all components."""
from __future__ import annotations

import gc
import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from config import MAX_OUTPUT_EDGE, OUTPUT_WIDTH, OUTPUT_HEIGHT, JPEG_QUALITY
from translator import MalayTranslator
from ocr_detector import (
    ResidualChineseDetector,
    box_overlap_ratio,
    is_actionable_chinese_hit,
)
from enhancement import ImageQualityEnhancer
from quality_gate import assess_layout_diagnostics

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


def fit_to_output_canvas(
    image: Image.Image,
    size: tuple[int, int] = (OUTPUT_WIDTH, OUTPUT_HEIGHT),
) -> Image.Image:
    """Fit the whole image on an exact-size canvas without stretching or cropping."""
    img = image.convert("RGB")
    target_w, target_h = size
    scale = min(target_w / img.width, target_h / img.height)
    resized = img.resize(
        (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
        Image.Resampling.LANCZOS,
    )
    # Use the average of the four corners so poster backgrounds remain visually
    # continuous while the product and translated copy keep their proportions.
    corners = (
        resized.getpixel((0, 0)),
        resized.getpixel((resized.width - 1, 0)),
        resized.getpixel((0, resized.height - 1)),
        resized.getpixel((resized.width - 1, resized.height - 1)),
    )
    background = tuple(round(sum(pixel[channel] for pixel in corners) / 4) for channel in range(3))
    canvas = Image.new("RGB", size, background)
    canvas.paste(resized, ((target_w - resized.width) // 2, (target_h - resized.height) // 2))
    return canvas


class ImagePipeline:
    """Main processing pipeline for image translation."""

    def __init__(self) -> None:
        LOGGER.info("Initializing image pipeline...")
        self.enhancer = ImageQualityEnhancer()
        self.detector = ResidualChineseDetector()
        self.translator = MalayTranslator()
        # RapidOCR/ONNX and the translator maintain mutable state. Serialize
        # access to one pipeline instance instead of sharing them across worker
        # threads unsafely.
        self._process_lock = threading.Lock()
        LOGGER.info(
            "Pipeline ready (qwen_disabled=%s, offline_disabled=%s)",
            self.translator.qwen_disabled,
            self.translator.offline_disabled,
        )

    def process_image(self, source_path: Path, output_path: Path) -> dict:
        with self._process_lock:
            return self._process_image_locked(source_path, output_path)

    def _process_image_locked(self, source_path: Path, output_path: Path) -> dict:
        """Process a single image. Returns a result dict."""
        try:
            with Image.open(source_path) as opened:
                edited = opened.copy().convert("RGB")

            # Try Qwen-VL vision analysis first for layout-aware translation
            self.detector.last_layout_diagnostics = []
            self.detector.last_brand_boxes = []
            self.detector.last_watermark_diagnostics = []
            self.detector.last_remaining_hits = []
            source_ocr_hints = self.detector.scan(edited, minimum_confidence=0.35)
            vision_data = self.translator.vision_analyze_image(
                source_path,
                ocr_hints=[
                    {"text": hit.text, "box": list(hit.box)}
                    for hit in source_ocr_hints
                ],
            )
            vision_repaired = 0
            handled_boxes: tuple[tuple[int, int, int, int], ...] = ()
            if vision_data:
                edited, vision_repaired, handled_boxes = self.detector.apply_vision_replacements(
                    edited, vision_data, self.translator,
                )
            unsafe_watermarks = [
                item for item in self.detector.last_watermark_diagnostics
                if item.get("unsafe")
            ]
            if unsafe_watermarks:
                LOGGER.warning(
                    "Quality gate rejected %s: watermark crosses foreground",
                    source_path.name,
                )
                return {
                    "status": "failed",
                    "retryable": False,
                    "error": "商家水印覆盖商品主体，为避免损伤商品图已停止自动处理，请人工处理",
                    "quality_score": 0.0,
                    "quality_reasons": ["watermark_crosses_foreground"],
                }

            # Fallback brand removal runs after vision so faint OCR fragments
            # remain available as coordinate anchors for complete watermarks.
            source_brand = self.detector.remove_brands_and_verify(edited)
            edited = source_brand.image
            layout_quality = assess_layout_diagnostics(
                self.detector.last_layout_diagnostics,
                image_size=edited.size,
            )
            if layout_quality.severe:
                LOGGER.warning(
                    "Quality gate rejected %s: unsafe layout (%s)",
                    source_path.name,
                    ",".join(layout_quality.reasons),
                )
                return {
                    "status": "failed",
                    "retryable": False,
                    "error": "自动排版可能遮挡商品，请人工确认",
                    "quality_score": layout_quality.score,
                    "quality_reasons": list(layout_quality.reasons),
                }

            # OCR may still see remnants inside a vision-handled box. Erase
            # those strokes, but never draw a second translation there.
            if handled_boxes:
                handled_residuals = [
                    hit for hit in self.detector.scan(edited)
                    if any(
                        box_overlap_ratio(hit.box, box) >= 0.35
                        for box in handled_boxes
                    )
                ]
                self.detector.erase_hits(edited, handled_residuals)

            source_residual = self.detector.repair_and_verify(
                edited,
                allow_repair=True,
                translator=self.translator,
                handled_boxes=handled_boxes,
            )

            # Enhancement (only upscale small images, preserve aspect)
            enhancement = self.enhancer.enhance(source_residual.image)

            # Limit output size (preserve aspect ratio, no forced square)
            final = limit_size(enhancement.image)

            # Scale handled regions when enhancement/limit_size changed image dimensions.
            source_w, source_h = source_residual.image.size
            final_w, final_h = final.size
            scaled_handled_boxes = tuple(
                (
                    round(box[0] * final_w / source_w),
                    round(box[1] * final_h / source_h),
                    round(box[2] * final_w / source_w),
                    round(box[3] * final_h / source_h),
                )
                for box in handled_boxes
            )

            if scaled_handled_boxes:
                handled_final_residuals = [
                    hit for hit in self.detector.scan(final)
                    if any(
                        box_overlap_ratio(hit.box, box) >= 0.35
                        for box in scaled_handled_boxes
                    )
                ]
                self.detector.erase_hits(final, handled_final_residuals)

            final_residual = self.detector.repair_and_verify(
                final,
                allow_repair=True,
                translator=self.translator,
                handled_boxes=scaled_handled_boxes,
            )
            final_brand = self.detector.remove_brands_and_verify(final_residual.image)
            final = trim_near_white_border(final_brand.image)

            # A generated JPEG is not a successful translation if unhandled
            # Chinese remains after both repair passes.
            remaining_chinese = tuple(
                hit
                for hit in self.detector.scan(final, minimum_confidence=0.35)
                if is_actionable_chinese_hit(hit)
            )
            if remaining_chinese:
                self.detector.last_remaining_hits = [
                    {
                        "text": hit.text,
                        "confidence": round(hit.confidence, 4),
                        "box": list(hit.box),
                    }
                    for hit in remaining_chinese
                ]
                LOGGER.warning(
                    "Quality gate rejected %s: %d Chinese regions remain",
                    source_path.name,
                    len(remaining_chinese),
                )
                return {
                    "status": "failed",
                    "retryable": False,
                    "error": "译图仍存在未处理中文，请重试或人工确认",
                    "quality_score": 0.0,
                    "quality_reasons": ["residual_chinese"],
                }

            repaired_count = vision_repaired + len(source_residual.repaired) + len(final_residual.repaired)
            removed_brand_count = len(source_brand.repaired) + len(final_brand.repaired)

            # Standardize the public artifact only after all OCR/layout quality
            # checks. This preserves content proportions and guarantees 800x800.
            final = fit_to_output_canvas(final)

            # Save output
            output_path.parent.mkdir(parents=True, exist_ok=True)
            save_high_quality_jpeg(final, output_path)

            return {
                "status": "success",
                "translated": repaired_count > 0 or removed_brand_count > 0,
                "repaired_phrases": repaired_count,
                "removed_brands": removed_brand_count,
                "enhanced": enhancement.enhanced,
                "quality_score": layout_quality.score,
                "needs_review": layout_quality.needs_review,
                "quality_reasons": list(layout_quality.reasons),
            }
        except Exception as exc:
            LOGGER.exception("Failed to process %s", source_path)
            return {
                "status": "failed",
                "retryable": False,
                "error": "图片处理失败，请检查文件格式",
            }

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
