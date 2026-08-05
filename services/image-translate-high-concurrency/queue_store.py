"""SQLite-backed durable, fair work queue for image translation."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class QueueItem:
    id: int
    task_id: str
    user_id: str
    ordinal: int
    source_key: str
    file_name: str
    attempts: int


class QueueCapacityError(RuntimeError):
    pass


class UserTaskLimitError(RuntimeError):
    pass


class DurableQueue:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._write_lock = threading.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.db_path), timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=15000")
        return connection

    @staticmethod
    def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
        return {
            str(row[1])
            for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
        }

    def _initialize(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._write_lock, self._connect() as connection:
            connection.execute("""
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
            migrations = {
                "user_id": "TEXT NOT NULL DEFAULT ''",
                "updated_at": "REAL",
                "started_at": "REAL",
                "completed_at": "REAL",
                "last_dispatched_at": "REAL",
            }
            columns = self._columns(connection, "tasks")
            for name, declaration in migrations.items():
                if name not in columns:
                    connection.execute(
                        f"ALTER TABLE tasks ADD COLUMN {name} {declaration}"
                    )
            connection.execute("""
                CREATE TABLE IF NOT EXISTS queue_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL,
                    ordinal INTEGER NOT NULL,
                    source_key TEXT NOT NULL,
                    file_name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    enqueued_at REAL NOT NULL DEFAULT 0,
                    available_at REAL NOT NULL DEFAULT 0,
                    started_at REAL,
                    completed_at REAL,
                    duration_ms INTEGER,
                    last_error TEXT,
                    result TEXT NOT NULL DEFAULT '{}',
                    UNIQUE(task_id, ordinal),
                    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
                )
            """)
            connection.execute(
                "CREATE INDEX IF NOT EXISTS queue_items_ready "
                "ON queue_items(status, available_at, task_id, ordinal)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS tasks_user_status "
                "ON tasks(user_id, status, created_at)"
            )
            connection.execute("""
                CREATE TABLE IF NOT EXISTS result_cache (
                    source_hash TEXT NOT NULL,
                    pipeline_version TEXT NOT NULL,
                    output_key TEXT NOT NULL,
                    result TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    PRIMARY KEY(source_hash, pipeline_version)
                )
            """)
            connection.execute(
                "CREATE INDEX IF NOT EXISTS result_cache_updated "
                "ON result_cache(updated_at)"
            )
            now = time.time()
            queue_columns = self._columns(connection, "queue_items")
            if "enqueued_at" not in queue_columns:
                connection.execute(
                    "ALTER TABLE queue_items ADD COLUMN "
                    "enqueued_at REAL NOT NULL DEFAULT 0"
                )
            connection.execute(
                "UPDATE queue_items SET enqueued_at = ? WHERE enqueued_at = 0",
                (now,),
            )
            connection.execute(
                "UPDATE tasks SET updated_at = ? WHERE updated_at IS NULL",
                (now,),
            )

    def task_exists(self, task_id: str) -> bool:
        with self._connect() as connection:
            return connection.execute(
                "SELECT 1 FROM tasks WHERE task_id = ?", (task_id,),
            ).fetchone() is not None

    def enqueue_task(
        self,
        task_id: str,
        user_id: str,
        image_keys: list[str],
        *,
        max_queued_images: int,
        max_active_tasks_per_user: int,
    ) -> None:
        now = time.time()
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute(
                "SELECT 1 FROM tasks WHERE task_id = ?", (task_id,),
            ).fetchone():
                raise ValueError("task already exists")
            queued = int(connection.execute(
                "SELECT COUNT(*) FROM queue_items "
                "WHERE status IN ('pending', 'processing')"
            ).fetchone()[0])
            if queued + len(image_keys) > max_queued_images:
                raise QueueCapacityError("queue capacity exceeded")
            active = int(connection.execute(
                "SELECT COUNT(*) FROM tasks WHERE user_id = ? "
                "AND status IN ('pending', 'processing')",
                (user_id,),
            ).fetchone()[0])
            if active >= max_active_tasks_per_user:
                raise UserTaskLimitError("user active task limit exceeded")

            connection.execute(
                """INSERT INTO tasks
                   (task_id, user_id, status, total, done, failed, results,
                    updated_at, started_at, completed_at, last_dispatched_at)
                   VALUES (?, ?, 'pending', ?, 0, 0, '[]', ?, NULL, NULL, NULL)""",
                (task_id, user_id, len(image_keys), now),
            )
            connection.executemany(
                """INSERT INTO queue_items
                   (task_id, ordinal, source_key, file_name, status,
                    enqueued_at, available_at)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?)""",
                [
                    (task_id, index, key, Path(key).name, now, now)
                    for index, key in enumerate(image_keys)
                ],
            )
            connection.commit()

    def recover_stale_work(self) -> tuple[int, int]:
        """Requeue interrupted items and fail legacy active tasks without items."""
        now = time.time()
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            interrupted = int(connection.execute(
                "SELECT COUNT(*) FROM queue_items WHERE status = 'processing'"
            ).fetchone()[0])
            connection.execute(
                """UPDATE queue_items
                   SET status = 'pending', available_at = ?, started_at = NULL,
                       last_error = 'worker interrupted; automatically resumed'
                   WHERE status = 'processing'""",
                (now,),
            )
            connection.execute(
                """UPDATE tasks SET status = 'pending', updated_at = ?
                   WHERE status = 'processing'
                   AND EXISTS (
                       SELECT 1 FROM queue_items q
                       WHERE q.task_id = tasks.task_id AND q.status = 'pending'
                   )""",
                (now,),
            )
            legacy_rows = connection.execute(
                """SELECT task_id, total, done, results FROM tasks
                   WHERE status IN ('pending', 'processing')
                   AND NOT EXISTS (
                       SELECT 1 FROM queue_items q WHERE q.task_id = tasks.task_id
                   )"""
            ).fetchall()
            for row in legacy_rows:
                results = json.loads(row["results"] or "[]")
                results.append({
                    "file": "*",
                    "status": "failed",
                    "error": "旧版任务无法恢复，请重新上传",
                })
                remaining = max(0, int(row["total"]) - int(row["done"]))
                connection.execute(
                    """UPDATE tasks SET status = 'failed', failed = ?, results = ?,
                       updated_at = ?, completed_at = ? WHERE task_id = ?""",
                    (remaining, json.dumps(results, ensure_ascii=False), now, now, row["task_id"]),
                )
            connection.commit()
        return interrupted, len(legacy_rows)

    def claim_next_item(self, *, now: float | None = None) -> QueueItem | None:
        claimed_at = time.time() if now is None else now
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            task = connection.execute(
                """SELECT t.task_id, t.user_id
                   FROM tasks t
                   WHERE t.status IN ('pending', 'processing')
                   AND EXISTS (
                       SELECT 1 FROM queue_items q
                       WHERE q.task_id = t.task_id
                       AND q.status = 'pending' AND q.available_at <= ?
                   )
                   ORDER BY
                       CASE WHEN (
                           SELECT MAX(u.last_dispatched_at) FROM tasks u
                           WHERE u.user_id = t.user_id
                       ) IS NULL THEN 0 ELSE 1 END,
                       (
                           SELECT MAX(u.last_dispatched_at) FROM tasks u
                           WHERE u.user_id = t.user_id
                       ) ASC,
                       CASE WHEN t.last_dispatched_at IS NULL THEN 0 ELSE 1 END,
                       t.last_dispatched_at ASC,
                       t.created_at ASC
                   LIMIT 1""",
                (claimed_at,),
            ).fetchone()
            if task is None:
                connection.commit()
                return None
            item = connection.execute(
                """SELECT id, task_id, ordinal, source_key, file_name, attempts
                   FROM queue_items
                   WHERE task_id = ? AND status = 'pending' AND available_at <= ?
                   ORDER BY ordinal ASC LIMIT 1""",
                (task["task_id"], claimed_at),
            ).fetchone()
            if item is None:
                connection.commit()
                return None
            attempts = int(item["attempts"]) + 1
            connection.execute(
                """UPDATE queue_items SET status = 'processing', attempts = ?,
                   started_at = ?, last_error = NULL WHERE id = ?""",
                (attempts, claimed_at, item["id"]),
            )
            connection.execute(
                """UPDATE tasks SET status = 'processing', updated_at = ?,
                   started_at = COALESCE(started_at, ?), last_dispatched_at = ?
                   WHERE task_id = ?""",
                (claimed_at, claimed_at, claimed_at, task["task_id"]),
            )
            connection.commit()
            return QueueItem(
                id=int(item["id"]),
                task_id=str(item["task_id"]),
                user_id=str(task["user_id"]),
                ordinal=int(item["ordinal"]),
                source_key=str(item["source_key"]),
                file_name=str(item["file_name"]),
                attempts=attempts,
            )

    def _refresh_task(self, connection: sqlite3.Connection, task_id: str, now: float) -> None:
        counts = {
            str(row["status"]): int(row["count"])
            for row in connection.execute(
                "SELECT status, COUNT(*) AS count FROM queue_items "
                "WHERE task_id = ? GROUP BY status",
                (task_id,),
            ).fetchall()
        }
        done = counts.get("success", 0)
        failed = counts.get("failed", 0)
        active = counts.get("pending", 0) + counts.get("processing", 0)
        if active:
            status = "processing" if counts.get("processing", 0) else "pending"
            completed_at = None
        else:
            status = "failed" if done == 0 and failed > 0 else "done"
            completed_at = now
        results = [
            json.loads(row["result"])
            for row in connection.execute(
                """SELECT result FROM queue_items WHERE task_id = ?
                   AND status IN ('success', 'failed') ORDER BY ordinal""",
                (task_id,),
            ).fetchall()
            if row["result"] and row["result"] != "{}"
        ]
        connection.execute(
            """UPDATE tasks SET status = ?, done = ?, failed = ?, results = ?,
               updated_at = ?, completed_at = ? WHERE task_id = ?""",
            (
                status,
                done,
                failed,
                json.dumps(results, ensure_ascii=False),
                now,
                completed_at,
                task_id,
            ),
        )

    def complete_item(self, item: QueueItem, result: dict, *, duration_ms: int) -> None:
        now = time.time()
        payload = {"file": item.file_name, "status": "success", **result}
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """UPDATE queue_items SET status = 'success', completed_at = ?,
                   duration_ms = ?, result = ? WHERE id = ?""",
                (now, duration_ms, json.dumps(payload, ensure_ascii=False), item.id),
            )
            self._refresh_task(connection, item.task_id, now)
            connection.commit()

    def load_cached_result(
        self, source_hash: str, pipeline_version: str,
    ) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                """SELECT output_key, result FROM result_cache
                   WHERE source_hash = ? AND pipeline_version = ?""",
                (source_hash, pipeline_version),
            ).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(row["result"] or "{}")
        except (TypeError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        return {"output_key": str(row["output_key"]), "result": payload}

    def store_cached_result(
        self,
        source_hash: str,
        pipeline_version: str,
        output_key: str,
        result: dict,
    ) -> None:
        now = time.time()
        with self._write_lock, self._connect() as connection:
            connection.execute(
                """INSERT INTO result_cache
                   (source_hash, pipeline_version, output_key, result, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(source_hash, pipeline_version) DO UPDATE SET
                     output_key = excluded.output_key,
                     result = excluded.result,
                     updated_at = excluded.updated_at""",
                (
                    source_hash,
                    pipeline_version,
                    output_key,
                    json.dumps(result, ensure_ascii=False),
                    now,
                ),
            )
            connection.execute(
                "DELETE FROM result_cache WHERE updated_at < ?",
                (now - 90 * 24 * 60 * 60,),
            )
            connection.commit()

    def fail_or_retry_item(
        self,
        item: QueueItem,
        error: str,
        *,
        retryable: bool,
        max_attempts: int,
        retry_base_seconds: float,
        duration_ms: int,
        details: dict | None = None,
    ) -> bool:
        """Return True when the item was requeued, False when terminally failed."""
        now = time.time()
        should_retry = retryable and item.attempts < max_attempts
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if should_retry:
                backoff = retry_base_seconds * (2 ** max(0, item.attempts - 1))
                connection.execute(
                    """UPDATE queue_items SET status = 'pending', available_at = ?,
                       completed_at = NULL, duration_ms = ?, last_error = ?
                       WHERE id = ?""",
                    (now + backoff, duration_ms, error, item.id),
                )
            else:
                payload = {
                    "file": item.file_name,
                    "status": "failed",
                    "error": error,
                    "attempts": item.attempts,
                    **(details or {}),
                }
                connection.execute(
                    """UPDATE queue_items SET status = 'failed', completed_at = ?,
                       duration_ms = ?, last_error = ?, result = ? WHERE id = ?""",
                    (
                        now,
                        duration_ms,
                        error,
                        json.dumps(payload, ensure_ascii=False),
                        item.id,
                    ),
                )
            self._refresh_task(connection, item.task_id, now)
            connection.commit()
        return should_retry

    def load_task(self, task_id: str) -> dict | None:
        with self._connect() as connection:
            row = connection.execute(
                """SELECT status, total, done, failed, results, created_at,
                   started_at, completed_at FROM tasks WHERE task_id = ?""",
                (task_id,),
            ).fetchone()
            if row is None:
                return None
            position = 0
            if row["status"] in {"pending", "processing"}:
                active = connection.execute(
                    """SELECT task_id FROM tasks WHERE status IN ('pending', 'processing')
                       ORDER BY CASE WHEN last_dispatched_at IS NULL THEN 0 ELSE 1 END,
                                last_dispatched_at ASC, created_at ASC"""
                ).fetchall()
                identifiers = [str(item["task_id"]) for item in active]
                position = identifiers.index(task_id) + 1 if task_id in identifiers else 0
            return {
                "status": str(row["status"]),
                "total": int(row["total"]),
                "done": int(row["done"]),
                "failed": int(row["failed"]),
                "results": json.loads(row["results"] or "[]"),
                "queue_position": position,
                "started_at": row["started_at"],
                "completed_at": row["completed_at"],
            }

    def metrics(self) -> dict:
        with self._connect() as connection:
            item_counts = {
                str(row["status"]): int(row["count"])
                for row in connection.execute(
                    "SELECT status, COUNT(*) AS count FROM queue_items GROUP BY status"
                ).fetchall()
            }
            task_counts = {
                str(row["status"]): int(row["count"])
                for row in connection.execute(
                    "SELECT status, COUNT(*) AS count FROM tasks GROUP BY status"
                ).fetchall()
            }
            durations = [
                int(row[0])
                for row in connection.execute(
                    """SELECT duration_ms FROM queue_items
                       WHERE status = 'success' AND duration_ms IS NOT NULL
                       ORDER BY completed_at DESC LIMIT 1000"""
                ).fetchall()
            ]
            retries = int(connection.execute(
                "SELECT COALESCE(SUM(MAX(attempts - 1, 0)), 0) FROM queue_items"
            ).fetchone()[0])
            oldest_enqueued_at = connection.execute(
                "SELECT MIN(enqueued_at) FROM queue_items WHERE status = 'pending'"
            ).fetchone()[0]
            terminal_results = connection.execute(
                "SELECT status, result FROM queue_items "
                "WHERE status IN ('success', 'failed')"
            ).fetchall()

        review_items = 0
        cache_hits = 0
        failure_reasons: dict[str, int] = {}
        stage_samples: dict[str, list[int]] = {}
        for row in terminal_results:
            try:
                payload = json.loads(row["result"] or "{}")
            except (TypeError, json.JSONDecodeError):
                continue
            if row["status"] == "success" and payload.get("needs_review"):
                review_items += 1
            if row["status"] == "success":
                if payload.get("cache_hit"):
                    cache_hits += 1
                for stage, duration in (payload.get("stage_durations_ms") or {}).items():
                    if isinstance(duration, (int, float)) and duration >= 0:
                        stage_samples.setdefault(str(stage), []).append(round(duration))
            if row["status"] == "failed":
                reasons = payload.get("quality_reasons") or ["unclassified"]
                for reason in reasons:
                    key = str(reason or "unclassified")
                    failure_reasons[key] = failure_reasons.get(key, 0) + 1

        def percentile(values: list[int], ratio: float) -> int:
            if not values:
                return 0
            ordered = sorted(values)
            return ordered[round((len(ordered) - 1) * ratio)]

        average_duration = sum(durations) / len(durations) if durations else 0.0
        return {
            "items": item_counts,
            "tasks": task_counts,
            "queue_depth": item_counts.get("pending", 0),
            "processing": item_counts.get("processing", 0),
            "retries": retries,
            "average_duration_ms": round(average_duration, 1),
            "p50_duration_ms": percentile(durations, 0.50),
            "p95_duration_ms": percentile(durations, 0.95),
            "max_duration_ms": max(durations, default=0),
            "completed_samples": len(durations),
            "active_tasks": task_counts.get("pending", 0) + task_counts.get("processing", 0),
            "failed_items": item_counts.get("failed", 0),
            "review_items": review_items,
            "cache_hits": cache_hits,
            "stage_average_ms": {
                stage: round(sum(values) / len(values), 1)
                for stage, values in sorted(stage_samples.items())
                if values
            },
            "failure_reasons": failure_reasons,
            "oldest_pending_seconds": round(
                max(0.0, time.time() - float(oldest_enqueued_at)), 1
            ) if oldest_enqueued_at else 0.0,
        }
