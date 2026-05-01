import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");

const tapDotsOverlay = source.match(/function TapDotsOverlay\([\s\S]*?\n}\n\n\/\/ components\/sogs-migrated-viewer\/TapPickFeedback\.tsx/)?.[0] || "";

if (!tapDotsOverlay) {
  throw new Error("TapDotsOverlay source block was not found.");
}

if (!tapDotsOverlay.includes("__sogsProjectWorldPoint")) {
  throw new Error("TapDotsOverlay must use the viewer projection bridge so dots stay pinned to the viewer camera.");
}

if (tapDotsOverlay.includes("createOverlayPerspectiveCamera") || tapDotsOverlay.includes("syncOverlayCamera")) {
  throw new Error("TapDotsOverlay must not use the old parent-side camera approximation.");
}

if (!source.includes("TAP_DOT_DEFAULT_MAX_DISTANCE") || !source.includes("tapDotDistanceOpacity")) {
  throw new Error("TapDotsOverlay must include distance limits/fade behavior.");
}

if (!source.includes("var TAP_DOT_DEFAULT_MAX_DISTANCE = 50;")) {
  throw new Error("Tap dot default max distance must stay at 50 units.");
}

const tapDotMaxDistanceMatches = source.match(/maxDistance: 50/g) || [];
if (tapDotMaxDistanceMatches.length < 2) {
  throw new Error("Bundled tap dots must use a 50 unit max distance.");
}

if (!source.includes("maxDistance: 50") || !source.includes("maxRadiusFromOrigin: 50")) {
  throw new Error("Viewer distance and radius caps must stay at 50 units.");
}

console.log("Tap dot overlay regression checks passed.");
