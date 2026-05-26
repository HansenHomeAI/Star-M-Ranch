import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");

assert.match(source, /maxDistance: 1,/, "HMC orbit max distance should be 1 unit.");
assert.match(source, /var CANYON_VISTA_CAMERA_WORLD_BOUNDS = \{\s*yMin: 0\.1,/, "HMC camera Y floor should default to 0.1.");
assert.match(source, /maxRadiusFromOrigin: 50/, "HMC world-origin safety radius should stay separate from the orbit max distance.");
assert.doesNotMatch(source, /maxRadiusFromOrigin: 1\b/, "The 1-unit zoom limit should not be implemented as a world-origin radius clamp.");
assert.match(source, /type: "sogs:orbitLimits"/, "Parent viewer should send orbit zoom limits into the SOGS iframe.");
assert.doesNotMatch(source, /minDistance: roundSplatThousandths\(activeHoleView\.minDistance\)/, "Parent viewer should not send an orbit minimum distance.");
assert.doesNotMatch(source, /minDistance: roundSplatThousandths\(hv\.minDistance\)/, "Initial viewer boot should not send an orbit minimum distance.");
assert.match(source, /maxDistance: maxR/, "Orbit limits should use the editable max distance value.");
assert.match(source, /focusCenter: \[\s*roundSplatThousandths\(activeHoleView\.target\.x\),\s*roundSplatThousandths\(activeHoleView\.target\.y\),\s*roundSplatThousandths\(activeHoleView\.target\.z\)\s*\]/, "Orbit limits should keep tap focus bound to the authored focus center.");

const splatPanel = source.match(/id: "splatAlignPanel"[\s\S]*?children: "Reset defaults"/)?.[0] || "";
assert.ok(splatPanel, "Splat align panel should be extractable.");
const copyButtonIndex = source.indexOf('children: "Copy splat align JSON"');
assert.notEqual(copyButtonIndex, -1, "Splat align copy button should exist.");
const copyButtonBlock = source.slice(Math.max(0, copyButtonIndex - 2400), copyButtonIndex + 80);
assert.match(copyButtonBlock, /onClick: async \(\) => \{/, "Splat align copy action should support async clipboard fallbacks.");
assert.match(copyButtonBlock, /await copyTextToClipboard\(text\);/, "Splat align copy should use the shared clipboard helper.");
assert.match(copyButtonBlock, /orbitLimits: \{[\s\S]*?maxDistance: roundSplatThousandths\(cameraMaxRadius\)/, "Splat align copy should include orbit max distance separately from camera bounds.");
assert.match(copyButtonBlock, /focusCenter: \[[\s\S]*?roundSplatThousandths\(activeHoleView\.target\.x\)/, "Splat align copy should include the fixed orbit focus center.");
assert.doesNotMatch(copyButtonBlock, /minDistance:/, "Splat align copy should not serialize an orbit minimum distance.");
assert.doesNotMatch(copyButtonBlock, /maxRadiusFromOrigin: roundSplatThousandths\(cameraMaxRadius\)/, "Splat align copy should not serialize max distance as world-origin radius.");
assert.doesNotMatch(splatPanel, /navigator\.clipboard\.writeText\(text\)/, "Splat align copy should not bypass the local dev clipboard bridge.");
assert.match(copyButtonBlock, /console\.error\("Splat align JSON copy failed", error2\);/, "Splat align copy failures should log a specific error.");

console.log("Splat align regression checks passed.");
