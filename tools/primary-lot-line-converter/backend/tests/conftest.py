from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
import pytest


def polygon_points(width: int = 420, height: int = 320) -> np.ndarray:
    return np.array(
        [
            [70, 95],
            [180, 42],
            [350, 58],
            [365, 208],
            [285, 247],
            [250, 294],
            [104, 266],
            [52, 198],
        ],
        dtype=np.int32,
    )


def rasterize_polygon(points: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(mask, [points.astype(np.int32)], 255)
    return mask


def rotate_image_and_points(
    image: np.ndarray, points: np.ndarray, angle_degrees: float
) -> tuple[np.ndarray, np.ndarray]:
    height, width = image.shape[:2]
    center = (width / 2.0, height / 2.0)
    matrix = cv2.getRotationMatrix2D(center, angle_degrees, 1.0)
    cos = abs(matrix[0, 0])
    sin = abs(matrix[0, 1])
    new_width = int((height * sin) + (width * cos))
    new_height = int((height * cos) + (width * sin))
    matrix[0, 2] += (new_width / 2.0) - center[0]
    matrix[1, 2] += (new_height / 2.0) - center[1]
    rotated = cv2.warpAffine(
        image,
        matrix,
        (new_width, new_height),
        flags=cv2.INTER_LINEAR,
        borderValue=(242, 239, 226),
    )
    homogeneous = np.column_stack([points, np.ones(len(points))])
    rotated_points = homogeneous @ matrix.T
    return rotated, rotated_points.astype(np.int32)


def make_synthetic_map(
    style: str,
    width: int = 420,
    height: int = 320,
    rotate: float = 0,
    noise: bool = False,
) -> tuple[np.ndarray, np.ndarray]:
    image = np.full((height, width, 3), (178, 188, 150), dtype=np.uint8)
    rng = np.random.default_rng(42)

    # Aerial-map texture.
    for _ in range(80):
        center = (int(rng.integers(0, width)), int(rng.integers(0, height)))
        radius = int(rng.integers(2, 10))
        color = tuple(int(v) for v in rng.integers(80, 190, size=3))
        cv2.circle(image, center, radius, color, -1, cv2.LINE_AA)

    # Roads and neighboring parcel noise.
    cv2.line(image, (0, 70), (width, 50), (198, 194, 182), 10, cv2.LINE_AA)
    cv2.line(image, (20, height), (125, 0), (204, 201, 190), 12, cv2.LINE_AA)
    for x in (20, 395):
        cv2.line(image, (x, 0), (x, height), (231, 171, 39), 2, cv2.LINE_AA)
    cv2.polylines(
        image,
        [np.array([[20, 260], [62, 230], [100, 300], [40, 315]], dtype=np.int32)],
        True,
        (235, 160, 30),
        2,
        cv2.LINE_AA,
    )

    points = polygon_points(width, height)
    if style == "red":
        cv2.polylines(image, [points], True, (25, 30, 224), 8, cv2.LINE_AA)
    elif style == "orange":
        cv2.polylines(image, [points], True, (0, 145, 255), 7, cv2.LINE_AA)
    elif style == "pink":
        cv2.polylines(image, [points], True, (210, 45, 230), 7, cv2.LINE_AA)
    elif style == "blue":
        cv2.polylines(image, [points], True, (240, 90, 30), 7, cv2.LINE_AA)
    elif style == "black":
        paper = np.full_like(image, (238, 236, 226))
        for offset in range(0, width, 46):
            cv2.line(paper, (offset, 0), (offset + 80, height), (155, 155, 155), 1)
        image = paper
        cv2.polylines(image, [points], True, (20, 20, 20), 5, cv2.LINE_AA)
    elif style == "dashed":
        for start, end in zip(points, np.roll(points, -1, axis=0)):
            segment = end - start
            length = float(np.linalg.norm(segment))
            direction = segment / max(length, 1.0)
            dash = 0
            while dash < length:
                a = start + direction * dash
                b = start + direction * min(dash + 18, length)
                cv2.line(image, tuple(a.astype(int)), tuple(b.astype(int)), (20, 25, 220), 7, cv2.LINE_AA)
                dash += 30
    elif style == "tint":
        overlay = image.copy()
        cv2.fillPoly(overlay, [points], (95, 210, 105))
        image = cv2.addWeighted(overlay, 0.45, image, 0.55, 0)
        cv2.polylines(image, [points], True, (45, 145, 45), 3, cv2.LINE_AA)
    elif style == "low_contrast":
        cv2.polylines(image, [points], True, (70, 95, 170), 5, cv2.LINE_AA)
    elif style == "none":
        pass
    else:
        raise ValueError(style)

    if noise:
        image = cv2.add(image, rng.normal(0, 8, image.shape).astype(np.int16), dtype=cv2.CV_8U)

    if rotate:
        image, points = rotate_image_and_points(image, points, rotate)

    return image, points


@pytest.fixture()
def synthetic_png(tmp_path: Path):
    def _write(style: str, rotate: float = 0, noise: bool = False) -> tuple[Path, np.ndarray]:
        image, points = make_synthetic_map(style, rotate=rotate, noise=noise)
        path = tmp_path / f"{style}_{rotate}_{noise}.png"
        cv2.imwrite(str(path), image)
        return path, points

    return _write


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    a_bool = a > 0
    b_bool = b > 0
    union = np.logical_or(a_bool, b_bool).sum()
    if union == 0:
        return 0.0
    return float(np.logical_and(a_bool, b_bool).sum() / union)

