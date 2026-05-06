import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../3d/index.css", import.meta.url), "utf8");

const tapDotsOverlay = source.match(/function TapDotsOverlay\([\s\S]*?\n}\n\n\/\/ components\/sogs-migrated-viewer\/TapPickFeedback\.tsx/)?.[0] || "";

if (!tapDotsOverlay) {
  throw new Error("TapDotsOverlay source block was not found.");
}

if (!source.includes("const [tapDots, setTapDots]")) {
  throw new Error("Tap dots should be mutable state so developer edits can reposition labels.");
}

if (!source.includes("selectedTapDotCaption")) {
  throw new Error("Tap dot editor should track the selected tap dot title.");
}

if (!source.includes("updateTapDotPosition")) {
  throw new Error("Tap dot editor should expose a world-position updater.");
}

if (!source.includes("TAP_DOT_KEYBOARD_Y_STEP")) {
  throw new Error("Tap dot editor should support small keyboard Y-axis edits.");
}

if (!tapDotsOverlay.includes("editable = false") || !tapDotsOverlay.includes("onPointMove") || !tapDotsOverlay.includes("onPointSelect")) {
  throw new Error("TapDotsOverlay should accept editing props for drag/select behavior.");
}

if (!tapDotsOverlay.includes("__sogsScreenToLotLinePoint")) {
  throw new Error("Tap dot dragging should use the viewer screen-to-world bridge.");
}

if (!tapDotsOverlay.includes("tapDotDragRef") || !tapDotsOverlay.includes("setPointerCapture") || !tapDotsOverlay.includes("onPointerMove")) {
  throw new Error("Tap dot labels should be pointer-draggable while editing.");
}

if (!tapDotsOverlay.includes("onOpenPhotos(dot)") || !tapDotsOverlay.includes("if (!editable)")) {
  throw new Error("Tap dot clicks should still open photos when not in edit mode.");
}

if (!source.includes("editable: developerToolsEnabled && showTapDots")) {
  throw new Error("The camera/tap-dot toolbar toggle should enable tap dot editing while developer tools are on.");
}

if (!source.includes("if (!developerToolsEnabled || !showTapDots || toggleDisabled) return;")) {
  throw new Error("Tap dot keyboard Y-axis controls should only run in developer tap-dot mode.");
}

const bubbleCss = css.match(/\.tapdot-label-bubble \{[\s\S]*?\n\}/)?.[0] || "";
const selectedCss = css.match(/\.tapdot-label-bubble--selected \{[\s\S]*?\n\}/)?.[0] || "";
const editableCss = css.match(/\.tapdot-layer--editable \.tapdot-label-bubble \{[\s\S]*?\n\}/)?.[0] || "";

if (!bubbleCss.includes("touch-action: none;")) {
  throw new Error("Tap dot labels should disable browser touch gestures while dragging.");
}

if (!editableCss.includes("cursor: grab;")) {
  throw new Error("Editable tap dot labels should communicate drag affordance.");
}

if (!selectedCss.includes("box-shadow")) {
  throw new Error("Selected tap dot labels should have visible edit feedback.");
}

console.log("Tap dot editing regression checks passed.");
