import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const OUT_DIR = process.env.LOTLINE_VISUAL_OUT_DIR || "/tmp/meadow-lotline-occlusion";
const URL = process.env.LOTLINE_VISUAL_URL || "http://127.0.0.1:5173/3d/?quality=lq";
const VIEWPORT = { width: 1024, height: 768 };

mkdirSync(OUT_DIR, { recursive: true });

function parsePng(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error("Screenshot is not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`Unsupported PNG format: bitDepth=${data[8]} colorType=${colorType}`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const inputBytesPerPixel = colorType === 6 ? 4 : 3;
  const outputBytesPerPixel = 4;
  const stride = width * inputBytesPerPixel;
  const rgba = Buffer.alloc(width * height * outputBytesPerPixel);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= inputBytesPerPixel ? row[x - inputBytesPerPixel] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= inputBytesPerPixel ? prev[x - inputBytesPerPixel] : 0;
      if (filter === 1) {
        row[x] = (row[x] + left) & 255;
      } else if (filter === 2) {
        row[x] = (row[x] + up) & 255;
      } else if (filter === 3) {
        row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
    }
    for (let x = 0; x < width; x++) {
      const srcIndex = x * inputBytesPerPixel;
      const outIndex = (y * width + x) * outputBytesPerPixel;
      rgba[outIndex] = row[srcIndex];
      rgba[outIndex + 1] = row[srcIndex + 1];
      rgba[outIndex + 2] = row[srcIndex + 2];
      rgba[outIndex + 3] = colorType === 6 ? row[srcIndex + 3] : 255;
    }
    prev = row;
  }
  return { width, height, rgba };
}

function diffMetric(onPng, offPng, roi) {
  const on = parsePng(onPng);
  const off = parsePng(offPng);
  if (on.width !== off.width || on.height !== off.height) {
    throw new Error("Screenshot dimensions differ");
  }
  const x0 = Math.max(0, Math.floor((roi?.x0 ?? 0) * on.width));
  const y0 = Math.max(0, Math.floor((roi?.y0 ?? 0) * on.height));
  const x1 = Math.min(on.width, Math.ceil((roi?.x1 ?? 1) * on.width));
  const y1 = Math.min(on.height, Math.ceil((roi?.y1 ?? 1) * on.height));
  let strongPixels = 0;
  let totalDelta = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * on.width + x) * 4;
      const d =
        Math.abs(on.rgba[i] - off.rgba[i]) +
        Math.abs(on.rgba[i + 1] - off.rgba[i + 1]) +
        Math.abs(on.rgba[i + 2] - off.rgba[i + 2]);
      totalDelta += d;
      if (d > 54) strongPixels++;
    }
  }
  return { strongPixels, totalDelta, roiPixels: (x1 - x0) * (y1 - y0) };
}

async function waitForViewer(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("iframe.sogs-migrated-iframe", { timeout: 60000 });
  await page.waitForFunction(
    () => {
      const iframe = document.querySelector("iframe.sogs-migrated-iframe");
      const win = iframe?.contentWindow;
      return !!win?.__sogsCtx?.app && !!win.__sogsCtx.camera && !!win.__sogsProjectWorldPoint;
    },
    null,
    { timeout: 90000 },
  );
  await page.waitForFunction(
    () => document.querySelector("iframe.sogs-migrated-iframe")?.contentWindow?.__sogsLotLinesRoot?.enabled === true,
    null,
    { timeout: 90000 },
  );
}

async function setLotLines(page, enabled) {
  await page.evaluate((value) => {
    const iframe = document.querySelector("iframe.sogs-migrated-iframe");
    iframe.contentWindow.postMessage({ type: "sogs:lotLines", enabled: value, dots: window.__MEADOW_LAST_LOT_DOTS, lines: window.__MEADOW_LAST_LOT_LINES, style: window.__MEADOW_LAST_LOT_STYLE }, "*");
  }, enabled);
  await page.waitForTimeout(250);
}

async function setCamera(page, pose) {
  await page.evaluate((p) => {
    const iframe = document.querySelector("iframe.sogs-migrated-iframe");
    iframe.contentWindow.postMessage({ type: "sogs:cameraMode", mode: "scripted" }, "*");
    iframe.contentWindow.postMessage({ type: "sogs:cameraLookAt", position: p.position, target: p.target, fov: p.fov ?? 55 }, "*");
  }, pose);
  await page.waitForTimeout(700);
}

async function snapshot(page, name) {
  const iframe = await page.locator("iframe.sogs-migrated-iframe").elementHandle();
  const png = await iframe.screenshot({ type: "png" });
  writeFileSync(path.join(OUT_DIR, `${name}.png`), png);
  return png;
}

const poses = [
  {
    name: "open-top",
    position: [0.05, 0.95, 0.82],
    target: [0.05, -0.07, -0.2],
    roi: { x0: 0.05, y0: 0.18, x1: 0.95, y1: 0.9 },
  },
  {
    name: "foreground-low",
    position: [0.01, 0.11, 0.72],
    target: [0.03, -0.08, -0.22],
    roi: { x0: 0.18, y0: 0.38, x1: 0.85, y1: 0.78 },
  },
  {
    name: "reverse-low",
    position: [0.28, 0.12, -0.74],
    target: [0.03, -0.08, -0.2],
    roi: { x0: 0.12, y0: 0.35, x1: 0.9, y1: 0.8 },
  },
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
page.on("console", (msg) => {
  if (msg.type() === "error") console.error(msg.text());
});
await waitForViewer(page);

// Pull the currently rendered lot-line payload from the iframe globals so on/off screenshots differ only by visibility.
await page.evaluate(() => {
  const win = document.querySelector("iframe.sogs-migrated-iframe").contentWindow;
  window.__MEADOW_LAST_LOT_DOTS = win.__sogsLotLineDots;
  window.__MEADOW_LAST_LOT_LINES = win.__sogsLotLineSegments;
  window.__MEADOW_LAST_LOT_STYLE = win.__sogsLotLineStyle;
});

const results = [];
for (const pose of poses) {
  await setCamera(page, pose);
  await setLotLines(page, true);
  const on = await snapshot(page, `${pose.name}-on`);
  await setLotLines(page, false);
  const off = await snapshot(page, `${pose.name}-off`);
  await setLotLines(page, true);
  const metric = diffMetric(on, off, pose.roi);
  results.push({ name: pose.name, ...metric });
}

await browser.close();

const open = results.find((r) => r.name === "open-top");
const low = results.filter((r) => r.name !== "open-top");
if (!open || open.strongPixels < 600) {
  throw new Error(`Lot lines are not visibly present from the open top view: ${JSON.stringify(open)}`);
}
for (const result of low) {
  if (result.strongPixels > open.strongPixels * 0.92) {
    throw new Error(`Low-angle lot-line visibility is too close to the open view, suggesting no splat occlusion: ${JSON.stringify({ open, result })}`);
  }
}

writeFileSync(path.join(OUT_DIR, "metrics.json"), `${JSON.stringify(results, null, 2)}\n`);
console.log(`Lot-line occlusion visual regression passed. Artifacts: ${OUT_DIR}`);
console.log(JSON.stringify(results, null, 2));
