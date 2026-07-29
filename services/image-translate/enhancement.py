"""Image quality enhancement (Lanczos + UnsharpMask, no GPU required)."""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageFilter

LOGGER = logging.getLogger("image_translate.enhancement")


@dataclass(frozen=True)
class EnhancementResult:
    image: Image.Image
    enhanced: bool
    method: str


class ImageQualityEnhancer:
    """Enhances image quality using Lanczos upscale + sharpening."""

    MIN_OUTPUT_EDGE = 800
    NEAR_OUTPUT_EDGE = 640
    BLUR_DETAIL_THRESHOLD = 90.0

    def enhance(self, image: Image.Image) -> EnhancementResult:
        rgb = image.convert("RGB")
        longest = max(rgb.size)
        shortest = min(rgb.size)

        # Only enhance if image is small or blurry
        needs_upscale = shortest < self.NEAR_OUTPUT_EDGE
        detail = self._detail_score(rgb)
        needs_sharpen = detail < self.BLUR_DETAIL_THRESHOLD and longest < 1200

        if not needs_upscale and not needs_sharpen:
            return EnhancementResult(image=rgb, enhanced=False, method="none")

        enhanced = self._fallback_enhance(rgb)
        return EnhancementResult(image=enhanced, enhanced=True, method="Lanczos+Sharpen")

    @staticmethod
    def _fallback_enhance(image: Image.Image) -> Image.Image:
        longest_edge = max(image.size)
        scale = 4 if longest_edge < 400 else 2
        target_longest = min(1600, max(1000, longest_edge * scale))
        factor = target_longest / longest_edge
        target_size = (
            max(1, round(image.width * factor)),
            max(1, round(image.height * factor)),
        )
        enhanced = image.resize(target_size, Image.Resampling.LANCZOS)
        return enhanced.filter(ImageFilter.UnsharpMask(radius=1.0, percent=125, threshold=3))

    @staticmethod
    def _detail_score(image: Image.Image) -> float:
        probe = image.convert("L")
        scale = min(1.0, 512 / max(probe.size))
        if scale < 1.0:
            probe = probe.resize(
                (max(3, round(probe.width * scale)), max(3, round(probe.height * scale))),
                Image.Resampling.BOX,
            )
        pixels = np.asarray(probe, dtype=np.float32)
        if pixels.shape[0] < 3 or pixels.shape[1] < 3:
            return 0.0
        laplacian = (
            -4 * pixels[1:-1, 1:-1]
            + pixels[:-2, 1:-1]
            + pixels[2:, 1:-1]
            + pixels[1:-1, :-2]
            + pixels[1:-1, 2:]
        )
        return float(np.var(laplacian))
