"""FastAPI service for image translation processing."""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import sqlite3
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from config import TMP_DIR, LOGS_DIR, SERVICE_DIR, SUPPORTED_EXTENSIONS, MAX_IMAGES_PER_TASK
from pipeline import ImagePipeline
from oss_client import OSSClient

# Configure logging with rotation
from logging.handlers import RotatingFileHandler

_log_handler = RotatingFileHandler(
    LOGS_DIR / "service.log", maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[_log_handler, logging.StreamHandler()],
    force=True,
)
LOGGER = logging.getLogger("image_translate.service")

# --- SQLite task persistence ---
DB_PATH = SERVICE_DIR / "tasks.db"
_db_lock = threading.Lock()


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            task_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'pending',
            total INTEGER NOT NULL DEFAULT 0,
            done INTEGER NOT NULL DEFAULT 0,
            failed INTEGER NOT NULL DEFAULT 0,
            results TEXT NOT NULL DEFAULT '[]',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    return conn


def _db_save_task(task_id: str, data: dict) -> None:
    with _db_lock:
        conn = _get_db()
        try:
            conn.execute(
                """INSERT OR REPLACE INTO tasks (task_id, status, total, done, failed, results)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (task_id, data["status"], data["total"], data["done"], data["failed"],
                 json.dumps(data.get("results", []), ensure_ascii=False)),
            )
            conn.commit()
        finally:
            conn.close()


def _db_load_task(task_id: str) -> dict | None:
    with _db_lock:
        conn = _get_db()
        try:
            row = conn.execute(
                "SELECT status, total, done, failed, results FROM tasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            return {
                "status": row[0], "total": row[1], "done": row[2],
                "failed": row[3], "results": json.loads(row[4]),
            }
        finally:
            conn.close()


def _db_task_exists(task_id: str) -> bool:
    with _db_lock:
        conn = _get_db()
        try:
            row = conn.execute("SELECT 1 FROM tasks WHERE task_id = ?", (task_id,)).fetchone()
            return row is not None
        finally:
            conn.close()


def _db_recover_stale_tasks() -> int:
    """On startup, mark stale tasks as failed with proper counts, and clean temp dirs."""
    with _db_lock:
        conn = _get_db()
        try:
            # Find all stale tasks
            rows = conn.execute(
                "SELECT task_id, total, done, results FROM tasks WHERE status IN ('pending', 'processing')"
            ).fetchall()
            if not rows:
                return 0
            for task_id, total, done, results_json in rows:
                remaining = total - done
                results = json.loads(results_json) if results_json else []
                results.append({"file": "*", "status": "failed", "error": "服务重启导致任务中断，请重新上传"})
                conn.execute(
                    "UPDATE tasks SET status = 'failed', failed = ?, results = ? WHERE task_id = ?",
                    (remaining, json.dumps(results, ensure_ascii=False), task_id),
                )
                # P1-402: Clean up temp directory for this task
                task_tmp = TMP_DIR / task_id
                if task_tmp.exists():
                    shutil.rmtree(task_tmp, ignore_errors=True)
                    LOGGER.info("Cleaned stale temp dir: %s", task_tmp)
            conn.commit()
            return len(rows)
        finally:
            conn.close()


# Global state
pipeline: ImagePipeline | None = None
oss: OSSClient | None = None
# In-memory cache for active tasks (fast access during processing)
_active_tasks: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline, oss
    LOGGER.info("Starting image translation service...")
    # Recover stale tasks from previous run
    recovered = _db_recover_stale_tasks()
    if recovered:
        LOGGER.info("Recovered %d stale tasks (marked as failed)", recovered)
    pipeline = ImagePipeline()
    oss = OSSClient()
    # Self-heal: ensure OSS lifecycle rule exists
    if oss.available:
        oss.ensure_lifecycle()
    LOGGER.info("Service ready.")
    yield
    LOGGER.info("Shutting down.")


app = FastAPI(title="Image Translation Service", version="2.0.0", lifespan=lifespan)


class ProcessRequest(BaseModel):
    task_id: str
    user_id: str
    images: list[str]  # OSS object keys for input images


class ProcessResponse(BaseModel):
    task_id: str
    status: str
    message: str


class TaskStatus(BaseModel):
    task_id: str
    status: str  # pending, processing, done, failed
    total: int
    done: int
    failed: int
    results: list[dict] = []


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "pipeline_ready": pipeline is not None,
        "oss_available": oss is not None and oss.available,
    }


@app.post("/process", response_model=ProcessResponse)
async def start_process(req: ProcessRequest):
    if pipeline is None:
        raise HTTPException(503, "Pipeline not initialized")
    if not req.images:
        raise HTTPException(400, "No images provided")
    if len(req.images) > MAX_IMAGES_PER_TASK:
        raise HTTPException(400, f"Max {MAX_IMAGES_PER_TASK} images per task")
    if _db_task_exists(req.task_id):
        raise HTTPException(409, "Task already exists")

    task_data = {
        "status": "pending",
        "total": len(req.images),
        "done": 0,
        "failed": 0,
        "results": [],
    }
    _db_save_task(req.task_id, task_data)
    _active_tasks[req.task_id] = task_data

    # Run processing in background thread to avoid blocking
    asyncio.get_event_loop().run_in_executor(
        None, _process_task, req.task_id, req.user_id, req.images
    )

    return ProcessResponse(
        task_id=req.task_id, status="accepted",
        message=f"Processing {len(req.images)} images",
    )


@app.get("/task/{task_id}", response_model=TaskStatus)
async def get_task_status(task_id: str):
    # Check active (in-memory) first, then DB
    t = _active_tasks.get(task_id)
    if t is None:
        t = _db_load_task(task_id)
    if t is None:
        raise HTTPException(404, "Task not found")
    return TaskStatus(
        task_id=task_id,
        status=t["status"],
        total=t["total"],
        done=t["done"],
        failed=t["failed"],
        results=t.get("results", []),
    )


def _process_task(task_id: str, user_id: str, image_keys: list[str]) -> None:
    """Background worker that processes images for a task."""
    task = _active_tasks[task_id]
    task["status"] = "processing"
    _db_save_task(task_id, task)

    work_dir = TMP_DIR / task_id
    input_dir = work_dir / "input"
    output_dir = work_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Download images from OSS
        local_inputs: list[Path] = []
        for key in image_keys:
            filename = Path(key).name
            local_path = input_dir / filename
            if oss and oss.available:
                try:
                    oss.download_file(key, local_path)
                except Exception as exc:
                    LOGGER.warning("Failed to download %s: %s", key, exc)
                    task["failed"] += 1
                    task["results"].append({"file": filename, "status": "failed", "error": "文件下载失败"})
                    _db_save_task(task_id, task)
                    continue
            else:
                local_path = Path(key)
                if not local_path.is_file():
                    task["failed"] += 1
                    task["results"].append({"file": filename, "status": "failed", "error": "文件未找到"})
                    _db_save_task(task_id, task)
                    continue
            if local_path.suffix.lower() in SUPPORTED_EXTENSIONS:
                local_inputs.append(local_path)

        # Process each image
        for index, src in enumerate(local_inputs, start=1):
            out_path = output_dir / f"{src.stem}.jpg"
            result = pipeline.process_image(src, out_path)

            if result["status"] == "success":
                output_key = ""
                upload_error = ""
                if oss and oss.available and out_path.is_file():
                    output_key = f"image-translate/{user_id}/{task_id}/output/{out_path.name}"
                    try:
                        oss.upload_file(out_path, output_key)
                    except Exception as exc:
                        LOGGER.warning("Failed to upload output %s: %s", out_path.name, exc)
                        upload_error = "结果上传失败，请重试"
                else:
                    upload_error = "结果存储服务不可用"

                if output_key and not upload_error:
                    task["done"] += 1
                    task["results"].append({
                        "file": src.name,
                        "status": "success",
                        "output_key": output_key,
                        "repaired": result.get("repaired_phrases", 0),
                        "brands_removed": result.get("removed_brands", 0),
                        "enhanced": result.get("enhanced", False),
                    })
                else:
                    task["failed"] += 1
                    task["results"].append({
                        "file": src.name,
                        "status": "failed",
                        "error": upload_error or "结果上传失败",
                    })
            else:
                task["failed"] += 1
                task["results"].append({
                    "file": src.name, "status": "failed",
                    "error": result.get("error", "处理失败"),
                })

            # Persist progress after each image
            _db_save_task(task_id, task)
            LOGGER.info("Task %s: %d/%d processed", task_id, index, len(local_inputs))

        task["status"] = "failed" if task["done"] == 0 and task["failed"] > 0 else "done"
        _db_save_task(task_id, task)
        LOGGER.info(
            "Task %s complete: %d done, %d failed",
            task_id, task["done"], task["failed"],
        )
    except Exception as exc:
        LOGGER.exception("Task %s failed", task_id)
        task["status"] = "failed"
        task["results"].append({"file": "*", "status": "failed", "error": "任务处理异常"})
        _db_save_task(task_id, task)
    finally:
        # Cleanup temp files
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass
        # Remove from active cache (stays in DB for history)
        _active_tasks.pop(task_id, None)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8100)
