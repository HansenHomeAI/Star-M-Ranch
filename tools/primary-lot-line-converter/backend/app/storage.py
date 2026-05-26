from __future__ import annotations

import json
import uuid
from pathlib import Path

import numpy as np

from app.exporters import (
    build_feature_geojson,
    build_feature_kml,
    build_feature_kmz,
    build_geojson,
    build_kml,
    build_kmz,
    build_metadata,
    build_shapefile_zip,
)
from app.models import JobMode, JobRecord, VectorFeature

ROOT = Path(__file__).resolve().parents[2]
JOB_DIR = ROOT / "data" / "jobs"
JOB_DIR.mkdir(parents=True, exist_ok=True)


def create_job(image: np.ndarray, filename: str, mode: JobMode = "parcel") -> JobRecord:
    import cv2

    job_id = uuid.uuid4().hex
    job_path = JOB_DIR / job_id
    job_path.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(job_path / "original.png"), image)
    return _run_extraction(job_id, filename, image, None, mode)


def rerun_with_hint(job_id: str, hint_mask: np.ndarray) -> JobRecord:
    import cv2

    job_path = _job_path(job_id)
    image = cv2.imread(str(job_path / "original.png"), cv2.IMREAD_COLOR)
    if image is None:
        raise KeyError(job_id)
    cv2.imwrite(str(job_path / "hint.png"), hint_mask)
    record = _load_record(job_id)
    return _run_extraction(job_id, record.filename, image, hint_mask, record.result.mode)


def get_job(job_id: str) -> JobRecord:
    return _load_record(job_id)


def get_file(job_id: str, name: str) -> Path:
    path = _job_path(job_id) / name
    if not path.exists():
        raise KeyError(job_id)
    return path


def _run_extraction(
    job_id: str, filename: str, image: np.ndarray, hint_mask: np.ndarray | None, mode: JobMode
) -> JobRecord:
    from app.extraction import create_overlay, extract_primary_lot, result_geo_polygon
    from app.floor_plan import create_floor_plan_overlay, extract_floor_plan, floor_plan_geometry_to_relative
    from app.image_io import encode_png

    job_path = _job_path(job_id)
    result = (
        extract_floor_plan(image, hint_mask=hint_mask)
        if mode == "floor_plan"
        else extract_primary_lot(image, hint_mask=hint_mask)
    )
    overlay = create_floor_plan_overlay(image, result) if mode == "floor_plan" else create_overlay(image, result)
    (job_path / "overlay.png").write_bytes(encode_png(overlay))

    geo_polygon = []
    geo_features: list[dict] = []
    if mode == "floor_plan":
        geometry = (
            floor_plan_geometry_to_relative(result, image.shape[1], image.shape[0])
            if result.detected
            else {"geo_features": [], "geo_rooms": [], "geo_wall_segments": []}
        )
        geo_features = geometry["geo_features"]
        metadata = result.to_metadata(
            job_id=job_id,
            width=image.shape[1],
            height=image.shape[0],
            geo_features=geo_features,
            geo_rooms=geometry["geo_rooms"],
            geo_wall_segments=geometry["geo_wall_segments"],
        )
    else:
        geo_polygon = result_geo_polygon(result, image.shape[1], image.shape[0]) if result.detected else []
        metadata = build_metadata(
            job_id=job_id,
            confidence=result.confidence,
            georef_mode=result.georef_mode,
            warnings=result.warnings,
            pixel_polygon=result.pixel_polygon,
            geo_polygon=geo_polygon,
        )
    (job_path / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    if result.detected:
        if mode == "floor_plan":
            (job_path / "boundary.kml").write_text(build_feature_kml(geo_features, metadata), encoding="utf-8")
            (job_path / "boundary.kmz").write_bytes(build_feature_kmz(geo_features, metadata))
            (job_path / "boundary.geojson").write_text(
                build_feature_geojson(geo_features, metadata), encoding="utf-8"
            )
            (job_path / "boundary.shp.zip").write_bytes(build_shapefile_zip(geo_features, metadata))
        else:
            (job_path / "boundary.kml").write_text(build_kml(geo_polygon, metadata), encoding="utf-8")
            (job_path / "boundary.kmz").write_bytes(build_kmz(geo_polygon, metadata))
            (job_path / "boundary.geojson").write_text(build_geojson(geo_polygon, metadata), encoding="utf-8")
    else:
        for stale in ("boundary.kml", "boundary.kmz", "boundary.geojson", "boundary.shp.zip"):
            stale_path = job_path / stale
            if stale_path.exists():
                stale_path.unlink()

    record = JobRecord(
        job_id=job_id,
        status="complete",
        filename=filename,
        width=int(image.shape[1]),
        height=int(image.shape[0]),
        result=result,
        metadata=metadata,
    )
    (job_path / "record.json").write_text(json.dumps(record.to_public_dict(), indent=2), encoding="utf-8")
    return record


def _load_record(job_id: str) -> JobRecord:
    job_path = _job_path(job_id)
    record_path = job_path / "record.json"
    if not record_path.exists():
        raise KeyError(job_id)
    public = json.loads(record_path.read_text(encoding="utf-8"))
    metadata = json.loads((job_path / "metadata.json").read_text(encoding="utf-8"))
    from app.models import ExtractionResult

    result = ExtractionResult(
        detected=bool(public["detected"]),
        confidence=float(public["confidence"]),
        pixel_polygon=[tuple(point) for point in metadata.get("pixel_polygon", [])],
        pixel_features=[
            VectorFeature(
                feature_id=str(feature.get("id", f"line-{index}")),
                kind=feature.get("kind", "line"),
                points=[tuple(point) for point in feature.get("points", [])],
                closed=bool(feature.get("closed", False)),
            )
            for index, feature in enumerate(metadata.get("pixel_features", []), start=1)
        ],
        rooms=list(metadata.get("rooms", [])),
        wall_segments=list(metadata.get("wall_segments", [])),
        georef_mode=public.get("georef_mode", "relative_0_0"),
        warnings=list(public.get("warnings", [])),
        error_code=public.get("error_code"),
        used_hint=bool(public.get("used_hint", False)),
        candidate_count=int(public.get("candidate_count", 0)),
        mode=public.get("mode", metadata.get("mode", "parcel")),
        geometry_type=public.get("geometry_type", "linework" if metadata.get("mode") == "floor_plan" else "polygon"),
    )
    return JobRecord(
        job_id=job_id,
        status=public["status"],
        filename=public["filename"],
        width=int(public["width"]),
        height=int(public["height"]),
        result=result,
        metadata=metadata,
    )


def _job_path(job_id: str) -> Path:
    if not job_id or "/" in job_id or ".." in job_id:
        raise KeyError(job_id)
    path = JOB_DIR / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path
