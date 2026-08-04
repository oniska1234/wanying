from __future__ import annotations

import unittest

import numpy as np
from PIL import Image

from ocr_detector import (
    ChineseHit,
    ResidualChineseDetector,
    box_overlap_ratio,
    is_box_handled,
    render_text_with_layout,
    TextLayout,
    _render_rotated,
    _render_stacked_vertical_words,
)
from config import FONT_REG
from translator import MalayTranslator


class RegionDeduplicationTests(unittest.TestCase):
    def test_overlap_uses_smaller_region_as_denominator(self) -> None:
        self.assertEqual(box_overlap_ratio((10, 10, 20, 20), (0, 0, 30, 30)), 1.0)

    def test_handled_region_rejects_repeat_ocr_box(self) -> None:
        self.assertTrue(is_box_handled((12, 20, 36, 80), ((10, 10, 40, 90),)))
        self.assertFalse(is_box_handled((100, 100, 130, 130), ((10, 10, 40, 90),)))


class TranslationQualityTests(unittest.TestCase):
    def test_known_copy_overrides_long_vision_translation(self) -> None:
        translator = MalayTranslator()
        result = translator.validate_vision_translation(
            "拉长身材比例",
            "MEMANJANGKAN PERKADARAN TUBUH",
        )
        self.assertEqual(result, "Memanjangkan perkadaran tubuh")

    def test_valid_vision_translation_is_polished(self) -> None:
        translator = MalayTranslator()
        result = translator.validate_vision_translation("测试文案", "  Kualiti   tinggi. ")
        self.assertEqual(result, "Kualiti tinggi")


class RenderingAndInpaintTests(unittest.TestCase):
    def test_horizontal_renderer_wraps_long_copy(self) -> None:
        image = Image.new("RGB", (320, 180), (235, 235, 235))
        layout = TextLayout(
            angle=0.0,
            font_size=54,
            color=(80, 80, 80),
            is_bold=True,
            box=(20, 20, 300, 160),
            line_count=2,
        )
        render_text_with_layout(
            image,
            layout.box,
            "EFEK KAKI LEBIH PANJANG",
            layout,
        )
        pixels = np.asarray(image)
        self.assertGreater(np.count_nonzero(pixels[:, :, 0] < 180), 100)

    def test_inpaint_does_not_replace_entire_padded_rectangle(self) -> None:
        pixels = np.full((140, 180, 3), 232, dtype=np.uint8)
        # Faint background watermark must survive outside the glyph strokes.
        pixels[20:120:12, :, :] = 220
        pixels[45:95, 70:78, :] = 90
        image = Image.fromarray(pixels)
        before = np.asarray(image).copy()
        hit = ChineseHit(
            text="测",
            confidence=0.99,
            box=(65, 40, 85, 100),
            polygon=((65, 40), (85, 40), (85, 100), (65, 100)),
        )
        detector = ResidualChineseDetector.__new__(ResidualChineseDetector)
        detector.erase_hits(image, [hit])
        after = np.asarray(image)
        # A watermark row away from the dark glyph stays nearly unchanged.
        delta = np.abs(after[32, 55:95].astype(int) - before[32, 55:95].astype(int))
        self.assertLess(float(delta.mean()), 3.0)

    def test_stacked_vertical_words_remain_upright_and_separated(self) -> None:
        image = Image.new("RGB", (240, 500), (235, 235, 235))
        layout = TextLayout(
            angle=0.0,
            font_size=52,
            color=(100, 100, 100),
            is_bold=True,
            box=(10, 10, 230, 490),
            line_count=3,
        )
        _render_stacked_vertical_words(
            image,
            layout.box,
            "KAKI TAMPAK PANJANG",
            layout,
        )
        dark_rows = np.where(np.any(np.asarray(image)[:, :, 0] < 180, axis=1))[0]
        self.assertGreater(len(dark_rows), 20)
        self.assertGreater(int(dark_rows.max() - dark_rows.min()), 250)

    def test_preserved_vertical_copy_is_one_continuous_rotated_line(self) -> None:
        image = Image.new("RGB", (220, 700), (235, 235, 235))
        _render_rotated(
            image,
            (20, 20, 200, 680),
            "Memanjangkan perkadaran tubuh",
            (100, 100, 100),
            90.0,
            52,
            str(FONT_REG),
        )
        points = np.argwhere(np.asarray(image)[:, :, 0] < 180)
        self.assertGreater(len(points), 100)
        vertical_span = int(points[:, 0].max() - points[:, 0].min())
        horizontal_span = int(points[:, 1].max() - points[:, 1].min())
        self.assertGreater(vertical_span, 350)
        self.assertLess(horizontal_span, 80)


if __name__ == "__main__":
    unittest.main()
