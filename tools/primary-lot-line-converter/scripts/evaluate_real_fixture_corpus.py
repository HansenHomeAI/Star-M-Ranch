from __future__ import annotations

import base64
import io
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import cv2
import numpy as np

from app.extraction import create_overlay, extract_primary_lot, result_geo_polygon
from app.exporters import build_kml, build_kmz, build_metadata


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "backend" / "tests" / "fixtures" / "real_parcels"
REPORT_DIR = ROOT / "reports" / "real_fixture_eval"


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    a_bool = a > 0
    b_bool = b > 0
    union = np.logical_or(a_bool, b_bool).sum()
    if union == 0:
        return 0.0
    return float(np.logical_and(a_bool, b_bool).sum() / union)


def polygon_mask(points: list[tuple[int, int]], shape: tuple[int, int]) -> np.ndarray:
    mask = np.zeros(shape, dtype=np.uint8)
    if points:
        cv2.fillPoly(mask, [np.array(points, dtype=np.int32)], 255)
    return mask


def parse_kml_lonlat(kml_text: str) -> list[tuple[float, float]]:
    root = ElementTree.fromstring(kml_text)
    node = root.find(".//{http://www.opengis.net/kml/2.2}coordinates")
    if node is None or not node.text:
        return []
    coords = []
    for part in node.text.split():
        lon, lat, *_ = part.split(",")
        coords.append((float(lon), float(lat)))
    if coords and coords[0] == coords[-1]:
        coords.pop()
    return coords


def lonlat_to_pixels(coords: list[tuple[float, float]], width: int, height: int) -> list[tuple[int, int]]:
    scale = 0.01 / max(width, height, 1)
    center_x = width / 2.0
    center_y = height / 2.0
    return [(int(round((lon / scale) + center_x)), int(round(center_y - (lat / scale)))) for lon, lat in coords]


def encode_img(image: np.ndarray) -> str:
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("Could not encode report image")
    return base64.b64encode(encoded.tobytes()).decode("ascii")


def labeled_panel(title: str, image: np.ndarray) -> np.ndarray:
    target_h = 220
    scale = target_h / image.shape[0]
    resized = cv2.resize(image, (int(image.shape[1] * scale), target_h), interpolation=cv2.INTER_AREA)
    panel = np.full((target_h + 34, resized.shape[1], 3), 248, dtype=np.uint8)
    panel[34:, :] = resized
    cv2.putText(panel, title, (8, 23), cv2.FONT_HERSHEY_SIMPLEX, 0.58, (30, 35, 40), 2, cv2.LINE_AA)
    return panel


def make_row(input_img: np.ndarray, expected_mask: np.ndarray, overlay: np.ndarray, kml_mask: np.ndarray, label: str) -> np.ndarray:
    expected = input_img.copy()
    fill = expected.copy()
    cv2.cvtColor(expected_mask, cv2.COLOR_GRAY2BGR, dst=fill)
    fill[:, :, 0] = 40
    fill[:, :, 1] = np.where(expected_mask > 0, 210, fill[:, :, 1])
    fill[:, :, 2] = np.where(expected_mask > 0, 40, fill[:, :, 2])
    expected = cv2.addWeighted(fill, 0.35, expected, 0.65, 0)

    kml = input_img.copy()
    points = cv2.findContours(kml_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]
    if points:
        cv2.drawContours(kml, points, -1, (255, 70, 30), 4, cv2.LINE_AA)

    panels = [
        labeled_panel(f"{label} input", input_img),
        labeled_panel("ground truth", expected),
        labeled_panel("detector overlay", overlay),
        labeled_panel("KML reprojected", kml),
    ]
    height = max(panel.shape[0] for panel in panels)
    normalized = []
    for panel in panels:
        if panel.shape[0] < height:
            pad = np.full((height - panel.shape[0], panel.shape[1], 3), 248, dtype=np.uint8)
            panel = np.vstack([panel, pad])
        normalized.append(panel)
    return np.hstack(normalized)


def evaluate() -> dict:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))
    results = []
    rows = []
    for item in manifest:
        image = cv2.imread(str(FIXTURE_DIR / item["image"]), cv2.IMREAD_COLOR)
        expected_mask = cv2.imread(str(FIXTURE_DIR / item["mask"]), cv2.IMREAD_GRAYSCALE)
        result = extract_primary_lot(image)
        detected_mask = polygon_mask(result.pixel_polygon, image.shape[:2])
        iou = mask_iou(detected_mask, expected_mask)

        geo_polygon = result_geo_polygon(result, image.shape[1], image.shape[0]) if result.detected else []
        metadata = build_metadata(
            item["id"],
            result.confidence,
            result.georef_mode,
            result.warnings,
            result.pixel_polygon,
            geo_polygon,
        )
        kml_text = build_kml(geo_polygon, metadata) if result.detected else ""
        kmz_ok = False
        kml_mask = np.zeros(image.shape[:2], dtype=np.uint8)
        if result.detected:
            with zipfile.ZipFile(io.BytesIO(build_kmz(geo_polygon, metadata))) as archive:
                kmz_ok = archive.namelist() == ["doc.kml"]
            kml_pixels = lonlat_to_pixels(parse_kml_lonlat(kml_text), image.shape[1], image.shape[0])
            kml_mask = polygon_mask(kml_pixels, image.shape[:2])

        overlay = create_overlay(image, result)
        passed = bool(result.detected and result.confidence >= 0.55 and iou >= 0.62 and kmz_ok)
        row = make_row(image, expected_mask, overlay, kml_mask, f"{item['id']} {'PASS' if passed else 'FAIL'}")
        cv2.imwrite(str(REPORT_DIR / f"{item['id']}_compare.png"), row)
        rows.append(row)
        results.append(
            {
                **item,
                "detected": result.detected,
                "confidence": round(result.confidence, 4),
                "iou": round(iou, 4),
                "kmz_has_doc_kml": kmz_ok,
                "passed": passed,
                "comparison": f"{item['id']}_compare.png",
            }
        )

    max_width = max(row.shape[1] for row in rows)
    padded_rows = []
    for row in rows:
        if row.shape[1] < max_width:
            pad = np.full((row.shape[0], max_width - row.shape[1], 3), 248, dtype=np.uint8)
            row = np.hstack([row, pad])
        padded_rows.append(row)
    contact_sheet = np.vstack(padded_rows)
    cv2.imwrite(str(REPORT_DIR / "contact_sheet.png"), contact_sheet)

    passed_count = sum(1 for row in results if row["passed"])
    summary = {
        "fixture_count": len(results),
        "passed": passed_count,
        "failed": len(results) - passed_count,
        "pass_rate": round(passed_count / max(len(results), 1), 4),
        "min_iou": min(row["iou"] for row in results),
        "median_iou": round(float(np.median([row["iou"] for row in results])), 4),
        "results": results,
    }
    (REPORT_DIR / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    html_rows = "\n".join(
        f"<tr class='{('pass' if row['passed'] else 'fail')}'><td>{row['id']}</td><td>{row['source_name']}</td>"
        f"<td>{row['highlight_style']}</td><td>{row['confidence']}</td><td>{row['iou']}</td>"
        f"<td>{row['passed']}</td><td><img src='{row['comparison']}' /></td></tr>"
        for row in results
    )
    (REPORT_DIR / "index.html").write_text(
        f"""<!doctype html><html><head><meta charset='utf-8'><title>Real Fixture Evaluation</title>
<style>body{{font-family:Arial,sans-serif;margin:24px;background:#f4f6f8;color:#1d232b}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #cfd6de;padding:6px;vertical-align:top}}img{{max-width:100%;height:auto}}.pass{{background:#ecf8ef}}.fail{{background:#fff0f0}}</style>
</head><body><h1>Real Parcel Fixture Evaluation</h1><p>{passed_count}/{len(results)} passed. Median IoU {summary['median_iou']}. Minimum IoU {summary['min_iou']}.</p><table><thead><tr><th>ID</th><th>Source</th><th>Style</th><th>Confidence</th><th>IoU</th><th>Pass</th><th>Visual Comparison</th></tr></thead><tbody>{html_rows}</tbody></table></body></html>""",
        encoding="utf-8",
    )
    return summary


if __name__ == "__main__":
    print(json.dumps(evaluate(), indent=2))

