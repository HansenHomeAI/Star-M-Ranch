import { readFileSync } from "node:fs";

const viewerSource = readFileSync(new URL("../supersplat-viewer/index.js", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../supersplat-viewer/sogs-bridge.mjs", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");

const pickBlock = viewerSource.match(/events\.on\('pick', \(payload\) => \{[\s\S]*?\n        \}\);/)?.[0] || "";

if (!pickBlock) {
  throw new Error("Camera pick handler should exist.");
}

if (!pickBlock.includes("state.cameraMode = 'orbit';")) {
  throw new Error("Tap focus should force orbit mode instead of dropping picks while another camera mode is active.");
}

if (!pickBlock.includes("controllers.orbit.goto(tmpCamera);")) {
  throw new Error("Tap focus should smoothly pan the orbit controller to the picked focus target.");
}

if (pickBlock.includes("tmpCamera.look(cam.position, worldPos);")) {
  throw new Error("Tap focus should not call Camera.look with the picked point because that recalculates orbit distance.");
}

if (
  !pickBlock.includes("tmpCamera.position.set(worldPos.x, worldPos.y, worldPos.z).sub(tmpv.mulScalar(cam.distance));") ||
  !pickBlock.includes("tmpCamera.angles.copy(cam.angles);") ||
  !pickBlock.includes("tmpCamera.distance = cam.distance;")
) {
  throw new Error("Tap focus should preserve current orbit distance and angles while moving the focus point.");
}

if (pickBlock.includes("target.copy(tmpCamera);") || pickBlock.includes("this.camera.copy(tmpCamera);")) {
  throw new Error("Tap focus should not hard-snap the active camera state to the picked focus target.");
}

if (!pickBlock.includes("this.emitPickFocusScreen();")) {
  throw new Error("Tap focus should emit feedback immediately after a successful pick.");
}

if (!pickBlock.includes("global.app.renderNextFrame = true;")) {
  throw new Error("Tap focus should request a render on successful pick.");
}

if (/const notifyUserInteraction = \(\) => \{\s*if \(window\.__sogsScriptedCamera\)/.test(bridgeSource)) {
  throw new Error("Viewer user-interaction notifications should not be gated behind scripted-camera state.");
}

if (!bridgeSource.includes('window.parent.postMessage({ type: "sogs:userInteraction" }, "*");')) {
  throw new Error("Viewer should notify the parent immediately when the user touches the scene.");
}

if (!shellSource.includes("stopScriptedViewerMotion")) {
  throw new Error("Parent viewer should share one immediate scripted-motion stop path.");
}

if (!shellSource.includes('event.data?.type === "sogs:pickFocus"') || !shellSource.includes("stopScriptedViewerMotion(event.source);")) {
  throw new Error("Pick-focus messages should stop parent scripted path/auto-rotate before updating focus.");
}

console.log("Tap focus regression checks passed.");
