from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from pipeline import ImagePipeline


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = round((len(ordered) - 1) * percentile)
    return ordered[index]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-dir", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--max-cases", type=int, default=0)
    parser.add_argument("--vision-cache", type=Path)
    parser.add_argument("--case-id", action="append", default=[])
    args = parser.parse_args()

    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    cases = [case for case in inventory if case.get("chinese_regions")]
    if args.case_id:
        wanted = set(args.case_id)
        cases = [case for case in cases if case.get("case_id") in wanted]
    if args.max_cases > 0:
        cases = cases[:args.max_cases]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)

    pipeline = ImagePipeline()
    vision_cache: dict[str, list] = {}
    if args.vision_cache and args.vision_cache.is_file():
        vision_cache = json.loads(args.vision_cache.read_text(encoding="utf-8"))
    if args.vision_cache:
        original_vision_analyze = pipeline.translator.vision_analyze_image

        def cached_vision_analyze(path: Path, **kwargs) -> list:
            case_id = Path(path).stem
            if case_id in vision_cache:
                return vision_cache[case_id]
            result = original_vision_analyze(path, **kwargs)
            vision_cache[case_id] = result
            args.vision_cache.parent.mkdir(parents=True, exist_ok=True)
            args.vision_cache.write_text(
                json.dumps(vision_cache, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return result

        pipeline.translator.vision_analyze_image = cached_vision_analyze
    results: list[dict] = []
    for index, case in enumerate(cases, start=1):
        source = args.corpus_dir / Path(case["path"]).name
        output = args.output_dir / f"{case['case_id']}.jpg"
        started = time.monotonic()
        result = pipeline.process_image(source, output)
        duration = time.monotonic() - started
        record = {
            "case_id": case["case_id"],
            "source": str(source),
            "output": str(output) if output.is_file() else None,
            "source_chinese_regions": len(case["chinese_regions"]),
            "duration_seconds": round(duration, 3),
            "layout_diagnostics": pipeline.detector.last_layout_diagnostics,
            "brand_boxes": [list(box) for box in pipeline.detector.last_brand_boxes],
            "watermark_diagnostics": pipeline.detector.last_watermark_diagnostics,
            "remaining_hits": pipeline.detector.last_remaining_hits,
            **result,
        }
        results.append(record)
        print(
            f"[{index}/{len(cases)}] {case['case_id']}: "
            f"{record.get('status')} {duration:.1f}s",
            flush=True,
        )

    durations = [float(item["duration_seconds"]) for item in results]
    summary = {
        "total": len(results),
        "success": sum(item.get("status") == "success" for item in results),
        "failed": sum(item.get("status") != "success" for item in results),
        "needs_review": sum(bool(item.get("needs_review")) for item in results),
        "mean_seconds": round(statistics.mean(durations), 3) if durations else 0.0,
        "p50_seconds": round(_percentile(durations, 0.50), 3),
        "p95_seconds": round(_percentile(durations, 0.95), 3),
        "results": results,
    }
    args.report.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({key: value for key, value in summary.items() if key != "results"}, ensure_ascii=False))
    if summary["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
