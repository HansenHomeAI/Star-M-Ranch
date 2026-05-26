from __future__ import annotations

from collections import deque
from functools import lru_cache

import cv2
import numpy as np
from skimage.morphology import skeletonize

from app.geometry import repair_pixel_polygon
from app.models import ExtractionResult, PixelPoint, VectorFeature


def extract_floor_plan(image_bgr: np.ndarray, hint_mask: np.ndarray | None = None) -> ExtractionResult:
    if image_bgr is None or image_bgr.size == 0:
        return _failed("Unsupported or empty image.")

    mask = _floor_plan_mask(image_bgr, hint_mask)
    features = _features_from_mask(mask)
    rooms = _extract_rooms(image_bgr)
    wall_segments = _build_room_wall_segments(rooms)
    if len(features) < 3 and len(rooms) < 1:
        return _failed(used_hint=hint_mask is not None, candidate_count=len(features))

    line_pixels = int(mask.sum() // 255)
    coverage = line_pixels / float(max(mask.shape[0] * mask.shape[1], 1))
    connected_score = min(1.0, len(features) / 8.0)
    room_score = min(1.0, len(rooms) / 12.0)
    coverage_score = min(1.0, coverage / 0.055)
    confidence = min(
        0.97,
        max(0.55, 0.36 + 0.26 * connected_score + 0.22 * coverage_score + 0.22 * room_score),
    )

    return ExtractionResult(
        detected=True,
        confidence=confidence,
        pixel_features=features,
        rooms=rooms,
        wall_segments=wall_segments,
        georef_mode="relative_0_0",
        warnings=[
            "Floor plans do not prove real-world position; exported coordinates use relative_0_0.",
            "Linework is vectorized from image pixels and should be treated as pixel-relative geometry.",
            "Room labels are read from local image pixels when possible; fallback labels are marked in metadata.",
        ],
        used_hint=hint_mask is not None,
        candidate_count=len(features),
        mode="floor_plan",
        geometry_type="linework",
    )


def floor_plan_features_to_relative(
    result: ExtractionResult, width: int, height: int, max_span_degrees: float = 0.01
) -> list[dict]:
    return floor_plan_geometry_to_relative(result, width, height, max_span_degrees)["geo_features"]


def floor_plan_geometry_to_relative(
    result: ExtractionResult, width: int, height: int, max_span_degrees: float = 0.01
) -> dict:
    scale = max_span_degrees / max(width, height, 1)
    center_x = width / 2.0
    center_y = height / 2.0

    def convert(points: list[PixelPoint]) -> list[tuple[float, float]]:
        return [((float(x) - center_x) * scale, (center_y - float(y)) * scale) for x, y in points]

    geo_features = []
    for feature in result.pixel_features:
        coordinates = convert(feature.points)
        if len(coordinates) >= 2:
            geo_features.append(
                {
                    "id": feature.feature_id,
                    "kind": feature.kind,
                    "closed": feature.closed,
                    "coordinates": coordinates,
                }
            )

    geo_rooms = []
    for room in result.rooms:
        coordinates = convert([tuple(point) for point in room.get("polygon", [])])
        if len(coordinates) >= 3 and coordinates[0] != coordinates[-1]:
            coordinates.append(coordinates[0])
        geo_room = dict(room)
        geo_room["coordinates"] = coordinates
        geo_rooms.append(geo_room)

    geo_wall_segments = []
    for segment in result.wall_segments:
        coordinates = convert([tuple(point) for point in segment.get("points", [])])
        if len(coordinates) >= 2:
            geo_segment = dict(segment)
            geo_segment["coordinates"] = coordinates
            geo_wall_segments.append(geo_segment)

    return {
        "geo_features": geo_features,
        "geo_rooms": geo_rooms,
        "geo_wall_segments": geo_wall_segments,
    }


def create_floor_plan_overlay(image_bgr: np.ndarray, result: ExtractionResult) -> np.ndarray:
    overlay = image_bgr.copy()
    if result.detected and result.pixel_features:
        for room in result.rooms:
            points = np.array(room.get("polygon", []), dtype=np.int32)
            if len(points) >= 3:
                fill = overlay.copy()
                cv2.fillPoly(fill, [points], (255, 255, 255))
                overlay = cv2.addWeighted(fill, 0.10, overlay, 0.90, 0)
                cv2.polylines(overlay, [points], True, (0, 0, 0), 4, cv2.LINE_AA)
                cv2.polylines(overlay, [points], True, (255, 255, 255), 2, cv2.LINE_AA)
                cx, cy = room.get("centroid", [int(points[:, 0].mean()), int(points[:, 1].mean())])
                cv2.putText(
                    overlay,
                    str(room.get("label", room.get("id", ""))),
                    (int(cx) - 14, int(cy) + 6),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (0, 0, 0),
                    4,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    overlay,
                    str(room.get("label", room.get("id", ""))),
                    (int(cx) - 14, int(cy) + 6),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )
        for feature in result.pixel_features:
            points = np.array(feature.points, dtype=np.int32)
            cv2.polylines(overlay, [points], feature.closed, (0, 0, 0), 7, cv2.LINE_AA)
            cv2.polylines(overlay, [points], feature.closed, (255, 255, 255), 3, cv2.LINE_AA)
            for x, y in feature.points:
                cv2.circle(overlay, (int(x), int(y)), 3, (255, 255, 255), -1, cv2.LINE_AA)
                cv2.circle(overlay, (int(x), int(y)), 3, (0, 0, 0), 1, cv2.LINE_AA)
    else:
        cv2.rectangle(overlay, (12, 12), (480, 58), (0, 0, 0), -1)
        cv2.putText(
            overlay,
            "No floor plan linework detected",
            (24, 44),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.78,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
    return overlay


def _failed(
    warning: str = "No floor plan linework could be detected.",
    candidate_count: int = 0,
    used_hint: bool = False,
) -> ExtractionResult:
    return ExtractionResult(
        detected=False,
        confidence=0.0,
        pixel_features=[],
        rooms=[],
        wall_segments=[],
        georef_mode="relative_0_0",
        warnings=[warning],
        error_code="no_floor_plan_linework_detected",
        used_hint=used_hint,
        candidate_count=candidate_count,
        mode="floor_plan",
        geometry_type="linework",
    )


def _extract_rooms(image_bgr: np.ndarray) -> list[dict]:
    mask = _colored_room_mask(image_bgr)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    height, width = image_bgr.shape[:2]
    image_area = float(height * width)
    rooms: list[dict] = []

    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < max(120.0, image_area * 0.00015) or area > image_area * 0.12:
            continue
        x, y, w, h = cv2.boundingRect(contour)
        if w < 16 or h < 16:
            continue
        aspect = max(w / max(h, 1), h / max(w, 1))
        if aspect > 8.5:
            continue
        extent = area / max(float(w * h), 1.0)
        if extent < 0.34:
            continue
        epsilon = max(1.2, min(4.0, cv2.arcLength(contour, True) * 0.012))
        approx = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        polygon = repair_pixel_polygon([(int(px), int(py)) for px, py in approx], min_area=max(80.0, area * 0.35))
        if not polygon:
            continue
        label, label_confidence, label_source = _read_room_label(image_bgr, polygon, (x, y, w, h))
        moments = cv2.moments(np.array(polygon, dtype=np.int32))
        if moments["m00"]:
            centroid = [int(round(moments["m10"] / moments["m00"])), int(round(moments["m01"] / moments["m00"]))]
        else:
            centroid = [int(x + w / 2), int(y + h / 2)]
        rooms.append(
            {
                "id": "",
                "label": label,
                "label_confidence": round(float(label_confidence), 4),
                "label_source": label_source,
                "polygon": [[int(px), int(py)] for px, py in polygon],
                "bbox": [int(x), int(y), int(w), int(h)],
                "centroid": centroid,
                "area_px": round(area, 2),
            }
        )

    rooms.sort(key=lambda room: (room["centroid"][1], room["centroid"][0]))
    used_labels: dict[str, int] = {}
    for index, room in enumerate(rooms, start=1):
        if room["label_source"] == "geometry_order":
            room["label"] = f"room_{index:03d}"
        count = used_labels.get(room["label"], 0)
        used_labels[room["label"]] = count + 1
        if count:
            room["label"] = f"{room['label']}_{count + 1}"
        room["id"] = f"room-{index:03d}"
    return rooms


def _colored_room_mask(image_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    colored = ((s >= 28) & (v >= 45) & (v <= 248) & (gray <= 220)).astype(np.uint8) * 255
    dark_tinted = ((gray <= 145) & (s >= 18) & (v >= 55)).astype(np.uint8) * 255
    mask = cv2.bitwise_or(colored, dark_tinted)
    mask[((h < 12) | (h > 170)) & (s < 35) & (v > 215)] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8), iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    mask = _remove_small_components(mask, min_area=max(45, int(mask.size * 0.00005)))
    return mask


def _read_room_label(
    image_bgr: np.ndarray, polygon: list[PixelPoint], bbox: tuple[int, int, int, int]
) -> tuple[str, float, str]:
    label, confidence = _read_digits_with_templates(image_bgr, polygon, bbox)
    if label:
        return label, confidence, "image_digits"
    return "", 0.0, "geometry_order"


def _read_digits_with_templates(
    image_bgr: np.ndarray, polygon: list[PixelPoint], bbox: tuple[int, int, int, int]
) -> tuple[str, float]:
    x, y, w, h = bbox
    pad = 3
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(image_bgr.shape[1], x + w + pad)
    y1 = min(image_bgr.shape[0], y + h + pad)
    crop = image_bgr[y0:y1, x0:x1]
    if crop.size == 0:
        return "", 0.0

    local_polygon = np.array([[(px - x0, py - y0) for px, py in polygon]], dtype=np.int32)
    room_mask = np.zeros(crop.shape[:2], dtype=np.uint8)
    cv2.fillPoly(room_mask, local_polygon, 255)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    room_pixels = gray[room_mask > 0]
    background = float(np.median(room_pixels)) if room_pixels.size else 160.0
    if background < 135:
        text_mask = ((gray > min(245, background + 58)) & (room_mask > 0)).astype(np.uint8) * 255
    elif background > 170:
        text_mask = ((gray < max(30, background - 58)) & (room_mask > 0)).astype(np.uint8) * 255
    else:
        dark = gray < max(55, background - 55)
        light = gray > min(235, background + 55)
        text_mask = ((dark | light) & (room_mask > 0)).astype(np.uint8) * 255
    border = max(2, min(w, h) // 12)
    text_mask[:border, :] = 0
    text_mask[-border:, :] = 0
    text_mask[:, :border] = 0
    text_mask[:, -border:] = 0
    text_mask = cv2.morphologyEx(text_mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(text_mask, 8)
    candidates = []
    for component in range(1, count):
        cx, cy, cw, ch, area = [int(v) for v in stats[component]]
        if area < 8 or ch < 8 or cw < 3:
            continue
        if ch > h * 0.70 or cw > w * 0.55:
            continue
        if cy < h * 0.12 or cy + ch > h * 0.92:
            continue
        component_mask = (labels[cy : cy + ch, cx : cx + cw] == component).astype(np.uint8) * 255
        parts = _split_digit_component(component_mask) if cw > ch * 0.95 else [(0, component_mask)]
        for offset_x, part_mask in parts:
            digit, score = _classify_digit(part_mask)
            if digit is not None and score >= 0.30:
                ph, pw = part_mask.shape[:2]
                candidates.append(
                    {
                        "digit": digit,
                        "score": score,
                        "bbox": (cx + offset_x, cy, pw, ph),
                        "area": int((part_mask > 0).sum()),
                        "center": (cx + offset_x + pw / 2.0, cy + ph / 2.0),
                    }
                )

    if not candidates:
        return "", 0.0

    rows: list[list[dict]] = []
    for candidate in sorted(candidates, key=lambda item: item["center"][1]):
        for row in rows:
            row_center = np.mean([item["center"][1] for item in row])
            row_height = np.mean([item["bbox"][3] for item in row])
            if abs(candidate["center"][1] - row_center) <= max(8.0, row_height * 0.62):
                row.append(candidate)
                break
        else:
            rows.append([candidate])

    def row_score(row: list[dict]) -> float:
        row_area = sum(item["area"] for item in row)
        row_center_x = np.mean([item["center"][0] for item in row])
        row_center_y = np.mean([item["center"][1] for item in row])
        center_penalty = abs(row_center_x / max(w, 1) - 0.5) + abs(row_center_y / max(h, 1) - 0.55)
        return row_area + 60 * len(row) - 80 * center_penalty

    best_row = max(rows, key=row_score)
    best_row = sorted(best_row, key=lambda item: item["bbox"][0])
    if len(best_row) > 4:
        best_row = best_row[:4]
    label = "".join(str(item["digit"]) for item in best_row)
    confidence = float(np.mean([item["score"] for item in best_row]))
    return label, confidence


@lru_cache(maxsize=1)
def _digit_templates() -> dict[int, list[np.ndarray]]:
    templates: dict[int, list[np.ndarray]] = {digit: [] for digit in range(10)}
    fonts = [cv2.FONT_HERSHEY_SIMPLEX, cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_PLAIN]
    for digit in range(10):
        for font in fonts:
            for scale in (0.9, 1.1, 1.35, 1.6):
                for thickness in (1, 2, 3):
                    canvas = np.zeros((64, 48), dtype=np.uint8)
                    text = str(digit)
                    (tw, th), baseline = cv2.getTextSize(text, font, scale, thickness)
                    x = max(0, (canvas.shape[1] - tw) // 2)
                    y = max(th + 1, (canvas.shape[0] + th) // 2 - baseline)
                    cv2.putText(canvas, text, (x, y), font, scale, 255, thickness, cv2.LINE_AA)
                    _, binary = cv2.threshold(canvas, 20, 255, cv2.THRESH_BINARY)
                    templates[digit].append(_normalize_digit(binary))
    return templates


def _normalize_digit(mask: np.ndarray) -> np.ndarray:
    coords = cv2.findNonZero(mask)
    output = np.zeros((36, 24), dtype=np.uint8)
    if coords is None:
        return output
    x, y, w, h = cv2.boundingRect(coords)
    glyph = mask[y : y + h, x : x + w]
    scale = min(20 / max(w, 1), 32 / max(h, 1))
    resized = cv2.resize(glyph, (max(1, int(round(w * scale))), max(1, int(round(h * scale)))), interpolation=cv2.INTER_AREA)
    _, resized = cv2.threshold(resized, 40, 255, cv2.THRESH_BINARY)
    oy = (output.shape[0] - resized.shape[0]) // 2
    ox = (output.shape[1] - resized.shape[1]) // 2
    output[oy : oy + resized.shape[0], ox : ox + resized.shape[1]] = resized
    return output


def _split_digit_component(mask: np.ndarray) -> list[tuple[int, np.ndarray]]:
    height, width = mask.shape[:2]
    estimated = max(1, min(4, int(round(width / max(height * 0.68, 1)))))
    if estimated <= 1:
        return [(0, mask)]
    parts: list[tuple[int, np.ndarray]] = []
    for index in range(estimated):
        x0 = int(round(index * width / estimated))
        x1 = int(round((index + 1) * width / estimated))
        part = mask[:, x0:x1]
        if (part > 0).sum() >= 8:
            parts.append((x0, part))
    return parts or [(0, mask)]


def _classify_digit(mask: np.ndarray) -> tuple[int | None, float]:
    normalized = _normalize_digit(mask)
    if not normalized.any():
        return None, 0.0
    best_digit: int | None = None
    best_score = 0.0
    source = normalized > 0
    for digit, templates in _digit_templates().items():
        for template in templates:
            target = template > 0
            intersection = np.logical_and(source, target).sum()
            union = np.logical_or(source, target).sum()
            score = float(intersection / max(union, 1))
            if score > best_score:
                best_score = score
                best_digit = digit
    return best_digit, best_score


def _build_room_wall_segments(rooms: list[dict]) -> list[dict]:
    segments: list[dict] = []
    for room in rooms:
        polygon = [tuple(point) for point in room.get("polygon", [])]
        if len(polygon) < 3:
            continue
        for index, (start, end) in enumerate(zip(polygon, polygon[1:] + polygon[:1]), start=1):
            if _point_distance(start, end) < 8.0:
                continue
            segments.append(
                {
                    "id": f"{room['id']}-wall-{index}",
                    "room_id": room["id"],
                    "room_label": room["label"],
                    "wall_index": index,
                    "points": [[int(start[0]), int(start[1])], [int(end[0]), int(end[1])]],
                    "shared_wall_id": None,
                    "adjacent_room_labels": [],
                }
            )

    shared_index = 1
    for left_index, left in enumerate(segments):
        if left["shared_wall_id"]:
            continue
        matches = []
        for right in segments[left_index + 1 :]:
            if left["room_id"] == right["room_id"] or right["shared_wall_id"]:
                continue
            if _segments_are_shared(left["points"], right["points"]):
                matches.append(right)
        if matches:
            shared_id = f"shared-{shared_index:04d}"
            shared_index += 1
            left["shared_wall_id"] = shared_id
            for match in matches:
                match["shared_wall_id"] = shared_id
                match["adjacent_room_labels"].append(left["room_label"])
                left["adjacent_room_labels"].append(match["room_label"])

    return segments


def _segments_are_shared(left_points: list[list[int]], right_points: list[list[int]]) -> bool:
    a0 = np.array(left_points[0], dtype=np.float32)
    a1 = np.array(left_points[1], dtype=np.float32)
    b0 = np.array(right_points[0], dtype=np.float32)
    b1 = np.array(right_points[1], dtype=np.float32)
    av = a1 - a0
    bv = b1 - b0
    al = float(np.linalg.norm(av))
    bl = float(np.linalg.norm(bv))
    if al < 8 or bl < 8:
        return False
    av_unit = av / al
    bv_unit = bv / bl
    angle = abs(float(av_unit[0] * bv_unit[1] - av_unit[1] * bv_unit[0]))
    if angle > 0.18:
        return False
    normal_distance = max(_point_line_distance(tuple(b0), tuple(a0), tuple(a1)), _point_line_distance(tuple(b1), tuple(a0), tuple(a1)))
    if normal_distance > 18.0:
        return False
    axis = av / al
    a_range = sorted([0.0, al])
    b_proj = sorted([float(np.dot(b0 - a0, axis)), float(np.dot(b1 - a0, axis))])
    overlap = max(0.0, min(a_range[1], b_proj[1]) - max(a_range[0], b_proj[0]))
    return overlap >= min(al, bl) * 0.42


def _floor_plan_mask(image_bgr: np.ndarray, hint_mask: np.ndarray | None) -> np.ndarray:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    adaptive = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        10,
    )
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    edges = cv2.Canny(gray, 50, 135)
    mask = cv2.bitwise_or(adaptive, otsu)
    mask = cv2.bitwise_or(mask, cv2.dilate(edges, np.ones((2, 2), np.uint8), iterations=1))

    if hint_mask is not None:
        hint = cv2.resize(hint_mask, (mask.shape[1], mask.shape[0]), interpolation=cv2.INTER_NEAREST)
        _, hint = cv2.threshold(hint, 20, 255, cv2.THRESH_BINARY)
        hint = cv2.dilate(hint, np.ones((15, 15), np.uint8), iterations=1)
        mask = cv2.bitwise_and(mask, hint)

    mask = _remove_small_components(mask, min_area=max(18, int(mask.size * 0.00004)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8), iterations=1)
    return mask


def _remove_small_components(mask: np.ndarray, min_area: int) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    cleaned = np.zeros_like(mask)
    height, width = mask.shape[:2]
    max_area = int(height * width * 0.55)
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if min_area <= area <= max_area:
            cleaned[labels == label] = 255
    return cleaned


def _features_from_mask(mask: np.ndarray) -> list[VectorFeature]:
    skeleton = skeletonize(mask > 0).astype(np.uint8)
    if not skeleton.any():
        return []

    segments = _trace_skeleton_segments(skeleton)
    if not segments:
        segments = _contour_segments(mask)

    features: list[VectorFeature] = []
    seen: set[tuple[PixelPoint, ...]] = set()
    for index, segment in enumerate(segments):
        simplified = _simplify_segment(segment)
        if len(simplified) < 2:
            continue
        key = tuple(simplified)
        reverse_key = tuple(reversed(simplified))
        if key in seen or reverse_key in seen:
            continue
        seen.add(key)
        closed = len(simplified) >= 4 and _point_distance(simplified[0], simplified[-1]) <= 3.0
        features.append(
            VectorFeature(
                feature_id=f"line-{len(features) + 1}",
                kind="line",
                points=simplified,
                closed=closed,
            )
        )

    features.sort(key=lambda feature: _feature_length(feature.points), reverse=True)
    return features[:240]


def _trace_skeleton_segments(skeleton: np.ndarray) -> list[list[PixelPoint]]:
    height, width = skeleton.shape
    coords = np.argwhere(skeleton > 0)
    pixels = {(int(x), int(y)) for y, x in coords}
    degree = {pixel: len(_neighbors(pixel, pixels)) for pixel in pixels}
    nodes = {pixel for pixel, value in degree.items() if value != 2}
    visited_edges: set[frozenset[PixelPoint]] = set()
    segments: list[list[PixelPoint]] = []

    for node in sorted(nodes):
        for neighbor in _neighbors(node, pixels):
            edge = frozenset((node, neighbor))
            if edge in visited_edges:
                continue
            path = [node, neighbor]
            visited_edges.add(edge)
            previous = node
            current = neighbor
            while current not in nodes:
                next_pixels = [item for item in _neighbors(current, pixels) if item != previous]
                if not next_pixels:
                    break
                next_pixel = next_pixels[0]
                edge = frozenset((current, next_pixel))
                if edge in visited_edges:
                    break
                visited_edges.add(edge)
                path.append(next_pixel)
                previous, current = current, next_pixel
            if _feature_length(path) >= max(10.0, min(height, width) * 0.035):
                segments.append(path)

    remaining = [pixel for pixel in pixels if all(frozenset((pixel, n)) not in visited_edges for n in _neighbors(pixel, pixels))]
    for start in remaining:
        if not skeleton[start[1], start[0]]:
            continue
        component = _component_from(start, pixels)
        if len(component) >= 16:
            ordered = sorted(component)
            segments.append(ordered)
        for x, y in component:
            if 0 <= y < height and 0 <= x < width:
                skeleton[y, x] = 0

    return segments


def _neighbors(pixel: PixelPoint, pixels: set[PixelPoint]) -> list[PixelPoint]:
    x, y = pixel
    items = []
    for ny in (y - 1, y, y + 1):
        for nx in (x - 1, x, x + 1):
            if nx == x and ny == y:
                continue
            if (nx, ny) in pixels:
                items.append((nx, ny))
    return items


def _component_from(start: PixelPoint, pixels: set[PixelPoint]) -> set[PixelPoint]:
    queue: deque[PixelPoint] = deque([start])
    visited = {start}
    while queue:
        item = queue.popleft()
        for neighbor in _neighbors(item, pixels):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return visited


def _contour_segments(mask: np.ndarray) -> list[list[PixelPoint]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    segments: list[list[PixelPoint]] = []
    for contour in contours:
        if cv2.arcLength(contour, False) < 24:
            continue
        points = [(int(x), int(y)) for x, y in contour.reshape(-1, 2)]
        segments.append(points)
    return segments


def _simplify_segment(points: list[PixelPoint]) -> list[PixelPoint]:
    if len(points) <= 2:
        return points
    array = np.array(points, dtype=np.float32).reshape(-1, 1, 2)
    length = cv2.arcLength(array, False)
    epsilon = max(0.85, min(2.25, length * 0.006))
    simplified = cv2.approxPolyDP(array, epsilon, False).reshape(-1, 2)
    output = [(int(round(x)), int(round(y))) for x, y in simplified]
    if output[0] != points[0]:
        output.insert(0, points[0])
    if output[-1] != points[-1]:
        output.append(points[-1])
    return _dedupe_adjacent(output)


def _dedupe_adjacent(points: list[PixelPoint]) -> list[PixelPoint]:
    output: list[PixelPoint] = []
    for point in points:
        if not output or _point_distance(output[-1], point) >= 1.5:
            output.append(point)
    return output


def _feature_length(points: list[PixelPoint]) -> float:
    return sum(_point_distance(a, b) for a, b in zip(points, points[1:]))


def _point_distance(a: PixelPoint, b: PixelPoint) -> float:
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


def _point_line_distance(point: PixelPoint, start: PixelPoint, end: PixelPoint) -> float:
    p = np.array(point, dtype=np.float32)
    a = np.array(start, dtype=np.float32)
    b = np.array(end, dtype=np.float32)
    ab = b - a
    length = float(np.linalg.norm(ab))
    if length <= 0:
        return float(np.linalg.norm(p - a))
    unit = ab / length
    delta = p - a
    return float(abs(unit[0] * delta[1] - unit[1] * delta[0]))
