from __future__ import annotations

import json
import zipfile

from starlette.testclient import TestClient

from app.main import app


def test_upload_status_overlay_and_exports(synthetic_png) -> None:
    path, _ = synthetic_png("red")
    client = TestClient(app)

    with path.open("rb") as handle:
        response = client.post("/api/jobs", files={"file": ("parcel.png", handle, "image/png")})

    assert response.status_code == 200
    payload = response.json()
    job_id = payload["job_id"]
    assert payload["status"] == "complete"
    assert payload["detected"] is True

    status = client.get(f"/api/jobs/{job_id}")
    assert status.status_code == 200
    assert status.json()["georef_mode"] == "relative_0_0"

    overlay = client.get(f"/api/jobs/{job_id}/overlay.png")
    assert overlay.status_code == 200
    assert overlay.headers["content-type"] == "image/png"
    assert overlay.content.startswith(b"\x89PNG")

    kml = client.get(f"/api/jobs/{job_id}/exports/kml")
    assert kml.status_code == 200
    assert b"<Polygon>" in kml.content

    kmz = client.get(f"/api/jobs/{job_id}/exports/kmz")
    assert kmz.status_code == 200
    with zipfile.ZipFile(__import__("io").BytesIO(kmz.content)) as archive:
        assert archive.namelist() == ["doc.kml"]

    geojson = client.get(f"/api/jobs/{job_id}/exports/geojson")
    assert geojson.status_code == 200
    assert json.loads(geojson.text)["features"][0]["geometry"]["type"] == "Polygon"

    metadata = client.get(f"/api/jobs/{job_id}/exports/metadata")
    assert metadata.status_code == 200
    assert metadata.json()["georef_mode"] == "relative_0_0"


def test_hint_endpoint_recovers_no_detection_map(synthetic_png) -> None:
    import cv2
    import numpy as np

    path, points = synthetic_png("none")
    client = TestClient(app)

    with path.open("rb") as handle:
        response = client.post("/api/jobs", files={"file": ("plain.png", handle, "image/png")})
    job_id = response.json()["job_id"]
    assert response.json()["detected"] is False

    hint = np.zeros((320, 420), dtype=np.uint8)
    cv2.polylines(hint, [points.astype(np.int32)], True, 255, 18, cv2.LINE_AA)
    ok, encoded = cv2.imencode(".png", hint)
    assert ok

    hint_response = client.post(
        f"/api/jobs/{job_id}/hint",
        files={"hint": ("hint.png", encoded.tobytes(), "image/png")},
    )

    assert hint_response.status_code == 200
    assert hint_response.json()["detected"] is True
    assert hint_response.json()["used_hint"] is True
