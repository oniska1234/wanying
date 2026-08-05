"""Core image processing pipeline - orchestrates all components."""
from __future__ import annotations

import gc
import logging
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from config import MAX_OUTPUT_EDGE, OUTPUT_WIDTH, OUTPUT_HEIGHT, JPEG_QUALITY
from translator import MalayTranslator
from ocr_detector import (
    ResidualChineseDetector,
    is_actionable_chinese_hit,
)
from enhancement import ImageQualityEnhancer
from quality_gate import assess_layout_diagnostics

LOGGER = logging.getLogger("image_translate.pipeline")


@contextmanager
def timed_stage(timings: dict[str, int], name: str):
    started = time.monotonic()
    try:
        yield
    finally:
        timings[name] = round((time.monotonic() - started) * 1000)


def is_small_product_label_hit(hit, image_size: tuple[int, int]) -> bool:
    """Identify compact Chinese copy embedded on the product/packaging area."""
    width, height = image_size
    box_width = max(1, hit.box[2] - hit.box[0])
    box_height = max(1, hit.box[3] - hit.box[1])
    center_y = (hit.box[1] + hit.box[3]) / 2
    return (
        len([char for char in hit.text if "\u3400" <= char <= "\u9fff"]) >= 2
        and box_width <= width * 0.28
        and box_height <= height * 0.08
        and center_y >= height * 0.25
    )


def should_request_manual_review(
    *,
    layout_needs_review: bool,
    has_unresolved_source: bool,
    has_small_product_label: bool,
    has_remaining_chinese: bool,
    has_seller_watermark: bool,
) -> bool:
    detected_review_risk = (
        layout_needs_review
        or has_unresolved_source
        or has_small_product_label
        or has_remaining_chinese
    )
    return detected_review_risk and not has_seller_watermark


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
        started = time.monotonic()
        timings: dict[str, int] = {}

        def finish(result: dict) -> dict:
            timings["total"] = round((time.monotonic() - started) * 1000)
            result["stage_durations_ms"] = dict(timings)
            LOGGER.info(
                "Pipeline timing %s: %s",
                source_path.name,
                " ".join(f"{name}={duration}ms" for name, duration in timings.items()),
            )
            return result

        try:
            with timed_stage(timings, "decode"):
                with Image.open(source_path) as opened:
                    edited = opened.copy().convert("RGB")

            # Try Qwen-VL vision analysis first for layout-aware translation
            self.detector.last_layout_diagnostics = []
            self.detector.last_brand_boxes = []
            self.detector.last_watermark_diagnostics = []
            self.detector.last_remaining_hits = []
            with timed_stage(timings, "source_ocr"):
                source_ocr_hints = self.detector.scan(
                    edited, minimum_confidence=0.35,
                )
            small_product_label_hits = tuple(
                hit for hit in source_ocr_hints
                if is_small_product_label_hit(hit, edited.size)
            )
            with timed_stage(timings, "vision"):
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
                with timed_stage(timings, "vision_render"):
                    edited, vision_repaired, handled_boxes = (
                        self.detector.apply_vision_replacements(
                            edited,
                            vision_data,
                            self.translator,
                            ocr_hints=source_ocr_hints,
                        )
                    )
            detected_watermarks = list(self.detector.last_watermark_diagnostics)
            unsafe_watermarks = [
                item for item in self.detector.last_watermark_diagnostics
                if item.get("unsafe")
            ]
            if unsafe_watermarks:
                LOGGER.warning(
                    "Preserving %d foreground-crossing watermark regions in %s and continuing",
                    len(unsafe_watermarks),
                    source_path.name,
                )

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
                return finish({
                    "status": "failed",
                    "retryable": False,
                    "error": "自动排版检测到译文区域越界、重叠或遮挡商品，请人工确认",
                    "quality_score": layout_quality.score,
                    "quality_reasons": list(layout_quality.reasons),
                })

            # Reuse the original source OCR for the fallback cleanup. Vision-
            # handled boxes are filtered out, while unmatched labels and brand
            # copy retain their original source coordinates. Final verification
            # is deferred to the exact public 800x800 artifact instead of
            # rescanning several intermediate sizes.
            with timed_stage(timings, "source_cleanup"):
                source_residual = self.detector.repair_and_verify(
                    edited,
                    allow_repair=True,
                    translator=self.translator,
                    handled_boxes=handled_boxes,
                    initial_hits=source_ocr_hints,
                    max_repair_passes=1,
                    verify_after_repair=False,
                )
            unresolved_source_hits = tuple(
                hit for hit in source_residual.remaining
                if is_actionable_chinese_hit(hit)
            )

            with timed_stage(timings, "enhance_resize"):
                enhancement = self.enhancer.enhance(source_residual.image)
                final = limit_size(enhancement.image)
                final = trim_near_white_border(final)
                final = fit_to_output_canvas(final)

            # One repair pass plus one conditional verification pass on the
            # exact downloadable artifact replaces the previous source/final/
            # public scan chain. repair_and_verify.remaining already contains
            # the last OCR result, so a separate final scan is unnecessary.
            with timed_stage(timings, "public_quality"):
                public_residual = self.detector.repair_and_verify(
                    final,
                    allow_repair=True,
                    translator=self.translator,
                    max_repair_passes=1,
                    verify_after_repair=True,
                    # The dedicated watermark pass has already removed what it
                    # can safely handle or preserved the risky area. Keep brand
                    # regions out of the generic final OCR repair while still
                    # translating all other actionable Chinese copy.
                    preserve_brand_regions=bool(detected_watermarks),
                )
                final = public_residual.image

            remaining_chinese = tuple(
                hit
                for hit in public_residual.remaining
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
                    "Quality review flagged %s: %d Chinese regions remain",
                    source_path.name,
                    len(remaining_chinese),
                )

            repaired_count = (
                vision_repaired
                + len(source_residual.repaired)
                + len(public_residual.repaired)
            )
            removed_brand_count = (
                len(source_residual.removed_brands)
                + len(public_residual.removed_brands)
            )
            quality_reasons = list(layout_quality.reasons)
            if unsafe_watermarks:
                quality_reasons.append("watermark_preserved_foreground")
            elif detected_watermarks:
                quality_reasons.append("watermark_processed")
            if unresolved_source_hits:
                # The final OCR is clean, but source-scale OCR had ambiguous
                # product-area fragments that could not be translated safely.
                # Preserve the result for manual comparison instead of calling
                # it an unconditional success or discarding it entirely.
                quality_reasons.append("source_residual_requires_review")
            if small_product_label_hits:
                # OCR can read these labels in the source, but replacement on
                # a curved/rotated product surface is not reliably verifiable
                # after resizing. Keep the artifact downloadable and require a
                # human comparison instead of reporting a false clean success.
                quality_reasons.append("small_product_label_requires_review")
            if remaining_chinese:
                # OCR/layout misses are deterministic for the same artifact.
                # Preserve the usable output for comparison instead of blocking
                # the queue with up to three identical full-image retries.
                quality_reasons.append("residual_chinese")
            quality_reasons = list(dict.fromkeys(quality_reasons))
            # Seller-watermark images must be delivered as normal successes.
            # Unsafe regions stay untouched to protect the product; diagnostic
            # reasons remain available for operations monitoring only.
            needs_review = should_request_manual_review(
                layout_needs_review=layout_quality.needs_review,
                has_unresolved_source=bool(unresolved_source_hits),
                has_small_product_label=bool(small_product_label_hits),
                has_remaining_chinese=bool(remaining_chinese),
                has_seller_watermark=bool(detected_watermarks),
            )
            quality_score = layout_quality.score
            if unresolved_source_hits:
                quality_score = min(quality_score, 0.6)
            if small_product_label_hits:
                quality_score = min(quality_score, 0.55)
            if remaining_chinese:
                quality_score = min(quality_score, 0.4)

            # Save output
            with timed_stage(timings, "encode"):
                output_path.parent.mkdir(parents=True, exist_ok=True)
                save_high_quality_jpeg(final, output_path)

            quality_details = {}
            if remaining_chinese:
                quality_details["remaining_regions"] = self.detector.last_remaining_hits
            if detected_watermarks:
                quality_details["watermark_regions"] = detected_watermarks

            return finish({
                "status": "success",
                "translated": repaired_count > 0 or removed_brand_count > 0,
                "repaired_phrases": repaired_count,
                "removed_brands": removed_brand_count,
                "enhanced": enhancement.enhanced,
                "quality_score": quality_score,
                "needs_review": needs_review,
                "quality_reasons": quality_reasons,
                "review_message": (
                    "图片存在低置信度艺术字、商品贴纸或残留中文，请对比确认"
                    if needs_review
                    else None
                ),
                "quality_details": quality_details,
            })
        except Exception as exc:
            LOGGER.exception("Failed to process %s", source_path)
            return finish({
                "status": "failed",
                "retryable": False,
                "error": "图片处理失败，请检查文件格式",
            })

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
