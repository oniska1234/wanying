from __future__ import annotations

import argparse
import json
from pathlib import Path

from pipeline import ImagePipeline


REFERENCE_VISION = [
    {
        "box": [103, 137, 241, 876],
        "text": "拉长身材比例",
        "translation": "Memanjangkan perkadaran tubuh",
        "orientation": "vertical",
        "color": [180, 180, 180],
        "font_size": 55,
    },
    {
        "box": [216, 136, 361, 754],
        "text": "秀出好身材",
        "translation": "Tonjolkan bentuk badan cantik",
        "orientation": "vertical",
        "color": [180, 180, 180],
        "font_size": 55,
    },
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    pipeline = ImagePipeline()
    pipeline.translator.vision_analyze_image = lambda _, **kwargs: REFERENCE_VISION
    result = pipeline.process_image(args.source, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") != "success":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
