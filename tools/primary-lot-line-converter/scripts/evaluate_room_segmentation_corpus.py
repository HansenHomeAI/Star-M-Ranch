from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.floor_plan import create_floor_plan_overlay, extract_floor_plan  # noqa: E402


def make_room_map(index: int) -> tuple[np.ndarray, list[str]]:
    width, height = 760, 460
    image = np.full((height, width, 3), 248, dtype=np.uint8)
    labels: list[str] = []
    colors = [(178, 133, 72), (212, 184, 106), (128, 76, 58), (224, 201, 130), (166, 96, 72)]
    room_w = 76 + (index % 3) * 8
    room_h = 58 + (index % 2) * 8
    gap = 7 + (index % 2)
    start_x = 70
    start_y = 52 + index * 4
    label = 1 + index * 20
    rows = 2 + (index % 2)
    cols = 5 + (index % 2)
    for row in range(rows):
        for col in range(cols):
            left = start_x + col * (room_w + gap)
            top = start_y + row * (room_h + gap)
            right = left + room_w
            bottom = top + room_h
            color = colors[(row * cols + col + index) % len(colors)]
            cv2.rectangle(image, (left, top), (right, bottom), color, -1)
            cv2.rectangle(image, (left, top), (right, bottom), (20, 20, 20), 3)
            text = str(label)
            labels.append(text)
            text_color = (10, 10, 10) if sum(color) > 450 else (242, 242, 242)
            cv2.putText(image, text, (left + 15, top + room_h // 2 + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.64, text_color, 2, cv2.LINE_AA)
            label += 1
    cv2.putText(image, "ROOM MAP", (70, height - 48), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (170, 170, 170), 1, cv2.LINE_AA)
    if index % 2:
        noise = np.random.default_rng(index).normal(0, 3, image.shape).astype(np.int16)
        image = cv2.add(image, noise, dtype=cv2.CV_8U)
    return image, labels


def label_strip(image: np.ndarray, text: str) -> np.ndarray:
    out = image.copy()
    cv2.rectangle(out, (0, 0), (out.shape[1], 34), (0, 0, 0), -1)
    cv2.putText(out, text, (10, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.56, (255, 255, 255), 2, cv2.LINE_AA)
    return out


def main() -> None:
    out_dir = ROOT / "reports" / "room_segmentation_eval"
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    contact = []
    for index in range(4):
        image, labels = make_room_map(index)
        result = extract_floor_plan(image)
        detected_labels = {room["label"] for room in result.rooms}
        label_recall = len(set(labels) & detected_labels) / max(len(labels), 1)
        shared_walls = sum(1 for segment in result.wall_segments if segment.get("shared_wall_id"))
        passed = bool(result.detected and label_recall >= 0.90 and shared_walls >= len(labels))
        overlay = create_floor_plan_overlay(image, result)
        compare = np.hstack([label_strip(image, f"input {index + 1}"), label_strip(overlay, f"rooms {label_recall:.2f}")])
        cv2.imwrite(str(out_dir / f"room_{index + 1:02d}_compare.png"), compare)
        contact.append(cv2.resize(compare, (980, 300), interpolation=cv2.INTER_AREA))
        rows.append(
            {
                "fixture": f"room_{index + 1:02d}",
                "expected_rooms": len(labels),
                "detected_rooms": result.room_count,
                "label_recall": round(label_recall, 4),
                "shared_wall_segments": shared_walls,
                "passed": passed,
            }
        )
    cv2.imwrite(str(out_dir / "contact_sheet.png"), np.vstack(contact))
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
