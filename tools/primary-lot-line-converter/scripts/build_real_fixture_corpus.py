from __future__ import annotations

import json
import math
import random
import textwrap
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from shapely import make_valid
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.geometry.polygon import orient


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "backend" / "tests" / "fixtures" / "real_parcels"


@dataclass(frozen=True)
class Source:
    name: str
    url: str
    layer_name: str


SOURCES = [
    Source(
        "Middlesex County NJ Parcels",
        "https://services.arcgis.com/BnY3izA2Kwu6jVHq/ArcGIS/rest/services/Middlesex_County_NJ_Parcel_data/FeatureServer/0/query",
        "Parcels",
    ),
    Source(
        "Caldwell County TX CAD Parcels",
        "https://services.arcgis.com/rVxY74DxxIDrDbc0/arcgis/rest/services/Caldwell_CAD_Parcel_Map/FeatureServer/0/query",
        "Caldwell_CAD_Parcel_Map",
    ),
    Source(
        "Los Angeles County Residential Parcels",
        "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/SPA7_8_ResidentialParcels_forAGOLtest_112823/FeatureServer/3/query",
        "SPA7_8_ResidentialParcels",
    ),
    Source(
        "Central Utah Sanpete Parcel Boundary",
        "https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Central_Utah_CWDG_Sanpete_Field_Map_Layers/FeatureServer/9/query",
        "Parcel Boundary",
    ),
    Source(
        "Clark County WA Parcels",
        "https://gis.parametrix.com/arcgis/rest/services/IBR_Parcels_Public/MapServer/0/query",
        "Clark County Parcels (Public)",
    ),
    Source(
        "Multnomah County OR Parcels",
        "https://gis.parametrix.com/arcgis/rest/services/IBR_Parcels_Public/MapServer/1/query",
        "Multnomah County Parcels (Public)",
    ),
]


STYLE_PLAN = [
    ("aerial", "red_thick", 0),
    ("aerial", "orange_thick", 2),
    ("aerial", "blue_thick", -3),
    ("aerial", "pink_thick", 5),
    ("aerial", "green_thick", -5),
    ("paper", "black_survey", 0),
    ("paper", "yellow_marker", 1),
    ("paper", "red_dashed", -4),
    ("paper", "blue_dashed", 4),
    ("government", "black_survey", 0),
    ("government", "red_thin", 2),
    ("government", "orange_thin", -2),
    ("zoning", "red_thick", 0),
    ("zoning", "pink_tint", 3),
    ("zoning", "green_tint", -3),
    ("lowres", "red_thick", 0),
    ("lowres", "orange_thick", 4),
    ("lowres", "blue_thick", -4),
    ("scan", "black_survey", 1),
    ("scan", "yellow_marker", -1),
    ("scan", "red_dashed", 5),
    ("aerial", "red_double", -6),
    ("paper", "blue_thin", 6),
    ("government", "pink_thick", -6),
    ("zoning", "orange_thick", 0),
]


def fetch_geojson(source: Source, count: int = 20) -> list[dict[str, Any]]:
    params = {
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
        "resultRecordCount": str(count),
    }
    url = source.url + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=40) as response:
        data = json.loads(response.read().decode("utf-8"))
    return data.get("features", [])


def largest_polygon(feature: dict[str, Any]) -> Polygon | None:
    geometry = shape(feature["geometry"])
    if not geometry.is_valid:
        geometry = make_valid(geometry)
    if isinstance(geometry, MultiPolygon):
        geometry = max(geometry.geoms, key=lambda item: item.area, default=None)
    if not isinstance(geometry, Polygon) or geometry.is_empty:
        return None
    geometry = orient(geometry, sign=1.0)
    if geometry.area <= 0:
        return None
    return geometry


def select_polygons() -> list[tuple[Source, dict[str, Any], Polygon]]:
    selected: list[tuple[Source, dict[str, Any], Polygon]] = []
    for source in SOURCES:
        for feature in fetch_geojson(source):
            polygon = largest_polygon(feature)
            if polygon is None:
                continue
            minx, miny, maxx, maxy = polygon.bounds
            width = abs(maxx - minx)
            height = abs(maxy - miny)
            if width <= 0 or height <= 0:
                continue
            aspect = max(width / height, height / width)
            if aspect > 9:
                continue
            coords = list(polygon.exterior.coords)
            if len(coords) < 4:
                continue
            selected.append((source, feature, polygon))
    if len(selected) < 25:
        raise RuntimeError(f"Only found {len(selected)} usable public parcel polygons")
    # Interleave sources so the 25 fixtures are not all from one county.
    buckets: dict[str, list[tuple[Source, dict[str, Any], Polygon]]] = {}
    for item in selected:
        buckets.setdefault(item[0].name, []).append(item)
    output = []
    while len(output) < 25:
        for bucket in buckets.values():
            if bucket and len(output) < 25:
                output.append(bucket.pop(0))
    return output


def project_ring(polygon: Polygon) -> np.ndarray:
    coords = np.array(polygon.exterior.coords[:-1], dtype=np.float64)
    lon0 = float(coords[:, 0].mean())
    lat0 = float(coords[:, 1].mean())
    x = (coords[:, 0] - lon0) * math.cos(math.radians(lat0))
    y = coords[:, 1] - lat0
    return np.column_stack([x, y])


def fit_to_canvas(points: np.ndarray, width: int, height: int) -> np.ndarray:
    min_xy = points.min(axis=0)
    max_xy = points.max(axis=0)
    span = np.maximum(max_xy - min_xy, 1e-9)
    scale = min(width * 0.62 / span[0], height * 0.62 / span[1])
    centered = (points - (min_xy + max_xy) / 2.0) * scale
    rendered = np.column_stack([width / 2 + centered[:, 0], height / 2 - centered[:, 1]])
    return rendered.astype(np.int32)


def rotate_points(points: np.ndarray, width: int, height: int, degrees: float) -> np.ndarray:
    if not degrees:
        return points
    center = np.array([width / 2, height / 2], dtype=np.float64)
    radians = math.radians(degrees)
    matrix = np.array(
        [[math.cos(radians), -math.sin(radians)], [math.sin(radians), math.cos(radians)]],
        dtype=np.float64,
    )
    return ((points - center) @ matrix.T + center).astype(np.int32)


def make_background(style: str, width: int, height: int, rng: random.Random) -> np.ndarray:
    if style in {"paper", "government", "scan"}:
        image = np.full((height, width, 3), (238, 236, 226), dtype=np.uint8)
        for x in range(-80, width + 80, 56):
            cv2.line(image, (x, 0), (x + 120, height), (190, 190, 184), 1, cv2.LINE_AA)
        for y in range(40, height, 74):
            cv2.line(image, (0, y), (width, y + 18), (202, 202, 196), 1, cv2.LINE_AA)
        return image
    if style == "zoning":
        image = np.full((height, width, 3), (207, 211, 190), dtype=np.uint8)
        cv2.rectangle(image, (width - 125, 0), (width, height), (185, 226, 184), -1)
        cv2.rectangle(image, (0, height - 105), (width, height), (216, 186, 222), -1)
        return image
    image = np.full((height, width, 3), (168, 182, 142), dtype=np.uint8)
    for _ in range(130):
        center = (rng.randrange(width), rng.randrange(height))
        radius = rng.randrange(2, 15)
        color = tuple(rng.randrange(70, 190) for _ in range(3))
        cv2.circle(image, center, radius, color, -1, cv2.LINE_AA)
    for _ in range(3):
        p0 = (rng.randrange(-40, width // 2), rng.randrange(0, height))
        p1 = (rng.randrange(width // 2, width + 40), rng.randrange(0, height))
        cv2.line(image, p0, p1, (200, 198, 185), rng.randrange(5, 12), cv2.LINE_AA)
    return image


def draw_context(image: np.ndarray, points: np.ndarray, rng: random.Random, style: str) -> None:
    height, width = image.shape[:2]
    context_color = (214, 155, 32) if style != "scan" else (80, 80, 80)
    for dx, dy, scale in [(-0.34, 0.08, 0.72), (0.36, -0.02, 0.68), (0.14, 0.34, 0.55)]:
        center = np.array([width / 2, height / 2])
        shifted = ((points - center) * scale + center + np.array([dx * width, dy * height])).astype(np.int32)
        cv2.polylines(image, [shifted], True, context_color, 2, cv2.LINE_AA)
    labels = ["LOT 4", "R/W", "TRACT A", "ROAD", "APN"]
    for _ in range(5):
        cv2.putText(
            image,
            rng.choice(labels),
            (rng.randrange(20, width - 90), rng.randrange(36, height - 24)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (88, 88, 82) if style in {"paper", "government", "scan"} else (245, 244, 235),
            1,
            cv2.LINE_AA,
        )


def draw_primary(image: np.ndarray, points: np.ndarray, style: str) -> None:
    colors = {
        "red": (25, 25, 225),
        "orange": (0, 145, 245),
        "blue": (235, 85, 35),
        "pink": (215, 40, 225),
        "green": (55, 145, 55),
        "yellow": (35, 215, 245),
        "black": (22, 22, 22),
    }
    if style == "pink_tint":
        overlay = image.copy()
        cv2.fillPoly(overlay, [points], (210, 120, 220))
        image[:] = cv2.addWeighted(overlay, 0.45, image, 0.55, 0)
        cv2.polylines(image, [points], True, colors["pink"], 4, cv2.LINE_AA)
    elif style == "green_tint":
        overlay = image.copy()
        cv2.fillPoly(overlay, [points], (110, 205, 110))
        image[:] = cv2.addWeighted(overlay, 0.45, image, 0.55, 0)
        cv2.polylines(image, [points], True, colors["green"], 4, cv2.LINE_AA)
    elif style.endswith("_dashed"):
        color = colors[style.split("_", 1)[0]]
        for start, end in zip(points, np.roll(points, -1, axis=0)):
            segment = end - start
            length = float(np.linalg.norm(segment))
            direction = segment / max(length, 1)
            dash = 0
            while dash < length:
                a = start + direction * dash
                b = start + direction * min(dash + 22, length)
                cv2.line(image, tuple(a.astype(int)), tuple(b.astype(int)), color, 7, cv2.LINE_AA)
                dash += 34
    elif style == "red_double":
        cv2.polylines(image, [points], True, (25, 25, 225), 9, cv2.LINE_AA)
        cv2.polylines(image, [points], True, (255, 255, 255), 3, cv2.LINE_AA)
    elif style == "black_survey":
        cv2.polylines(image, [points], True, colors["black"], 5, cv2.LINE_AA)
    elif style == "yellow_marker":
        cv2.polylines(image, [points], True, colors["yellow"], 13, cv2.LINE_AA)
        cv2.polylines(image, [points], True, (42, 42, 42), 2, cv2.LINE_AA)
    else:
        color_name, weight = style.rsplit("_", 1)
        thickness = {"thin": 4, "thick": 8}.get(weight, 7)
        cv2.polylines(image, [points], True, colors[color_name], thickness, cv2.LINE_AA)


def render_fixture(
    fixture_id: int,
    source: Source,
    feature: dict[str, Any],
    polygon: Polygon,
    background_style: str,
    highlight_style: str,
    rotation: float,
) -> dict[str, Any]:
    rng = random.Random(9100 + fixture_id)
    width, height = 620, 460
    image = make_background(background_style, width, height, rng)
    points = fit_to_canvas(project_ring(polygon), width, height)
    points = rotate_points(points, width, height, rotation)
    draw_context(image, points, rng, background_style)
    draw_primary(image, points, highlight_style)

    if background_style == "lowres":
        image = cv2.resize(image, (310, 230), interpolation=cv2.INTER_AREA)
        image = cv2.resize(image, (620, 460), interpolation=cv2.INTER_NEAREST)
    if background_style == "scan":
        noise = np.random.default_rng(fixture_id).normal(0, 7, image.shape).astype(np.int16)
        image = cv2.add(image, noise, dtype=cv2.CV_8U)

    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [points], 255)

    fixture_name = f"real_{fixture_id:02d}_{source.name.lower().split()[0]}_{background_style}_{highlight_style}"
    image_path = OUT_DIR / f"{fixture_name}.png"
    mask_path = OUT_DIR / f"{fixture_name}_mask.png"
    cv2.imwrite(str(image_path), image)
    cv2.imwrite(str(mask_path), mask)

    props = feature.get("properties", {})
    object_id = next((props.get(key) for key in ("OBJECTID", "OBJECTID_1", "FID", "ID") if key in props), None)
    return {
        "id": fixture_name,
        "image": image_path.name,
        "mask": mask_path.name,
        "source_name": source.name,
        "source_url": source.url,
        "layer_name": source.layer_name,
        "source_object_id": object_id,
        "background_style": background_style,
        "highlight_style": highlight_style,
        "rotation_degrees": rotation,
        "ground_truth_kind": "public_gis_parcel_polygon_rendered_to_test_map",
        "notes": "Primary boundary geometry came from public GIS. Background/context styling is generated to stress detector robustness.",
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for path in OUT_DIR.glob("*"):
        if path.is_file():
            path.unlink()

    parcels = select_polygons()
    manifest = []
    for idx, (source, feature, polygon) in enumerate(parcels[:25], start=1):
        background, highlight, rotation = STYLE_PLAN[idx - 1]
        manifest.append(render_fixture(idx, source, feature, polygon, background, highlight, rotation))

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (OUT_DIR / "README.md").write_text(
        textwrap.dedent(
            """
            # Real Parcel Fixture Corpus

            These fixtures use public GIS parcel polygons as the primary lot boundary.
            The map backgrounds and highlight styles are rendered locally so tests have
            exact ground-truth masks while still using legitimate real parcel shapes.

            Run `python scripts/build_real_fixture_corpus.py` to refresh the corpus.
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"fixtures": len(manifest), "output": str(OUT_DIR)}, indent=2))


if __name__ == "__main__":
    main()

