from __future__ import annotations

import unittest

import numpy as np
from PIL import Image

from ocr_detector import (
    ChineseHit,
    ResidualChineseDetector,
    box_overlap_ratio,
    is_box_handled,
    is_actionable_chinese_hit,
    render_text_with_layout,
    TextLayout,
    _contrast_ratio,
    _deduplicate_anchored_tasks,
    _ensure_readable_color,
    _infer_vision_coordinate_scale,
    _match_multiline_ocr_hints,
    _render_rotated,
    _render_stacked_vertical_words,
    _merge_overlapping_horizontal_tasks,
)
from config import FONT_REG
from translator import MalayTranslator
from layout_planner import plan_vertical_columns
from quality_gate import assess_layout_diagnostics
from pipeline import is_small_product_label_hit
from brand_removal import BrandPolicy


class RegionDeduplicationTests(unittest.TestCase):
    def test_repair_can_reuse_initial_ocr_without_rescanning(self) -> None:
        hit = ChineseHit(
            text="产品信息", confidence=0.99, box=(10, 10, 110, 40),
            polygon=((10, 10), (110, 10), (110, 40), (10, 40)),
        )
        detector = object.__new__(ResidualChineseDetector)
        scan_calls = []
        detector.scan = lambda *_args, **_kwargs: scan_calls.append(True) or ()
        detector._batch_translate_hits = (
            lambda hits, _translator, **_kwargs: [(hits[0], "Maklumat Produk")]
        )
        detector._apply_replacements = lambda *_args, **_kwargs: None

        result = detector.repair_and_verify(
            Image.new("RGB", (200, 100), "white"),
            allow_repair=True,
            initial_hits=(hit,),
            max_repair_passes=1,
            verify_after_repair=False,
        )

        self.assertEqual(scan_calls, [])
        self.assertEqual(result.repaired, (hit,))
        self.assertEqual(result.remaining, ())

    def test_vision_render_reuses_supplied_ocr_hints(self) -> None:
        detector = object.__new__(ResidualChineseDetector)
        detector._brand_policy = BrandPolicy()
        detector.scan = lambda *_args, **_kwargs: self.fail("unexpected OCR scan")

        image, count, handled = detector.apply_vision_replacements(
            Image.new("RGB", (200, 100), "white"),
            [],
            MalayTranslator(),
            ocr_hints=(),
        )

        self.assertEqual(image.size, (200, 100))
        self.assertEqual(count, 0)
        self.assertEqual(handled, ())

    def test_compact_chinese_in_product_area_requires_review(self) -> None:
        hit = ChineseHit(
            text="烟花水", confidence=0.99, box=(120, 450, 180, 480),
            polygon=((120, 450), (180, 450), (180, 480), (120, 480)),
        )
        self.assertTrue(is_small_product_label_hit(hit, (800, 800)))

    def test_large_headline_is_not_a_small_product_label(self) -> None:
        hit = ChineseHit(
            text="特色手柄设计", confidence=0.99, box=(80, 80, 720, 180),
            polygon=((80, 80), (720, 80), (720, 180), (80, 180)),
        )
        self.assertFalse(is_small_product_label_hit(hit, (800, 800)))

    def test_overlap_uses_smaller_region_as_denominator(self) -> None:
        self.assertEqual(box_overlap_ratio((10, 10, 20, 20), (0, 0, 30, 30)), 1.0)

    def test_handled_region_rejects_repeat_ocr_box(self) -> None:
        self.assertTrue(is_box_handled((12, 20, 36, 80), ((10, 10, 40, 90),)))
        self.assertFalse(is_box_handled((100, 100, 130, 130), ((10, 10, 40, 90),)))

    def test_low_confidence_single_glyph_texture_is_not_actionable(self) -> None:
        hit = ChineseHit(
            text="喜", confidence=0.59, box=(10, 10, 50, 50),
            polygon=((10, 10), (50, 10), (50, 50), (10, 50)),
        )
        self.assertFalse(is_actionable_chinese_hit(hit))

    def test_multiline_vision_paragraph_anchors_to_all_ocr_lines(self) -> None:
        first = ChineseHit(
            text="首次使用前用清水冲洗揉搓搓澡绵",
            confidence=0.98,
            box=(1410, 298, 2992, 403),
            polygon=((1410, 298), (2992, 298), (2992, 403), (1410, 403)),
        )
        second = ChineseHit(
            text="洗净海绵内的保湿剂",
            confidence=0.98,
            box=(1404, 440, 2700, 545),
            polygon=((1404, 440), (2700, 440), (2700, 545), (1404, 545)),
        )
        unrelated = ChineseHit(
            text="用前须知",
            confidence=0.99,
            box=(350, 306, 1217, 527),
            polygon=((350, 306), (1217, 306), (1217, 527), (350, 527)),
        )
        matches = _match_multiline_ocr_hints(
            "首次使用前用清水冲洗揉搓搓澡绵，洗净海绵内的保湿剂！",
            (first, second, unrelated),
        )
        self.assertEqual(matches, [first, second])

    def test_internal_vision_canvas_is_scaled_for_large_source(self) -> None:
        scale = _infer_vision_coordinate_scale(
            [{"box": [540, 67, 1289, 271]}, {"box": [540, 679, 1289, 883]}],
            (3160, 2400),
        )
        self.assertAlmostEqual(scale, 3160 / 1289, places=3)

    def test_duplicate_anchor_keeps_text_match_over_spatial_fallback(self) -> None:
        text_task = {
            "source_box": (100, 100, 400, 220),
            "source_text": "正确标题",
            "translation": "Tajuk",
            "anchor_method": "text",
        }
        spatial_task = {
            "source_box": (105, 102, 395, 218),
            "source_text": "另一段正文",
            "translation": "Perenggan",
            "anchor_method": "spatial",
        }
        self.assertEqual(
            _deduplicate_anchored_tasks([spatial_task, text_task]),
            [text_task],
        )


class TranslationQualityTests(unittest.TestCase):
    def test_batch_keeps_curated_terms_when_qwen_is_unavailable(self) -> None:
        translator = MalayTranslator()
        translator.qwen_disabled = True
        self.assertEqual(
            translator.translate_batch(["产品信息"]),
            {"产品信息": "MAKLUMAT PRODUK"},
        )

    def test_ocr_batch_miss_does_not_start_serial_translation(self) -> None:
        hit = ChineseHit(
            text="神奇新品组合", confidence=0.99, box=(10, 10, 180, 50),
            polygon=((10, 10), (180, 10), (180, 50), (10, 50)),
        )

        class StubTranslator:
            @staticmethod
            def translate_batch(_texts: list[str]) -> dict[str, str]:
                return {}

            @staticmethod
            def translate(_text: str) -> str:
                raise AssertionError("unexpected serial translation fallback")

        detector = object.__new__(ResidualChineseDetector)
        detector._brand_policy = BrandPolicy()
        replacements = detector._batch_translate_hits(
            (hit,), StubTranslator(), image_size=(800, 800),
        )
        self.assertEqual(replacements, [])

    def test_failed_batch_does_not_fan_out_into_serial_qwen_calls(self) -> None:
        translator = MalayTranslator()
        translator.qwen_disabled = False
        translator._translate_qwen_batch = lambda _text: None
        translator._translate_qwen = lambda _text: self.fail(
            "unexpected per-region Qwen fallback"
        )

        self.assertEqual(translator.translate_batch(["新款玩具", "产品尺寸"]), {})

    def test_high_confidence_short_product_label_is_translated(self) -> None:
        class StubTranslator:
            @staticmethod
            def translate_batch(texts: list[str]) -> dict[str, str]:
                return {text: "Pistol air bunga api" for text in texts}

            @staticmethod
            def translate(text: str) -> str:
                del text
                return "Pistol air bunga api"

        detector = ResidualChineseDetector.__new__(ResidualChineseDetector)
        detector._brand_policy = BrandPolicy()
        hit = ChineseHit(
            text="烟花水", confidence=0.99, box=(120, 450, 180, 480),
            polygon=((120, 450), (180, 450), (180, 480), (120, 480)),
        )
        replacements = detector._batch_translate_hits(
            (hit,), StubTranslator(), image_size=(800, 800),
        )
        self.assertEqual(replacements, [(hit, "Pistol air bunga api")])

    def test_low_confidence_short_central_fragment_stays_deferred(self) -> None:
        detector = ResidualChineseDetector.__new__(ResidualChineseDetector)
        detector._brand_policy = BrandPolicy()
        hit = ChineseHit(
            text="烟花水", confidence=0.75, box=(120, 450, 180, 480),
            polygon=((120, 450), (180, 450), (180, 480), (120, 480)),
        )
        replacements = detector._batch_translate_hits(
            (hit,), None, image_size=(800, 800),
        )
        self.assertEqual(replacements, [])

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

    def test_common_squishy_copy_uses_curated_malay_term(self) -> None:
        translator = MalayTranslator()
        result = translator.validate_vision_translation(
            "黄油条捏捏乐",
            "Mainan Kikis Mentega",
        )
        self.assertEqual(result, "Mainan picit berbentuk mentega")

    def test_long_vision_paragraph_is_kept_for_large_poster_cell(self) -> None:
        translator = MalayTranslator()
        result = translator.validate_vision_translation(
            "搓泥神器的效果因人各异，经常沐浴者皮肤清洁度高，污垢量自然会少！",
            "Keberkesanan alat mengeluarkan kotoran berbeza mengikut individu; "
            "mereka yang kerap mandi mempunyai kulit lebih bersih, jadi kotoran "
            "yang terhasil secara semula jadi lebih sedikit.",
        )
        self.assertIsNotNone(result)


class RenderingAndInpaintTests(unittest.TestCase):
    def test_low_contrast_pastel_text_is_darkened_for_small_badge(self) -> None:
        image = Image.new("RGB", (300, 100), (180, 230, 235))
        original = (100, 195, 200)
        adjusted = _ensure_readable_color(
            image, (20, 20, 280, 80), original, minimum_ratio=2.5,
        )
        self.assertGreater(_contrast_ratio(adjusted, (180, 230, 235)), 2.49)
        self.assertLess(sum(adjusted), sum(original))

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

    def test_smooth_gradient_cleanup_does_not_leave_outlined_glyphs(self) -> None:
        yy, xx = np.mgrid[0:140, 0:240]
        pixels = np.empty((140, 240, 3), dtype=np.uint8)
        pixels[:, :, 0] = 150 + xx // 8
        pixels[:, :, 1] = 205 + yy // 12
        pixels[:, :, 2] = 225
        pixels[45:95, 65:175] = (245, 245, 245)
        pixels[55:85, 78:162] = (80, 110, 160)
        image = Image.fromarray(pixels)
        hit = ChineseHit(
            text="测试",
            confidence=0.99,
            box=(60, 40, 180, 100),
            polygon=((60, 40), (180, 40), (180, 100), (60, 100)),
        )
        detector = ResidualChineseDetector.__new__(ResidualChineseDetector)
        detector.erase_hits(image, [hit])
        cleaned = np.asarray(image)[45:95, 65:175]
        self.assertLess(float(np.mean(cleaned[:, :, 0] > 235)), 0.02)
        self.assertLess(float(np.std(cleaned[:, :, 0])), 12.0)

    def test_flat_poster_cleanup_removes_stylized_foreground_pixels(self) -> None:
        pixels = np.full((400, 600, 3), (90, 190, 220), dtype=np.uint8)
        for left in range(110, 490, 45):
            pixels[70:170, left:left + 18] = (245, 245, 245)
        image = Image.fromarray(pixels)
        applied, dominance, selected = ResidualChineseDetector._inpaint_flat_poster_text(
            image, (100, 60, 500, 180),
        )
        self.assertTrue(applied)
        self.assertGreater(dominance, 0.5)
        self.assertGreater(selected, 0.1)
        remaining_white = np.mean(np.asarray(image)[60:180, 100:500, 0] > 235)
        self.assertLess(remaining_white, 0.1)

    def test_flat_poster_cleanup_removes_outline_outside_ocr_box(self) -> None:
        pixels = np.full((400, 600, 3), (90, 190, 220), dtype=np.uint8)
        pixels[58:182, 110:490] = (245, 245, 245)
        pixels[68:172, 120:480] = (120, 70, 160)
        image = Image.fromarray(pixels)
        applied, _, _ = ResidualChineseDetector._inpaint_flat_poster_text(
            image, (100, 60, 500, 180),
        )
        self.assertTrue(applied)
        remaining_outline = np.mean(np.asarray(image)[58:182, 110:490, 0] > 235)
        self.assertLess(remaining_outline, 0.02)

    def test_flat_poster_cleanup_accepts_dense_outlined_headline(self) -> None:
        pixels = np.full((400, 600, 3), (90, 190, 220), dtype=np.uint8)
        # Dense outlined glyph artwork covers roughly two thirds of the OCR
        # rectangle, while its surrounding ring remains a proven flat colour.
        pixels[70:170, 120:480] = (245, 245, 245)
        pixels[82:158, 140:460] = (120, 70, 160)
        image = Image.fromarray(pixels)
        applied, dominance, selected = ResidualChineseDetector._inpaint_flat_poster_text(
            image, (100, 60, 500, 180),
        )
        self.assertTrue(applied)
        self.assertGreater(dominance, 0.5)
        self.assertGreater(selected, 0.58)
        remaining_foreground = np.mean(
            np.linalg.norm(
                np.asarray(image)[60:180, 100:500].astype(float)
                - np.array((90, 190, 220), dtype=float),
                axis=2,
            ) > 25
        )
        self.assertLess(remaining_foreground, 0.1)

    def test_flat_poster_cleanup_accepts_region_already_cleaned(self) -> None:
        image = Image.new("RGB", (600, 400), (90, 190, 220))
        applied, dominance, selected = ResidualChineseDetector._inpaint_flat_poster_text(
            image, (100, 60, 500, 180),
        )
        self.assertTrue(applied)
        self.assertGreater(dominance, 0.5)
        self.assertLess(selected, 0.015)

    def test_flat_poster_cleanup_accepts_nearly_full_outlined_subtitle(self) -> None:
        pixels = np.full((400, 600, 3), (90, 190, 220), dtype=np.uint8)
        pixels[62:178, 104:496] = (245, 245, 245)
        image = Image.fromarray(pixels)
        applied, dominance, selected = ResidualChineseDetector._inpaint_flat_poster_text(
            image, (100, 60, 500, 180),
        )
        self.assertTrue(applied)
        self.assertGreater(dominance, 0.5)
        self.assertGreater(selected, 0.9)

    def test_flat_poster_cleanup_accepts_dense_text_on_smooth_gradient(self) -> None:
        yy, xx = np.mgrid[0:400, 0:600]
        pixels = np.empty((400, 600, 3), dtype=np.uint8)
        pixels[:, :, 0] = 80 + xx // 20
        pixels[:, :, 1] = 170 + yy // 20
        pixels[:, :, 2] = 225
        pixels[60:180, 100:500] = (248, 248, 248)
        pixels[66:174, 106:494] = (45, 115, 175)
        image = Image.fromarray(pixels)
        applied, _, selected = ResidualChineseDetector._inpaint_flat_poster_text(
            image, (100, 60, 500, 180),
        )
        self.assertTrue(applied)
        self.assertGreater(selected, 0.96)

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


class AdaptiveLayoutTests(unittest.TestCase):
    def test_vertical_copy_stays_in_left_safe_area_away_from_subject(self) -> None:
        image = Image.new("RGB", (1000, 1200), (236, 236, 236))
        pixels = np.asarray(image).copy()
        pixels[100:1120, 430:920] = (95, 115, 145)
        image = Image.fromarray(pixels)
        plan = plan_vertical_columns(
            image,
            [(95, 150, 165, 700), (175, 150, 245, 650)],
            ["Memanjangkan perkadaran tubuh", "Tonjolkan bentuk badan cantik"],
        )
        self.assertEqual(len(plan.boxes), 2)
        self.assertLess(plan.boxes[-1][2], 430)
        self.assertLess(plan.foreground_overlap, 0.20)
        self.assertGreater(plan.confidence, 0.40)

    def test_vertical_copy_can_use_right_side_layout(self) -> None:
        image = Image.new("RGB", (1000, 1200), (238, 238, 238))
        pixels = np.asarray(image).copy()
        pixels[100:1120, 80:560] = (105, 120, 145)
        image = Image.fromarray(pixels)
        plan = plan_vertical_columns(
            image,
            [(760, 130, 825, 700), (835, 130, 900, 650)],
            ["Rekaan moden dan elegan", "Selesa dipakai setiap hari"],
        )
        self.assertGreater(plan.boxes[0][0], 560)
        self.assertLess(plan.foreground_overlap, 0.20)

    def test_quality_gate_rejects_foreground_collision(self) -> None:
        quality = assess_layout_diagnostics(
            [{
                "confidence": 0.1,
                "foreground_overlap": 0.45,
                "boxes": [[10, 10, 200, 500]],
            }],
            image_size=(500, 800),
        )
        self.assertTrue(quality.severe)
        self.assertTrue(quality.needs_review)
        self.assertIn("translation_overlaps_foreground", quality.reasons)

    def test_quality_gate_rejects_overlapping_target_regions(self) -> None:
        quality = assess_layout_diagnostics(
            [
                {"confidence": 1.0, "foreground_overlap": 0.0, "boxes": [[10, 10, 210, 160]]},
                {"confidence": 1.0, "foreground_overlap": 0.0, "boxes": [[40, 30, 220, 170]]},
            ],
            image_size=(500, 800),
        )
        self.assertTrue(quality.severe)
        self.assertIn("translated_regions_overlap", quality.reasons)

    def test_quality_gate_reviews_unclean_stylized_source_without_short_circuit(self) -> None:
        quality = assess_layout_diagnostics(
            [{
                "confidence": 1.0,
                "foreground_overlap": 0.0,
                "boxes": [[10, 10, 400, 120]],
                "source_cleanup_required": True,
                "source_cleanup_applied": False,
            }],
            image_size=(500, 800),
        )
        self.assertFalse(quality.severe)
        self.assertTrue(quality.needs_review)
        self.assertLess(quality.score, 1.0)
        self.assertIn("source_cleanup_low_confidence", quality.reasons)

    def test_overlapping_horizontal_regions_are_merged(self) -> None:
        layout = TextLayout(
            angle=0.0,
            font_size=40,
            color=(20, 20, 20),
            is_bold=True,
            box=(20, 20, 260, 120),
            line_count=1,
        )
        tasks = [
            {"box": (20, 20, 260, 120), "translation": "Saiz produk", "layout": layout, "orientation": "horizontal"},
            {"box": (40, 70, 280, 160), "translation": "Berat produk", "layout": layout, "orientation": "horizontal"},
        ]
        merged = _merge_overlapping_horizontal_tasks(tasks, (400, 400))
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["orientation"], "horizontal-merged")
        self.assertIn("\n", merged[0]["translation"])

    def test_overlapping_header_and_body_keep_colours_and_split_boxes(self) -> None:
        header = TextLayout(
            angle=0.0, font_size=36, color=(250, 250, 250), is_bold=True,
            box=(100, 100, 300, 170), line_count=1,
        )
        body = TextLayout(
            angle=0.0, font_size=28, color=(10, 10, 10), is_bold=False,
            box=(100, 150, 320, 230), line_count=1,
        )
        tasks = [
            {"box": header.box, "translation": "Parameter produk", "layout": header, "orientation": "horizontal"},
            {"box": body.box, "translation": "Berat: 20kg", "layout": body, "orientation": "horizontal"},
        ]
        resolved = _merge_overlapping_horizontal_tasks(tasks, (500, 500))
        self.assertEqual(len(resolved), 2)
        self.assertLess(resolved[0]["box"][3], resolved[1]["box"][1])
        self.assertNotEqual(resolved[0]["layout"].color, resolved[1]["layout"].color)

    def test_chinese_business_watermark_is_treated_as_brand(self) -> None:
        policy = BrandPolicy()
        self.assertTrue(policy.is_brand_text(
            "义乌市乐璞电子商务商行（个体工商户）",
            confidence=0.9,
            box=(100, 300, 900, 420),
            image_size=(1000, 1000),
        ))
        self.assertTrue(policy.is_brand_text(
            "体工商户）",
            confidence=0.9,
            box=(600, 450, 900, 520),
            image_size=(1000, 1000),
        ))

    def test_bottom_corner_ai_attribution_is_treated_as_watermark(self) -> None:
        policy = BrandPolicy()
        self.assertTrue(policy.is_brand_text(
            "豆包AI生成", confidence=0.95,
            box=(1586, 1814, 1891, 1886), image_size=(1920, 1920),
        ))
        self.assertFalse(policy.is_brand_text(
            "AI生成创意设计", confidence=0.95,
            box=(300, 300, 1500, 500), image_size=(1920, 1920),
        ))


if __name__ == "__main__":
    unittest.main()
