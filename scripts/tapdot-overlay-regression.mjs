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

if (!source.includes("function tapDotStackZIndex(distance, index = 0)") || !tapDotsOverlay.includes("button.style.zIndex = String(tapDotStackZIndex(distance, i));")) {
  throw new Error("TapDotsOverlay should stack overlapping labels by camera distance, not static DOM order.");
}

if (tapDotsOverlay.includes("createOverlayPerspectiveCamera") || tapDotsOverlay.includes("syncOverlayCamera")) {
  throw new Error("TapDotsOverlay must not use the old parent-side camera approximation.");
}

if (!source.includes("TAP_DOT_DEFAULT_MAX_VISIBLE_DISTANCE") || !source.includes("tapDotTargetOpacity")) {
  throw new Error("TapDotsOverlay must include distance threshold behavior.");
}

if (!source.includes("var TAP_DOT_DEFAULT_MAX_VISIBLE_DISTANCE = 0.24;")) {
  throw new Error("Tap dot default max visible distance must match the edited uncluttered view distance.");
}

const tapDotMaxVisibleDistanceMatches = source.match(/maxVisibleDistance: 0\.24/g) || [];
if (tapDotMaxVisibleDistanceMatches.length < 4) {
  throw new Error("Bundled Incognito tap dots must use explicit edited per-dot max visible distances.");
}

if (!source.includes("maxRadiusFromOrigin: 1")) {
  throw new Error("Viewer radius cap must stay at one unit.");
}

const incognitoProjectId = "78659e97-7978-43f6-88b8-577e45f182de";
for (const folderName of ["Main House", "Attached Shop and Studio/Guest Apt", "Guest/Caretaker Cabin", "Horse Barn"]) {
  if (!source.includes(`caption: "${folderName}"`)) {
    throw new Error(`Expected an Incognito tap dot named after folder: ${folderName}`);
  }
}
for (const expectedPosition of [
  "position: { x: -0.013, y: 0.012, z: -0.021 }",
  "position: { x: 0.014, y: 0.01, z: 0.021 }",
  "position: { x: 0.121, y: -0.02, z: -0.259 }",
  "position: { x: 0.125, y: -0.02, z: -0.291 }"
]) {
  if (!source.includes(expectedPosition)) {
    throw new Error(`Missing edited tap dot position: ${expectedPosition}`);
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
if (!source.includes("var TAP_DOT_IDLE_PRELOAD_COUNT = 1;")) {
  throw new Error("Tap dot layer should idle-preload only the first photo for each tap dot.");
}
if (!source.includes("var TAP_DOT_OPEN_PRELOAD_AHEAD = 3;")) {
  throw new Error("Tap dot galleries should preload at least the next 3 photos when opened or advanced.");
}
if (!source.includes('function preloadTapDotImages(urls, startIdx = 0, count = TAP_DOT_OPEN_PRELOAD_AHEAD, priority = "auto")')) {
  throw new Error("Tap dot gallery should have a reusable bounded image preloader.");
}
if (!source.includes('preloadTapDotImages(urls, idx + 1, TAP_DOT_OPEN_PRELOAD_AHEAD, "high")')) {
  throw new Error("Tap dot gallery should preload the next 3 photos from the active image.");
}
if (!tapDotsOverlay.includes("requestIdleCallback") || !tapDotsOverlay.includes("TAP_DOT_IDLE_PRELOAD_COUNT")) {
  throw new Error("Tap dot layer should lazy-preload each tap dot's first photo during idle time.");
}

const tapDotBubbleCss = css.match(/\.tapdot-label-bubble \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotCameraCss = css.match(/\.tapdot-label-bubble \.tapdot-camera-icon \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotCameraSizeCss = css.match(/\.tapdot-label-bubble\.has-camera \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotPhotoCss = css.match(/\.tapdot-popup \.tapdot-photo \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotPhotoFadeCss = css.match(/\.tapdot-popup \.tapdot-photo\.fade \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotCaptionWrapCss = css.match(/(?:^|\n)\.tapdot-caption-wrap \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotDotsWrapCss = css.match(/(?:^|\n)\.tapdot-carousel-dots-wrap \{[\s\S]*?\n\}/)?.[0] || "";
const tapDotDotsCss = css.match(/(?:^|\n)\.tapdot-carousel-dots \{[\s\S]*?\n\}/)?.[0] || "";

if (!tapDotBubbleCss.includes("gap: 6px;") || !tapDotBubbleCss.includes("padding: 7px 12px;")) {
  throw new Error("Tap dot pills should keep the original compact spacing.");
}

if (tapDotBubbleCss.includes("min-height: 40px;")) {
  throw new Error("Tap dot pills should not force the larger polished height.");
}

if (!tapDotCameraCss.includes("margin-right: -2px;") || !tapDotCameraSizeCss.includes("--tapdot-camera-size: 24px;")) {
  throw new Error("Tap dot camera icon spacing should match the original compact pill layout.");
}

if (!tapDotPhotoCss.includes("cubic-bezier(0.22, 1, 0.36, 1)") || !tapDotPhotoCss.includes("filter 240ms")) {
  throw new Error("Tap dot photo transitions should use a subtle premium easing across opacity, transform, and filter.");
}

if (!tapDotPhotoCss.includes("will-change: opacity, transform, filter;")) {
  throw new Error("Tap dot photo transitions should hint the animated properties for smoother gallery movement.");
}

if (!tapDotPhotoFadeCss.includes("opacity: 0.18;") || !tapDotPhotoFadeCss.includes("translate3d(10px, 0, 0)") || !tapDotPhotoFadeCss.includes("blur(3px)")) {
  throw new Error("Tap dot photo fade state should be a subtle fade/slide/soften transition instead of a hard disappearance.");
}

if (!tapDotCaptionWrapCss.includes("max-width: 100%;") || !tapDotCaptionWrapCss.includes("box-sizing: border-box;")) {
  throw new Error("Tap dot caption content should be constrained inside the popup width.");
}

if (!tapDotDotsWrapCss.includes("width: 100%;") || !tapDotDotsWrapCss.includes("overflow: hidden;")) {
  throw new Error("Tap dot carousel dot wrapper should prevent horizontal overflow outside the popup.");
}

if (!tapDotDotsCss.includes("flex-wrap: wrap;") || !tapDotDotsCss.includes("max-width: 100%;") || !tapDotDotsCss.includes("row-gap: 8px;")) {
  throw new Error("Tap dot carousel dots should wrap into rows instead of running past the popup edge.");
}

console.log("Tap dot overlay regression checks passed.");
