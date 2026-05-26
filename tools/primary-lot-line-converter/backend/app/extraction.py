from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from app.geometry import inset_pixel_polygon, pixel_polygon_to_relative_lonlat, repair_pixel_polygon
from app.models import ExtractionResult, PixelPoint


@dataclass
class Candidate:
    polygon: list[PixelPoint]
    score: float
    mask_name: str
    area_ratio: float


def extract_primary_lot(image_bgr: np.ndarray, hint_mask: np.ndarray | None = None) -> ExtractionResult:
    if image_bgr is None or image_bgr.size == 0:
        return _failed("Unsupported or empty image.")

    image = _normalize_image(image_bgr)
    height, width = image.shape[:2]
    masks = _build_masks(image, hint_mask)
    candidates: list[Candidate] = []
    for name, mask in masks:
        candidates.extend(_candidates_from_mask(mask, name, width, height, hint_mask is not None))

    if not candidates:
        return _failed(candidate_count=0, used_hint=hint_mask is not None)

    candidates.sort(key=lambda item: item.score, reverse=True)
    best = candidates[0]
    specific_masks = {"red", "orange", "pink", "blue_core", "blue", "green_line", "dark"}
    if best.mask_name in {"saturated", "edges"}:
        focused = [
            candidate
            for candidate in candidates
            if candidate.mask_name in specific_masks and candidate.score >= best.score - 0.12
        ]
        if focused:
            best = max(focused, key=lambda item: item.score)
    threshold = 0.48 if hint_mask is not None else 0.55
    if best.score < threshold:
        return _failed(candidate_count=len(candidates), used_hint=hint_mask is not None)

    confidence = min(0.98, max(0.55, best.score))
    warnings = [
        "World coordinates were not confidently recovered; exported coordinates use relative_0_0."
    ]
    return ExtractionResult(
        detected=True,
        confidence=confidence,
        pixel_polygon=best.polygon,
        georef_mode="relative_0_0",
        warnings=warnings,
        used_hint=hint_mask is not None,
        candidate_count=len(candidates),
    )


def create_overlay(image_bgr: np.ndarray, result: ExtractionResult) -> np.ndarray:
    overlay = image_bgr.copy()
    if result.detected and result.pixel_polygon:
        points = np.array(result.pixel_polygon, dtype=np.int32)
        fill = overlay.copy()
        cv2.fillPoly(fill, [points], (255, 255, 255))
        overlay = cv2.addWeighted(fill, 0.18, overlay, 0.82, 0)
        cv2.polylines(overlay, [points], True, (0, 0, 0), 7, cv2.LINE_AA)
        cv2.polylines(overlay, [points], True, (255, 255, 255), 3, cv2.LINE_AA)
    else:
        cv2.rectangle(overlay, (12, 12), (430, 58), (0, 0, 0), -1)
        cv2.putText(
            overlay,
            "No primary lot line detected",
            (24, 44),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.85,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
    return overlay


def result_geo_polygon(result: ExtractionResult, width: int, height: int):
    return pixel_polygon_to_relative_lonlat(result.pixel_polygon, width=width, height=height)


def _normalize_image(image_bgr: np.ndarray) -> np.ndarray:
    max_side = max(image_bgr.shape[:2])
    if max_side <= 1800:
        return image_bgr.copy()
    scale = 1800 / max_side
    return cv2.resize(image_bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


def _failed(
    warning: str = "No primary highlighted lot boundary could be detected.",
    candidate_count: int = 0,
    used_hint: bool = False,
) -> ExtractionResult:
    return ExtractionResult(
        detected=False,
        confidence=0.0,
        pixel_polygon=[],
        georef_mode="relative_0_0",
        warnings=[warning],
        error_code="no_primary_lot_line_detected",
        used_hint=used_hint,
        candidate_count=candidate_count,
    )


def _build_masks(image: np.ndarray, hint_mask: np.ndarray | None) -> list[tuple[str, np.ndarray]]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    masks: list[tuple[str, np.ndarray]] = []
    masks.append(("red", (((h <= 12) | (h >= 168)) & (s >= 65) & (v >= 70)).astype(np.uint8) * 255))
    masks.append(("orange", ((h >= 8) & (h <= 35) & (s >= 65) & (v >= 80)).astype(np.uint8) * 255))
    masks.append(("pink", ((h >= 135) & (h <= 178) & (s >= 45) & (v >= 85)).astype(np.uint8) * 255))
    masks.append(("blue_core", ((h >= 105) & (h <= 126) & (s >= 150) & (v >= 120)).astype(np.uint8) * 255))
    masks.append(("blue", ((h >= 85) & (h <= 132) & (s >= 45) & (v >= 60)).astype(np.uint8) * 255))
    masks.append(("green_line", ((h >= 38) & (h <= 86) & (s >= 75) & (v <= 190)).astype(np.uint8) * 255))
    masks.append(("saturated", ((s >= 90) & (v >= 90) & ~((h >= 42) & (h <= 82))).astype(np.uint8) * 255))

    dark = ((gray <= 72) & (s <= 120)).astype(np.uint8) * 255
    masks.append(("dark", dark))

    edges = cv2.Canny(gray, 55, 140)
    masks.append(("edges", edges))

    if hint_mask is not None:
        hint = cv2.resize(hint_mask, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)
        _, hint = cv2.threshold(hint, 20, 255, cv2.THRESH_BINARY)
        hint = cv2.dilate(hint, np.ones((9, 9), np.uint8), iterations=1)
        guided_edges = cv2.bitwise_and(cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=1), hint)
        masks.insert(0, ("hint", hint))
        masks.insert(1, ("hint_edges", cv2.bitwise_or(hint, guided_edges)))

    return [(name, _clean_mask(mask, name, hint_mask is not None)) for name, mask in masks]


def _clean_mask(mask: np.ndarray, name: str, has_hint: bool) -> np.ndarray:
    if name in {"hint", "hint_edges"}:
        kernel_size = 19
    elif name == "edges":
        kernel_size = 9
    elif name == "dark":
        kernel_size = 11
    else:
        kernel_size = 15
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    cleaned = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    cleaned = cv2.dilate(cleaned, np.ones((5, 5), np.uint8), iterations=1)
    if has_hint and name not in {"hint", "hint_edges"}:
        cleaned = cv2.dilate(cleaned, np.ones((3, 3), np.uint8), iterations=1)
    return cleaned


def _candidates_from_mask(
    mask: np.ndarray, mask_name: str, width: int, height: int, has_hint: bool
) -> list[Candidate]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    image_area = float(width * height)
    candidates: list[Candidate] = []
    min_area = image_area * (0.012 if has_hint else 0.02)

    for contour in contours:
        contour_area = float(cv2.contourArea(contour))
        if contour_area < min_area:
            continue
        area_ratio = contour_area / image_area
        if area_ratio > 0.88:
            continue

        perimeter = float(cv2.arcLength(contour, True))
        if perimeter <= 0:
            continue
        epsilon = max(0.75, min(2.0, 0.0016 * perimeter))
        approx = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        repaired = repair_pixel_polygon([(int(x), int(y)) for x, y in approx], min_area=min_area)
        if repaired is None:
            continue
        inset = max(2.0, min(9.0, max(width, height) * 0.010))
        repaired = inset_pixel_polygon(repaired, inset, min_area=min_area * 0.6) or repaired

        x, y, w, h = cv2.boundingRect(np.array(repaired, dtype=np.int32))
        if w < width * 0.08 or h < height * 0.08:
            continue
        contour_area = float(cv2.contourArea(np.array(repaired, dtype=np.int32)))
        if contour_area < min_area:
            continue
        bbox_area = max(float(w * h), 1.0)
        extent = contour_area / bbox_area
        if extent < 0.12 and not has_hint:
            continue

        score = _score_candidate(
            repaired,
            mask_name=mask_name,
            area_ratio=area_ratio,
            extent=extent,
            width=width,
            height=height,
            has_hint=has_hint,
        )
        candidates.append(Candidate(repaired, score, mask_name, area_ratio))

    return candidates


def _score_candidate(
    polygon: list[PixelPoint],
    mask_name: str,
    area_ratio: float,
    extent: float,
    width: int,
    height: int,
    has_hint: bool,
) -> float:
    xs = np.array([point[0] for point in polygon], dtype=np.float32)
    ys = np.array([point[1] for point in polygon], dtype=np.float32)
    centroid_x = float(xs.mean())
    centroid_y = float(ys.mean())
    center_distance = np.hypot((centroid_x / width) - 0.5, (centroid_y / height) - 0.5)
    center_score = max(0.0, 1.0 - center_distance * 1.8)
    area_score = 1.0 - min(abs(area_ratio - 0.34) / 0.34, 1.0)
    extent_score = min(max(extent, 0.0), 1.0)
    if 4 <= len(polygon) <= 140:
        vertex_score = 1.0
    elif len(polygon) <= 240:
        vertex_score = 0.88
    else:
        vertex_score = 0.72

    mask_bonus = {
        "hint": 0.30,
        "hint_edges": 0.26,
        "red": 0.18,
        "pink": 0.16,
        "blue_core": 0.18,
        "orange": 0.13,
        "blue": 0.13,
        "dark": 0.10,
        "green_line": 0.08,
        "saturated": 0.06,
        "edges": -0.08,
    }.get(mask_name, 0.0)
    hint_bonus = 0.08 if has_hint else 0.0
    return (
        0.36 * area_score
        + 0.26 * extent_score
        + 0.20 * center_score
        + 0.10 * vertex_score
        + mask_bonus
        + hint_bonus
    )
