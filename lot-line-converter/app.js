const MAX_CANVAS_SIDE = 1400;
const RELATIVE_SPAN_DEGREES = 0.01;
const STAR_M_KML_URL = "../3d/assets/star_m_ranch_lot_line.kml";
const STAR_M_GEOJSON_URL = "../3d/assets/star_m_ranch_lot_line.geojson";

let currentMode = "lot";
let currentImage = null;
let currentResult = null;
let currentPayloads = null;

export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function isLotLinePixel(r, g, b) {
  const { h, s, v } = rgbToHsv(r, g, b);
  const red = (h <= 16 || h >= 344) && s >= 0.48 && v >= 0.42;
  const orange = h >= 16 && h <= 44 && s >= 0.48 && v >= 0.48;
  const pink = h >= 290 && h <= 342 && s >= 0.34 && v >= 0.5;
  const blue = h >= 190 && h <= 250 && s >= 0.32 && v >= 0.34;
  const green = h >= 82 && h <= 155 && s >= 0.38 && v >= 0.28;
  const darkSurvey = v <= 0.12 && s <= 0.35;
  return red || orange || pink || blue || green || darkSurvey;
}

export function isRoomLinePixel(r, g, b) {
  const { s, v } = rgbToHsv(r, g, b);
  return v <= 0.28 || (s >= 0.38 && v >= 0.32);
}

export function detectBoundary(imageData, mode = "lot") {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  let maskCount = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const hit =
      mode === "room"
        ? isRoomLinePixel(data[i], data[i + 1], data[i + 2])
        : isLotLinePixel(data[i], data[i + 1], data[i + 2]);
    if (hit) {
      mask[p] = 1;
      maskCount++;
    }
  }

  const component = largestComponent(mask, width, height);
  if (!component || component.count < Math.max(32, width * height * 0.0008)) {
    return {
      detected: false,
      confidence: 0,
      polygon: [],
      warnings: ["No highlighted boundary was detected."]
    };
  }

  const polygon = polygonFromComponent(component, width, height);
  const areaRatio = polygonArea(polygon) / Math.max(1, width * height);
  const componentRatio = component.count / Math.max(1, maskCount);
  const coverage = component.count / Math.max(1, width * height);
  const confidence = clamp(0.46 + componentRatio * 0.32 + Math.min(areaRatio * 2.4, 0.18) + Math.min(coverage * 5, 0.08), 0.55, 0.98);

  return {
    detected: polygon.length >= 4,
    confidence,
    polygon,
    warnings: ["World coordinates were not recovered from the image; exports use relative_0_0 coordinates."]
  };
}

function largestComponent(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const stack = [];
  let best = null;
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ];

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    const rowMin = new Int32Array(height).fill(width);
    const rowMax = new Int32Array(height).fill(-1);
    stack.length = 0;
    stack.push(i);
    visited[i] = 1;

    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = Math.floor(p / width);
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;

      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (mask[ni] && !visited[ni]) {
          visited[ni] = 1;
          stack.push(ni);
        }
      }
    }

    if (!best || count > best.count) {
      best = { count, minX, minY, maxX, maxY, rowMin, rowMax };
    }
  }

  return best;
}

function polygonFromComponent(component, width, height) {
  const rows = [];
  for (let y = component.minY; y <= component.maxY; y++) {
    const minX = component.rowMin[y];
    const maxX = component.rowMax[y];
    if (maxX >= minX && maxX - minX >= 1) {
      rows.push({ y, minX, maxX });
    }
  }
  if (rows.length < 3) {
    return [
      [component.minX, component.minY],
      [component.maxX, component.minY],
      [component.maxX, component.maxY],
      [component.minX, component.maxY]
    ];
  }

  const left = rows.map((row) => [row.minX, row.y]);
  const right = rows.slice().reverse().map((row) => [row.maxX, row.y]);
  const raw = removeNearDuplicates([...left, ...right], 2);
  const epsilon = Math.max(width, height) * 0.008;
  const simplified = simplifyClosedPolygon(raw, epsilon);
  return simplified.length >= 4 ? simplified : raw;
}

function removeNearDuplicates(points, minDistance) {
  const clean = [];
  for (const point of points) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= minDistance) {
      clean.push(point);
    }
  }
  if (clean.length > 1) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < minDistance) clean.pop();
  }
  return clean;
}

export function simplifyClosedPolygon(points, epsilon) {
  if (points.length <= 4) return points;
  const closed = [...points, points[0]];
  const simplified = simplifyRdp(closed, epsilon);
  if (simplified.length > 1 && samePoint(simplified[0], simplified[simplified.length - 1])) {
    simplified.pop();
  }
  return removeNearDuplicates(simplified, Math.max(1, epsilon * 0.35));
}

function simplifyRdp(points, epsilon) {
  if (points.length < 3) return points;
  let maxDistance = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const distance = pointLineDistance(points[i], first, last);
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }
  if (maxDistance > epsilon) {
    const left = simplifyRdp(points.slice(0, index + 1), epsilon);
    const right = simplifyRdp(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function pointLineDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy), 0, 1);
  const x = start[0] + t * dx;
  const y = start[1] + t * dy;
  return Math.hypot(point[0] - x, point[1] - y);
}

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

export function pixelPolygonToRelativeLonLat(polygon, width, height) {
  const scale = RELATIVE_SPAN_DEGREES / Math.max(width, height, 1);
  const centerX = width / 2;
  const centerY = height / 2;
  return polygon.map(([x, y]) => [(x - centerX) * scale, (centerY - y) * scale]);
}

export function closeRing(points) {
  if (!points.length) return [];
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}

export function buildKml({ name, polygon, width, height, confidence, warnings = [], source = "static_browser_highlight_detector" }) {
  const coords = closeRing(pixelPolygonToRelativeLonLat(polygon, width, height));
  const coordinateText = coords.map(([lon, lat]) => `${lon.toFixed(10)},${lat.toFixed(10)},0`).join(" ");
  const warningText = escapeXml(warnings.join("; "));
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
    <Style id="primaryLotStyle">
      <LineStyle><color>ff1d22e8</color><width>4</width></LineStyle>
      <PolyStyle><color>331d22e8</color></PolyStyle>
    </Style>
    <Placemark>
      <name>${escapeXml(name)}</name>
      <description>Primary lot boundary. Georef mode: relative_0_0.</description>
      <ExtendedData>
        <Data name="confidence"><value>${confidence.toFixed(4)}</value></Data>
        <Data name="georef_mode"><value>relative_0_0</value></Data>
        <Data name="source"><value>${escapeXml(source)}</value></Data>
        <Data name="warnings"><value>${warningText}</value></Data>
      </ExtendedData>
      <styleUrl>#primaryLotStyle</styleUrl>
      <Polygon>
        <tessellate>1</tessellate>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinateText}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>
`;
}

export function buildGeojson({ name, polygon, width, height, confidence, warnings = [], source = "static_browser_highlight_detector" }) {
  return JSON.stringify(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            name,
            confidence: Number(confidence.toFixed(4)),
            georef_mode: "relative_0_0",
            source,
            warnings
          },
          geometry: {
            type: "Polygon",
            coordinates: [closeRing(pixelPolygonToRelativeLonLat(polygon, width, height))]
          }
        }
      ]
    },
    null,
    2
  );
}

export function buildMetadata({ fileName, mode, polygon, width, height, confidence, warnings = [] }) {
  return JSON.stringify(
    {
      fileName,
      mode,
      width,
      height,
      confidence: Number(confidence.toFixed(4)),
      georef_mode: "relative_0_0",
      coordinate_order: "longitude,latitude,altitude",
      source: "static_browser_highlight_detector",
      warnings,
      pixel_polygon: polygon.map(([x, y]) => [Math.round(x), Math.round(y)]),
      geo_polygon: closeRing(pixelPolygonToRelativeLonLat(polygon, width, height))
    },
    null,
    2
  );
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2;
}

function initConverter() {
  const canvas = document.getElementById("previewCanvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const fileInput = document.getElementById("fileInput");
  const uploadLabel = document.getElementById("uploadLabel");
  const statusBadge = document.getElementById("statusBadge");
  const statusText = document.getElementById("statusText");
  const emptyState = document.getElementById("emptyState");
  const modeMetric = document.getElementById("modeMetric");
  const vertexMetric = document.getElementById("vertexMetric");
  const confidenceMetric = document.getElementById("confidenceMetric");
  const outputText = document.getElementById("outputText");
  const downloadKml = document.getElementById("downloadKml");
  const downloadGeojson = document.getElementById("downloadGeojson");
  const downloadMetadata = document.getElementById("downloadMetadata");
  const sampleButton = document.getElementById("sampleButton");

  function setStatus(kind, badge, text) {
    statusBadge.className = `status-badge ${kind || ""}`.trim();
    statusBadge.textContent = badge;
    statusText.textContent = text;
  }

  function setMode(mode) {
    currentMode = mode;
    for (const button of document.querySelectorAll("[data-mode]")) {
      button.classList.toggle("selected", button.dataset.mode === mode);
    }
    modeMetric.textContent = mode === "room" ? "Room Lines" : "Lot Lines";
    if (currentImage) processImage(currentImage);
  }

  async function loadFile(file) {
    if (!file.type.startsWith("image/")) {
      setStatus("warn", "Skipped", "Use an image file for the static converter");
      return;
    }
    uploadLabel.textContent = file.name;
    const bitmap = await createImageBitmap(file);
    currentImage = { bitmap, name: file.name };
    processImage(currentImage);
  }

  function processImage(image) {
    const scale = Math.min(1, MAX_CANVAS_SIDE / Math.max(image.bitmap.width, image.bitmap.height));
    canvas.width = Math.round(image.bitmap.width * scale);
    canvas.height = Math.round(image.bitmap.height * scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image.bitmap, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = detectBoundary(imageData, currentMode);
    currentResult = result;
    canvas.classList.add("active");
    emptyState.classList.add("hidden");

    if (!result.detected) {
      setStatus("warn", "No Match", image.name);
      vertexMetric.textContent = "0";
      confidenceMetric.textContent = "0%";
      outputText.value = "";
      currentPayloads = null;
      updateDownloadState(false);
      return;
    }

    drawResultOverlay(ctx, result.polygon);
    const displayName = currentMode === "room" ? "Detected Room Lines" : "Detected Lot Boundary";
    const base = {
      name: displayName,
      polygon: result.polygon,
      width: canvas.width,
      height: canvas.height,
      confidence: result.confidence,
      warnings: result.warnings
    };
    currentPayloads = {
      kml: buildKml(base),
      geojson: buildGeojson(base),
      metadata: buildMetadata({
        fileName: image.name,
        mode: currentMode,
        polygon: result.polygon,
        width: canvas.width,
        height: canvas.height,
        confidence: result.confidence,
        warnings: result.warnings
      })
    };
    outputText.value = currentPayloads.kml;
    vertexMetric.textContent = String(result.polygon.length);
    confidenceMetric.textContent = `${Math.round(result.confidence * 100)}%`;
    setStatus("good", "Detected", image.name);
    updateDownloadState(true);
  }

  function updateDownloadState(enabled) {
    downloadKml.disabled = !enabled;
    downloadGeojson.disabled = !enabled;
    downloadMetadata.disabled = !enabled;
  }

  function drawResultOverlay(context, polygon) {
    context.save();
    context.beginPath();
    polygon.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = "rgba(240, 255, 226, 0.18)";
    context.strokeStyle = "#f8fff0";
    context.lineWidth = Math.max(3, Math.round(Math.max(canvas.width, canvas.height) * 0.004));
    context.fill();
    context.stroke();
    context.restore();
  }

  function download(kind) {
    if (!currentPayloads?.[kind]) return;
    const extension = kind === "metadata" ? "json" : kind;
    const mime = kind === "kml" ? "application/vnd.google-earth.kml+xml" : "application/json";
    const name = `detected-${currentMode}-lines.${extension}`;
    downloadText(name, currentPayloads[kind], mime);
  }

  async function loadVerifiedStarM() {
    const [kmlResponse, geojsonResponse] = await Promise.all([fetch(STAR_M_KML_URL), fetch(STAR_M_GEOJSON_URL)]);
    const kml = await kmlResponse.text();
    const geojson = await geojsonResponse.text();
    const metadata = JSON.stringify(
      {
        name: "Star M Ranch verified parcel boundary",
        source: "Summit County GIS",
        kml: STAR_M_KML_URL,
        geojson: STAR_M_GEOJSON_URL
      },
      null,
      2
    );
    currentPayloads = { kml, geojson, metadata };
    outputText.value = kml;
    vertexMetric.textContent = "15";
    confidenceMetric.textContent = "Verified";
    setStatus("good", "Loaded", "Star M Ranch verified KML");
    updateDownloadState(true);
  }

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.item(0);
    if (file) void loadFile(file);
  });
  downloadKml.addEventListener("click", () => download("kml"));
  downloadGeojson.addEventListener("click", () => download("geojson"));
  downloadMetadata.addEventListener("click", () => download("metadata"));
  sampleButton.addEventListener("click", () => void loadVerifiedStarM());
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }

  document.addEventListener("dragover", (event) => {
    event.preventDefault();
    document.body.classList.add("dragging");
  });
  document.addEventListener("dragleave", () => document.body.classList.remove("dragging"));
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("dragging");
    const file = event.dataTransfer?.files?.item(0);
    if (file) void loadFile(file);
  });
}

function downloadText(fileName, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

if (typeof document !== "undefined") {
  initConverter();
}
