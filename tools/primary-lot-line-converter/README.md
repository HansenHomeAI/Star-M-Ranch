# Primary Lot Line Converter

Local web app for extracting a primary highlighted lot boundary from parcel/site-map images or PDFs. It also has a floor-plan mode for vectorizing plan linework.

Parcel mode exports closed `KML`, `KMZ`, `GeoJSON`, and `metadata.json` files. Floor-plan mode exports linework as `KML`, `KMZ`, `GeoJSON`, zipped Shapefile, and `metadata.json`.

## Run

```bash
make setup
make dev
```

Open the local Vite URL printed by `make dev`, usually `http://127.0.0.1:5173`.
The API runs on `http://127.0.0.1:8000`.

## Test

```bash
make test
```

## Robustness Corpus

The repo includes a 25-case parcel-map corpus at `backend/tests/fixtures/real_parcels`.
The parcel shapes come from public GIS parcel layers, then are rendered into local
map styles with exact ground-truth masks so the extractor can be scored honestly.

Run the deeper visual evaluation with:

```bash
PYTHONPATH=backend python scripts/evaluate_real_fixture_corpus.py
```

It writes:

- `reports/real_fixture_eval/summary.json`
- `reports/real_fixture_eval/contact_sheet.png`
- `reports/real_fixture_eval/index.html`

Each report row shows the input, ground truth, detector overlay, and exported KML
reprojected back onto the input image for side-by-side sniff testing.

Curved lot lines are preserved as dense segmented rings. KML does not store true
curve primitives inside a `LinearRing`, so the exporter keeps enough vertices to
follow source-image curvature instead of collapsing arcs into coarse corners.
The curve regression proof is written to `reports/curve_regression`.

Floor-plan mode has a 20-case generated corpus covering apartments, houses,
office-style plans, curved/angled walls, low-resolution inputs, and scanned/noisy
variants:

```bash
PYTHONPATH=backend python scripts/evaluate_floor_plan_corpus.py
```

It writes `reports/floor_plan_eval/summary.json` and a visual contact sheet at
`reports/floor_plan_eval/contact_sheet.png`.

Floor-plan mode also detects colored/labeled room blocks when they are present.
The KML export then includes a `Rooms` folder with one polygon placemark per
room and a `Room Wall Segments` folder with each wall segment annotated with
`room_label`, `wall_index`, `shared_wall_id`, and adjacent room labels.

Run the room-aware visual evaluation with:

```bash
PYTHONPATH=backend python scripts/evaluate_room_segmentation_corpus.py
```

It writes `reports/room_segmentation_eval/summary.json` and
`reports/room_segmentation_eval/contact_sheet.png`.

The first version uses classic computer vision only. It never invents world coordinates: when real coordinates are not confidently recoverable, exports use `relative_0_0` coordinates and mark that in KML metadata.
