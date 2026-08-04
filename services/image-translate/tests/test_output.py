from pathlib import Path
import sys
import unittest

from PIL import Image

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from pipeline import fit_to_output_canvas


class OutputCanvasTests(unittest.TestCase):
    def test_is_exact_and_preserves_portrait_aspect_ratio(self):
        source = Image.new("RGB", (400, 800), (240, 242, 244))
        for y in range(1, 799):
            for x in range(400):
                source.putpixel((x, y), (100, 120, 140))

        result = fit_to_output_canvas(source, (800, 800))

        self.assertEqual(result.size, (800, 800))
        self.assertNotEqual(result.getpixel((199, 400)), (100, 120, 140))
        self.assertEqual(result.getpixel((200, 400)), (100, 120, 140))
        self.assertEqual(result.getpixel((599, 400)), (100, 120, 140))
        self.assertNotEqual(result.getpixel((600, 400)), (100, 120, 140))

    def test_is_exact_and_preserves_landscape_aspect_ratio(self):
        source = Image.new("RGB", (1600, 800), (232, 235, 239))

        result = fit_to_output_canvas(source, (800, 800))

        self.assertEqual(result.size, (800, 800))
        self.assertEqual(result.getpixel((400, 0)), (232, 235, 239))
        self.assertEqual(result.getpixel((400, 200)), (232, 235, 239))
