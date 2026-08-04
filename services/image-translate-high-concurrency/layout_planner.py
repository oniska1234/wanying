"""Adaptive placement for translated poster copy.

The planner keeps text near its source region while scoring several candidate
placements against a lightweight foreground mask. It is deterministic and does
not depend on a second generative-model call.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image


Box = tuple[int, int, int, int]


@dataclass(frozen=True)
class VerticalLayoutPlan:
    boxes: tuple[Box, ...]
    font_size: int
    gutter: int
    score: float
    confidence: float
    foreground_overlap: float
    clearance_ratio: float
    strategy: str


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _clear_boxes(mask: np.ndarray, boxes: list[Box], padding: int) -> None:
    height, width = mask.shape
    for left, top, right, bottom in boxes:
        x1 = max(0, left - padding)
        y1 = max(0, top - padding)
        x2 = min(width, right + padding)
        y2 = min(height, bottom + padding)
        if x2 > x1 and y2 > y1:
            mask[y1:y2, x1:x2] = 0


def estimate_foreground_mask(image: Image.Image, source_boxes: list[Box]) -> np.ndarray:
    """Estimate product/person pixels from border color and local gradients."""
    rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]
    border_size = max(2, round(min(width, height) * 0.025))
    border_pixels = np.concatenate(
        (
            rgb[:border_size].reshape(-1, 3),
            rgb[-border_size:].reshape(-1, 3),
            rgb[:, :border_size].reshape(-1, 3),
            rgb[:, -border_size:].reshape(-1, 3),
        ),
        axis=0,
    ).astype(np.float32)
    background = np.median(border_pixels, axis=0)
    color_distance = np.linalg.norm(rgb.astype(np.float32) - background, axis=2)

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gradient_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gradient_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    gradient = cv2.magnitude(gradient_x, gradient_y)

    color_threshold = max(24.0, float(np.percentile(color_distance, 58)))
    gradient_threshold = max(22.0, float(np.percentile(gradient, 76)))
    mask = np.where(
        (color_distance >= color_threshold) | (gradient >= gradient_threshold),
        255,
        0,
    ).astype(np.uint8)

    # Source glyphs are expected to disappear and must not be mistaken for the
    # subject that translated text should avoid.
    _clear_boxes(mask, source_boxes, max(3, round(min(width, height) * 0.008)))
    kernel_size = max(3, round(min(width, height) * 0.006))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return mask


def _fit_vertical_geometry(
    image_size: tuple[int, int],
    source_boxes: list[Box],
    phrases: list[str],
    column_count: int,
) -> tuple[int, int, int, int, int, int]:
    width, height = image_size
    left = min(box[0] for box in source_boxes)
    top = min(box[1] for box in source_boxes)
    right = max(box[2] for box in source_boxes)
    bottom = max(box[3] for box in source_boxes)
    source_width = max(1, right - left)
    gutter = max(6, round(width * 0.006))
    source_center = (left + right) / 2
    if source_center <= width / 2:
        approved_left = max(0, left - round(source_width * 0.06))
        approved_right = min(
            width,
            round(width * 0.29),
            right + round(source_width * 0.30),
        )
    else:
        approved_right = min(width, right + round(source_width * 0.06))
        approved_left = max(
            0,
            round(width * 0.71),
            left - round(source_width * 0.30),
        )
    minimum_width = column_count * max(28, round(width * 0.03)) + gutter * max(0, column_count - 1)
    if approved_right - approved_left < minimum_width:
        approved_left = max(0, round(source_center - minimum_width / 2))
        approved_right = min(width, approved_left + minimum_width)
        approved_left = max(0, approved_right - minimum_width)
    total_width = max(1, approved_right - approved_left)
    column_width = max(
        1,
        (total_width - gutter * max(0, column_count - 1)) // column_count,
    )
    font_size = max(28, min(72, round(column_width * 0.44)))
    y1 = max(0, top - round(height * 0.08))
    y2 = min(height, max(bottom, round(height * 0.72)))
    return approved_left, total_width, font_size, gutter, y1, y2


def _candidate_positions(
    image_width: int,
    block_width: int,
    source_left: int,
    source_right: int,
    approved_left: int,
) -> list[tuple[str, int]]:
    maximum_left = max(0, image_width - block_width)
    source_center = (source_left + source_right) / 2
    preferred = round(source_center - block_width / 2)
    same_side = (
        round(image_width * 0.025)
        if source_center < image_width / 2
        else round(image_width * 0.975 - block_width)
    )
    inward = (
        round(min(image_width * 0.34, source_right + image_width * 0.015) - block_width)
        if source_center < image_width / 2
        else round(max(image_width * 0.66, source_left - image_width * 0.015))
    )
    raw = [
        ("approved-baseline", approved_left),
        ("source", preferred),
        ("same-side-margin", same_side),
        ("subject-clearance", inward),
    ]
    step = max(6, round(image_width * 0.018))
    search_radius = max(step, round(image_width * 0.14))
    for offset in range(-search_radius, search_radius + 1, step):
        raw.append(("local-search", preferred + offset))

    seen: set[int] = set()
    result: list[tuple[str, int]] = []
    for strategy, value in raw:
        value = max(0, min(maximum_left, value))
        if value not in seen:
            seen.add(value)
            result.append((strategy, value))
    return result


def plan_vertical_columns(
    image: Image.Image,
    source_boxes: list[Box],
    phrases: list[str],
) -> VerticalLayoutPlan:
    if not source_boxes:
        raise ValueError("source_boxes must not be empty")
    if len(source_boxes) != len(phrases):
        raise ValueError("source_boxes and phrases must have the same length")

    width, height = image.size
    source_left = min(box[0] for box in source_boxes)
    source_right = max(box[2] for box in source_boxes)
    source_center = (source_left + source_right) / 2
    approved_left, total_width, font_size, gutter, top, bottom = _fit_vertical_geometry(
        image.size,
        source_boxes,
        phrases,
        len(source_boxes),
    )
    foreground = estimate_foreground_mask(image, source_boxes)
    free_space = np.where(foreground > 0, 0, 255).astype(np.uint8)
    clearance = cv2.distanceTransform(free_space, cv2.DIST_L2, 5)

    best: tuple[float, str, int, float, float] | None = None
    for strategy, left in _candidate_positions(
        width,
        total_width,
        source_left,
        source_right,
        approved_left,
    ):
        right = min(width, left + total_width)
        region = foreground[top:bottom, left:right]
        overlap = float(np.count_nonzero(region)) / max(1, region.size)
        clear_region = clearance[top:bottom, left:right]
        positive_clearance = clear_region[clear_region > 0]
        clearance_px = (
            float(np.percentile(positive_clearance, 18))
            if positive_clearance.size
            else 0.0
        )
        clearance_ratio = _clamp(clearance_px / max(1.0, width * 0.055), 0.0, 1.0)
        candidate_center = (left + right) / 2
        distance = abs(candidate_center - source_center) / max(1, width)
        crosses_center = (
            source_center < width / 2 <= candidate_center
            or candidate_center < width / 2 <= source_center
        )
        edge_margin = min(left, width - right) / max(1, width)
        edge_penalty = max(0.0, 0.012 - edge_margin) * 8.0
        score = (
            overlap * 5.0
            + distance * 0.72
            + (0.35 if crosses_center else 0.0)
            + edge_penalty
            - clearance_ratio * 0.42
        )
        current = (score, strategy, left, overlap, clearance_ratio)
        if best is None or current[0] < best[0]:
            best = current

        # Preserve the already approved renderer geometry whenever it is safe.
        # Adaptive movement is reserved for actual subject collisions.
        if (
            strategy == "approved-baseline"
            and overlap <= 0.08
            and clearance_ratio >= 0.18
        ):
            best = current
            break

    assert best is not None
    score, strategy, block_left, overlap, clearance_ratio = best
    column_width = max(
        1,
        (total_width - gutter * max(0, len(source_boxes) - 1))
        // len(source_boxes),
    )
    boxes: list[Box] = []
    for index in range(len(source_boxes)):
        left = block_left + index * (column_width + gutter)
        right = (
            block_left + total_width
            if index == len(source_boxes) - 1
            else left + column_width
        )
        boxes.append((left, top, right, bottom))

    confidence = _clamp(
        1.0 - overlap * 2.2 - min(0.45, score * 0.22) + clearance_ratio * 0.12,
        0.0,
        1.0,
    )
    return VerticalLayoutPlan(
        boxes=tuple(boxes),
        font_size=font_size,
        gutter=gutter,
        score=round(score, 4),
        confidence=round(confidence, 4),
        foreground_overlap=round(overlap, 4),
        clearance_ratio=round(clearance_ratio, 4),
        strategy=strategy,
    )
