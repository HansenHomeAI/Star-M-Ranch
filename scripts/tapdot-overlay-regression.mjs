import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../3d/index.css", import.meta.url), "utf8");

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

const incognitoProjectId = "78659e97-7978-43f6-88b8-577e45f182de";
for (const folderName of ["Main House", "Attached Shop and Studio/Guest Apt", "Guest/Caretaker Cabin", "Horse Barn"]) {
  if (!source.includes(`caption: "${folderName}"`)) {
    throw new Error(`Expected an Incognito tap dot named after folder: ${folderName}`);
  }
}
if (!source.includes(incognitoProjectId)) {
  throw new Error("Expected Incognito tap dots to use the uploaded Incognito project photo URLs.");
}
for (const otherProjectId of ["9988ace7-373e-4364-ad1c-74662068cd74", "97d978ad-6e40-4f4b-97cd-ed7e5d921da5"]) {
  if (source.includes(otherProjectId)) {
    throw new Error(`Incognito viewer should not include photos from other property project ${otherProjectId}.`);
  }
}
const staticPhotoUrlMatches = source.match(/https:\/\/spcprt\.com\/spaces\/media\/users\/d8914320-9061-70dd-72d5-0e5878ed821c\/projects\/78659e97-7978-43f6-88b8-577e45f182de\/photos\//g) || [];
if (staticPhotoUrlMatches.length !== 87) {
  throw new Error(`Expected all 87 Incognito public photo URLs to be attached to tap dots, found ${staticPhotoUrlMatches.length}.`);
}
if (!source.includes("var TAP_DOT_IDLE_PRELOAD_COUNT = 2;")) {
  throw new Error("Tap dot layer should idle-preload the first 2 photos for each tap dot.");
}
if (!source.includes("var TAP_DOT_OPEN_PRELOAD_AHEAD = 3;")) {
  throw new Error("Tap dot galleries should preload at least the next 3 photos when opened or advanced.");
}
if (!source.includes("function preloadTapDotImages(urls, startIdx = 0, count = TAP_DOT_OPEN_PRELOAD_AHEAD)")) {
  throw new Error("Tap dot gallery should have a reusable bounded image preloader.");
}
if (!source.includes("preloadTapDotImages(urls, idx + 1, TAP_DOT_OPEN_PRELOAD_AHEAD)")) {
  throw new Error("Tap dot gallery should preload the next 3 photos from the active image.");
}
if (!tapDotsOverlay.includes("requestIdleCallback") || !tapDotsOverlay.includes("TAP_DOT_IDLE_PRELOAD_COUNT")) {
  throw new Error("Tap dot layer should lazy-preload each tap dot's first 2 photos during idle time.");
}

const tapDotBubbleCss = css.match(/\.tapdot-label-bubble \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotCameraCss = css.match(/\.tapdot-label-bubble \.tapdot-camera-icon \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotCameraSizeCss = css.match(/\.tapdot-label-bubble\.has-camera \{[\s\S]*?\n\}/)?.[0] || "";

if (!tapDotBubbleCss.includes("gap: 6px;") || !tapDotBubbleCss.includes("padding: 7px 12px;")) {
  throw new Error("Tap dot pills should keep the original compact spacing.");
}

if (tapDotBubbleCss.includes("min-height: 40px;")) {
  throw new Error("Tap dot pills should not force the larger polished height.");
}

if (!tapDotCameraCss.includes("margin-right: -2px;") || !tapDotCameraSizeCss.includes("--tapdot-camera-size: 24px;")) {
  throw new Error("Tap dot camera icon spacing should match the original compact pill layout.");
}

console.log("Tap dot overlay regression checks passed.");
