from __future__ import annotations

from app.geometry import close_ring, pixel_polygon_to_relative_lonlat, repair_pixel_polygon


def test_repair_pixel_polygon_fixes_self_intersection() -> None:
    bowtie = [(20, 20), (90, 90), (20, 90), (90, 20)]
    repaired = repair_pixel_polygon(bowtie, min_area=50)

    assert repaired is not None
    assert len(repaired) >= 4
    assert repaired[0] != repaired[-1]


def test_repair_pixel_polygon_rejects_tiny_shapes() -> None:
    tiny = [(1, 1), (2, 1), (2, 2), (1, 2)]
    assert repair_pixel_polygon(tiny, min_area=50) is None


def test_relative_lonlat_is_centered_near_zero_and_closed_on_export() -> None:
    pixels = [(0, 0), (100, 0), (100, 100), (0, 100)]
    lonlat = pixel_polygon_to_relative_lonlat(pixels, width=100, height=100)
    closed = close_ring(lonlat)

    assert closed[0] == closed[-1]
    assert min(lon for lon, _ in lonlat) < 0 < max(lon for lon, _ in lonlat)
    assert min(lat for _, lat in lonlat) < 0 < max(lat for _, lat in lonlat)

