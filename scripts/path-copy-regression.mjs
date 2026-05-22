import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");

const defaultPathBlock = source.match(/var CANYON_VISTA_DEFAULT_PATH_CHECKPOINTS = \[[\s\S]*?\n\];/)?.[0] || "";
assert.ok(defaultPathBlock, "Default animation path should be extractable.");
assert.equal((defaultPathBlock.match(/duration: 5/g) || []).length, 9, "Default animation path should contain 9 checkpoints.");
assert.match(defaultPathBlock, /position: \{ x: 0\.43102809586419916, y: 0\.25785430620725724, z: 0\.8515784166158226 \}/, "Default animation path should start from the updated first checkpoint.");
assert.match(defaultPathBlock, /position: \{ x: 0\.9523214311018778, y: 0\.162397901885115, z: -0\.6975256227520483 \}/, "Default animation path should end at the updated ninth checkpoint.");

const panelBlock = source.match(/function AnimationPathPanel\([\s\S]*?\n}\n\n\/\/ components\/sogs-migrated-viewer\/SogsMigratedViewer\.tsx/)?.[0] || "";
assert.ok(panelBlock, "Animation path panel should be extractable.");
assert.match(panelBlock, /const exportJson = .*?useCallback\)\(async \(\) => \{/, "Animation path copy action should be async.");
assert.match(panelBlock, /await copyTextToClipboard\(json\);/, "Animation path copy should use the shared clipboard helper.");
assert.doesNotMatch(panelBlock, /navigator\.clipboard\.writeText\(json\)/, "Animation path copy should not bypass local dev and legacy clipboard fallbacks.");
assert.match(panelBlock, /console\.error\("Path JSON copy failed", error2\);/, "Animation path copy failures should log a specific error.");
assert.match(panelBlock, /setCopyFeedback\("Copied"\)/, "Animation path copy should show success feedback.");
assert.match(panelBlock, /setCopyFeedback\("Copy failed"\)/, "Animation path copy should show failure feedback.");

console.log("Path copy regression checks passed.");
