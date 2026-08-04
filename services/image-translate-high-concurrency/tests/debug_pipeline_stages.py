from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

from ocr_detector import ResidualChineseDetector, box_overlap_ratio
from translator import MalayTranslator


def save_stage(image: Image.Image, output_dir: Path, name: str) -> None:
    image.convert("RGB").save(output_dir / f"{name}.jpg", quality=96, subsampling=0)


def print_hits(label: str, detector: ResidualChineseDetector, image: Image.Image) -> None:
    print(label, [
        {"text": hit.text, "confidence": round(hit.confidence, 4), "box": hit.box}
        for hit in detector.scan(image, minimum_confidence=0.25)
    ])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("vision_cache", type=Path)
    parser.add_argument("case_id")
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    vision = json.loads(args.vision_cache.read_text(encoding="utf-8"))[args.case_id]
    detector = ResidualChineseDetector()
    translator = MalayTranslator()
    with Image.open(args.source) as opened:
        edited = opened.copy().convert("RGB")

    print_hits("source", detector, edited)
    edited, _, handled = detector.apply_vision_replacements(edited, vision, translator)
    save_stage(edited, args.output_dir, "01-vision")
    print_hits("after-vision", detector, edited)

    brand = detector.remove_brands_and_verify(edited)
    edited = brand.image
    save_stage(edited, args.output_dir, "02-brand")
    print_hits("after-brand", detector, edited)

    residuals = [
        hit for hit in detector.scan(edited)
        if any(box_overlap_ratio(hit.box, box) >= 0.35 for box in handled)
    ]
    detector.erase_hits(edited, residuals)
    save_stage(edited, args.output_dir, "03-handled-residual")
    print_hits("after-handled-residual", detector, edited)


if __name__ == "__main__":
    main()
