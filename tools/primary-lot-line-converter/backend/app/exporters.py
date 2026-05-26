from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from html import escape

from app.geometry import close_ring
from app.models import PixelPoint, Point


def build_metadata(
    job_id: str,
    confidence: float,
    georef_mode: str,
    warnings: list[str],
    pixel_polygon: list[PixelPoint],
    geo_polygon: list[Point],
) -> dict:
    return {
        "job_id": job_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "confidence": round(float(confidence), 4),
        "georef_mode": georef_mode,
        "coordinate_order": "longitude,latitude,altitude",
        "source": "classic_cv_image_first",
        "warnings": warnings,
        "pixel_polygon": [[int(x), int(y)] for x, y in pixel_polygon],
        "geo_polygon": [[float(lon), float(lat)] for lon, lat in close_ring(geo_polygon)],
    }


def build_geojson(geo_polygon: list[Point], metadata: dict) -> str:
    closed = close_ring(geo_polygon)
    feature = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "job_id": metadata["job_id"],
                    "confidence": metadata["confidence"],
                    "georef_mode": metadata["georef_mode"],
                    "source": metadata["source"],
                    "warnings": metadata["warnings"],
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[lon, lat] for lon, lat in closed]],
                },
            }
        ],
    }
    return json.dumps(feature, indent=2)


def build_kml(geo_polygon: list[Point], metadata: dict) -> str:
    closed = close_ring(geo_polygon)
    coordinate_text = " ".join(f"{lon:.10f},{lat:.10f},0" for lon, lat in closed)
    description = (
        f"Primary lot boundary. Georef mode: {metadata['georef_mode']}. "
        "If mode is relative_0_0, coordinates are intentionally local placeholders."
    )
    warnings = "; ".join(metadata.get("warnings", []))
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Primary Lot Boundary</name>
    <Style id="primaryLotStyle">
      <LineStyle><color>ff1d22e8</color><width>4</width></LineStyle>
      <PolyStyle><color>331d22e8</color></PolyStyle>
    </Style>
    <Placemark>
      <name>Primary Lot Boundary</name>
      <description>{escape(description)}</description>
      <ExtendedData>
        <Data name="job_id"><value>{escape(str(metadata["job_id"]))}</value></Data>
        <Data name="confidence"><value>{metadata["confidence"]}</value></Data>
        <Data name="georef_mode"><value>{escape(str(metadata["georef_mode"]))}</value></Data>
        <Data name="source"><value>{escape(str(metadata["source"]))}</value></Data>
        <Data name="warnings"><value>{escape(warnings)}</value></Data>
      </ExtendedData>
      <styleUrl>#primaryLotStyle</styleUrl>
      <Polygon>
        <tessellate>1</tessellate>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>{coordinate_text}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>
'''


def build_kmz(geo_polygon: list[Point], metadata: dict) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", build_kml(geo_polygon, metadata))
    return buffer.getvalue()


def build_feature_geojson(geo_features: list[dict], metadata: dict) -> str:
    features = []
    for room in metadata.get("geo_rooms", []):
        coordinates = [[float(lon), float(lat)] for lon, lat in room.get("coordinates", [])]
        if len(coordinates) < 4:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "job_id": metadata["job_id"],
                    "mode": metadata.get("mode", "floor_plan"),
                    "kind": "room",
                    "room_id": room.get("id"),
                    "room_label": room.get("label"),
                    "label_source": room.get("label_source"),
                    "label_confidence": room.get("label_confidence"),
                    "confidence": metadata["confidence"],
                    "georef_mode": metadata["georef_mode"],
                    "source": metadata["source"],
                    "warnings": metadata["warnings"],
                },
                "geometry": {"type": "Polygon", "coordinates": [coordinates]},
            }
        )
    for segment in metadata.get("geo_wall_segments", []):
        coordinates = [[float(lon), float(lat)] for lon, lat in segment.get("coordinates", [])]
        if len(coordinates) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "job_id": metadata["job_id"],
                    "mode": metadata.get("mode", "floor_plan"),
                    "kind": "room_wall",
                    "wall_id": segment.get("id"),
                    "room_id": segment.get("room_id"),
                    "room_label": segment.get("room_label"),
                    "wall_index": segment.get("wall_index"),
                    "shared_wall_id": segment.get("shared_wall_id"),
                    "adjacent_room_labels": segment.get("adjacent_room_labels", []),
                    "confidence": metadata["confidence"],
                    "georef_mode": metadata["georef_mode"],
                    "source": metadata["source"],
                    "warnings": metadata["warnings"],
                },
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        )
    for item in geo_features:
        coordinates = [[float(lon), float(lat)] for lon, lat in item.get("coordinates", [])]
        if len(coordinates) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "job_id": metadata["job_id"],
                    "mode": metadata.get("mode", "floor_plan"),
                    "feature_id": item.get("id"),
                    "kind": item.get("kind", "line"),
                    "closed": bool(item.get("closed", False)),
                    "confidence": metadata["confidence"],
                    "georef_mode": metadata["georef_mode"],
                    "source": metadata["source"],
                    "warnings": metadata["warnings"],
                },
                "geometry": {"type": "LineString", "coordinates": coordinates},
            }
        )
    return json.dumps({"type": "FeatureCollection", "features": features}, indent=2)


def build_feature_kml(geo_features: list[dict], metadata: dict) -> str:
    room_placemarks = []
    for room in metadata.get("geo_rooms", []):
        coordinates = room.get("coordinates", [])
        if len(coordinates) < 4:
            continue
        coordinate_text = " ".join(f"{lon:.10f},{lat:.10f},0" for lon, lat in coordinates)
        room_placemarks.append(
            f"""
      <Placemark>
        <name>Room {escape(str(room.get("label", room.get("id", ""))) )}</name>
        <styleUrl>#roomStyle</styleUrl>
        <ExtendedData>
          <Data name="room_id"><value>{escape(str(room.get("id", "")))}</value></Data>
          <Data name="room_label"><value>{escape(str(room.get("label", "")))}</value></Data>
          <Data name="label_source"><value>{escape(str(room.get("label_source", "")))}</value></Data>
          <Data name="label_confidence"><value>{room.get("label_confidence", 0)}</value></Data>
        </ExtendedData>
        <Polygon>
          <tessellate>1</tessellate>
          <outerBoundaryIs><LinearRing><coordinates>{coordinate_text}</coordinates></LinearRing></outerBoundaryIs>
        </Polygon>
      </Placemark>"""
        )

    wall_placemarks = []
    for segment in metadata.get("geo_wall_segments", []):
        coordinates = segment.get("coordinates", [])
        if len(coordinates) < 2:
            continue
        coordinate_text = " ".join(f"{lon:.10f},{lat:.10f},0" for lon, lat in coordinates)
        adjacent = ",".join(str(item) for item in segment.get("adjacent_room_labels", []))
        wall_placemarks.append(
            f"""
      <Placemark>
        <name>Room {escape(str(segment.get("room_label", "")))} Wall {segment.get("wall_index", "")}</name>
        <styleUrl>#roomWallStyle</styleUrl>
        <ExtendedData>
          <Data name="wall_id"><value>{escape(str(segment.get("id", "")))}</value></Data>
          <Data name="room_id"><value>{escape(str(segment.get("room_id", "")))}</value></Data>
          <Data name="room_label"><value>{escape(str(segment.get("room_label", "")))}</value></Data>
          <Data name="wall_index"><value>{segment.get("wall_index", "")}</value></Data>
          <Data name="shared_wall_id"><value>{escape(str(segment.get("shared_wall_id") or ""))}</value></Data>
          <Data name="adjacent_room_labels"><value>{escape(adjacent)}</value></Data>
        </ExtendedData>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>{coordinate_text}</coordinates>
        </LineString>
      </Placemark>"""
        )

    line_strings = []
    for item in geo_features:
        coordinates = item.get("coordinates", [])
        if len(coordinates) < 2:
            continue
        coordinate_text = " ".join(f"{lon:.10f},{lat:.10f},0" for lon, lat in coordinates)
        line_strings.append(
            f"""
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>{coordinate_text}</coordinates>
        </LineString>"""
        )

    description = (
        "Floor plan linework. Georef mode: "
        f"{metadata['georef_mode']}. Coordinates are pixel-relative placeholders."
    )
    warnings = "; ".join(metadata.get("warnings", []))
    multi_geometry = "\n".join(line_strings)
    rooms_folder = f"""
    <Folder><name>Rooms</name>{''.join(room_placemarks)}
    </Folder>""" if room_placemarks else ""
    walls_folder = f"""
    <Folder><name>Room Wall Segments</name>{''.join(wall_placemarks)}
    </Folder>""" if wall_placemarks else ""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Floor Plan Linework</name>
    <Style id="floorPlanStyle">
      <LineStyle><color>ffffffff</color><width>3</width></LineStyle>
    </Style>
    <Style id="roomStyle">
      <LineStyle><color>ff000000</color><width>2</width></LineStyle>
      <PolyStyle><color>55ffffff</color></PolyStyle>
    </Style>
    <Style id="roomWallStyle">
      <LineStyle><color>ff000000</color><width>3</width></LineStyle>
    </Style>
    {rooms_folder}
    {walls_folder}
    <Placemark>
      <name>Floor Plan Linework</name>
      <description>{escape(description)}</description>
      <ExtendedData>
        <Data name="job_id"><value>{escape(str(metadata["job_id"]))}</value></Data>
        <Data name="mode"><value>{escape(str(metadata.get("mode", "floor_plan")))}</value></Data>
        <Data name="confidence"><value>{metadata["confidence"]}</value></Data>
        <Data name="georef_mode"><value>{escape(str(metadata["georef_mode"]))}</value></Data>
        <Data name="source"><value>{escape(str(metadata["source"]))}</value></Data>
        <Data name="warnings"><value>{escape(warnings)}</value></Data>
      </ExtendedData>
      <styleUrl>#floorPlanStyle</styleUrl>
      <MultiGeometry>{multi_geometry}
      </MultiGeometry>
    </Placemark>
  </Document>
</kml>
'''


def build_feature_kmz(geo_features: list[dict], metadata: dict) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", build_feature_kml(geo_features, metadata))
    return buffer.getvalue()


def build_shapefile_zip(geo_features: list[dict], metadata: dict) -> bytes:
    import shapefile

    shp_buffer = io.BytesIO()
    shx_buffer = io.BytesIO()
    dbf_buffer = io.BytesIO()
    writer = shapefile.Writer(shp=shp_buffer, shx=shx_buffer, dbf=dbf_buffer, shapeType=shapefile.POLYLINE)
    writer.field("id", "C", size=32)
    writer.field("mode", "C", size=16)
    writer.field("room", "C", size=32)
    writer.field("wall", "N", size=8)
    writer.field("shared", "C", size=32)
    writer.field("conf", "F", size=10, decimal=4)
    writer.field("georef", "C", size=32)
    line_items = metadata.get("geo_wall_segments") or geo_features
    for index, item in enumerate(line_items, start=1):
        coordinates = [(float(lon), float(lat)) for lon, lat in item.get("coordinates", [])]
        if len(coordinates) < 2:
            continue
        writer.line([coordinates])
        writer.record(
            str(item.get("id") or item.get("wall_id") or f"line-{index}")[:32],
            str(metadata.get("mode", "floor_plan"))[:16],
            str(item.get("room_label", ""))[:32],
            int(item.get("wall_index") or 0),
            str(item.get("shared_wall_id") or "")[:32],
            float(metadata.get("confidence", 0.0)),
            str(metadata.get("georef_mode", "relative_0_0"))[:32],
        )
    writer.close()

    prj = 'GEOGCS["Relative_0_0",DATUM["Relative",SPHEROID["Relative",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("floor_plan.shp", shp_buffer.getvalue())
        archive.writestr("floor_plan.shx", shx_buffer.getvalue())
        archive.writestr("floor_plan.dbf", dbf_buffer.getvalue())
        archive.writestr("floor_plan.prj", prj)
        archive.writestr("metadata.json", json.dumps(metadata, indent=2))
    return buffer.getvalue()
