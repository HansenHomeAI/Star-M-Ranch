from __future__ import annotations

import cv2
import numpy as np

from app.exporters import build_kml, build_metadata
from app.extraction import extract_primary_lot, result_geo_polygon
from tests.conftest import mask_iou, rasterize_polygon


def _detected_fill(result, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    cv2.fillPoly(mask, [np.array(result.pixel_polygon, dtype=np.int32)], 255)
    return mask


def _sample_cubic(p0, p1, p2, p3, count: int) -> np.ndarray:
    t = np.linspace(0.0, 1.0, count, dtype=np.float32)[:, None]
    return (
        ((1 - t) ** 3) * np.array(p0, dtype=np.float32)
        + 3 * ((1 - t) ** 2) * t * np.array(p1, dtype=np.float32)
        + 3 * (1 - t) * (t**2) * np.array(p2, dtype=np.float32)
        + (t**3) * np.array(p3, dtype=np.float32)
    )


def _curved_lot_map() -> tuple[np.ndarray, np.ndarray]:
    width, height = 560, 400
    image = np.full((height, width, 3), (172, 184, 145), dtype=np.uint8)
    rng = np.random.default_rng(91)
    for _ in range(90):
        center = (int(rng.integers(0, width)), int(rng.integers(0, height)))
        radius = int(rng.integers(2, 11))
        color = tuple(int(v) for v in rng.integers(82, 185, size=3))
        cv2.circle(image, center, radius, color, -1, cv2.LINE_AA)
    cv2.line(image, (0, 315), (width, 270), (205, 201, 188), 12, cv2.LINE_AA)
    cv2.line(image, (395, 0), (450, height), (199, 195, 184), 9, cv2.LINE_AA)
    cv2.polylines(
        image,
        [np.array([[35, 90], [110, 65], [125, 190], [45, 220]], dtype=np.int32)],
        True,
        (215, 156, 36),
        2,
        cv2.LINE_AA,
    )

    top = np.column_stack([np.linspace(88, 350, 18), np.linspace(78, 72, 18)])
    right_curve = _sample_cubic((350, 72), (455, 105), (462, 225), (425, 292), 28)
    bottom_curve = _sample_cubic((425, 292), (335, 352), (190, 330), (92, 286), 32)
    left = np.column_stack([np.linspace(92, 88, 10), np.linspace(286, 78, 10)])
    points = np.vstack([top, right_curve[1:], bottom_curve[1:], left[1:]]).astype(np.int32)

    cv2.polylines(image, [points], True, (22, 24, 226), 9, cv2.LINE_AA)
    return image, points


def test_extracts_wide_variety_of_primary_lot_styles(synthetic_png) -> None:
    styles = [
        "red",
        "orange",
        "pink",
        "blue",
        "black",
        "dashed",
        "tint",
        "low_contrast",
    ]
    variants = []
    for style in styles:
        variants.append((style, 0, False))
        variants.append((style, 0, True))
        variants.append((style, 4, False))
    variants.append(("red", -6, True))

    passed = 0
    for style, rotate, noise in variants:
        path, expected_points = synthetic_png(style, rotate=rotate, noise=noise)
        image = cv2.imread(str(path))
        result = extract_primary_lot(image)
        expected = rasterize_polygon(expected_points, image.shape[:2])
        actual = _detected_fill(result, image.shape[:2])
        iou = mask_iou(actual, expected)
        if result.detected and result.confidence >= 0.55 and iou >= 0.58:
            passed += 1

    assert passed / len(variants) >= 0.90


def test_fails_clearly_when_no_primary_highlight_exists(synthetic_png) -> None:
    path, _ = synthetic_png("none", rotate=0, noise=True)
    image = cv2.imread(str(path))
    result = extract_primary_lot(image)

    assert result.detected is False
    assert result.error_code == "no_primary_lot_line_detected"
    assert result.pixel_polygon == []


def test_hint_mask_guides_detection_when_image_has_no_highlight(synthetic_png) -> None:
    path, points = synthetic_png("none", rotate=0, noise=False)
    image = cv2.imread(str(path))
    hint = np.zeros(image.shape[:2], dtype=np.uint8)
    cv2.polylines(hint, [points.astype(np.int32)], True, 255, 18, cv2.LINE_AA)

    result = extract_primary_lot(image, hint_mask=hint)
    expected = rasterize_polygon(points, image.shape[:2])
    actual = _detected_fill(result, image.shape[:2])

    assert result.detected is True
    assert result.used_hint is True
    assert mask_iou(actual, expected) >= 0.70


def test_curved_lot_lines_are_preserved_as_dense_export_segments() -> None:
    image, expected_points = _curved_lot_map()
    result = extract_primary_lot(image)
    expected = rasterize_polygon(expected_points, image.shape[:2])
    actual = _detected_fill(result, image.shape[:2])

    geo_polygon = result_geo_polygon(result, image.shape[1], image.shape[0])
    metadata = build_metadata("curved-lot", result.confidence, result.georef_mode, [], result.pixel_polygon, geo_polygon)
    kml_text = build_kml(geo_polygon, metadata)
    exported_coordinate_count = len(
        kml_text.split("<coordinates>", 1)[1].split("</coordinates>", 1)[0].strip().split()
    )

    assert result.detected is True
    assert len(result.pixel_polygon) >= 28
    assert exported_coordinate_count >= 29
    assert mask_iou(actual, expected) >= 0.90
