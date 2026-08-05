from __future__ import annotations

import argparse
import os

from benchmark_single import load_pm2_environment


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pm2-id", type=int, required=True)
    parser.add_argument("--port", type=int, default=8120)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()

    load_pm2_environment(args.pm2_id)
    os.environ["IMAGE_TRANSLATE_WORKERS"] = str(args.workers)

    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
