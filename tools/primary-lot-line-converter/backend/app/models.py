from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

Point = tuple[float, float]
PixelPoint = tuple[int, int]
GeorefMode = Literal["georeferenced", "estimated_from_image_clues", "relative_0_0"]
JobMode = Literal["parcel", "floor_plan"]


@dataclass
class VectorFeature:
    feature_id: str
    kind: Literal["line", "polygon"]
    points: list[PixelPoint]
    closed: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ExtractionResult:
    detected: bool
    confidence: float
    pixel_polygon: list[PixelPoint] = field(default_factory=list)
    pixel_features: list[VectorFeature] = field(default_factory=list)
    rooms: list[dict] = field(default_factory=list)
    wall_segments: list[dict] = field(default_factory=list)
    georef_mode: GeorefMode = "relative_0_0"
    warnings: list[str] = field(default_factory=list)
    error_code: str | None = None
    used_hint: bool = False
    candidate_count: int = 0
    mode: JobMode = "parcel"
    geometry_type: Literal["polygon", "linework"] = "polygon"

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def feature_count(self) -> int:
        if self.mode == "floor_plan":
            return len(self.pixel_features)
        return 1 if self.detected and self.pixel_polygon else 0

    @property
    def room_count(self) -> int:
        return len(self.rooms) if self.mode == "floor_plan" else 0

    def to_metadata(
        self,
        job_id: str,
        width: int,
        height: int,
        geo_features: list[dict] | None = None,
        geo_rooms: list[dict] | None = None,
        geo_wall_segments: list[dict] | None = None,
        geo_polygon: list[Point] | None = None,
    ) -> dict:
        from app.exporters import build_metadata

        if self.mode == "floor_plan":
            return {
                "job_id": job_id,
                "mode": "floor_plan",
                "geometry_type": "linework",
                "feature_count": self.feature_count,
                "room_count": self.room_count,
                "width": int(width),
                "height": int(height),
                "confidence": round(float(self.confidence), 4),
                "georef_mode": self.georef_mode,
                "coordinate_order": "longitude,latitude,altitude",
                "units": "pixel_relative",
                "source": "classic_cv_image_first",
                "warnings": self.warnings,
                "pixel_features": [
                    {
                        "id": feature.feature_id,
                        "kind": feature.kind,
                        "closed": feature.closed,
                        "points": [[int(x), int(y)] for x, y in feature.points],
                    }
                    for feature in self.pixel_features
                ],
                "rooms": self.rooms,
                "wall_segments": self.wall_segments,
                "geo_features": geo_features or [],
                "geo_rooms": geo_rooms or [],
                "geo_wall_segments": geo_wall_segments or [],
            }

        return build_metadata(
            job_id=job_id,
            confidence=self.confidence,
            georef_mode=self.georef_mode,
            warnings=self.warnings,
            pixel_polygon=self.pixel_polygon,
            geo_polygon=geo_polygon or [],
        )


@dataclass
class JobRecord:
    job_id: str
    status: Literal["complete", "failed"]
    filename: str
    width: int
    height: int
    result: ExtractionResult
    metadata: dict

    def to_public_dict(self) -> dict:
        data = {
            "job_id": self.job_id,
            "status": self.status,
            "filename": self.filename,
            "width": self.width,
            "height": self.height,
            "mode": self.result.mode,
            "detected": self.result.detected,
            "confidence": self.result.confidence,
            "georef_mode": self.result.georef_mode,
            "warnings": self.result.warnings,
            "error_code": self.result.error_code,
            "used_hint": self.result.used_hint,
            "candidate_count": self.result.candidate_count,
            "feature_count": self.result.feature_count,
            "room_count": self.result.room_count,
            "geometry_type": self.result.geometry_type,
        }
        if self.result.detected:
            data["exports"] = (
                ["kml", "kmz", "geojson", "shp", "metadata"]
                if self.result.mode == "floor_plan"
                else ["kml", "kmz", "geojson", "metadata"]
            )
        return data
