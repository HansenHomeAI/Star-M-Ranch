# Star M Ranch Viewer

Static split-shell SOGS viewer using the High Mountain Camp shell with the latest completed Star M Ranch compressed SOGS bundle from AWS staging.

The property bio is based on the public Star M Ranch listing for 389 E Boulderville Road in Oakley, Utah: a 60-acre Weber River estate with a trout pond, remodeled main residence, guest housing, artist studio, horse facilities, and a 16,800-square-foot party barn.

## Local development

```bash
npm install
npm run dev
```

The Vite dev server serves the repo root (default **5173**; if that port is busy, Vite uses the next free one—check the terminal for the URL). `/` redirects to `/3d/`. The viewer assets are resolved relative to the deployed `/3d/` route so the repo works both at a domain root and under GitHub Pages project paths.

Developer tools in the shell (splat position/rotation helpers) are hidden by default. Add `?dev=1` to the URL to show them.

## Lot-line converter page

The hidden converter route lives at `/lot-line-converter/`. It vendors the `HansenHomeAI/primary-lot-line-converter` reference project under `tools/primary-lot-line-converter` and adds a static browser-side page for highlighted lot-line screenshots. The page exports image-derived KML, GeoJSON, and metadata using `relative_0_0` coordinates, plus a direct verified Star M Ranch KML/GeoJSON shortcut from the county parcel data.

## Lot-line data

The verified Star M Ranch parcel boundary is bundled in both formats:

- `3d/assets/star_m_ranch_lot_line.kml`
- `3d/assets/star_m_ranch_lot_line.geojson`

The source parcel is Summit County GIS APN `OTBV-254`, account `0104426`, situs `389 E BOULDERVILLE RD`, reported at 60.41 acres. The county ArcGIS query used to export it is embedded in the GeoJSON `source_url` property.

Open the lot-line editor to inspect a `.kml` file, or choose another `.kml` file from the KML field, then use **Scale**, **Center X/Y/Z**, and **Rotation** to align the imported boundary around the splat. KML coordinates are treated as relative geometry and centered around the viewer origin because the splat does not currently carry real-world coordinates.

The importer prefers `Polygon > outerBoundaryIs > LinearRing > coordinates`, ignores inner holes, supports namespaced KML tags, and falls back to closed `LinearRing`/coordinate blocks when no Polygon is present. Run `npm run test:kml` to check the regression cases.

## Tap-dot photos

Tap dots are on by default. The example dots are configured in `3d/index.js` under `CANYON_VISTA_TAP_DOTS`, and the sample image assets live in `3d/assets/tapdots/`.

Each dot has a world `position`, a `caption`, and a `photos` array. Photo entries can be repo-local paths like `assets/tapdots/front-entry.svg`, root-relative paths like `/media/front.webp`, or full remote URLs like `https://media.example.com/incognito/front.webp`.

## Repo structure

- `3d/`: shell app
- `supersplat-viewer/`: renderer app
- `index.html`: root redirect for GitHub Pages and local startup

## Default bundle

The shell defaults to this **meta.json** (same folder as the splat assets):

`3d/star-m-ranch-sogs/meta.json`

The iframe loads **`background_skybox.webp` in the same directory** as `meta.json` (see also `background_manifest.json` in that folder).

The local bundle was synced from AWS staging:

`s3://spaceport-ml-processing-staging/compressed/friday-mtc-20260524T0001Z/supersplat_bundle/`

It contains 363,609 splats and the complete SuperSplat compressed asset set. The source SageMaker training job is `friday-mtc-20260524T0001Z-3dgs`, created May 24, 2026 at 03:05 MDT and completed May 24, 2026 at 06:54 MDT. The compression job completed May 24, 2026 at 07:14 MDT.

### Staging bucket

The previous HMC bundle objects were KMS-encrypted, so unsigned browser reads to raw S3 returned a SigV4 error. This Star M setup is self-contained for local verification and does not require AWS credentials to load.
