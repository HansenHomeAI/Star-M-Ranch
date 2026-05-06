import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");

const tapDotsOverlay = source.match(/function TapDotsOverlay\([\s\S]*?\n}\n\n\/\/ components\/sogs-migrated-viewer\/TapPickFeedback\.tsx/)?.[0] || "";
assert.ok(tapDotsOverlay, "TapDotsOverlay source block should exist");

assert.match(source, /var TAP_DOT_DEFAULT_MAX_VISIBLE_DISTANCE = 1\.35;/, "Tap dots should default to a close max visible distance so zoomed-out views stay uncluttered");
assert.match(source, /var TAP_DOT_OPACITY_ANIMATION_MS = 400;/, "Tap dots should use a fixed 400ms opacity animation duration");
assert.match(source, /function tapDotMaxVisibleDistance\(tapDot\)/, "Tap dots should resolve per-dot max visible distance");
assert.match(source, /function tapDotTargetOpacity\(distance, minDistance, maxDistance\)/, "Tap dot distance should resolve to a binary threshold target opacity");
assert.match(source, /function tapDotAnimatedOpacity\(current, target, deltaMs\)/, "Tap dots should smooth opacity changes with a fixed-rate helper");
assert.match(source, /function tapDotBlurForOpacity\(opacity\)/, "Tap dots should get a blur value from animation progress, not viewing distance");
assert.match(tapDotsOverlay, /const maxDistance = tapDotMaxVisibleDistance\(td\);/, "TapDotsOverlay should use the per-dot max visible distance resolver");
assert.match(tapDotsOverlay, /const targetOpacity = tapDotTargetOpacity\(distance, minDistance, maxDistance\);/, "TapDotsOverlay should use a binary distance threshold instead of distance-proportional opacity");
assert.match(tapDotsOverlay, /const previousOpacity = opacityRefs\.current\[i\] \?\? 0;/, "Newly visible tap dots should fade in from zero instead of appearing fully opaque");
assert.match(tapDotsOverlay, /const animatedOpacity = tapDotAnimatedOpacity\(previousOpacity, targetOpacity, deltaMs\);/, "TapDotsOverlay should animate toward the binary threshold target opacity");
assert.match(tapDotsOverlay, /button\.style\.filter = `blur\(\$\{tapDotBlurForOpacity\(animatedOpacity\)\}px\)`;/, "TapDotsOverlay should apply blur from the fixed animation progress");
assert.doesNotMatch(tapDotsOverlay, /fadeDistance/, "TapDotsOverlay should not make opacity proportional to distance inside a fade band");
assert.match(source, /caption: "Front Entry"[\s\S]*?maxVisibleDistance: 1\.2/, "Front Entry should have a shorter per-dot max visible distance");
assert.match(source, /caption: "Mountain Lawn"[\s\S]*?maxVisibleDistance: 1\.35/, "Mountain Lawn should have a shorter per-dot max visible distance");
assert.doesNotMatch(source, /caption: "Front Entry"[\s\S]*?maxDistance: 50/, "Bundled tap dots should not use the old zoomed-out 50-unit max distance");

const constants = source.match(/var TAP_DOT_DEFAULT_MIN_DISTANCE[\s\S]*?var TAP_DOT_OPACITY_ANIMATION_MS = [^;]+;/)?.[0] || "";
const maxVisibleFn = source.match(/function tapDotMaxVisibleDistance\(tapDot\) \{[\s\S]*?\n\}/)?.[0] || "";
const targetOpacityFn = source.match(/function tapDotTargetOpacity\(distance, minDistance, maxDistance\) \{[\s\S]*?\n\}/)?.[0] || "";
const animatedOpacityFn = source.match(/function tapDotAnimatedOpacity\(current, target, deltaMs\) \{[\s\S]*?\n\}/)?.[0] || "";
const blurFn = source.match(/function tapDotBlurForOpacity\(opacity\) \{[\s\S]*?\n\}/)?.[0] || "";
assert.ok(constants && maxVisibleFn && targetOpacityFn && animatedOpacityFn && blurFn, "Tap dot distance helpers should be extractable");

const { tapDotMaxVisibleDistance, tapDotTargetOpacity, tapDotAnimatedOpacity, tapDotBlurForOpacity } = new Function(`${constants}\n${maxVisibleFn}\n${targetOpacityFn}\n${animatedOpacityFn}\n${blurFn}\nreturn { tapDotMaxVisibleDistance, tapDotTargetOpacity, tapDotAnimatedOpacity, tapDotBlurForOpacity };`)();

assert.equal(tapDotMaxVisibleDistance({ maxVisibleDistance: 1.2 }), 1.2, "Explicit maxVisibleDistance should win");
assert.equal(tapDotMaxVisibleDistance({ maxDistance: 2.25 }), 2.25, "Legacy maxDistance should still work as a fallback");
assert.equal(tapDotMaxVisibleDistance({}), 1.35, "Missing max visible distance should use the uncluttered default");
assert.equal(tapDotTargetOpacity(1.19, 0.06, 1.2), 1, "Tap dot should be fully targeted visible until the threshold");
assert.equal(tapDotTargetOpacity(1.2, 0.06, 1.2), 1, "Tap dot should still be fully targeted visible at the threshold");
assert.equal(tapDotTargetOpacity(1.21, 0.06, 1.2), 0, "Tap dot should target hidden immediately after the threshold");
assert.equal(tapDotTargetOpacity(0.2, 0.06, 1.2), 1, "Tap dot opacity target should not vary based on distance while inside the threshold");
assert.equal(tapDotTargetOpacity(0.8, 0.06, 1.2), 1, "Tap dot opacity target should stay binary while inside the threshold");
assert.equal(tapDotAnimatedOpacity(1, 0, 0), 1, "Zero elapsed time should not change opacity");
assert.equal(tapDotAnimatedOpacity(1, 0, 200), 0.5, "Fade-out should advance at the fixed 400ms animation rate");
assert.equal(tapDotAnimatedOpacity(1, 0, 1000), 0, "Long frames should clamp at the target opacity");
assert.equal(tapDotAnimatedOpacity(0, 1, 200), 0.5, "Fade-in should use the same fixed 400ms animation rate");
assert.equal(tapDotBlurForOpacity(0), 6, "Fully hidden tap dots should be blurred during transition");
assert.equal(tapDotBlurForOpacity(1), 0, "Fully visible tap dots should be sharp");

console.log("Tap dot distance regression checks passed.");
