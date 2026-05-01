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

console.log("Tap dot overlay regression checks passed.");
