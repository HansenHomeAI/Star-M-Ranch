import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../3d/index.css", import.meta.url), "utf8");
const bridgeSource = fs.readFileSync(new URL("../supersplat-viewer/sogs-bridge.mjs", import.meta.url), "utf8");
const start = source.indexOf("var DEFAULT_LOT_LINE_STYLE");
const end = source.indexOf("var CANYON_VISTA_SOLD_HOTSPOTS");

assert.ok(start >= 0 && end > start, "Could not locate KML lot importer code in 3d/index.js");

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  `${source.slice(start, end)}
  globalThis.__kmlLotImporter = { parseKmlLotBoundary, buildLotFromKmlBoundary, createDefaultLotDots, createDefaultLotLines, getAdjacentLotVertexName, DEFAULT_INCOGNITO_KML_BOUNDARY, DEFAULT_INCOGNITO_KML_TRANSFORM, DEFAULT_LOT_LINE_STYLE };`,
  sandbox
);

const { parseKmlLotBoundary, buildLotFromKmlBoundary, createDefaultLotDots, createDefaultLotLines, getAdjacentLotVertexName, DEFAULT_INCOGNITO_KML_BOUNDARY, DEFAULT_INCOGNITO_KML_TRANSFORM, DEFAULT_LOT_LINE_STYLE } = sandbox.__kmlLotImporter;

function manyLinePoints(count) {
  return Array.from({ length: count }, (_, i) => `${-111 + i * 0.00001},45.${String(i).padStart(3, "0")},0`).join(" ");
}

{
  const kml = `<?xml version="1.0"?>
  <kml><Document>
    <Placemark><LineString><coordinates>${manyLinePoints(28)}</coordinates></LineString></Placemark>
    <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
      -111.001,45.001,0 -111.000,45.001,0 -111.000,45.000,0 -111.001,45.000,0 -111.001,45.001,0
    </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Document></kml>`;
  const boundary = parseKmlLotBoundary(kml, "polygon-vs-line.kml");
  assert.equal(boundary.pointCount, 4, "polygon outer ring should win over longer LineString coordinates");
  assert.equal(boundary.sourceKind, "Polygon outerBoundaryIs");
}

{
  const kml = `<?xml version="1.0"?>
  <kml:kml xmlns:kml="http://www.opengis.net/kml/2.2"><kml:Document>
    <kml:Placemark><kml:Polygon><kml:outerBoundaryIs><kml:LinearRing><kml:coordinates>
      -111.002,45.002,0
      -111.000,45.002,0
      -111.000,45.000,0
      -111.002,45.000,0
      -111.002,45.002,0
    </kml:coordinates></kml:LinearRing></kml:outerBoundaryIs></kml:Polygon></kml:Placemark>
  </kml:Document></kml:kml>`;
  const boundary = parseKmlLotBoundary(kml, "namespaced.kml");
  assert.equal(boundary.pointCount, 4, "namespaced KML polygons should parse");
}

{
  const kml = `<?xml version="1.0"?>
  <kml><Document><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
    -0.001,0.001,0
     0.001,0.001,0
     0.001,-0.001,0
    -0.001,-0.001,0
    -0.001,0.001,0
  </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
  const boundary = parseKmlLotBoundary(kml, "orientation.kml");
  assert.ok(boundary.rawPoints[0].z < 0, "higher KML latitude should map to negative viewer Z so imports are not mirrored");
  assert.ok(boundary.rawPoints[2].z > 0, "lower KML latitude should map to positive viewer Z so imports are not mirrored");
}

{
  const kml = `<?xml version="1.0"?>
  <kml><Document><Placemark><Polygon>
    <outerBoundaryIs><LinearRing><coordinates>
      -111.004,45.004,0 -111.000,45.004,0 -111.000,45.000,0 -111.004,45.000,0 -111.004,45.004,0
    </coordinates></LinearRing></outerBoundaryIs>
    <innerBoundaryIs><LinearRing><coordinates>
      -111.0035,45.0035,0 -111.003,45.0037,0 -111.0025,45.0035,0 -111.002,45.003,0
      -111.0025,45.0025,0 -111.003,45.0023,0 -111.0035,45.0025,0 -111.0037,45.003,0 -111.0035,45.0035,0
    </coordinates></LinearRing></innerBoundaryIs>
  </Polygon></Placemark></Document></kml>`;
  const boundary = parseKmlLotBoundary(kml, "hole.kml");
  assert.equal(boundary.pointCount, 4, "innerBoundaryIs holes should not be imported as the lot line");
}

{
  const kml = `<?xml version="1.0"?>
  <kml><Document><Placemark><MultiGeometry>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>
      -111.001,45.001,0 -111.0005,45.001,0 -111.0005,45.0005,0 -111.001,45.0005,0 -111.001,45.001,0
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>
      -111.010,45.010,0 -111.000,45.010,0 -111.000,45.000,0 -111.010,45.000,0 -111.010,45.010,0
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
  </MultiGeometry></Placemark></Document></kml>`;
  const boundary = parseKmlLotBoundary(kml, "multigeometry.kml");
  const built = buildLotFromKmlBoundary(boundary, { x: 0.25, y: -0.2, z: -0.5, scale: boundary.autoScale, rotation: 15 });
  assert.equal(boundary.pointCount, 4, "largest Polygon in MultiGeometry should be selected");
  assert.equal(built.dots.length, 4);
  assert.equal(built.lines.length, 4);
  assert.equal(built.lines.at(-1).start, "KML_V4");
  assert.equal(built.lines.at(-1).end, "KML_V1");
  assert.ok(built.dots.every((d) => Number.isFinite(d.position.x) && Number.isFinite(d.position.y) && Number.isFinite(d.position.z)));
}

{
  const kml = fs.readFileSync(new URL("../3d/assets/incognito_lot_line.kml", import.meta.url), "utf8");
  const boundary = parseKmlLotBoundary(kml, "incognito_lot_line.kml");
  const defaultDots = createDefaultLotDots();
  const defaultLines = createDefaultLotLines();
  assert.equal(boundary.pointCount, 17, "Incognito bundled KML should parse all true lot vertices");
  assert.equal(boundary.sourceKind, "Polygon outerBoundaryIs");
  assert.equal(DEFAULT_INCOGNITO_KML_BOUNDARY.pointCount, boundary.pointCount);
  assert.deepEqual(DEFAULT_INCOGNITO_KML_BOUNDARY.rawPoints, boundary.rawPoints, "Bundled fallback KML boundary should match the parser orientation");
  assert.equal(JSON.stringify(DEFAULT_INCOGNITO_KML_TRANSFORM), JSON.stringify({ x: 0.054, y: -0.074, z: -0.205, scale: 0.00102, rotation: 11.2 }), "Default Incognito transform should use the user's latest saved lot-line pose");
  assert.equal(JSON.stringify(DEFAULT_LOT_LINE_STYLE), JSON.stringify({ color: "#eaffdb", width: 0.004, height: 0.001, opacity: 0.72 }), "Default lot-line style should use the user's latest width, height, color, and opacity");
  assert.equal(defaultDots.length, 17, "Default lot line should come from the Incognito KML boundary");
  assert.equal(defaultLines.length, 17, "Default lot line should be a closed Incognito loop");
  assert.equal(JSON.stringify(defaultDots.map((d) => d.position)), JSON.stringify([
    { x: -0.384, y: -0.074, z: -0.343 },
    { x: -0.26, y: -0.074, z: -0.399 },
    { x: -0.149, y: -0.074, z: -0.431 },
    { x: 0.009, y: -0.074, z: -0.458 },
    { x: 0.198, y: -0.074, z: -0.475 },
    { x: 0.324, y: -0.074, z: -0.455 },
    { x: 0.498, y: -0.074, z: -0.419 },
    { x: 0.512, y: -0.074, z: -0.17 },
    { x: 0.5, y: -0.074, z: -0.146 },
    { x: 0.474, y: -0.074, z: -0.133 },
    { x: 0.353, y: -0.074, z: -0.131 },
    { x: 0.286, y: -0.074, z: -0.112 },
    { x: 0.266, y: -0.074, z: -0.068 },
    { x: 0.294, y: -0.074, z: 0.034 },
    { x: 0.379, y: -0.074, z: 0.153 },
    { x: -0.103, y: -0.074, z: 0.067 },
    { x: -0.109, y: -0.074, z: -0.012 }
  ]), "Default lot line should use the user's latest copied JSON vertex positions");
  assert.equal(defaultLines.at(-1).start, "KML_V17");
  assert.equal(defaultLines.at(-1).end, "KML_V1");
}

{
  const dots = [{ name: "KML_V1" }, { name: "KML_V2" }, { name: "KML_V3" }];
  const lines = [{ start: "KML_V1", end: "KML_V2" }, { start: "KML_V2", end: "KML_V3" }, { start: "KML_V3", end: "KML_V1" }];
  assert.equal(getAdjacentLotVertexName("KML_V2", 1, dots, lines), "KML_V3", "Right arrow should select the next connected lot vertex");
  assert.equal(getAdjacentLotVertexName("KML_V2", -1, dots, lines), "KML_V1", "Left arrow should select the previous connected lot vertex");
  assert.equal(getAdjacentLotVertexName("KML_V1", -1, dots, lines), "KML_V3", "Left arrow should wrap around a closed lot line loop");
  assert.equal(getAdjacentLotVertexName("missing", 1, dots, []), "KML_V1", "Keyboard selection should recover to the first vertex when the current selection is missing");
}

assert.match(source, /var DEFAULT_INCOGNITO_KML_URL = "assets\/incognito_lot_line\.kml";/, "Default Incognito KML asset path should be explicit in the app");
assert.match(source, /var DEFAULT_KML_LOT_TRANSFORM = \{ x: 0, y: 0, z: 0, scale: 1, rotation: 0 \};/, "Default KML should sit high enough to be visible before manual Y adjustment");
assert.match(source, /var DEFAULT_INCOGNITO_KML_TRANSFORM = \{ \.\.\.DEFAULT_KML_LOT_TRANSFORM, x: 0\.054, y: -0\.074, z: -0\.205, scale: 0\.00102, rotation: 11\.2 \};/, "Default Incognito KML should use the user's saved aligned transform");
assert.match(source, /const transform = DEFAULT_INCOGNITO_KML_TRANSFORM;/, "Bundled Incognito KML reload should preserve the saved aligned transform");
assert.match(source, /const \[showLotLines, setShowLotLines\] = \(0, import_react9\.useState\)\(true\);/, "Lot lines should be visible by default");
assert.match(source, /const \[lotLineEditorOpen, setLotLineEditorOpen\] = \(0, import_react9\.useState\)\(false\);/, "Lot line editor should not open just because lot lines are visible");
assert.match(source, /const \[lotLineEditorCollapsed, setLotLineEditorCollapsed\] = \(0, import_react9\.useState\)\(false\);/, "Lot line editor should support collapsing the controls while staying selected");
assert.match(source, /className: `lot-editor-panel animation-editor-panel lot-line-editor-panel \$\{lotLineEditorOpen \? "active" : ""\} \$\{lotLineEditorCollapsed \? "lot-line-editor-panel--collapsed" : ""\}`/, "Lot line editor panel should expose a collapsed class without closing the editor");
assert.match(source, /"aria-hidden": !lotLineEditorOpen/, "Lot line editor aria-hidden should follow the editor state");
assert.match(source, /"aria-label": "Toggle lot line editor"/, "Toolbar button should toggle the editor, not the rendered line visibility");
assert.match(source, /"aria-label": lotLineEditorCollapsed \? "Expand lot line editor" : "Collapse lot line editor"/, "Lot line editor header should let the user collapse or expand the controls");
assert.match(source, /onClick: \(\) => setLotLineEditorCollapsed\(\(v\) => !v\)/, "Lot line editor collapse button should toggle collapsed state without changing editor selection");
assert.match(source, /LotLinesOverlay[\s\S]*?enabled: viewerState === "ready" && showLotLines[\s\S]*?editable: lotLineEditorOpen/, "Lot line drag handles and add-vertex controls should only show when the lot line editor is open");
assert.doesNotMatch(source, /editable: lotLineEditorOpen && !lotLineEditorCollapsed/, "Collapsed lot line editor should keep visual editing handles active");
assert.doesNotMatch(source, /LotLinesOverlay[\s\S]*?enabled: viewerState === "ready" && showLotLines[\s\S]*?editable: developerToolsEnabled/, "Global dev tools should not expose lot line edit affordances unless the lot line editor is open");
assert.match(css, /\.lot-line-editor-panel--collapsed > :not\(\.animation-editor-header\)[\s\S]*?display: none;/, "Collapsed lot line editor should hide the heavy controls to free workspace");
assert.match(css, /\.lot-line-editor-panel--collapsed[\s\S]*?width: auto;/, "Collapsed lot line editor should shrink to a compact header");
assert.match(source, /var LOT_LINE_KEYBOARD_Y_STEP = 0\.001;/, "Selected lot vertices should move on the Y axis in small keyboard increments");
assert.match(source, /function getAdjacentLotVertexName\(/, "Lot line keyboard navigation should use connected neighboring vertices");
assert.match(source, /window\.addEventListener\("keydown", onLotLineKeyDown\)/, "Lot line editor should listen for keyboard nudges while active");
assert.match(source, /event\.key === "ArrowUp"[\s\S]*?LOT_LINE_KEYBOARD_Y_STEP/, "ArrowUp should nudge the selected vertex Y upward by the small step");
assert.match(source, /event\.key === "ArrowDown"[\s\S]*?LOT_LINE_KEYBOARD_Y_STEP/, "ArrowDown should nudge the selected vertex Y downward by the small step");
assert.match(source, /event\.key === "ArrowRight"[\s\S]*?getAdjacentLotVertexName\(selectedLotPointName, 1, lotDots, lotLines\)/, "ArrowRight should select the next connected lot vertex");
assert.match(source, /event\.key === "ArrowLeft"[\s\S]*?getAdjacentLotVertexName\(selectedLotPointName, -1, lotDots, lotLines\)/, "ArrowLeft should select the previous connected lot vertex");
assert.match(source, /closest\?\.\("input, textarea, \[contenteditable=true\]"\)/, "Lot line keyboard shortcuts should not steal arrows from editable text fields");
assert.doesNotMatch(source, /closest\?\.\("input, textarea, select, \[contenteditable=true\]"\)/, "Lot line keyboard shortcuts should still work after choosing a vertex from the select menu");
assert.match(source, /function copyTextToClipboard\(text\)/, "Lot line JSON copy should use the shared clipboard helper");
assert.match(source, /function legacyCopyTextToClipboard\(text\)/, "Lot line JSON copy should have a legacy fallback when clipboard permission fails");
assert.match(source, /function copyTextWithLocalDevBridge\(text\)/, "Lot line JSON copy should use the local dev clipboard bridge when available");
assert.match(source, /fetch\("\/__meadow\/clipboard"/, "Lot line JSON copy should post to the local clipboard bridge on localhost");
assert.match(source, /const \[lotCopyFeedback, setLotCopyFeedback\]/, "Lot line JSON copy should show success or failure feedback");
assert.match(source, /setLotCopyFeedback\(`Copied \$\{lotDots\.length\} vertices`\)/, "Lot line JSON copy feedback should confirm the copied vertex count");
assert.match(source, /var DEFAULT_LOT_LINE_STYLE = \{ color: "#eaffdb", width: 0\.004, height: 0\.001, opacity: 0\.72 \};/, "Lot lines should have default editable color, width, flattened height, and opacity");
assert.match(source, /borderDots: lotDots[\s\S]*?borderLines: lotLines[\s\S]*?style: lotLineStyle[\s\S]*?kmlTransform: kmlBoundary \? kmlTransform : null[\s\S]*?source: kmlBoundary \? \{ type: "kml", fileName: kmlBoundary\.fileName, coordinateMode: "relative_0_0" \}/, "Lot line JSON copy should include vertices, lines, editable style, KML transform, and source metadata");
assert.match(source, /id: "lot-line-width"[\s\S]*?step: "0\.001"/, "Lot line width should have a fine numeric editor");
assert.match(source, /id: "lot-line-height"[\s\S]*?step: "0\.001"/, "Lot line height should have a fine numeric editor");
assert.match(source, /id: "lot-line-opacity"[\s\S]*?type: "range"[\s\S]*?min: "0\.1"[\s\S]*?max: "1"[\s\S]*?step: "0\.01"/, "Lot line opacity should have a fine slider editor");
assert.doesNotMatch(source, /id: "lot-line-thickness"/, "Lot lines should expose width and height controls instead of one thickness control");
assert.match(source, /const \[lotLineColorText, setLotLineColorText\]/, "Lot line color text input should allow typing partial hex values");
assert.match(source, /id: "lot-line-color-hex"[\s\S]*?value: lotLineColorText/, "Lot line color should have a hex text editor");
assert.match(source, /style: lotLineStyle[\s\S]*?type: "sogs:lotLines"/, "Rendered lot lines should receive the editable style");
assert.match(bridgeSource, /window\.__sogsLotLineStyle = normalizeLotLineStyle\(d\.style\);/, "Iframe lot line renderer should accept posted style");
assert.match(bridgeSource, /function parseHexColor\(hex\)/, "Iframe lot line renderer should parse hex colors");
assert.match(bridgeSource, /width: normalizeLotLineDimension\(style\?\.width, fallbackWidth\)/, "Iframe lot line style should normalize width");
assert.match(bridgeSource, /height: normalizeLotLineDimension\(style\?\.height, fallbackHeight\)/, "Iframe lot line style should normalize height");
assert.match(bridgeSource, /opacity: normalizeLotLineOpacity\(style\?\.opacity\)/, "Iframe lot line style should normalize opacity");
assert.match(bridgeSource, /m\.opacity = style\.opacity;/, "Iframe lot line material should apply requested opacity");
assert.match(bridgeSource, /m\.blendType = LOT_LINE_BLEND_NORMAL;/, "Iframe lot line material should enable alpha blending for opacity");
assert.match(bridgeSource, /m\.depthWrite = style\.opacity >= 0\.99;/, "Iframe lot line material should avoid depth-writing while semi-transparent");
assert.match(bridgeSource, /const LOT_LINE_CULL_NONE = 0;/, "Iframe lot line renderer should define a no-cull mode for constant viewing-angle opacity");
assert.match(bridgeSource, /m\.cull = LOT_LINE_CULL_NONE;/, "Iframe lot line material should be double-sided so opacity is not view-angle dependent");
assert.match(bridgeSource, /mi\.cull = false;/, "Iframe lot line mesh instances should avoid culling edge cases while lot lines are toggled on");
assert.match(bridgeSource, /function setLotLineRenderLayer\(ent\)/, "Iframe lot line renderer should have a dedicated render-layer helper");
assert.match(bridgeSource, /ent\.render\.layers = \[LAYER_ID_IMMEDIATE\];/, "Lot line render helper should move meshes to the Immediate layer so gsplat rendering cannot repaint them by viewing angle");
assert.match(bridgeSource, /mi\.drawOrder = LOT_LINE_DRAW_ORDER;/, "Lot line mesh instances should use a high manual draw order for stable compositing");
assert.match(bridgeSource, /setLotLineRenderLayer\(ent\);/, "Lot line segments and vertex caps should be assigned to the stable overlay layer");
assert.match(bridgeSource, /function stableLotLineRotation\(dir\)/, "Iframe lot line renderer should lock oval roll to world-up instead of per-segment arbitrary roll");
assert.match(bridgeSource, /ent\.setLocalRotation\(stableLotLineRotation\(dir\)\)/, "Iframe lot line renderer should use the stable world-up lot line rotation");
assert.doesNotMatch(bridgeSource, /setFromDirections\(LOCAL_Y, dir\)/, "Lot line segments should not use setFromDirections because it leaves oval roll unconstrained");
assert.match(bridgeSource, /ent\.setLocalScale\(style\.width, len, style\.height\)/, "Iframe lot line renderer should apply an oval cross-section using editable width and height");
assert.doesNotMatch(bridgeSource, /SphereGeometry/, "Lot vertex caps should not require changing the bundled viewer export surface");
assert.match(bridgeSource, /function buildUnitLotVertexGeometry\(\)/, "Iframe lot line renderer should build local rounded vertex geometry for joins");
assert.match(bridgeSource, /function buildUnitLotVertexMesh\(app\)/, "Iframe lot line renderer should build vertex cap geometry for rounded joins");
assert.match(bridgeSource, /new Entity\(`lotLineVertex:\$\{dot\.name\}`/, "Iframe lot line renderer should create a cap at every lot vertex");
assert.match(bridgeSource, /ent\.setLocalScale\(style\.width, style\.height, style\.width\)/, "Lot vertex caps should use a top-down circular width and vertical height matching the lot line style");
assert.match(bridgeSource, /catch \(error\) \{[\s\S]*?Lot line vertex caps failed; rendering line segments only\./, "Lot line segments should stay visible even if rounded vertex cap geometry fails");
assert.match(source, /fetch\(tapDotAssetUrl\(DEFAULT_INCOGNITO_KML_URL\)\)/, "The bundled KML file should be imported at runtime, not only hardcoded");
assert.match(source, /id: "lot-line-kml-scale"[\s\S]*?step: "0\.0001"/, "KML scale spinner should use fine 0.0001 increments");
for (const id of ["lot-line-kml-x", "lot-line-kml-y", "lot-line-kml-z", "lot-line-x", "lot-line-y", "lot-line-z"]) {
  assert.match(source, new RegExp(`id: "${id}"[\\s\\S]*?step: "0\\.001"`), `${id} spinner should use fine 0.001 unit increments`);
}
assert.match(source, /id: "lot-line-kml-rotation"[\s\S]*?step: "0\.1"/, "KML rotation spinner should use fine 0.1 degree increments");

console.log("KML importer regression checks passed.");
