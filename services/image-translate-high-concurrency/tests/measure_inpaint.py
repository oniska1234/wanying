from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from ocr_detector import ResidualChineseDetector


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("images", nargs="+", type=Path)
    args = parser.parse_args()
    detector = ResidualChineseDetector()
    for path in args.images:
        with Image.open(path) as opened:
            image = opened.copy().convert("RGB")
        hits = detector.scan(image, minimum_confidence=0.35)
        before = np.asarray(image).copy()
        detector._inpaint_hits(image, list(hits))
        after = np.asarray(image)
        measurements = []
        for hit in hits:
            x1, y1, x2, y2 = hit.box
            delta = np.max(
                np.abs(
                    after[y1:y2, x1:x2].astype(np.int16)
                    - before[y1:y2, x1:x2].astype(np.int16)
                ),
                axis=2,
            )
            measurements.append({
                "text": hit.text,
                "box": list(hit.box),
                "changed_ratio_8": round(float(np.mean(delta >= 8)), 4),
                "changed_ratio_20": round(float(np.mean(delta >= 20)), 4),
                "mean_delta": round(float(np.mean(delta)), 3),
            })
        print(json.dumps({"case": path.stem, "measurements": measurements}, ensure_ascii=False))


if __name__ == "__main__":
    main()
