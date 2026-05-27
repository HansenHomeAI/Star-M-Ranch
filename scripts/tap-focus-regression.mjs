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

const radiusGuardIndex = pickBlock.indexOf("Math.hypot(worldPos.x - focusCenterX, worldPos.y - focusCenterY, worldPos.z - focusCenterZ)");
const orbitModeIndex = pickBlock.indexOf("state.cameraMode = 'orbit';");
if (
  !pickBlock.includes("globalThis?.__sogsOrbitMaxDistance") ||
  !pickBlock.includes("globalThis?.__sogsOrbitFocusCenter") ||
  radiusGuardIndex === -1 ||
  radiusGuardIndex > orbitModeIndex
) {
  throw new Error("Tap focus should ignore picks outside the configured fixed max-distance focus area before moving the orbit target.");
}

if (!pickBlock.includes("controllers.orbit.goto(tmpCamera, false);")) {
  throw new Error("Tap focus should retarget the orbit controller without a dolly-style smooth camera move.");
}

if (
  !viewerSource.includes("const TAP_FOCUS_ANIMATION_SECONDS = 0.45;") ||
  !viewerSource.includes("target.angles.x = math.lerpAngle(tapFocusFromAngles.x, tapFocusToAngles.x, tapFocusT) % 360;") ||
  !viewerSource.includes("target.angles.y = math.lerpAngle(tapFocusFromAngles.y, tapFocusToAngles.y, tapFocusT) % 360;") ||
  !viewerSource.includes("target.position.copy(tapFocusPosition);") ||
  !viewerSource.includes("target.distance = tapFocusDistance;") ||
  !viewerSource.includes("target.fov = tapFocusFov;")
) {
  throw new Error("Tap focus should animate only pan/tilt while locking eye position, zoom distance, and FOV.");
}

if (pickBlock.includes("tmpCamera.look(cam.position, worldPos);")) {
  throw new Error("Tap focus should not call Camera.look with the picked point because that recalculates orbit distance.");
}

if (
  pickBlock.includes("tmpCamera.position.set(worldPos.x, worldPos.y, worldPos.z).sub(tmpv.mulScalar(cam.distance));") ||
  pickBlock.includes("tmpCamera.angles.copy(cam.angles);")
) {
  throw new Error("Tap focus should not move the camera eye to preserve the previous viewing angle.");
}

if (
  !pickBlock.includes("tmpv.set(worldPos.x - cam.position.x, worldPos.y - cam.position.y, worldPos.z - cam.position.z);") ||
  !pickBlock.includes("const pickDistance = tmpv.length();") ||
  !pickBlock.includes("if (pickDistance <= 1e-6)") ||
  !pickBlock.includes("vecToAngles(tmpCamera.angles, tmpv.mulScalar(1 / pickDistance));") ||
  !pickBlock.includes("tmpCamera.position.copy(cam.position);") ||
  !pickBlock.includes("tmpCamera.distance = cam.distance;") ||
  !pickBlock.includes("tapFocusPosition.copy(cam.position);") ||
  !pickBlock.includes("tapFocusFromAngles.copy(cam.angles);") ||
  !pickBlock.includes("tapFocusToAngles.copy(tmpCamera.angles);") ||
  !pickBlock.includes("tapFocusDistance = cam.distance;") ||
  !pickBlock.includes("tapFocusTimer = 0;")
) {
  throw new Error("Tap focus should keep the current eye position and zoom distance while rotating toward the picked point.");
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

if (!bridgeSource.includes("window.__sogsOrbitMaxDistance = maxDistance;")) {
  throw new Error("Viewer bridge should expose the configured max orbit distance for tap-focus bounds.");
}

if (!bridgeSource.includes("window.__sogsOrbitFocusCenter = d.focusCenter;") || !bridgeSource.includes("window.__sogsOrbitFocusCenter = d.target;")) {
  throw new Error("Viewer bridge should expose a fixed orbit focus center for tap-focus bounds.");
}

if (!shellSource.includes("focusCenter: [roundSplatThousandths(t.x), roundSplatThousandths(t.y), roundSplatThousandths(t.z)]")) {
  throw new Error("Parent viewer should send the authored focus center with initial orbit limits.");
}

if (!shellSource.includes("stopScriptedViewerMotion")) {
  throw new Error("Parent viewer should share one immediate scripted-motion stop path.");
}

if (!shellSource.includes('event.data?.type === "sogs:pickFocus"') || !shellSource.includes("stopScriptedViewerMotion(event.source);")) {
  throw new Error("Pick-focus messages should stop parent scripted path/auto-rotate before updating focus.");
}

console.log("Tap focus regression checks passed.");
