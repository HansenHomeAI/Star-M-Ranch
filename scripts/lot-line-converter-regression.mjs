import assert from "node:assert/strict";

import {
  buildGeojson,
  buildKml,
  buildMetadata,
  detectBoundary,
  isLotLinePixel,
  isRoomLinePixel,
  pixelPolygonToRelativeLonLat
} from "../lot-line-converter/app.js";

function makeSyntheticLotImage(width = 240, height = 200) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 34;
    data[i + 1] = 46;
    data[i + 2] = 31;
    data[i + 3] = 255;
  }
  const red = (x, y) => {
    const index = (y * width + x) * 4;
    data[index] = 248;
    data[index + 1] = 18;
    data[index + 2] = 12;
  };
  const drawLine = (x1, y1, x2, y2, thickness = 7) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x1 + ((x2 - x1) * i) / steps);
      const y = Math.round(y1 + ((y2 - y1) * i) / steps);
      for (let oy = -thickness; oy <= thickness; oy++) {
        for (let ox = -thickness; ox <= thickness; ox++) {
          const px = x + ox;
          const py = y + oy;
          if (px >= 0 && py >= 0 && px < width && py < height && Math.hypot(ox, oy) <= thickness) {
            red(px, py);
          }
        }
      }
    }
  };
  drawLine(30, 20, 205, 20);
  drawLine(205, 20, 205, 180);
  drawLine(205, 180, 110, 180);
  drawLine(110, 180, 110, 95);
  drawLine(110, 95, 30, 95);
  drawLine(30, 95, 30, 20);
  return { width, height, data };
}

assert.equal(isLotLinePixel(248, 18, 12), true, "Bright red lot-line pixels should be detected");
assert.equal(isRoomLinePixel(10, 10, 10), true, "Dark room-line pixels should be detected");

const result = detectBoundary(makeSyntheticLotImage(), "lot");
assert.equal(result.detected, true, "Synthetic L-shaped lot line should be detected");
assert.ok(result.polygon.length >= 5, "Detected lot line should retain the L-shape with enough vertices");
assert.ok(result.confidence >= 0.55, "Detected lot line should clear the confidence floor");

const relative = pixelPolygonToRelativeLonLat(result.polygon, 240, 200);
assert.equal(relative.length, result.polygon.length, "Every pixel vertex should map to a relative coordinate");
assert.ok(relative.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat)), "Relative coordinates should be finite");

const kml = buildKml({
  name: "Synthetic Lot",
  polygon: result.polygon,
  width: 240,
  height: 200,
  confidence: result.confidence,
  warnings: result.warnings
});
assert.match(kml, /<kml xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2">/, "KML export should use the KML namespace");
assert.match(kml, /relative_0_0/, "KML export should mark image-derived coordinates as relative");
assert.match(kml, /<coordinates>[\s\S]+<\/coordinates>/, "KML export should include coordinates");

const geojson = JSON.parse(
  buildGeojson({
    name: "Synthetic Lot",
    polygon: result.polygon,
    width: 240,
    height: 200,
    confidence: result.confidence,
    warnings: result.warnings
  })
);
assert.equal(geojson.features[0].geometry.type, "Polygon", "GeoJSON export should be a polygon");

const metadata = JSON.parse(
  buildMetadata({
    fileName: "synthetic.png",
    mode: "lot",
    polygon: result.polygon,
    width: 240,
    height: 200,
    confidence: result.confidence,
    warnings: result.warnings
  })
);
assert.equal(metadata.fileName, "synthetic.png", "Metadata should preserve the source filename");
assert.equal(metadata.pixel_polygon.length, result.polygon.length, "Metadata should include the pixel polygon");

console.log("Lot-line converter regression checks passed.");
