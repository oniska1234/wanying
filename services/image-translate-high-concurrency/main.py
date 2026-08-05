"""FastAPI service for durable image translation processing."""
from __future__ import annotations

import gc
import hashlib
import logging
import shutil
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from config import (
    DEFAULT_ESTIMATED_IMAGE_SECONDS,
    LOGS_DIR,
    MAX_ACTIVE_TASKS_PER_USER,
    MAX_IMAGES_PER_TASK,
    MAX_JOB_ATTEMPTS,
    MAX_QUEUED_IMAGES,
    OSS_PREFIX,
    PIPELINE_CACHE_VERSION,
    QUEUE_POLL_SECONDS,
    RETRY_BASE_SECONDS,
    SERVICE_DIR,
    SHUTDOWN_GRACE_SECONDS,
    SUPPORTED_EXTENSIONS,
    TMP_DIR,
    WORKER_COUNT,
)
from oss_client import OSSClient
from pipeline import ImagePipeline
from queue_store import (
    DurableQueue,
    QueueCapacityError,
    QueueItem,
    UserTaskLimitError,
)

from logging.handlers import RotatingFileHandler


_log_handler = RotatingFileHandler(
    LOGS_DIR / "service.log",
    maxBytes=10 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[_log_handler, logging.StreamHandler()],
    force=True,
)
LOGGER = logging.getLogger("image_translate.service")

DB_PATH = SERVICE_DIR / "tasks.db"
queue: DurableQueue | None = None
oss: OSSClient | None = None
_stop_event = threading.Event()
_wake_event = threading.Event()
_workers: list[threading.Thread] = []
_ready_workers: set[int] = set()
_worker_state_lock = threading.Lock()


class ProcessRequest(BaseModel):
    task_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    user_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    images: list[str]


class ProcessResponse(BaseModel):
    task_id: str
    status: str
    message: str


class TaskStatus(BaseModel):
    task_id: str
    status: str
    total: int
    done: int
    failed: int
    results: list[dict] = []
    queue_position: int = 0
    estimated_wait_seconds: int = 0
    duration_ms: int = 0


def _cleanup_stale_temp_dirs() -> int:
    cleaned = 0
    for child in TMP_DIR.iterdir():
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
            cleaned += 1
    return cleaned


def _process_queue_item(worker_id: int, pipeline: ImagePipeline, item: QueueItem) -> None:
    assert queue is not None
    started = time.monotonic()
    work_dir = TMP_DIR / item.task_id / str(item.id)
    input_dir = work_dir / "input"
    output_dir = work_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    local_path = input_dir / item.file_name
    out_path = output_dir / f"{Path(item.file_name).stem}.jpg"

    try:
        if local_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("不支持的图片格式")
        if oss is None or not oss.available:
            raise ConnectionError("结果存储服务不可用")
        try:
            oss.download_file(item.source_key, local_path)
        except Exception as exc:
            raise ConnectionError("文件下载失败") from exc

        source_hash = hashlib.sha256(local_path.read_bytes()).hexdigest()
        output_key = f"{OSS_PREFIX}/{item.user_id}/{item.task_id}/output/{out_path.name}"
        cached = queue.load_cached_result(source_hash, PIPELINE_CACHE_VERSION)
        if cached:
            try:
                oss.copy_object(cached["output_key"], output_key)
                duration_ms = round((time.monotonic() - started) * 1000)
                cached_result = {
                    **cached["result"],
                    "output_key": output_key,
                    "cache_hit": True,
                    "attempts": item.attempts,
                    "duration_ms": duration_ms,
                }
                queue.complete_item(item, cached_result, duration_ms=duration_ms)
                LOGGER.info(
                    "Worker %d completed cached item %d task %s in %dms",
                    worker_id,
                    item.id,
                    item.task_id,
                    duration_ms,
                )
                return
            except Exception as exc:
                LOGGER.warning(
                    "Cached result unavailable for item %d, processing normally: %s",
                    item.id,
                    exc,
                )

        result = pipeline.process_image(local_path, out_path)
        if result.get("status") != "success":
            retryable = bool(result.get("retryable", False))
            duration_ms = round((time.monotonic() - started) * 1000)
            requeued = queue.fail_or_retry_item(
                item,
                str(result.get("error", "图片处理失败")),
                retryable=retryable,
                max_attempts=MAX_JOB_ATTEMPTS,
                retry_base_seconds=RETRY_BASE_SECONDS,
                duration_ms=duration_ms,
                details={
                    "quality_score": result.get("quality_score", 0.0),
                    "quality_reasons": result.get("quality_reasons", []),
                    "quality_details": result.get("quality_details", {}),
                    "stage_durations_ms": result.get("stage_durations_ms", {}),
                },
            )
            LOGGER.warning(
                "Worker %d item %d %s: %s",
                worker_id,
                item.id,
                "requeued" if requeued else "failed",
                result.get("error", "图片处理失败"),
            )
            return

        try:
            oss.upload_file(out_path, output_key)
        except Exception as exc:
            raise ConnectionError("结果上传失败，请重试") from exc

        duration_ms = round((time.monotonic() - started) * 1000)
        result_payload = {
            "output_key": output_key,
            "repaired": result.get("repaired_phrases", 0),
            "brands_removed": result.get("removed_brands", 0),
            "enhanced": result.get("enhanced", False),
            "quality_score": result.get("quality_score", 1.0),
            "needs_review": result.get("needs_review", False),
            "quality_reasons": result.get("quality_reasons", []),
            "quality_details": result.get("quality_details", {}),
            "review_message": result.get("review_message"),
            "stage_durations_ms": result.get("stage_durations_ms", {}),
            "cache_hit": False,
            "attempts": item.attempts,
            "duration_ms": duration_ms,
        }
        queue.complete_item(item, result_payload, duration_ms=duration_ms)
        try:
            queue.store_cached_result(
                source_hash,
                PIPELINE_CACHE_VERSION,
                output_key,
                result_payload,
            )
        except Exception:
            LOGGER.exception("Failed to store result cache for item %d", item.id)
        LOGGER.info(
            "Worker %d completed item %d task %s in %dms",
            worker_id,
            item.id,
            item.task_id,
            duration_ms,
        )
    except ValueError as exc:
        duration_ms = round((time.monotonic() - started) * 1000)
        queue.fail_or_retry_item(
            item,
            str(exc),
            retryable=False,
            max_attempts=MAX_JOB_ATTEMPTS,
            retry_base_seconds=RETRY_BASE_SECONDS,
            duration_ms=duration_ms,
        )
    except ConnectionError as exc:
        duration_ms = round((time.monotonic() - started) * 1000)
        requeued = queue.fail_or_retry_item(
            item,
            str(exc),
            retryable=True,
            max_attempts=MAX_JOB_ATTEMPTS,
            retry_base_seconds=RETRY_BASE_SECONDS,
            duration_ms=duration_ms,
        )
        LOGGER.warning(
            "Worker %d storage error for item %d (%s): %s",
            worker_id,
            item.id,
            "requeued" if requeued else "failed",
            exc,
        )
    except Exception as exc:
        duration_ms = round((time.monotonic() - started) * 1000)
        LOGGER.exception("Worker %d unexpected failure for item %d", worker_id, item.id)
        queue.fail_or_retry_item(
            item,
            "任务处理异常",
            retryable=True,
            max_attempts=MAX_JOB_ATTEMPTS,
            retry_base_seconds=RETRY_BASE_SECONDS,
            duration_ms=duration_ms,
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        try:
            work_dir.parent.rmdir()
        except OSError:
            pass


def _worker_loop(worker_id: int) -> None:
    try:
        pipeline = ImagePipeline()
    except Exception:
        LOGGER.exception("Worker %d failed to initialize pipeline", worker_id)
        return
    with _worker_state_lock:
        _ready_workers.add(worker_id)
    LOGGER.info("Worker %d ready", worker_id)
    processed = 0
    try:
        while not _stop_event.is_set():
            assert queue is not None
            item = queue.claim_next_item()
            if item is None:
                _wake_event.wait(QUEUE_POLL_SECONDS)
                _wake_event.clear()
                continue
            _process_queue_item(worker_id, pipeline, item)
            processed += 1
            if processed % 5 == 0:
                gc.collect()
    finally:
        with _worker_state_lock:
            _ready_workers.discard(worker_id)
        LOGGER.info("Worker %d stopped", worker_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    global queue, oss
    LOGGER.info("Starting durable image translation service...")
    _stop_event.clear()
    _wake_event.clear()
    queue = DurableQueue(DB_PATH)
    interrupted, legacy = queue.recover_stale_work()
    cleaned = _cleanup_stale_temp_dirs()
    if interrupted or legacy or cleaned:
        LOGGER.info(
            "Startup recovery: requeued=%d legacy_failed=%d temp_dirs=%d",
            interrupted,
            legacy,
            cleaned,
        )
    oss = OSSClient()
    if oss.available:
        oss.ensure_lifecycle()
    _workers.clear()
    for worker_id in range(WORKER_COUNT):
        worker = threading.Thread(
            target=_worker_loop,
            args=(worker_id,),
            name=f"image-translate-worker-{worker_id}",
            daemon=True,
        )
        worker.start()
        _workers.append(worker)
    LOGGER.info("Service accepting jobs with %d worker(s)", WORKER_COUNT)
    yield
    LOGGER.info("Stopping image translation workers...")
    _stop_event.set()
    _wake_event.set()
    deadline = time.monotonic() + SHUTDOWN_GRACE_SECONDS
    for worker in _workers:
        remaining = max(0.0, deadline - time.monotonic())
        worker.join(timeout=remaining)
    alive = sum(worker.is_alive() for worker in _workers)
    if alive:
        LOGGER.warning("%d worker(s) still active; jobs will resume on restart", alive)
    else:
        LOGGER.info("All workers stopped cleanly")


app = FastAPI(title="Image Translation Service", version="3.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    metrics = queue.metrics() if queue else {"queue_depth": 0, "processing": 0}
    with _worker_state_lock:
        ready_workers = len(_ready_workers)
    worker_ready = queue is not None and ready_workers > 0
    storage_ready = oss is not None and oss.available
    return {
        "status": "ok" if worker_ready and storage_ready else (
            "degraded" if worker_ready else "starting"
        ),
        "pipeline_ready": worker_ready,
        "workers_ready": ready_workers,
        "workers_configured": WORKER_COUNT,
        "queue_depth": metrics["queue_depth"],
        "processing": metrics["processing"],
        "oss_available": storage_ready,
    }


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    if queue is None:
        raise HTTPException(503, "Queue not initialized")
    snapshot = queue.metrics()
    lines = [
        "# HELP image_translate_queue_depth Images waiting for a worker.",
        "# TYPE image_translate_queue_depth gauge",
        f"image_translate_queue_depth {snapshot['queue_depth']}",
        "# HELP image_translate_processing Images currently processing.",
        "# TYPE image_translate_processing gauge",
        f"image_translate_processing {snapshot['processing']}",
        "# HELP image_translate_retries_total Retried image attempts.",
        "# TYPE image_translate_retries_total counter",
        f"image_translate_retries_total {snapshot['retries']}",
        "# HELP image_translate_duration_ms Average successful image duration.",
        "# TYPE image_translate_duration_ms gauge",
        f"image_translate_duration_ms {snapshot['average_duration_ms']}",
        "# HELP image_translate_duration_p95_ms P95 successful image duration over the latest 1000 images.",
        "# TYPE image_translate_duration_p95_ms gauge",
        f"image_translate_duration_p95_ms {snapshot['p95_duration_ms']}",
        "# HELP image_translate_failed_items_total Terminally failed images.",
        "# TYPE image_translate_failed_items_total gauge",
        f"image_translate_failed_items_total {snapshot['failed_items']}",
        "# HELP image_translate_review_items_total Successful outputs requiring manual review.",
        "# TYPE image_translate_review_items_total gauge",
        f"image_translate_review_items_total {snapshot['review_items']}",
        "# HELP image_translate_cache_hits_total Images served from the result cache.",
        "# TYPE image_translate_cache_hits_total counter",
        f"image_translate_cache_hits_total {snapshot.get('cache_hits', 0)}",
        "# HELP image_translate_oldest_pending_seconds Age of the oldest queued image.",
        "# TYPE image_translate_oldest_pending_seconds gauge",
        f"image_translate_oldest_pending_seconds {snapshot['oldest_pending_seconds']}",
        "# HELP image_translate_failed_items_by_reason Terminal failures grouped by quality reason.",
        "# TYPE image_translate_failed_items_by_reason gauge",
    ]
    for reason, count in sorted(snapshot["failure_reasons"].items()):
        safe_reason = str(reason).replace("\\", "_").replace('"', "_")
        lines.append(
            f'image_translate_failed_items_by_reason{{reason="{safe_reason}"}} {count}'
        )
    lines.extend([
        "# HELP image_translate_stage_duration_ms Average pipeline stage duration.",
        "# TYPE image_translate_stage_duration_ms gauge",
    ])
    for stage, duration in sorted(snapshot.get("stage_average_ms", {}).items()):
        safe_stage = str(stage).replace("\\", "_").replace('"', "_")
        lines.append(
            f'image_translate_stage_duration_ms{{stage="{safe_stage}"}} {duration}'
        )
    return "\n".join(lines) + "\n"


@app.post("/process", response_model=ProcessResponse)
async def start_process(req: ProcessRequest):
    if queue is None:
        raise HTTPException(503, "Queue not initialized")
    with _worker_state_lock:
        if not _ready_workers:
            raise HTTPException(503, "No processing worker is ready")
    if oss is None or not oss.available:
        raise HTTPException(503, "Result storage is not available")
    if not req.images:
        raise HTTPException(400, "No images provided")
    if len(req.images) > MAX_IMAGES_PER_TASK:
        raise HTTPException(400, f"Max {MAX_IMAGES_PER_TASK} images per task")
    required_prefix = f"{OSS_PREFIX}/{req.user_id}/{req.task_id}/input/"
    if any(not key.startswith(required_prefix) for key in req.images):
        raise HTTPException(400, "Image key does not belong to this task")
    try:
        queue.enqueue_task(
            req.task_id,
            req.user_id,
            req.images,
            max_queued_images=MAX_QUEUED_IMAGES,
            max_active_tasks_per_user=MAX_ACTIVE_TASKS_PER_USER,
        )
    except ValueError:
        raise HTTPException(409, "Task already exists") from None
    except UserTaskLimitError:
        raise HTTPException(429, "Too many active tasks for this user") from None
    except QueueCapacityError:
        raise HTTPException(503, "Processing queue is full") from None
    _wake_event.set()
    return ProcessResponse(
        task_id=req.task_id,
        status="accepted",
        message=f"Queued {len(req.images)} images",
    )


@app.get("/task/{task_id}", response_model=TaskStatus)
async def get_task_status(task_id: str):
    if queue is None:
        raise HTTPException(503, "Queue not initialized")
    task = queue.load_task(task_id)
    if task is None:
        raise HTTPException(404, "Task not found")
    snapshot = queue.metrics()
    average_seconds = (
        snapshot["average_duration_ms"] / 1000
        if snapshot["average_duration_ms"] > 0
        else DEFAULT_ESTIMATED_IMAGE_SECONDS
    )
    return TaskStatus(
        task_id=task_id,
        status=task["status"],
        total=task["total"],
        done=task["done"],
        failed=task["failed"],
        results=task["results"],
        duration_ms=task["duration_ms"],
        queue_position=task["queue_position"],
        estimated_wait_seconds=round(
            (
                snapshot["processing"]
                + max(0, task["queue_position"] - 1)
            ) * average_seconds / max(1, WORKER_COUNT)
        ),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8100)
