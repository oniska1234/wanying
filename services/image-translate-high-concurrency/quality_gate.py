"""Deterministic quality gates for translated image output."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LayoutQuality:
    score: float
    severe: bool
    needs_review: bool
    reasons: tuple[str, ...]
    min_confidence: float
    max_foreground_overlap: float
    max_target_overlap: float


def _overlap_ratio(first: tuple[int, int, int, int], second: tuple[int, int, int, int]) -> float:
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    if right <= left or bottom <= top:
        return 0.0
    intersection = (right - left) * (bottom - top)
    first_area = max(1, (first[2] - first[0]) * (first[3] - first[1]))
    second_area = max(1, (second[2] - second[0]) * (second[3] - second[1]))
    return intersection / min(first_area, second_area)


def assess_layout_diagnostics(
    diagnostics: list[dict],
    *,
    image_size: tuple[int, int],
) -> LayoutQuality:
    if not diagnostics:
        return LayoutQuality(
            score=1.0,
            severe=False,
            needs_review=False,
            reasons=(),
            min_confidence=1.0,
            max_foreground_overlap=0.0,
            max_target_overlap=0.0,
        )

    width, height = image_size
    reasons: list[str] = []
    confidences = [float(item.get("confidence", 0.0)) for item in diagnostics]
    overlaps = [float(item.get("foreground_overlap", 1.0)) for item in diagnostics]
    min_confidence = min(confidences, default=0.0)
    max_overlap = max(overlaps, default=1.0)

    invalid_box = False
    cleanup_failed = False
    target_boxes: list[tuple[int, int, int, int]] = []
    for item in diagnostics:
        if item.get("source_cleanup_required") and not item.get("source_cleanup_applied"):
            cleanup_failed = True
        boxes = item.get("boxes", [])
        for box in boxes:
            if (
                not isinstance(box, (list, tuple))
                or len(box) != 4
                or box[0] < 0
                or box[1] < 0
                or box[2] > width
                or box[3] > height
                or box[2] <= box[0]
                or box[3] <= box[1]
            ):
                invalid_box = True
                break
            target_boxes.append(tuple(int(value) for value in box))
    max_target_overlap = 0.0
    for index, first in enumerate(target_boxes):
        for second in target_boxes[index + 1:]:
            max_target_overlap = max(
                max_target_overlap,
                _overlap_ratio(first, second),
            )
    if invalid_box:
        reasons.append("layout_box_out_of_bounds")
    if cleanup_failed:
        reasons.append("source_cleanup_low_confidence")
    if max_overlap > 0.38:
        reasons.append("translation_overlaps_foreground")
    elif max_overlap > 0.20:
        reasons.append("translation_close_to_foreground")
    if min_confidence < 0.18:
        reasons.append("layout_confidence_critical")
    elif min_confidence < 0.42:
        reasons.append("layout_confidence_low")
    if max_target_overlap > 0.35:
        reasons.append("translated_regions_overlap")

    # A conservative source-cleanup attempt can decline a stylized headline
    # even when the translated layout itself is safe.  Treat that signal as a
    # review condition and let the downstream OCR repair/final-artifact gate
    # decide whether Chinese actually remains.  It must not short-circuit the
    # only recovery stages available to the image.
    severe = (
        invalid_box
        or max_overlap > 0.38
        or min_confidence < 0.18
        or max_target_overlap > 0.35
    )
    needs_review = (
        severe
        or cleanup_failed
        or max_overlap > 0.20
        or min_confidence < 0.42
        or max_target_overlap > 0.18
    )
    score = max(
        0.0,
        min(1.0, min_confidence * (1.0 - max_overlap) * (1.0 - max_target_overlap)),
    )
    if cleanup_failed:
        # Keep telemetry consistent with the review decision.  Previously a
        # cleanup failure was marked severe while still reporting 1.0.
        score = min(score, 0.7)
    return LayoutQuality(
        score=round(score, 4),
        severe=severe,
        needs_review=needs_review,
        reasons=tuple(reasons),
        min_confidence=round(min_confidence, 4),
        max_foreground_overlap=round(max_overlap, 4),
        max_target_overlap=round(max_target_overlap, 4),
    )
