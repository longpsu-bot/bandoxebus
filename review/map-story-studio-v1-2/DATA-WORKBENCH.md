# Data Workbench V2 certification checkpoint

Status: **CERTIFIED — Draft PR handoff pending**

- Base SHA: `045a8b4b4ea0680273c1e9b676fa1677d749de3e`
- Current executable HEAD: `6968965d40b416b147a23d6c5c3c117af4684cd1`
- Branch: `feat/map-story-studio-v1-2-data-workbench`
- Draft PR: not opened; it remains a final post-certification Draft handoff
- Final full suite: **630/630 tests passed** at the current executable HEAD in **11.87 s**

## Passing checkpoint

Real isolated Chromium exercised the empty/cancel flow, GeoJSON line confirmation, mixed KML partition selection, CSV table insertion, CSV EPSG:32648 point conversion, projected Shapefile import, XLSX sheet selection, local GeoPackage plus local SQL.js WASM, projected GeoPackage EPSG:32648 conversion, stable-ID/path replacement, and the 1366×768 compact layout. Confirmed datasets remained production-valid with zero reported project problems.

The browser found and drove two fixes before the stop gate:

1. New spatial descriptors now receive complete production-valid geometry-specific render defaults before the first manifest write.
2. The GeoPackage adapter supports the actual 4.2.9 browser export shape, where `GeoPackageAPI` is exported but the reprojection helper is reached through the feature DAO instance constructor.

The post-review focused implementation set passes **113/113** tests. The bounded import, authoring, persistence, loader, ZIP, and runtime regression set passes **135/135** tests.

The clean executable head was reloaded after all temporary benchmark instrumentation had been removed. A quoted-comma CSV reached the explicit review state, rendered the expected quoted comma and multiline cells, confirmed through production validation, and left the project at **Valid / Problems 0**.

## Corrected responsiveness evidence

A generated 21,420,020-byte (20.43 MiB) UTF-8 CSV containing 21,000 records was selected in real Chromium. The earlier **38.615-second** report remains classified as a profiling-harness error: it polled a nonexistent `textContent` attribute and therefore added 30 seconds after the import had completed. The corrected permanent harness registers `data-workbench:review-ready` before import and has no DOM-polling completion fallback.

| Run | Review-ready wall time | Worst frame gap | Complete post-worker interval |
| --- | ---: | ---: | ---: |
| Cold | 841.1 ms | 149.9 ms | 94.8 ms |
| Warm 1 | 757.2 ms | 202.0 ms | 45.5 ms |
| Warm 2 | 557.7 ms | 116.6 ms | 65.2 ms |
| Warm 3 | 695.2 ms | 116.3 ms | 47.8 ms |

All four post-review complete post-worker intervals pass the locked **250 ms** gate. Each interval begins in the accepted worker-result handler, includes production validation plus Workbench state and preview installation, and ends only after two animation frames provide a paint opportunity. The observed in-window long tasks were 79 / 71 / 82 / none. The worst frame gap remains below the approved ceiling and no XML worker stop gate was triggered.

Cancellation was activated while the CSV worker reported **Parsing**. The modal painted closed in **10.7 ms**, emitted no late `data-workbench:review-ready` event during the teardown window, and canonical per-entry hashes of the exported project package were identical before and after cancellation. The temporary 20.43 MiB fixture and instrumentation were removed after certification.

Chromium did not expose a trustworthy combined main-thread-plus-worker heap figure through the controlled browser surface, so this report does not invent one. Memory evidence is instead the executable copy audit: CSV is parsed once, binary inputs use transferable buffers, the former decoded-string/grid/row/column/candidate copies are removed, and cancellation terminates the worker realm. Peak-memory behavior beyond the certified fixture remains a stated scaling limit.

## Independent review remediation

The exact base-to-head review found no critical issue and identified eight important edge cases. Each was reproduced before modification and now has a focused regression:

- file-count/size/aggregate limits run before any transferable-buffer read;
- production sessions receive existing dataset IDs for collision-safe suggestions;
- spatial SVG preview rendering shares one global 4,000-vertex budget;
- worker results release candidate/parser intermediates after posting, with CSV reparsing only on later configuration;
- XLSX inventory samples at most 50 header rows and materializes only the selected worksheet grid;
- replacement filters mixed sources to the compatible geometry before production validation;
- CSV chunk ingestion avoids spread overflow and caps diagnostics while parsing;
- GeoPackage Source CRS override reprojects raw geometry instead of trusting incorrect metadata.

Minor review findings were also closed: stale read/prepare completions cannot affect a newer dialog, the benchmark requires an exact session/request identity, and classic-worker bootstrap rejection returns a bounded error. A dense 7,500-point browser fixture rendered exactly 4,000 preview circles and completed its full post-worker interval in **56.8 ms**. Four repeated 20.43 MiB success cycles passed after worker result-release was added.

The phase profile, diagnosed copies/passes, worker protocol, format split, memory strategy, and revised acceptance gate are recorded in `docs/superpowers/specs/2026-09-01-map-story-studio-v1-2-data-workbench-design.md`. No smaller main-thread file limit is proposed as the primary solution, and no generic worker framework has been implemented.

The approved amendment makes the module worker the default. A 2026-09-02 headed-Chromium probe successfully ran Proj4, SheetJS, shpjs, GeoPackage with locally redirected SQL.js WASM, and the existing ESM normalizer through a module worker. PapaParse 5.7.0 alone failed as a module side effect because its UMD wrapper assigns through top-level `this`; that exact evidence permits a CSV-only classic fallback and no broader fallback.

The final 250 ms gate covers the complete main-thread interval from accepted worker-result handler entry through production validation, Workbench state/preview installation, and a subsequent paint opportunity. The permanent benchmark waits for a matching explicit `data-workbench:review-ready` event. Status text and assumed DOM attributes are not completion markers.

## Security, freeze, and console checks

- No `eval(`, `new Function`, or `innerHTML` application use was found under `editor/`.
- No runtime parser CDN, EPSG lookup service, or newly introduced editor CDN reference was found.
- Story 1.2 schema and Route 61-2 remain unchanged from base; the frozen story SHA-256 is `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`.
- Base-to-head `git diff --check` passes.
- The worker-format browser gate loaded only repository-local parser artifacts and the repository-local SQL.js WASM.
- KML/KMZ/GPX remain on the approved bounded main-thread XML path; representative KML/KMZ browser evidence did not trigger the stop gate.
- Console capture contained the previously documented browser-control `MutationObserver.observe` diagnostic, for which there is no matching application source, and the inherited external MapLibre `circle-11` sprite warning. No new application-origin Data Workbench exception was found.

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

These six files remain the bounded visual evidence set. The final full suite and independent exact-diff review are complete; push and Draft PR creation are the remaining handoff steps. The branch must not be merged in this task.
