import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");

const defaultPathBlock = source.match(/var CANYON_VISTA_DEFAULT_PATH_CHECKPOINTS = \[[\s\S]*?\n\];/)?.[0] || "";
assert.ok(defaultPathBlock, "Default animation path should be extractable.");
assert.equal((defaultPathBlock.match(/duration: 5/g) || []).length, 14, "Default animation path should contain 14 checkpoints with 5-second durations.");
assert.doesNotMatch(defaultPathBlock, /duration: 7/, "Default animation path should not keep old 7-second durations.");
assert.match(defaultPathBlock, /position: \{ x: -0\.6142325162058411, y: 0\.15581982934472063, z: -0\.7422609285119238 \}/, "Default animation path should start from the updated first checkpoint.");
assert.match(defaultPathBlock, /position: \{ x: -0\.8147770591573891, y: 0\.1728903205240006, z: -0\.3878196563880584 \}/, "Default animation path should end at the updated fourteenth checkpoint.");
assert.match(source, /appendCheckpoint\(pathStateRef\.current,[\s\S]*?duration: 5[\s\S]*?\}\);/, "Newly captured animation path checkpoints should default to 5 seconds.");

const panelBlock = source.match(/function AnimationPathPanel\([\s\S]*?\n}\n\n\/\/ components\/sogs-migrated-viewer\/SogsMigratedViewer\.tsx/)?.[0] || "";
assert.ok(panelBlock, "Animation path panel should be extractable.");
assert.match(panelBlock, /const exportJson = .*?useCallback\)\(async \(\) => \{/, "Animation path copy action should be async.");
assert.match(panelBlock, /await copyTextToClipboard\(json\);/, "Animation path copy should use the shared clipboard helper.");
assert.doesNotMatch(panelBlock, /navigator\.clipboard\.writeText\(json\)/, "Animation path copy should not bypass local dev and legacy clipboard fallbacks.");
assert.match(panelBlock, /console\.error\("Path JSON copy failed", error2\);/, "Animation path copy failures should log a specific error.");
assert.match(panelBlock, /setCopyFeedback\("Copied"\)/, "Animation path copy should show success feedback.");
assert.match(panelBlock, /setCopyFeedback\("Copy failed"\)/, "Animation path copy should show failure feedback.");

console.log("Path copy regression checks passed.");
