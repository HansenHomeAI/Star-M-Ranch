from __future__ import annotations

from collections.abc import Iterable

from shapely import make_valid
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient

from app.models import PixelPoint, Point


def close_ring(points: Iterable[Point]) -> list[Point]:
    ring = list(points)
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def _largest_polygon(geometry) -> Polygon | None:
    if geometry.is_empty:
        return None
    if isinstance(geometry, Polygon):
        return geometry
    if isinstance(geometry, MultiPolygon):
        return max(geometry.geoms, key=lambda poly: poly.area, default=None)
    if hasattr(geometry, "geoms"):
        polygons = [geom for geom in geometry.geoms if isinstance(geom, Polygon)]
        return max(polygons, key=lambda poly: poly.area, default=None)
    return None


def repair_pixel_polygon(points: Iterable[PixelPoint], min_area: float = 25.0) -> list[PixelPoint] | None:
    unique_points = list(dict.fromkeys((int(x), int(y)) for x, y in points))
    if len(unique_points) < 3:
        return None

    raw_polygon = Polygon(unique_points)
    polygon = raw_polygon
    if not polygon.is_valid:
        polygon = make_valid(polygon)
    polygon = _largest_polygon(polygon)
    if polygon is None or polygon.area < min_area:
        return None
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
        polygon = _largest_polygon(polygon)
    if polygon is None or polygon.area < min_area:
        return None

    polygon = orient(polygon, sign=1.0)
    coords = [(int(round(x)), int(round(y))) for x, y in polygon.exterior.coords[:-1]]
    if len(coords) < 4:
        hull = raw_polygon.convex_hull
        if isinstance(hull, Polygon) and hull.area >= min_area:
            coords = [(int(round(x)), int(round(y))) for x, y in hull.exterior.coords[:-1]]
    coords = list(dict.fromkeys(coords))
    if len(coords) < 3:
        return None
    return coords


def inset_pixel_polygon(
    points: Iterable[PixelPoint], distance: float, min_area: float = 25.0
) -> list[PixelPoint] | None:
    source = repair_pixel_polygon(points, min_area=min_area)
    if source is None or distance <= 0:
        return source

    polygon = Polygon(source).buffer(-distance, join_style=2, mitre_limit=4.0)
    polygon = _largest_polygon(polygon)
    if polygon is None or polygon.area < min_area:
        return source

    polygon = orient(polygon, sign=1.0)
    coords = [(int(round(x)), int(round(y))) for x, y in polygon.exterior.coords[:-1]]
    return repair_pixel_polygon(coords, min_area=min_area) or source


def pixel_polygon_to_relative_lonlat(
    pixels: Iterable[PixelPoint], width: int, height: int, max_span_degrees: float = 0.01
) -> list[Point]:
    points = list(pixels)
    if not points:
        return []
    scale = max_span_degrees / max(width, height, 1)
    center_x = width / 2.0
    center_y = height / 2.0
    return [((x - center_x) * scale, (center_y - y) * scale) for x, y in points]
