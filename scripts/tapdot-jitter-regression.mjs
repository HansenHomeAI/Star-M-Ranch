import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../3d/index.css", import.meta.url), "utf8");

const tapDotsOverlay = source.match(/function TapDotsOverlay\([\s\S]*?\n}\n\n\/\/ components\/sogs-migrated-viewer\/TapPickFeedback\.tsx/)?.[0] || "";

assert.ok(tapDotsOverlay, "TapDotsOverlay source block should exist");
assert.doesNotMatch(tapDotsOverlay, /Math\.round\((x|y)\)/, "Tap dot screen positions should not be whole-pixel rounded because it creates 0px/1px jitter");
assert.match(tapDotsOverlay, /button\.style\.transform = `translate3d\(\$\{tapDotScreenCoord\(x\)\}px, \$\{tapDotScreenCoord\(y\)\}px, 0\) translate\(-50%, -100%\)`;/, "Tap dots should be positioned with sub-pixel translate3d transforms");

const coordMatch = source.match(/function tapDotScreenCoord\(value\) \{[\s\S]*?\n\}/);
assert.ok(coordMatch, "tapDotScreenCoord helper should exist for deterministic sub-pixel positioning");
const tapDotScreenCoord = new Function(`${coordMatch[0]}; return tapDotScreenCoord;`)();

const projectedX = Array.from({ length: 28 }, (_, i) => 100.12 + i * 0.24);
const oldWholePixel = projectedX.map((x) => Math.round(x));
const stableSubPixel = projectedX.map((x) => tapDotScreenCoord(x));

function deltaSpread(values) {
  const deltas = values.slice(1).map((value, i) => Number((value - values[i]).toFixed(4)));
  return Math.max(...deltas) - Math.min(...deltas);
}

assert.ok(deltaSpread(oldWholePixel) >= 1, "Whole-pixel rounding baseline should expose visible 0px/1px jitter");
assert.ok(deltaSpread(stableSubPixel) <= 0.02, "Sub-pixel tap dot positioning should preserve smooth projected motion");

const bubbleCss = css.match(/\.tapdot-label-bubble \{[\s\S]*?\n\}/)?.[0] || "";
assert.match(bubbleCss, /will-change: transform, opacity;/, "Tap dot labels should promote transform and opacity updates");

console.log("Tap dot jitter regression checks passed.");
