from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from pathlib import Path


def load_pm2_environment(process_id: int) -> None:
    raw = subprocess.check_output(["pm2", "env", str(process_id)], text=True)
    for line in raw.splitlines():
        if ": " not in line:
            continue
        key, value = line.split(": ", 1)
        os.environ.setdefault(key.strip(), value.strip())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pm2-id", type=int)
    parser.add_argument("--source-key", required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    args = parser.parse_args()

    if args.pm2_id is not None:
        load_pm2_environment(args.pm2_id)

    from oss_client import OSSClient
    from pipeline import ImagePipeline

    args.work_dir.mkdir(parents=True, exist_ok=True)
    source = args.work_dir / "source.jpg"
    output = args.work_dir / "output.jpg"
    OSSClient().download_file(args.source_key, source)

    pipeline = ImagePipeline()
    started = time.monotonic()
    result = pipeline.process_image(source, output)
    result["wall_duration_ms"] = round((time.monotonic() - started) * 1000)
    result["output"] = str(output) if output.is_file() else None
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
