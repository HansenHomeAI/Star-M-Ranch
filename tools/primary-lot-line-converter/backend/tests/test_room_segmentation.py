from __future__ import annotations

import json
from xml.etree import ElementTree

import cv2
import numpy as np

from app.exporters import build_feature_geojson, build_feature_kml
from app.floor_plan import extract_floor_plan, floor_plan_geometry_to_relative


def _room_map(rows: int = 3, cols: int = 4) -> tuple[np.ndarray, list[str]]:
    width, height = 620, 420
    image = np.full((height, width, 3), 248, dtype=np.uint8)
    labels: list[str] = []
    colors = [
        (178, 133, 72),
        (212, 184, 106),
        (128, 76, 58),
        (224, 201, 130),
        (166, 96, 72),
        (201, 160, 88),
    ]
    x0, y0 = 70, 60
    room_w, room_h = 92, 72
    gap = 8
    label = 101
    for row in range(rows):
        for col in range(cols):
            left = x0 + col * (room_w + gap)
            top = y0 + row * (room_h + gap)
            right = left + room_w
            bottom = top + room_h
            color = colors[(row * cols + col) % len(colors)]
            cv2.rectangle(image, (left, top), (right, bottom), color, -1)
            cv2.rectangle(image, (left, top), (right, bottom), (22, 22, 22), 3)
            text = str(label)
            labels.append(text)
            text_color = (10, 10, 10) if sum(color) > 450 else (242, 242, 242)
            cv2.putText(
                image,
                text,
                (left + 22, top + 45),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.72,
                text_color,
                2,
                cv2.LINE_AA,
            )
            label += 1

    cv2.line(image, (x0 - 12, y0 + room_h + gap // 2), (x0 + cols * (room_w + gap), y0 + room_h + gap // 2), (250, 250, 250), 10)
    cv2.putText(image, "APARTMENT PLAN", (70, 350), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (160, 160, 160), 1, cv2.LINE_AA)
    return image, labels


def test_floor_plan_extracts_labeled_rooms_and_shared_wall_segments() -> None:
    image, expected_labels = _room_map()
    result = extract_floor_plan(image)

    assert result.detected is True
    assert result.room_count == len(expected_labels)
    labels = {room["label"] for room in result.rooms}
    assert set(expected_labels).issubset(labels)
    assert all(room["label_source"] in {"image_digits", "local_ocr"} for room in result.rooms)

    room_wall_segments = [segment for segment in result.wall_segments if segment["room_label"] in expected_labels]
    assert len(room_wall_segments) >= len(expected_labels) * 4
    assert all("wall_index" in segment for segment in room_wall_segments)
    assert all("room_label" in segment for segment in room_wall_segments)
    assert any(segment.get("shared_wall_id") for segment in room_wall_segments)
    assert any(segment.get("adjacent_room_labels") for segment in room_wall_segments)


def test_room_aware_exports_annotate_each_room_and_wall() -> None:
    image, expected_labels = _room_map(rows=2, cols=3)
    result = extract_floor_plan(image)
    geometry = floor_plan_geometry_to_relative(result, image.shape[1], image.shape[0])
    metadata = result.to_metadata(
        job_id="room-job",
        width=image.shape[1],
        height=image.shape[0],
        geo_features=geometry["geo_features"],
        geo_rooms=geometry["geo_rooms"],
        geo_wall_segments=geometry["geo_wall_segments"],
    )

    geojson = json.loads(build_feature_geojson(geometry["geo_features"], metadata))
    feature_kinds = {feature["properties"]["kind"] for feature in geojson["features"]}
    assert {"room", "room_wall"}.issubset(feature_kinds)
    assert {feature["properties"].get("room_label") for feature in geojson["features"]} & set(expected_labels)

    kml = build_feature_kml(geometry["geo_features"], metadata)
    root = ElementTree.fromstring(kml)
    assert root.tag.endswith("kml")
    assert "<Folder><name>Rooms</name>" in kml
    assert "<Folder><name>Room Wall Segments</name>" in kml
    assert "<Data name=\"room_label\"><value>101</value></Data>" in kml
    assert "<Data name=\"shared_wall_id\"><value>shared-" in kml
    assert "<Polygon>" in kml
    assert "<LineString>" in kml
