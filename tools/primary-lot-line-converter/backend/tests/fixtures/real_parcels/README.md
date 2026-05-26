# Real Parcel Fixture Corpus

These fixtures use public GIS parcel polygons as the primary lot boundary.
The map backgrounds and highlight styles are rendered locally so tests have
exact ground-truth masks while still using legitimate real parcel shapes.

Sources used by the current corpus:

- Middlesex County NJ Parcels
- Caldwell County TX CAD Parcels
- Los Angeles County Residential Parcels
- Central Utah Sanpete Parcel Boundary
- Clark County WA Parcels
- Multnomah County OR Parcels

Run `python scripts/build_real_fixture_corpus.py` to refresh the corpus.
