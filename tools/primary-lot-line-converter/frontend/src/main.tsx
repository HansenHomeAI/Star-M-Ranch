import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = "http://127.0.0.1:8000";

type JobStatus = {
  job_id: string;
  status: "complete" | "failed";
  filename: string;
  width: number;
  height: number;
  mode: "parcel" | "floor_plan";
  detected: boolean;
  confidence: number;
  georef_mode: string;
  warnings: string[];
  error_code?: string;
  used_hint: boolean;
  candidate_count: number;
  feature_count: number;
  room_count: number;
  geometry_type: "polygon" | "linework";
  exports?: string[];
};

function Icon({ name, size = 18 }: { name: "download" | "eraser" | "file" | "highlighter" | "reset"; size?: number }) {
  const paths = {
    download: "M12 3v10m0 0 4-4m-4 4-4-4M5 17h14v4H5z",
    eraser: "M4 15 14 5l6 6-8 8H8zM12 19h8",
    file: "M6 3h8l4 4v14H6zM14 3v5h5",
    highlighter: "M4 18 15 7l4 4L8 22H4zM13 9l4 4",
    reset: "M4 12a8 8 0 1 0 2.3-5.7M4 5v5h5",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="icon">
      <path d={paths[name]} />
    </svg>
  );
}

function App() {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Drop a parcel map, aerial screenshot, site map, or PDF.");
  const [mode, setMode] = useState<"parcel" | "floor_plan">("parcel");
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [drawMode, setDrawMode] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  async function upload(file: File) {
    setBusy(true);
    setMessage(mode === "floor_plan" ? "Vectorizing floor plan linework..." : "Detecting primary lot line...");
    setDrawMode(false);
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    const response = await fetch(`${API_BASE}/api/jobs`, { method: "POST", body: form });
    if (!response.ok) {
      setBusy(false);
      setMessage(await response.text());
      return;
    }
    const payload = (await response.json()) as JobStatus;
    setJob(payload);
    setOverlayVersion((value) => value + 1);
    setBusy(false);
    setMessage(statusMessage(payload));
    if (!payload.detected) {
      setDrawMode(true);
      setTimeout(sizeCanvas, 100);
    }
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    if (file) void upload(file);
  }

  function sizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const context = canvas.getContext("2d");
    if (context) {
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "rgba(255, 255, 255, 0.92)";
      context.lineWidth = 18;
    }
  }

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawMode) return;
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d");
    const point = pointerPosition(event);
    context?.beginPath();
    context?.moveTo(point.x, point.y);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawMode || !drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    const point = pointerPosition(event);
    context?.lineTo(point.x, point.y);
    context?.stroke();
  }

  function stopDrawing() {
    drawingRef.current = false;
  }

  function clearHint() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function submitHint() {
    if (!job || !canvasRef.current) return;
    setBusy(true);
    setMessage(job.mode === "floor_plan" ? "Rerunning floor plan extraction with your highlight..." : "Rerunning extraction with your highlight...");
    const blob = await new Promise<Blob | null>((resolve) => canvasRef.current?.toBlob(resolve, "image/png"));
    if (!blob) {
      setBusy(false);
      setMessage("Could not read highlight.");
      return;
    }
    const form = new FormData();
    form.append("hint", blob, "hint.png");
    const response = await fetch(`${API_BASE}/api/jobs/${job.job_id}/hint`, { method: "POST", body: form });
    const payload = (await response.json()) as JobStatus;
    setJob(payload);
    setOverlayVersion((value) => value + 1);
    setBusy(false);
    setDrawMode(!payload.detected);
    setMessage(statusMessage(payload, true));
  }

  const overlayUrl = job ? `${API_BASE}/api/jobs/${job.job_id}/overlay.png?v=${overlayVersion}` : "";
  const confidence = job ? Math.round(job.confidence * 100) : 0;
  const isFloorPlan = (job?.mode ?? mode) === "floor_plan";
  const title = isFloorPlan ? "Floor Plan Linework Converter" : "Primary Lot Line Converter";
  const description = isFloorPlan
    ? "Exports vector floor-plan linework. Coordinates are intentionally relative_0_0 unless a future georeference workflow proves position."
    : "Exports closed lot polygons. Coordinates stay marked as relative when the image does not prove a real-world position.";
  const emptyText = isFloorPlan ? "Upload a floor plan to see extracted linework." : "Upload a map to see the extracted lot line overlay.";

  return (
    <main className="shell">
      <section className="toolbar">
        <div className="modeToggle" aria-label="Extraction mode">
          <button className={mode === "parcel" ? "selected" : ""} onClick={() => setMode("parcel")} disabled={busy}>
            Parcel/site lot
          </button>
          <button className={mode === "floor_plan" ? "selected" : ""} onClick={() => setMode("floor_plan")} disabled={busy}>
            Floor plan
          </button>
        </div>
        <label className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <Icon name="file" size={22} />
          <span>{busy ? "Working..." : message}</span>
          <input
            type="file"
            accept="image/*,.pdf,application/pdf"
            onChange={(event) => {
              const file = event.currentTarget.files?.item(0);
              if (file) void upload(file);
            }}
          />
        </label>
        <div className="status">
          <span className={job?.detected ? "badge good" : job ? "badge warn" : "badge"}>{job ? (job.detected ? "Detected" : "Needs hint") : "Ready"}</span>
          <span className="metric">{job ? `${confidence}% confidence` : "No file loaded"}</span>
          <span className="metric">
            {job
              ? job.mode === "floor_plan" && job.room_count > 0
                ? `${job.room_count} rooms`
                : `${job.feature_count} ${job.geometry_type === "linework" ? "features" : "polygon"}`
              : mode === "floor_plan"
                ? "Floor plan mode"
                : "Parcel mode"}
          </span>
          <span className="metric">{job?.georef_mode ?? "relative_0_0 fallback when needed"}</span>
        </div>
      </section>

      <section className="workspace">
        <div className="preview">
          {job ? <img src={overlayUrl} alt="Detected overlay" onLoad={sizeCanvas} /> : <div className="empty">{emptyText}</div>}
          {job && drawMode ? (
            <canvas
              ref={canvasRef}
              className="hintCanvas"
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerLeave={stopDrawing}
            />
          ) : null}
        </div>
        <aside className="panel">
          <h1>{title}</h1>
          <p>{description}</p>
          {job?.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
          <div className="actions">
            {job?.detected ? (
              (job.exports ?? ["kml", "kmz", "geojson", "metadata"]).map((kind) => (
                <a className="button" key={kind} href={`${API_BASE}/api/jobs/${job.job_id}/exports/${kind}`}>
                  <Icon name="download" />
                  {kind === "shp" ? "SHP ZIP" : kind.toUpperCase()}
                </a>
              ))
            ) : (
              <button className="button" disabled>
                <Icon name="download" />
                Export locked
              </button>
            )}
          </div>
          {job && drawMode ? (
            <div className="hintTools">
              <button className="button primary" onClick={submitHint} disabled={busy}>
                <Icon name="highlighter" />
                Use Highlight
              </button>
              <button className="iconButton" onClick={clearHint} aria-label="Clear highlight">
                <Icon name="eraser" />
              </button>
            </div>
          ) : null}
          <button className="reset" onClick={() => window.location.reload()}>
            <Icon name="reset" size={16} />
            Reset
          </button>
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

function statusMessage(payload: JobStatus, fromHint = false) {
  if (payload.mode === "floor_plan") {
    if (payload.detected) {
      return fromHint ? "Floor plan linework detected from hint." : "Floor plan linework detected.";
    }
    return "No floor plan linework detected. Highlight the main plan lines to guide extraction.";
  }
  if (payload.detected) {
    return fromHint ? "Primary lot line detected from hint." : "Primary lot line detected.";
  }
  return fromHint
    ? "Still no primary lot line detected. Try highlighting directly over the boundary."
    : "No primary lot line detected. Highlight the lot line area to guide extraction.";
}
