from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.floor_plan import create_floor_plan_overlay, extract_floor_plan  # noqa: E402


def fixture_lines(index: int, width: int, height: int) -> list[list[tuple[int, int]]]:
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
        center = (right - 42, bottom - 58)
        radius = 44
        curve = []
        for angle in np.linspace(-92, 8, 18):
            rad = math.radians(float(angle))
            curve.append((int(center[0] + math.cos(rad) * radius), int(center[1] + math.sin(rad) * radius)))
        lines.append(curve)
    if index % 5 == 0:
        lines.append([(margin + 28, margin + 34), (mid_x - 22, mid_y - 26), (mid_x - 8, bottom - 34)])
    if index % 6 == 0:
        lines.append([(mid_x + 20, margin + 24), (right - 22, mid_y - 22), (right - 70, bottom - 24)])
    return lines


def make_floor_plan(index: int, scanned: bool = False) -> tuple[np.ndarray, list[list[tuple[int, int]]]]:
    width = 420 + (index % 4) * 28
    height = 320 + (index % 3) * 26
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    lines = fixture_lines(index, width, height)
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
        image = cv2.add(image, rng.normal(0, 9, image.shape).astype(np.int16), dtype=cv2.CV_8U)
    return image, lines


def line_mask(lines: list[list[tuple[int, int]]], shape: tuple[int, int], thickness: int = 7) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    for line in lines:
        cv2.polylines(mask, [np.array(line, dtype=np.int32)], False, 255, thickness, cv2.LINE_AA)
    return mask


def result_mask(result, shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    for feature in result.pixel_features:
        cv2.polylines(mask, [np.array(feature.points, dtype=np.int32)], False, 255, 7, cv2.LINE_AA)
    return mask


def iou(a: np.ndarray, b: np.ndarray) -> float:
    a_bool = a > 0
    b_bool = b > 0
    union = np.logical_or(a_bool, b_bool).sum()
    return float(np.logical_and(a_bool, b_bool).sum() / max(union, 1))


def label(image: np.ndarray, text: str) -> np.ndarray:
    output = image.copy()
    cv2.rectangle(output, (0, 0), (output.shape[1], 34), (0, 0, 0), -1)
    cv2.putText(output, text, (10, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (255, 255, 255), 2, cv2.LINE_AA)
    return output


def main() -> None:
    out_dir = ROOT / "reports" / "floor_plan_eval"
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    contact_items = []
    for index in range(20):
        image, expected_lines = make_floor_plan(index, scanned=index % 3 == 0)
        result = extract_floor_plan(image)
        expected = line_mask(expected_lines, image.shape[:2])
        actual = result_mask(result, image.shape[:2])
        score = iou(actual, expected)
        passed = bool(result.detected and result.feature_count >= 4 and result.confidence >= 0.55 and score >= 0.56)
        overlay = create_floor_plan_overlay(image, result)
        expected_bgr = cv2.cvtColor(expected, cv2.COLOR_GRAY2BGR)
        actual_bgr = cv2.cvtColor(actual, cv2.COLOR_GRAY2BGR)
        compare = np.hstack(
            [
                label(image, f"input {index + 1}"),
                label(expected_bgr, "ground truth"),
                label(overlay, f"overlay {score:.2f}"),
                label(actual_bgr, "export mask"),
            ]
        )
        cv2.imwrite(str(out_dir / f"floor_{index + 1:02d}_compare.png"), compare)
        contact_items.append(cv2.resize(compare, (840, 170), interpolation=cv2.INTER_AREA))
        rows.append(
            {
                "fixture": f"floor_{index + 1:02d}",
                "detected": result.detected,
                "confidence": round(float(result.confidence), 4),
                "feature_count": result.feature_count,
                "line_iou": round(score, 4),
                "passed": passed,
            }
        )

    contact = np.vstack(contact_items)
    cv2.imwrite(str(out_dir / "contact_sheet.png"), contact)
    summary = {
        "fixture_count": len(rows),
        "passed": sum(1 for row in rows if row["passed"]),
        "pass_rate": round(sum(1 for row in rows if row["passed"]) / len(rows), 4),
        "rows": rows,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
