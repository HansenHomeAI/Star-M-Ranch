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

if (!source.includes("tapDotEditorOpen")) {
  throw new Error("Tap dot editing should have its own camera-tool edit mode separate from tap-dot visibility.");
}

if (!source.includes("updateTapDotPosition")) {
  throw new Error("Tap dot editor should expose a world-position updater.");
}

if (!source.includes("updateTapDotCaption")) {
  throw new Error("Tap dot editor should expose a title updater so the selected label can be renamed.");
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

if (!source.includes("editable: developerToolsEnabled && tapDotEditorOpen && showTapDots")) {
  throw new Error("Tap dots should only be draggable when the camera/tap-dot editor mode is selected.");
}

if (!source.includes("if (!developerToolsEnabled || !tapDotEditorOpen || !showTapDots || toggleDisabled) return;")) {
  throw new Error("Tap dot keyboard Y-axis controls should only run while camera/tap-dot editor mode is selected.");
}

if (!source.includes('id: "tapDotEditorPanel"') || !source.includes('data-testid": "tap-dot-editor-panel"')) {
  throw new Error("Tap dot editor mode should expose a dedicated panel for title and Y-axis controls.");
}

if (!source.includes('data-testid": "tap-dot-title"') || !source.includes('data-testid": "tap-dot-y"')) {
  throw new Error("Tap dot editor panel should include title and Y-axis inputs for the selected tap dot.");
}

if (!source.includes("tap-dot-editor-grid") || !css.includes(".tap-dot-editor-grid")) {
  throw new Error("Tap dot editor title/Y controls should use a dedicated grid so long titles are editable without cramped inputs.");
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
