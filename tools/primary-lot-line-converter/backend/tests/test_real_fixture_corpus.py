from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from app.extraction import extract_primary_lot
from tests.conftest import mask_iou


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "real_parcels"


def _detected_fill(points: list[tuple[int, int]], shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    if points:
        cv2.fillPoly(mask, [np.array(points, dtype=np.int32)], 255)
    return mask


def test_real_public_parcel_fixture_corpus_has_25_legitimate_cases() -> None:
    manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))

    assert len(manifest) == 25
    assert len({item["source_name"] for item in manifest}) >= 5
    for item in manifest:
        assert (FIXTURE_DIR / item["image"]).exists()
        assert (FIXTURE_DIR / item["mask"]).exists()
        assert item["source_url"].startswith("https://")
        assert item["ground_truth_kind"] == "public_gis_parcel_polygon_rendered_to_test_map"


def test_extracts_real_public_parcel_fixture_corpus_with_high_success() -> None:
    manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))
    failures = []
    passed = 0

    for item in manifest:
        image = cv2.imread(str(FIXTURE_DIR / item["image"]), cv2.IMREAD_COLOR)
        expected = cv2.imread(str(FIXTURE_DIR / item["mask"]), cv2.IMREAD_GRAYSCALE)
        result = extract_primary_lot(image)
        actual = _detected_fill(result.pixel_polygon, image.shape[:2])
        iou = mask_iou(actual, expected)
        ok = result.detected and result.confidence >= 0.55 and iou >= 0.62
        if ok:
            passed += 1
        else:
            failures.append(
                {
                    "id": item["id"],
                    "source": item["source_name"],
                    "style": item["highlight_style"],
                    "detected": result.detected,
                    "confidence": round(result.confidence, 4),
                    "iou": round(iou, 4),
                    "error": result.error_code,
                }
            )

    assert passed == len(manifest), failures


def test_blue_primary_lines_do_not_absorb_same_hue_context_parcels() -> None:
    manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))
    target_ids = {
        "real_03_los_aerial_blue_thick",
        "real_18_multnomah_lowres_blue_thick",
        "real_23_clark_paper_blue_thin",
    }
    failures = []

    for item in manifest:
        if item["id"] not in target_ids:
            continue

        image = cv2.imread(str(FIXTURE_DIR / item["image"]), cv2.IMREAD_COLOR)
        expected = cv2.imread(str(FIXTURE_DIR / item["mask"]), cv2.IMREAD_GRAYSCALE)
        result = extract_primary_lot(image)
        actual = _detected_fill(result.pixel_polygon, image.shape[:2])
        iou = mask_iou(actual, expected)
        if not result.detected or iou < 0.84:
            failures.append(
                {
                    "id": item["id"],
                    "style": item["highlight_style"],
                    "confidence": round(result.confidence, 4),
                    "iou": round(iou, 4),
                }
            )

    assert not failures


def test_export_polygon_tracks_lot_line_center_not_outer_stroke_edge() -> None:
    manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))
    target_ids = {
        "real_04_central_aerial_pink_thick",
        "real_05_clark_aerial_green_thick",
        "real_07_middlesex_paper_yellow_marker",
        "real_20_caldwell_scan_yellow_marker",
    }
    failures = []

    for item in manifest:
        if item["id"] not in target_ids:
            continue

        image = cv2.imread(str(FIXTURE_DIR / item["image"]), cv2.IMREAD_COLOR)
        expected = cv2.imread(str(FIXTURE_DIR / item["mask"]), cv2.IMREAD_GRAYSCALE)
        result = extract_primary_lot(image)
        actual = _detected_fill(result.pixel_polygon, image.shape[:2])
        iou = mask_iou(actual, expected)
        if not result.detected or iou < 0.88:
            failures.append(
                {
                    "id": item["id"],
                    "style": item["highlight_style"],
                    "confidence": round(result.confidence, 4),
                    "iou": round(iou, 4),
                }
            )

    assert not failures
