from __future__ import annotations

import asyncio
import tempfile
import time
import unittest
from pathlib import Path

import main
from fastapi import HTTPException
from queue_store import DurableQueue


class FakeOSS:
    available = True

    def __init__(self, *, fail_download: bool = False, fail_upload: bool = False) -> None:
        self.fail_download = fail_download
        self.fail_upload = fail_upload
        self.uploaded: list[str] = []

    def download_file(self, key: str, target: Path) -> None:
        del key
        if self.fail_download:
            raise RuntimeError("download unavailable")
        target.write_bytes(b"input")

    def upload_file(self, source: Path, key: str) -> None:
        if self.fail_upload:
            raise RuntimeError("upload unavailable")
        self.assert_file(source)
        self.uploaded.append(key)

    @staticmethod
    def assert_file(path: Path) -> None:
        if not path.is_file():
            raise AssertionError(f"missing output: {path}")


class FakePipeline:
    def process_image(self, source: Path, output: Path) -> dict:
        if not source.is_file():
            raise AssertionError("source was not downloaded")
        output.write_bytes(b"output")
        return {
            "status": "success",
            "repaired_phrases": 2,
            "removed_brands": 1,
            "quality_score": 0.95,
        }


class WorkerFaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        main.TMP_DIR = root / "tmp"
        main.TMP_DIR.mkdir()
        main.queue = DurableQueue(root / "tasks.db")
        main.MAX_JOB_ATTEMPTS = 2
        main.RETRY_BASE_SECONDS = 0.01
        main._ready_workers.clear()

    def tearDown(self) -> None:
        main.queue = None
        main.oss = None
        main._ready_workers.clear()
        self.temp_dir.cleanup()

    def enqueue_and_claim(self, task_id: str = "task-a"):
        assert main.queue is not None
        main.queue.enqueue_task(
            task_id,
            "user-a",
            [f"image-translate/user-a/{task_id}/input/a.jpg"],
            max_queued_images=10,
            max_active_tasks_per_user=3,
        )
        item = main.queue.claim_next_item()
        assert item is not None
        return item

    def test_success_uploads_and_cleans_temporary_files(self) -> None:
        item = self.enqueue_and_claim()
        fake_oss = FakeOSS()
        main.oss = fake_oss
        main._process_queue_item(0, FakePipeline(), item)

        assert main.queue is not None
        task = main.queue.load_task(item.task_id)
        assert task is not None
        self.assertEqual(task["status"], "done")
        self.assertEqual(task["done"], 1)
        self.assertEqual(len(fake_oss.uploaded), 1)
        self.assertFalse((main.TMP_DIR / item.task_id / str(item.id)).exists())

    def test_download_failure_requeues_then_can_recover(self) -> None:
        item = self.enqueue_and_claim()
        main.oss = FakeOSS(fail_download=True)
        main._process_queue_item(0, FakePipeline(), item)

        assert main.queue is not None
        task = main.queue.load_task(item.task_id)
        assert task is not None
        self.assertEqual(task["status"], "pending")
        resumed = main.queue.claim_next_item(now=time.time() + 1)
        assert resumed is not None
        self.assertEqual(resumed.attempts, 2)

    def test_upload_failure_is_retried_without_false_success(self) -> None:
        item = self.enqueue_and_claim()
        main.oss = FakeOSS(fail_upload=True)
        main._process_queue_item(0, FakePipeline(), item)

        assert main.queue is not None
        task = main.queue.load_task(item.task_id)
        assert task is not None
        self.assertEqual(task["status"], "pending")
        self.assertEqual(task["done"], 0)

    def test_api_contract_accepts_and_reports_durable_task(self) -> None:
        main._ready_workers.add(0)
        main.oss = FakeOSS()
        response = asyncio.run(main.start_process(main.ProcessRequest(
            task_id="api-task",
            user_id="api-user",
            images=["image-translate/api-user/api-task/input/a.jpg"],
        )))
        self.assertEqual(response.status, "accepted")

        status = asyncio.run(main.get_task_status("api-task"))
        self.assertEqual(status.task_id, "api-task")
        self.assertEqual(status.status, "pending")
        self.assertEqual(status.total, 1)
        self.assertGreaterEqual(status.estimated_wait_seconds, 0)

    def test_api_rejects_cross_task_storage_key(self) -> None:
        main._ready_workers.add(0)
        main.oss = FakeOSS()
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(main.start_process(main.ProcessRequest(
                task_id="api-task",
                user_id="api-user",
                images=["image-translate/another-user/task/input/a.jpg"],
            )))
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
