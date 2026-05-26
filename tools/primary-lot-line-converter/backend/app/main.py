from __future__ import annotations

from pathlib import Path

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, JSONResponse
from starlette.routing import Route

from app.image_io import decode_hint, decode_upload
from app.storage import create_job, get_file, get_job, rerun_with_hint


async def health(_request):
    return JSONResponse({"ok": True})


async def post_job(request):
    form = await request.form()
    file = form.get("file")
    if file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="Missing upload file.")
    try:
        contents = await file.read()
        image = decode_upload(contents, file.filename or "upload", getattr(file, "content_type", None))
        mode = form.get("mode", "parcel")
        if mode not in {"parcel", "floor_plan"}:
            raise HTTPException(status_code=400, detail="Unsupported extraction mode.")
        record = create_job(image, file.filename or "upload", mode=mode)
        return JSONResponse(record.to_public_dict())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


async def get_job_status(request):
    try:
        return JSONResponse(get_job(request.path_params["job_id"]).to_public_dict())
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Job not found") from error


async def get_overlay(request):
    try:
        return FileResponse(get_file(request.path_params["job_id"], "overlay.png"), media_type="image/png")
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Overlay not found") from error


async def post_hint(request):
    form = await request.form()
    hint = form.get("hint")
    if hint is None or not hasattr(hint, "read"):
        raise HTTPException(status_code=400, detail="Missing hint image.")
    try:
        contents = await hint.read()
        mask = decode_hint(contents)
        record = rerun_with_hint(request.path_params["job_id"], mask)
        return JSONResponse(record.to_public_dict())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Job not found") from error


async def get_export(request):
    mapping = {
        "kml": ("boundary.kml", "application/vnd.google-earth.kml+xml"),
        "kmz": ("boundary.kmz", "application/vnd.google-earth.kmz"),
        "geojson": ("boundary.geojson", "application/geo+json"),
        "shp": ("boundary.shp.zip", "application/zip"),
        "shapefile": ("boundary.shp.zip", "application/zip"),
        "metadata": ("metadata.json", "application/json"),
    }
    kind = request.path_params["kind"]
    if kind not in mapping:
        raise HTTPException(status_code=404, detail="Unsupported export type")
    filename, media_type = mapping[kind]
    try:
        path = get_file(request.path_params["job_id"], filename)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Export not available") from error
    return FileResponse(path, media_type=media_type, filename=Path(filename).name)


app = Starlette(
    debug=False,
    routes=[
        Route("/api/health", health, methods=["GET"]),
        Route("/api/jobs", post_job, methods=["POST"]),
        Route("/api/jobs/{job_id}", get_job_status, methods=["GET"]),
        Route("/api/jobs/{job_id}/overlay.png", get_overlay, methods=["GET"]),
        Route("/api/jobs/{job_id}/hint", post_hint, methods=["POST"]),
        Route("/api/jobs/{job_id}/exports/{kind}", get_export, methods=["GET"]),
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
