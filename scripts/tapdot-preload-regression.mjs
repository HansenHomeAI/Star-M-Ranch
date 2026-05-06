import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");
const modalSource = source.match(/\/\/ components\/sogs-migrated-viewer\/CanyonPhotoModal\.tsx[\s\S]*?function CanyonPhotoModal/)?.[0] || "";
const overlaySource = source.match(/function TapDotsOverlay\([\s\S]*?\n}\n\n\/\/ components\/sogs-migrated-viewer\/TapPickFeedback\.tsx/)?.[0] || "";

assert.ok(modalSource, "CanyonPhotoModal preload source block should exist");
assert.ok(overlaySource, "TapDotsOverlay source block should exist");

assert.match(source, /var TAP_DOT_IDLE_PRELOAD_COUNT = 1;/, "Idle preload should warm only the first image for each tap dot to avoid loading hundreds of photos up front");
assert.match(source, /var TAP_DOT_OPEN_PRELOAD_AHEAD = 3;/, "Open galleries should still warm the next three photos");
assert.match(source, /var TAP_DOT_RECENT_KEEP_BEHIND = 3;/, "Gallery preload should keep the previous three visited photos warm");
assert.match(source, /var TAP_DOT_PRELOAD_CACHE_LIMIT = 16;/, "Decoded tap dot image cache should be bounded");
assert.match(source, /var tapDotImagePreloadCache = \/\* @__PURE__ \*\/ new Map\(\);/, "Tap dot preload cache should keep image records, not only URL strings");
assert.match(source, /function isTapDotImageReady\(url\)/, "Tap dot modal should know whether a target image is already warmed");
assert.match(source, /function trimTapDotPreloadCache\(\)/, "Tap dot preloader should trim old decoded image refs");
assert.match(source, /const wrappedIndex = \(index \+ urls\.length\) % urls\.length;/, "Preloader should wrap backward indexes correctly for short galleries");
assert.match(source, /img\.fetchPriority = priority;/, "Preloaded images should accept high priority for immediate next photos");
assert.match(source, /img\.decoding = "async";/, "Preloaded images should request async decoding");
assert.match(source, /img\.decode\(\)/, "Preloaded images should decode ahead, not only download bytes");
assert.match(source, /preloadTapDotImages\(urls, 0, TAP_DOT_IDLE_PRELOAD_COUNT, "auto"\)/, "Idle tap dot preload should warm the first image for each label");
assert.match(source, /preloadTapDotImages\(urls, idx, 1, "high"\)/, "Opened gallery should prioritize the current image");
assert.match(source, /preloadTapDotImages\(urls, idx \+ 1, TAP_DOT_OPEN_PRELOAD_AHEAD, "high"\)/, "Opened gallery should prioritize the next three images");
assert.match(source, /preloadTapDotImages\(urls, idx - TAP_DOT_RECENT_KEEP_BEHIND, TAP_DOT_RECENT_KEEP_BEHIND, "auto"\)/, "Opened gallery should keep the previous three images warm");
assert.match(source, /const nextReady = isTapDotImageReady\(urls\[i\]\);[\s\S]*?setSpinner\(!nextReady\);[\s\S]*?setImgFade\(!nextReady\);/, "Navigation should avoid the loading shutter when the target image is already decoded");
assert.match(source, /fetchPriority: "high"/, "Displayed tap dot image should request high fetch priority");
assert.match(source, /loading: "eager"/, "Displayed tap dot image should load eagerly once the modal is open");

console.log("Tap dot preload regression checks passed.");
