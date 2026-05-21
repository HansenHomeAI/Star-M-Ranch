# High Mountain Camp Viewer

Static split-shell SOGS viewer for the High Mountain Camp trained compressed bundle.

## Local development

```bash
npm install
npm run dev
```

The Vite dev server serves the repo root (default **5173**; if that port is busy, Vite uses the next free one—check the terminal for the URL). `/` redirects to `/3d/`.

Developer tools in the shell (splat position/rotation helpers) are hidden by default. Add `?dev=1` to the URL to show them.

## KML lot-line import

The viewer now defaults to the bundled Incognito lot boundary from `3d/assets/incognito_lot_line.kml`. Open the lot-line editor to inspect it, or choose another `.kml` file from the KML field, then use **Scale**, **Center X/Y/Z**, and **Rotation** to align the imported boundary around the splat. KML coordinates are treated as relative geometry and centered around the viewer origin because the splat does not currently carry real-world coordinates.

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

`https://spaceport-ml-processing-staging.s3.amazonaws.com/compressed/hmc-mtc-20260520T2015Z/supersplat_bundle/meta.json`

The iframe loads **`background_skybox.webp` in the same directory** as `meta.json` (see also `background_manifest.json` in that folder).

### Staging bucket

The HMC bundle objects are KMS-encrypted, so unsigned browser reads to raw S3 return a SigV4 error. Local development uses the Vite `/api/sogs-proxy` middleware in `vite.config.mjs`, which reads the same S3 objects through `/opt/homebrew/bin/aws`. Static Pages builds use the verified HMC hosted proxy at `https://agent-40136728-montana-time.v0-spaceport-website-preview2.pages.dev`.

Direct object URIs (for tools / AWS CLI):

- `s3://spaceport-ml-processing-staging/compressed/hmc-mtc-20260520T2015Z/supersplat_bundle/meta.json`
- `s3://spaceport-ml-processing-staging/compressed/hmc-mtc-20260520T2015Z/supersplat_bundle/background_skybox.webp`
- `s3://spaceport-ml-processing-staging/compressed/hmc-mtc-20260520T2015Z/supersplat_bundle/background_manifest.json`
