from __future__ import annotations

import json
import zipfile
from xml.etree import ElementTree

from app.exporters import build_geojson, build_kml, build_kmz, build_metadata


def test_exports_are_valid_closed_and_mark_relative_origin() -> None:
    polygon = [(-0.001, 0.001), (0.002, 0.001), (0.002, -0.001), (-0.001, -0.001)]
    metadata = build_metadata(
        job_id="job-1",
        confidence=0.91,
        georef_mode="relative_0_0",
        warnings=["World coordinates were not confidently recovered."],
        pixel_polygon=[(10, 10), (30, 10), (30, 30), (10, 30)],
        geo_polygon=polygon,
    )

    geojson = json.loads(build_geojson(polygon, metadata))
    coords = geojson["features"][0]["geometry"]["coordinates"][0]
    assert coords[0] == coords[-1]
    assert geojson["features"][0]["properties"]["georef_mode"] == "relative_0_0"

    root = ElementTree.fromstring(build_kml(polygon, metadata))
    assert root.tag.endswith("kml")
    kml_text = build_kml(polygon, metadata)
    assert "<Polygon>" in kml_text
    assert "relative_0_0" in kml_text

    kmz_bytes = build_kmz(polygon, metadata)
    with zipfile.ZipFile(__import__("io").BytesIO(kmz_bytes)) as archive:
        assert archive.namelist() == ["doc.kml"]
        assert archive.read("doc.kml").startswith(b'<?xml version="1.0"')


def test_kml_repeats_first_coordinate_as_last() -> None:
    polygon = [(0.0, 0.0), (0.001, 0.0), (0.001, -0.001), (0.0, -0.001)]
    metadata = build_metadata("job-2", 0.88, "relative_0_0", [], [], polygon)
    kml_text = build_kml(polygon, metadata)

    coordinate_text = kml_text.split("<coordinates>", 1)[1].split("</coordinates>", 1)[0].strip()
    coords = coordinate_text.split()
    assert coords[0] == coords[-1]

