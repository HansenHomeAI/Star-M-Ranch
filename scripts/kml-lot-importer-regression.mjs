import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../3d/index.js", import.meta.url), "utf8");
const start = source.indexOf("var DEFAULT_KML_LOT_TRANSFORM");
const end = source.indexOf("var CANYON_VISTA_SOLD_HOTSPOTS");

assert.ok(start >= 0 && end > start, "Could not locate KML lot importer code in 3d/index.js");

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(
  `${source.slice(start, end)}
  globalThis.__kmlLotImporter = { parseKmlLotBoundary, buildLotFromKmlBoundary, createDefaultLotDots, createDefaultLotLines, DEFAULT_INCOGNITO_KML_BOUNDARY };`,
  sandbox
);

const { parseKmlLotBoundary, buildLotFromKmlBoundary, createDefaultLotDots, createDefaultLotLines, DEFAULT_INCOGNITO_KML_BOUNDARY } = sandbox.__kmlLotImporter;

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
  assert.equal(defaultDots.length, 17, "Default lot line should come from the Incognito KML boundary");
  assert.equal(defaultLines.length, 17, "Default lot line should be a closed Incognito loop");
  assert.equal(defaultLines.at(-1).start, "KML_V17");
  assert.equal(defaultLines.at(-1).end, "KML_V1");
}

assert.match(source, /var DEFAULT_INCOGNITO_KML_URL = "assets\/incognito_lot_line\.kml";/, "Default Incognito KML asset path should be explicit in the app");
assert.match(source, /var DEFAULT_KML_LOT_TRANSFORM = \{ x: 0, y: 0, z: 0, scale: 1, rotation: 0 \};/, "Default KML should sit high enough to be visible before manual Y adjustment");
assert.match(source, /const \[showLotLines, setShowLotLines\] = \(0, import_react9\.useState\)\(true\);/, "Lot lines should be visible by default");
assert.match(source, /const \[lotLineEditorOpen, setLotLineEditorOpen\] = \(0, import_react9\.useState\)\(false\);/, "Lot line editor should not open just because lot lines are visible");
assert.match(source, /className: `lot-editor-panel animation-editor-panel lot-line-editor-panel \$\{lotLineEditorOpen \? "active" : ""\}`/, "Lot line editor panel visibility should be controlled separately from rendered lot lines");
assert.match(source, /"aria-hidden": !lotLineEditorOpen/, "Lot line editor aria-hidden should follow the editor state");
assert.match(source, /"aria-label": "Toggle lot line editor"/, "Toolbar button should toggle the editor, not the rendered line visibility");
assert.match(source, /fetch\(tapDotAssetUrl\(DEFAULT_INCOGNITO_KML_URL\)\)/, "The bundled KML file should be imported at runtime, not only hardcoded");
assert.match(source, /id: "lot-line-kml-scale"[\s\S]*?step: "0\.0001"/, "KML scale spinner should use fine 0.0001 increments");
for (const id of ["lot-line-kml-x", "lot-line-kml-y", "lot-line-kml-z", "lot-line-x", "lot-line-y", "lot-line-z"]) {
  assert.match(source, new RegExp(`id: "${id}"[\\s\\S]*?step: "0\\.001"`), `${id} spinner should use fine 0.001 unit increments`);
}
assert.match(source, /id: "lot-line-kml-rotation"[\s\S]*?step: "0\.1"/, "KML rotation spinner should use fine 0.1 degree increments");

console.log("KML importer regression checks passed.");
