from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path

from queue_store import (
    DurableQueue,
    QueueCapacityError,
    UserTaskLimitError,
)


class DurableQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.queue = DurableQueue(Path(self.temp_dir.name) / "tasks.db")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def enqueue(self, task_id: str, user_id: str, count: int) -> None:
        self.queue.enqueue_task(
            task_id,
            user_id,
            [f"image-translate/{user_id}/{task_id}/input/{index}.jpg" for index in range(count)],
            max_queued_images=20,
            max_active_tasks_per_user=3,
        )

    def test_tasks_are_dispatched_round_robin(self) -> None:
        self.enqueue("task-a", "user-a", 2)
        self.enqueue("task-b", "user-b", 1)

        first = self.queue.claim_next_item()
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.task_id, "task-a")
        self.queue.complete_item(first, {"output_key": "a/0.jpg"}, duration_ms=100)

        second = self.queue.claim_next_item()
        self.assertIsNotNone(second)
        assert second is not None
        self.assertEqual(second.task_id, "task-b")
        self.queue.complete_item(second, {"output_key": "b/0.jpg"}, duration_ms=120)

        third = self.queue.claim_next_item()
        self.assertIsNotNone(third)
        assert third is not None
        self.assertEqual(third.task_id, "task-a")

    def test_users_are_fair_even_when_one_user_has_more_tasks(self) -> None:
        self.enqueue("task-a1", "user-a", 1)
        self.enqueue("task-a2", "user-a", 1)
        self.enqueue("task-b1", "user-b", 1)

        first = self.queue.claim_next_item()
        assert first is not None
        self.queue.complete_item(first, {}, duration_ms=10)
        second = self.queue.claim_next_item()
        assert second is not None
        self.assertNotEqual(first.user_id, second.user_id)

    def test_interrupted_item_is_requeued(self) -> None:
        self.enqueue("task-a", "user-a", 1)
        claimed = self.queue.claim_next_item()
        self.assertIsNotNone(claimed)

        restored = DurableQueue(Path(self.temp_dir.name) / "tasks.db")
        interrupted, legacy = restored.recover_stale_work()
        self.assertEqual(interrupted, 1)
        self.assertEqual(legacy, 0)
        resumed = restored.claim_next_item()
        self.assertIsNotNone(resumed)
        assert resumed is not None
        self.assertEqual(resumed.attempts, 2)

    def test_retry_backoff_then_terminal_failure(self) -> None:
        self.enqueue("task-a", "user-a", 1)
        first = self.queue.claim_next_item()
        assert first is not None
        requeued = self.queue.fail_or_retry_item(
            first,
            "temporary",
            retryable=True,
            max_attempts=2,
            retry_base_seconds=0.01,
            duration_ms=10,
        )
        self.assertTrue(requeued)
        second = self.queue.claim_next_item(now=time.time() + 1)
        assert second is not None
        self.assertEqual(second.attempts, 2)
        requeued = self.queue.fail_or_retry_item(
            second,
            "still failing",
            retryable=True,
            max_attempts=2,
            retry_base_seconds=0.01,
            duration_ms=10,
        )
        self.assertFalse(requeued)
        task = self.queue.load_task("task-a")
        assert task is not None
        self.assertEqual(task["status"], "failed")
        self.assertEqual(task["failed"], 1)

        metrics = self.queue.metrics()
        self.assertEqual(metrics["failure_reasons"], {"unclassified": 1})

    def test_metrics_count_review_outputs_and_failure_reasons(self) -> None:
        self.enqueue("task-review", "user-review", 2)
        review = self.queue.claim_next_item()
        assert review is not None
        self.queue.complete_item(
            review,
            {
                "output_key": "review.jpg",
                "needs_review": True,
                "quality_reasons": ["source_cleanup_low_confidence"],
                "stage_durations_ms": {"source_ocr": 1200, "vision": 800},
            },
            duration_ms=10,
        )
        failed = self.queue.claim_next_item()
        assert failed is not None
        self.queue.fail_or_retry_item(
            failed,
            "residual",
            retryable=False,
            max_attempts=1,
            retry_base_seconds=0.01,
            duration_ms=10,
            details={"quality_reasons": ["residual_chinese"]},
        )

        metrics = self.queue.metrics()
        self.assertEqual(metrics["review_items"], 1)
        self.assertEqual(metrics["failure_reasons"], {"residual_chinese": 1})
        self.assertEqual(
            metrics["stage_average_ms"],
            {"source_ocr": 1200.0, "vision": 800.0},
        )

    def test_capacity_and_per_user_limits_are_enforced(self) -> None:
        self.enqueue("task-a", "user-a", 2)
        with self.assertRaises(UserTaskLimitError):
            self.queue.enqueue_task(
                "task-b",
                "user-a",
                ["b.jpg"],
                max_queued_images=20,
                max_active_tasks_per_user=1,
            )
        with self.assertRaises(QueueCapacityError):
            self.queue.enqueue_task(
                "task-c",
                "user-c",
                ["c.jpg"],
                max_queued_images=2,
                max_active_tasks_per_user=3,
            )

    def test_concurrent_claims_complete_each_image_exactly_once(self) -> None:
        total = 120
        for user_index in range(12):
            self.queue.enqueue_task(
                f"task-{user_index}",
                f"user-{user_index}",
                [f"{user_index}/{item}.jpg" for item in range(total // 12)],
                max_queued_images=total,
                max_active_tasks_per_user=3,
            )
        claimed_ids: list[int] = []
        claimed_lock = threading.Lock()

        def drain() -> None:
            while True:
                item = self.queue.claim_next_item()
                if item is None:
                    return
                with claimed_lock:
                    claimed_ids.append(item.id)
                self.queue.complete_item(item, {}, duration_ms=25)

        workers = [threading.Thread(target=drain) for _ in range(4)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=10)

        self.assertEqual(len(claimed_ids), total)
        self.assertEqual(len(set(claimed_ids)), total)
        metrics = self.queue.metrics()
        self.assertEqual(metrics["queue_depth"], 0)
        self.assertEqual(metrics["processing"], 0)
        self.assertEqual(metrics["items"].get("success"), total)


if __name__ == "__main__":
    unittest.main()
