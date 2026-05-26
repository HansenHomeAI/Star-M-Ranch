from __future__ import annotations

import io
import json
import math
import zipfile
from pathlib import Path

import cv2
import numpy as np
from starlette.testclient import TestClient

from app.exporters import build_feature_geojson, build_feature_kml, build_feature_kmz, build_shapefile_zip
from app.floor_plan import extract_floor_plan, floor_plan_features_to_relative
from app.main import app


def _fixture_lines(index: int, width: int, height: int) -> list[list[tuple[int, int]]]:
    margin = 34 + (index % 3) * 8
    right = width - margin
    bottom = height - margin
    mid_x = width // 2 + ((index % 5) - 2) * 11
    mid_y = height // 2 + ((index % 4) - 1) * 12
    lines: list[list[tuple[int, int]]] = [
        [(margin, margin), (right, margin), (right, bottom), (margin, bottom), (margin, margin)],
        [(mid_x, margin), (mid_x, bottom)],
        [(margin, mid_y), (right, mid_y)],
        [(margin + 18, mid_y), (margin + 54, mid_y)],
    ]
    if index % 4 == 0:
        curve = []
        center = (right - 42, bottom - 58)
        radius = 44
        for angle in np.linspace(-92, 8, 18):
            rad = math.radians(float(angle))
            curve.append((int(center[0] + math.cos(rad) * radius), int(center[1] + math.sin(rad) * radius)))
        lines.append(curve)
    if index % 5 == 0:
        lines.append([(margin + 28, margin + 34), (mid_x - 22, mid_y - 26), (mid_x - 8, bottom - 34)])
    if index % 6 == 0:
        lines.append([(mid_x + 20, margin + 24), (right - 22, mid_y - 22), (right - 70, bottom - 24)])
    return lines


def _make_floor_plan(index: int, scanned: bool = False) -> tuple[np.ndarray, list[list[tuple[int, int]]]]:
    width = 420 + (index % 4) * 28
    height = 320 + (index % 3) * 26
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    lines = _fixture_lines(index, width, height)
    for line in lines:
        cv2.polylines(image, [np.array(line, dtype=np.int32)], False, (15, 15, 15), 5, cv2.LINE_AA)
    rng = np.random.default_rng(index)
    for room in range(4):
        cv2.putText(
            image,
            f"R{room + 1}",
            (45 + room * 82, 72 + ((index + room) % 4) * 48),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (70, 70, 70),
            1,
            cv2.LINE_AA,
        )
    if scanned:
        image = cv2.GaussianBlur(image, (3, 3), 0)
        noise = rng.normal(0, 9, image.shape).astype(np.int16)
        image = cv2.add(image, noise, dtype=cv2.CV_8U)
    return image, lines


def _line_mask(lines: list[list[tuple[int, int]]], shape: tuple[int, int], thickness: int = 7) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    for line in lines:
        cv2.polylines(mask, [np.array(line, dtype=np.int32)], False, 255, thickness, cv2.LINE_AA)
    return mask


def _result_mask(result, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    for feature in result.pixel_features:
        cv2.polylines(mask, [np.array(feature.points, dtype=np.int32)], False, 255, 7, cv2.LINE_AA)
    return mask


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    a_bool = a > 0
    b_bool = b > 0
    union = np.logical_or(a_bool, b_bool).sum()
    return float(np.logical_and(a_bool, b_bool).sum() / max(union, 1))


def test_floor_plan_extractor_handles_twenty_diverse_layouts() -> None:
    passed = 0
    fixture_count = 20
    for index in range(fixture_count):
        image, expected_lines = _make_floor_plan(index, scanned=index % 3 == 0)
        result = extract_floor_plan(image)
        expected = _line_mask(expected_lines, image.shape[:2])
        actual = _result_mask(result, image.shape[:2])
        if (
            result.detected
            and result.geometry_type == "linework"
            and result.feature_count >= 4
            and result.confidence >= 0.55
            and _iou(actual, expected) >= 0.56
        ):
            passed += 1

    assert passed / fixture_count >= 0.90


def test_floor_plan_fails_clearly_on_blank_input() -> None:
    image = np.full((280, 360, 3), 255, dtype=np.uint8)
    result = extract_floor_plan(image)

    assert result.detected is False
    assert result.error_code == "no_floor_plan_linework_detected"
    assert result.feature_count == 0
    assert result.pixel_features == []


def test_floor_plan_exports_linework_and_shapefile_zip() -> None:
    image, _ = _make_floor_plan(7)
    result = extract_floor_plan(image)
    geo_features = floor_plan_features_to_relative(result, image.shape[1], image.shape[0])
    metadata = result.to_metadata(job_id="floor-job", width=image.shape[1], height=image.shape[0], geo_features=geo_features)

    geojson = json.loads(build_feature_geojson(geo_features, metadata))
    assert geojson["features"]
    assert {feature["geometry"]["type"] for feature in geojson["features"]} == {"LineString"}
    assert geojson["features"][0]["properties"]["mode"] == "floor_plan"

    kml_text = build_feature_kml(geo_features, metadata)
    assert "<MultiGeometry>" in kml_text
    assert "<LineString>" in kml_text
    assert "relative_0_0" in kml_text

    with zipfile.ZipFile(io.BytesIO(build_feature_kmz(geo_features, metadata))) as archive:
        assert archive.namelist() == ["doc.kml"]

    with zipfile.ZipFile(io.BytesIO(build_shapefile_zip(geo_features, metadata))) as archive:
        names = set(archive.namelist())
    assert {"floor_plan.shp", "floor_plan.shx", "floor_plan.dbf", "floor_plan.prj"}.issubset(names)


def test_floor_plan_api_mode_returns_exports(tmp_path: Path) -> None:
    image, _ = _make_floor_plan(2)
    path = tmp_path / "floor-plan.png"
    cv2.imwrite(str(path), image)
    client = TestClient(app)

    with path.open("rb") as handle:
        response = client.post(
            "/api/jobs",
            data={"mode": "floor_plan"},
            files={"file": ("floor-plan.png", handle, "image/png")},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "floor_plan"
    assert payload["detected"] is True
    assert payload["geometry_type"] == "linework"
    assert payload["feature_count"] >= 4
    assert "shp" in payload["exports"]

    kml = client.get(f"/api/jobs/{payload['job_id']}/exports/kml")
    assert kml.status_code == 200
    assert b"<LineString>" in kml.content

    shp = client.get(f"/api/jobs/{payload['job_id']}/exports/shp")
    assert shp.status_code == 200
    assert shp.content.startswith(b"PK")
