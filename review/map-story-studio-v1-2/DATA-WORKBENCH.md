# Data Workbench V2 certification checkpoint

Status: **STOPPED — responsiveness stop gate triggered**

- Base SHA: `045a8b4b4ea0680273c1e9b676fa1677d749de3e`
- Current executable HEAD: `27ab3373eb84a88fc7ede87261ddb5a8095e8c60`
- Branch: `feat/map-story-studio-v1-2-data-workbench`
- Draft PR: not opened because certification is blocked
- Final full suite: intentionally not run because this is not a certifiable final executable head

## Passing checkpoint

Real isolated Chromium exercised the empty/cancel flow, GeoJSON line confirmation, mixed KML partition selection, CSV table insertion, CSV EPSG:32648 point conversion, projected Shapefile import, XLSX sheet selection, local GeoPackage plus local SQL.js WASM, projected GeoPackage EPSG:32648 conversion, stable-ID/path replacement, and the 1366×768 compact layout. Confirmed datasets remained production-valid with zero reported project problems.

The browser found and drove two fixes before the stop gate:

1. New spatial descriptors now receive complete production-valid geometry-specific render defaults before the first manifest write.
2. The GeoPackage adapter supports the actual 4.2.9 browser export shape, where `GeoPackageAPI` is exported but the reprojection helper is reached through the feature DAO instance constructor.

The directly affected post-fix tests pass: **42/42** across `editor-data-import-adapters`, `editor-data-inspectors`, and `editor-data-workbench`.

## Blocking evidence

A generated 20.43 MiB UTF-8 CSV containing 21,000 records was selected in the real browser. The table preview remained bounded to 20 rows, but file selection did not return to a review-ready state for **38.615 seconds**. Parsing and normalization run on the browser main thread, so this is an unacceptable editor freeze under the prompt's required realistic 20–50 MiB QA gate.

The approved brief requires stopping and reporting before adding generic worker infrastructure. No worker subsystem, reduced file-size workaround, or architectural expansion has been attempted.

## Dependency disclosure

| Package | Version | License |
| --- | ---: | --- |
| @tmcw/togeojson | 7.1.2 | BSD-2-Clause |
| shpjs | 6.2.0 | MIT |
| proj4 | 2.22.0 | MIT |
| PapaParse | 5.7.0 | MIT |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 |
| @ngageoint/geopackage | 4.2.9 | MIT |
| fflate (existing) | 0.8.3 | MIT |

Exact vendored artifacts, provenance, licenses, and SHA-256 values are recorded in `vendor/data-import/THIRD-PARTY.md`.

## Evidence images

- `data-workbench/01-add-data-empty.png`
- `data-workbench/02-geojson-line-preview.png`
- `data-workbench/03-mixed-kml-partitions.png`
- `data-workbench/04-csv-32648-preview.png`
- `data-workbench/05-xlsx-sheet-table-preview.png`
- `data-workbench/06-geopackage-layer-preview.png`

These are checkpoint evidence only; final certification, console assessment, bounded regression, one-time full suite, push, and Draft PR remain pending a worker/large-file direction.
