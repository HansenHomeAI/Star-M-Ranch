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
  const kml = fs.readFileSync(new URL("../3d/assets/star_m_ranch_lot_line.kml", import.meta.url), "utf8");
  const boundary = parseKmlLotBoundary(kml, "star_m_ranch_lot_line.kml");
  const geojson = JSON.parse(fs.readFileSync(new URL("../3d/assets/star_m_ranch_lot_line.geojson", import.meta.url), "utf8"));
  assert.equal(boundary.pointCount, 15, "Star M Ranch bundled county parcel should parse as a 15-vertex boundary");
  assert.equal(boundary.sourceKind, "Polygon outerBoundaryIs");
  assert.equal(Math.round(boundary.sourceCenter.lon * 1e6) / 1e6, -111.273812, "Star M Ranch KML center longitude should match the county parcel");
  assert.equal(Math.round(boundary.sourceCenter.lat * 1e6) / 1e6, 40.713276, "Star M Ranch KML center latitude should match the county parcel");
  assert.equal(geojson.features[0].properties.apn, "OTBV-254", "Star M Ranch GeoJSON should keep the verified APN");
  assert.equal(geojson.features[0].properties.account, "0104426", "Star M Ranch GeoJSON should keep the county tax account");
  assert.equal(geojson.features[0].geometry.coordinates[0].length, 16, "Star M Ranch GeoJSON ring should be explicitly closed");
}

{
  const kml = fs.readFileSync(new URL("../3d/assets/incognito_lot_line.kml", import.meta.url), "utf8");
  const boundary = parseKmlLotBoundary(kml, "incognito_lot_line.kml");
  const defaultDots = createDefaultLotDots();
  const defaultLines = createDefaultLotLines();
  assert.equal(boundary.pointCount, 17, "Incognito bundled KML should still parse as an import fixture");
  assert.equal(boundary.sourceKind, "Polygon outerBoundaryIs");
  assert.equal(DEFAULT_INCOGNITO_KML_BOUNDARY.pointCount, boundary.pointCount);
  assert.deepEqual(DEFAULT_INCOGNITO_KML_BOUNDARY.rawPoints, boundary.rawPoints, "Bundled fallback KML boundary should match the parser orientation");
  assert.equal(JSON.stringify(DEFAULT_LOT_LINE_STYLE), JSON.stringify({ color: "#eaffdb", width: 0.004, height: 0.001, opacity: 0.72 }), "Default lot-line style should use the user's latest width, height, color, and opacity");
  assert.equal(defaultDots.length, 25, "Default lot line should use the user's latest edited 25-vertex JSON");
  assert.equal(defaultLines.length, 25, "Default lot line should use the user's latest edited 25-segment graph");
  assert.equal(JSON.stringify(defaultDots.map((d) => d.position)), JSON.stringify([
    { x: -0.378, y: -0.084, z: -0.331 },
    { x: -0.255, y: -0.094, z: -0.387 },
    { x: -0.146, y: -0.101, z: -0.421 },
    { x: 0.01, y: -0.11, z: -0.451 },
    { x: 0.201, y: -0.12, z: -0.463 },
    { x: 0.322, y: -0.123, z: -0.451 },
    { x: 0.515, y: -0.12, z: -0.414 },
    { x: 0.517, y: -0.1, z: -0.177 },
    { x: 0.5, y: -0.101, z: -0.146 },
    { x: 0.474, y: -0.101, z: -0.133 },
    { x: 0.353, y: -0.1, z: -0.131 },
    { x: 0.295, y: -0.095, z: -0.105 },
    { x: 0.274, y: -0.093, z: -0.057 },
    { x: 0.294, y: -0.085, z: 0.034 },
    { x: 0.383, y: -0.074, z: 0.157 },
    { x: -0.085, y: -0.081, z: 0.067 },
    { x: -0.117, y: -0.091, z: 0.004 },
    { x: 0.184, y: -0.081, z: 0.121 },
    { x: -0.022, y: -0.074, z: 0.081 },
    { x: 0.093, y: -0.087, z: 0.104 },
    { x: -0.25, y: -0.076, z: -0.169 },
    { x: 0.318, y: -0.097, z: -0.123 },
    { x: 0.274, y: -0.089, z: -0.011 },
    { x: 0.284, y: -0.084, z: 0.139 },
    { x: 0.334, y: -0.087, z: 0.148 }
  ]), "Default lot line should use the user's latest copied JSON vertex positions");
  assert.equal(JSON.stringify(defaultLines), JSON.stringify([
    { start: "KML_V1", end: "KML_V2" },
    { start: "KML_V2", end: "KML_V3" },
    { start: "KML_V3", end: "KML_V4" },
    { start: "KML_V4", end: "KML_V5" },
    { start: "KML_V5", end: "KML_V6" },
    { start: "KML_V6", end: "KML_V7" },
    { start: "KML_V7", end: "KML_V8" },
    { start: "KML_V8", end: "KML_V9" },
    { start: "KML_V9", end: "KML_V10" },
    { start: "KML_V10", end: "KML_V11" },
    { start: "KML_V11", end: "KML_V22" },
    { start: "KML_V22", end: "KML_V12" },
    { start: "KML_V12", end: "KML_V13" },
    { start: "KML_V13", end: "KML_V23" },
    { start: "KML_V23", end: "KML_V14" },
    { start: "KML_V14", end: "KML_V15" },
    { start: "KML_V15", end: "KML_V25" },
    { start: "KML_V25", end: "KML_V24" },
    { start: "KML_V24", end: "KML_V18" },
    { start: "KML_V18", end: "KML_V20" },
    { start: "KML_V20", end: "KML_V19" },
    { start: "KML_V19", end: "KML_V16" },
    { start: "KML_V16", end: "KML_V17" },
    { start: "KML_V17", end: "KML_V21" },
    { start: "KML_V21", end: "KML_V1" }
  ]), "Default lot line should use the user's latest copied JSON segment graph");
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
assert.match(source, /const \[showLotLines, setShowLotLines\] = \(0, import_react9\.useState\)\(false\);/, "Lot lines should remain hidden by default");
assert.match(source, /const \[lotLineEditorOpen, setLotLineEditorOpen\] = \(0, import_react9\.useState\)\(false\);/, "Lot line editor should not open just because lot lines are visible");
assert.match(source, /const \[lotLineEditorCollapsed, setLotLineEditorCollapsed\] = \(0, import_react9\.useState\)\(false\);/, "Lot line editor should support collapsing the controls while staying selected");
assert.match(source, /className: `lot-editor-panel animation-editor-panel lot-line-editor-panel \$\{lotLineEditorOpen \? "active" : ""\} \$\{lotLineEditorCollapsed \? "lot-line-editor-panel--collapsed" : ""\}`/, "Lot line editor panel should expose a collapsed class without closing the editor");
assert.match(source, /"aria-hidden": !lotLineEditorOpen/, "Lot line editor aria-hidden should follow the editor state");
assert.match(source, /"aria-label": "Toggle lot line editor"/, "Toolbar button should toggle the editor, not the rendered line visibility");
assert.match(source, /"aria-label": lotLineEditorCollapsed \? "Expand lot line editor" : "Collapse lot line editor"/, "Lot line editor header should let the user collapse or expand the controls");
assert.match(source, /onClick: \(\) => setLotLineEditorCollapsed\(\(v\) => !v\)/, "Lot line editor collapse button should toggle collapsed state without changing editor selection");
assert.match(source, /LotLinesOverlay[\s\S]*?enabled: false[\s\S]*?editable: lotLineEditorOpen/, "Lot line drag handles and add-vertex controls should stay disabled");
assert.doesNotMatch(source, /editable: lotLineEditorOpen && !lotLineEditorCollapsed/, "Collapsed lot line editor should keep visual editing handles active");
assert.doesNotMatch(source, /LotLinesOverlay[\s\S]*?enabled: viewerState === "ready" && showLotLines[\s\S]*?editable: developerToolsEnabled/, "Global dev tools should not expose lot line edit affordances unless the lot line editor is open");
assert.match(css, /\.lot-line-editor-panel--collapsed > :not\(\.animation-editor-header\)[\s\S]*?display: none;/, "Collapsed lot line editor should hide the heavy controls to free workspace");
assert.match(css, /\.lot-line-editor-panel--collapsed[\s\S]*?width: auto;/, "Collapsed lot line editor should shrink to a compact header");
assert.match(source, /var LOT_LINE_KEYBOARD_Y_STEP = 0\.001;/, "Selected lot vertices should move on the Y axis in small keyboard increments");
assert.match(source, /function getAdjacentLotVertexName\(/, "Lot line keyboard navigation should use connected neighboring vertices");
assert.match(source, /const handleLotLineKeyboardKey = \(0, import_react9\.useCallback\)\(\(key\) =>/, "Lot line keyboard actions should be centralized so parent and iframe key events share the same behavior");
assert.match(source, /window\.addEventListener\("keydown", onLotLineKeyDown\)/, "Lot line editor should listen for keyboard nudges while active");
assert.match(source, /key === "ArrowUp"[\s\S]*?LOT_LINE_KEYBOARD_Y_STEP/, "ArrowUp should nudge the selected vertex Y upward by the small step");
assert.match(source, /key === "ArrowDown"[\s\S]*?LOT_LINE_KEYBOARD_Y_STEP/, "ArrowDown should nudge the selected vertex Y downward by the small step");
assert.match(source, /key === "ArrowRight"[\s\S]*?getAdjacentLotVertexName\(selectedLotPointName, 1, lotDots, lotLines\)/, "ArrowRight should select the next connected lot vertex");
assert.match(source, /key === "ArrowLeft"[\s\S]*?getAdjacentLotVertexName\(selectedLotPointName, -1, lotDots, lotLines\)/, "ArrowLeft should select the previous connected lot vertex");
assert.match(source, /closest\?\.\("input, textarea, \[contenteditable=true\]"\)/, "Lot line keyboard shortcuts should not steal arrows from editable text fields");
assert.doesNotMatch(source, /closest\?\.\("input, textarea, select, \[contenteditable=true\]"\)/, "Lot line keyboard shortcuts should still work after choosing a vertex from the select menu");
assert.match(source, /event\.data\?\.type === "sogs:keyDown"[\s\S]*?handleLotLineKeyboardKey\(event\.data\.key\)/, "Iframe arrow-key messages should drive lot-line keyboard editing after the viewer canvas has focus");
assert.match(bridgeSource, /window\.parent\.postMessage\(\{ type: "sogs:keyDown", key: event\.key \}, "\*"\)/, "SOGS bridge should forward iframe arrow-key presses to the parent lot-line editor");
assert.match(bridgeSource, /event\.preventDefault\(\);/, "Forwarded iframe arrow keys should be prevented from also scrolling or orbiting while editing");
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
assert.match(bridgeSource, /m\.opacity = 1;/, "Iframe lot line material should stay solid so close-up views do not show blue-noise grain");
assert.match(bridgeSource, /m\.blendType = LOT_LINE_BLEND_NONE;/, "Iframe lot line material should render in the opaque queue so the splat can paint over it");
assert.match(bridgeSource, /m\.opacityDither = "none";/, "Iframe lot line material should not use opacity dithering because it creates visible particulate grain up close");
assert.doesNotMatch(bridgeSource, /LOT_LINE_OPACITY_DITHER|bluenoise/, "Lot line renderer should not keep the blue-noise opacity dither path");
assert.match(bridgeSource, /m\.depthWrite = true;/, "Iframe lot line material should write depth so front splats can occlude line fragments while back splats do not paint through");
assert.doesNotMatch(bridgeSource, /m\.depthTest = true;/, "Lot lines should not use World-layer depth testing because the transparent gsplat has no stable mesh depth for them");
assert.doesNotMatch(bridgeSource, /m\.depthBias = LOT_LINE_DEPTH_BIAS;/, "Lot lines should not depend on depth bias; that path caused angle-dependent disappearance");
assert.match(bridgeSource, /const LOT_LINE_CULL_NONE = 0;/, "Iframe lot line renderer should define a no-cull mode for constant viewing-angle opacity");
assert.match(bridgeSource, /m\.cull = LOT_LINE_CULL_NONE;/, "Iframe lot line material should be double-sided so opacity is not view-angle dependent");
assert.match(bridgeSource, /mi\.cull = false;/, "Iframe lot line mesh instances should avoid culling edge cases while lot lines are toggled on");
assert.match(bridgeSource, /function setLotLineRenderLayer\(ent\)/, "Iframe lot line renderer should have a dedicated render-layer helper");
assert.match(bridgeSource, /const LAYER_ID_WORLD = 0;/, "Lot line renderer should know the World layer used by the gsplat");
assert.match(bridgeSource, /ent\.render\.layers = \[LAYER_ID_WORLD\];/, "Lot line render helper should keep meshes in the World opaque pass so splats can occlude them");
assert.doesNotMatch(bridgeSource, /function setLotLineRenderLayer\(ent\)[\s\S]*?LAYER_ID_IMMEDIATE/, "Lot line render helper must not use the Immediate overlay layer because that makes lot lines float over the splat");
assert.match(bridgeSource, /mi\.drawOrder = LOT_LINE_DRAW_ORDER;/, "Lot line mesh instances should draw late and consistently while lot lines are toggled on");
assert.match(bridgeSource, /setLotLineRenderLayer\(ent\);/, "Lot line segments and vertex caps should be assigned to the stable lot-line render layer");
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
assert.match(source, /id: "lot-line-kml-scale"[\s\S]*?step: "0\.0001"/, "KML scale spinner should use fine 0.0001 increments");
for (const id of ["lot-line-kml-x", "lot-line-kml-y", "lot-line-kml-z", "lot-line-x", "lot-line-y", "lot-line-z"]) {
  assert.match(source, new RegExp(`id: "${id}"[\\s\\S]*?step: "0\\.001"`), `${id} spinner should use fine 0.001 unit increments`);
}
assert.match(source, /id: "lot-line-kml-rotation"[\s\S]*?step: "0\.1"/, "KML rotation spinner should use fine 0.1 degree increments");

console.log("KML importer regression checks passed.");
