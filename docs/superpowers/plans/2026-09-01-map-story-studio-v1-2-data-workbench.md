# Map Story Studio V1.2 — Data Workbench V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-local Add/Replace Data Workbench that converts ordinary GIS and tabular files into the existing managed GeoJSON and table-data-v1 contracts without changing production schemas or renderers.

**Architecture:** Explicit lazy format adapters produce transient source items and normalized candidates. Worker-backed formats use a module worker by default so existing ESM adapters/normalizers are reused directly; CSV alone uses an evidence-backed PapaParse-specific classic fallback. The main thread production-validates a returned candidate before Workbench installation/preview, emits an explicit review-ready marker after a paint opportunity, and retains all Confirm/write authority. Studio continues to render through one production MapLibre instance and reuses the existing Story 1.2 add-project-layer command.

**Tech Stack:** Native browser ESM, Node test runner, native DOM/dialog/SVG, vendored fflate 0.8.3, togeojson 7.1.2, shpjs 6.2.0, proj4 2.22.0, PapaParse 5.7.0, SheetJS CE 0.20.3, GeoPackage JS 4.2.9 + local SQL.js WASM.

**Spec:** `docs/superpowers/specs/2026-09-01-map-story-studio-v1-2-data-workbench-design.md`

## Global Constraints

- Base is exactly `045a8b4b4ea0680273c1e9b676fa1677d749de3e`; branch is `feat/map-story-studio-v1-2-data-workbench`.
- No changes to `data/schemas/story-1.2.schema.json`, `data/schemas/project-manifest-v1.schema.json`, `data/stories/route-61-2.story.json`, or `src/map/geojson-renderer.js`.
- No bundler, `package.json` runtime dependency, runtime CDN, EPSG network lookup, generic worker manager/pool/scheduler, second MapLibre map, authored SQL/JavaScript/formula execution, parser HTML insertion, image work, or 3D work.
- Pending imports remain memory-only until Confirm; Cancel and failed validation write nothing.
- Stored spatial output is a valid EPSG:4326 FeatureCollection partitioned into point, line, or polygon candidates; never create a new mixed dataset.
- Source CRS remains visible and locally overridable; EPSG:4326, EPSG:3857, and EPSG:32648 are hard cases.
- Shapefile PRJ output is not reprojected twice; GeoPackage projected output is independently verified; result sets and connections always close.
- Use `textContent`, DOM properties, and `createElementNS`; do not insert user/parser content through `innerHTML`.
- Direct file ceiling is 512 MiB, loose aggregate 768 MiB / 256 files, XML 128 MiB; import ZIP ceiling is 2,048 entries, 512 MiB per entry, 1 GiB total, and 100:1 expansion after 1 MiB compressed.
- Develop with focused suites. Run the full `npm test` once at the final executable head.
- Use no subagents and no parallel agents.
- Construct `data-import-worker.js` as `new Worker(new URL('./data-import-worker.js', import.meta.url), { type: 'module' })` by default. Only detected CSV may select the documented `data-import-worker-classic.js` fallback for PapaParse 5.7.0; no silent fallback is allowed.
- Measure the complete post-worker main-thread interval from accepted result-handler entry through production validation, Workbench candidate installation, preview DOM commit, and the next browser paint opportunity. The whole interval must be below 250 ms.
- Completion is the matching explicit Workbench state/event. No benchmark or test may poll an assumed DOM attribute, status string, class, or element existence.

## Current checkpoint

Tasks 1–5 below are the executed historical plan represented by commits `a48936c` through `6d01052`, followed by production-contract fixes at `27ab337` and the corrected browser stop-gate evidence at `93854a3`. The focused worker design commit `6374a42` was approved with the two amendments now incorporated in the spec and in Tasks 6–10 below. Execution resumes at Task 6; prior checkboxes are retained as historical plan text rather than replay instructions.

---

## Locked File Structure

### New application modules

- `editor/core/safe-zip.js` — configurable safe ZIP inventory/expansion over fflate.
- `editor/import/vendor-loaders.js` — cached explicit lazy parser loaders and isolated browser globals.
- `editor/import/import-identifiers.js` — labels, slugs, prefixes, and collision suffixes.
- `editor/import/crs.js` — local CRS resolution, XY reprojection, ordinate preservation, and WGS84 validation.
- `editor/import/spatial-normalizer.js` — canonical FeatureCollections, collection flattening, family partitions, summaries, and SVG sample models.
- `editor/import/table-normalizer.js` — grid/header normalization, conservative inference, and table-data-v1 output.
- `editor/import/spatial-adapters.js` — GeoJSON, KML/KMZ, GPX, and zipped/loose Shapefile adapters.
- `editor/import/table-adapters.js` — CSV, table JSON, record-array JSON, and XLSX adapters.
- `editor/import/geopackage-adapter.js` — feature-table chooser, SRS verification, extraction, and cleanup.
- `editor/import/data-import.js` — detection, session lifecycle, candidate selection/configuration, and replacement constraints.
- `editor/import/data-import-worker.js` — default module-worker entry point.
- `editor/import/data-import-worker-classic.js` — CSV-only PapaParse fallback entry point.
- `editor/import/data-import-worker-runtime.js` — shared focused worker protocol/runtime.
- `editor/import/data-import-worker-client.js` — one-session main-thread worker client.
- `editor/ui/data-workbench.js` — accessible transient dialog and bounded previews.

### Modified application modules

- `editor/storage/adapters.js` — consume safe ZIP helper with unchanged project-package limits.
- `editor/ui/inspectors.js` — keep existing production candidate validation/write authority and expose only the narrow preflight hooks required by the workbench.
- `editor/ui/studio-shell.js` — Add Data and Replace Data callback points plus layer summaries.
- `editor/editor.js` — own workbench lifecycle, confirm preflight/commit, immediate resource refresh, and insertion routing.
- `editor/editor.css` — responsive workbench styling.

### Tests and fixtures

- `tests/editor-data-import.test.mjs`
- `tests/editor-data-import-adapters.test.mjs`
- `tests/editor-data-import-worker.test.mjs`
- `tests/editor-data-workbench.test.mjs`
- `tests/editor-data-workbench-benchmark.test.mjs`
- modify `tests/editor-zip-storage.test.mjs`
- modify `tests/editor-data-inspectors.test.mjs`
- modify `tests/editor-studio-preview.test.mjs`
- modify `tests/editor-rich-content-authoring.test.mjs`
- add exact tiny fixtures under `tests/fixtures/data-import/` from spec section 17.2.

### Vendor and certification artifacts

- exact version directories and disclosures under `vendor/data-import/` from spec section 5;
- `scripts/map-story-studio-data-workbench-benchmark.mjs` — permanent explicit-event benchmark/cancellation harness;
- `review/map-story-studio-v1-2/DATA-WORKBENCH.md`;
- six bounded PNGs under `review/map-story-studio-v1-2/data-workbench/`.

---

### Task 1: Vendor parsers, lazy loaders, and shared safe ZIP boundary

**Files:**
- Create: `editor/core/safe-zip.js`
- Create: `editor/import/vendor-loaders.js`
- Create: `vendor/data-import/THIRD-PARTY.md`
- Create: exact versioned vendor files listed in the spec dependency table
- Modify: `editor/storage/adapters.js:1-10,185-226`
- Modify: `tests/editor-zip-storage.test.mjs`
- Create: `tests/editor-data-import.test.mjs`

**Interfaces:**
- Produces `readSafeZipEntries(bytes, { limits, caseInsensitivePaths }) -> Array<{ path, bytes, compressedSize, uncompressedSize, compression }>`.
- Produces frozen `PROJECT_ZIP_LIMITS` and `DATA_IMPORT_ZIP_LIMITS` constants.
- Produces `createVendorLoaders({ documentRef, globalRef, importModule, loadScript }) -> loaders` for deterministic tests and the default browser singleton for production.
- Produces `loadToGeoJson()`, `loadShp()`, `loadProj4()`, `loadPapaParse()`, `loadSheetJs()`, and `loadGeoPackage()` returning parser APIs.
- `loadGeoPackage()` configures `setSqljsWasmLocateFile()` with the local versioned WASM URL before resolving.

- [ ] **Step 1: Write RED safe-ZIP tests**

Add focused cases proving current project ZIP round-trips still pass and import limits reject normalized case-insensitive duplicates, traversal, encrypted flags, unsupported compression, entry overflow, per-entry overflow, aggregate overflow, and excessive expansion. Use explicit byte mutation helpers for the encryption/compression header flags:

```js
test('safe ZIP rejects encrypted and duplicate normalized import paths', () => {
  const duplicate = makeZip([['A/roads.shp', bytes('a')], ['a/roads.shp', bytes('b')]]);
  assert.throws(
    () => readSafeZipEntries(duplicate, { limits: DATA_IMPORT_ZIP_LIMITS, caseInsensitivePaths: true }),
    /duplicate normalized archive path/i
  );
  const encrypted = setFirstLocalHeaderFlags(makeZip([['roads.shp', bytes('a')]]), 0x0001);
  assert.throws(
    () => readSafeZipEntries(encrypted, { limits: DATA_IMPORT_ZIP_LIMITS, caseInsensitivePaths: true }),
    /encrypted archives are unsupported/i
  );
});
```

- [ ] **Step 2: Run RED tests**

Run: `node --test tests/editor-zip-storage.test.mjs tests/editor-data-import.test.mjs`

Expected: FAIL because `editor/core/safe-zip.js` and its exports do not exist.

- [ ] **Step 3: Implement minimal safe ZIP helper and preserve storage behavior**

Move only the bounded ZIP expansion responsibility out of `editor/storage/adapters.js`. Use fflate for decompression, parse only ZIP header metadata required for names/flags/sizes/methods, normalize paths through `normalizePackagePath`, sort output by normalized path, and recheck actual emitted byte counts. Keep existing project limits exactly `2048 / 64 MiB / 256 MiB`.

- [ ] **Step 4: Run safe-ZIP tests GREEN**

Run: `node --test tests/editor-zip-storage.test.mjs tests/editor-data-import.test.mjs`

Expected: all selected tests PASS.

- [ ] **Step 5: Vendor exact artifacts and license files**

Download from pinned official npm tarballs and the official SheetJS 0.20.3 distribution into a temporary directory, copy only the spec-listed files, and record upstream URL, package integrity/provenance, local file, license, and SHA-256 in `THIRD-PARTY.md`. Verify copied hashes locally. Do not add npm dependencies or CDN URLs to runtime source.

- [ ] **Step 6: Write RED lazy-loader tests**

Use injected `documentRef`, `globalRef`, and `importModule` seams so Node tests prove successful promise caching, failed-promise retry, exact local URLs, and GeoPackage WASM configuration:

```js
test('GeoPackage loader caches success and binds local SQL WASM', async () => {
  const calls = [];
  const api = { setSqljsWasmLocateFile: (locate) => calls.push(locate('sql-wasm.wasm')) };
  const loaders = createVendorLoaders({
    loadScript: async (url) => calls.push(url),
    globalRef: { GeoPackage: api }
  });
  assert.equal(await loaders.loadGeoPackage(), api);
  assert.equal(await loaders.loadGeoPackage(), api);
  assert.deepEqual(calls, [
    '../../vendor/data-import/geopackage/4.2.9/geopackage.min.js',
    '../../vendor/data-import/geopackage/4.2.9/sql-wasm.wasm'
  ]);
});
```

- [ ] **Step 7: Implement explicit cached loaders and run GREEN tests**

Run: `node --test tests/editor-data-import.test.mjs tests/editor-zip-storage.test.mjs`

Expected: all selected tests PASS; no parser appears in static `editor/index.html`.

- [ ] **Step 8: Commit Task 1**

```powershell
git add -- editor/core/safe-zip.js editor/import/vendor-loaders.js editor/storage/adapters.js tests/editor-zip-storage.test.mjs tests/editor-data-import.test.mjs vendor/data-import
git commit -m "feat: add safe lazy data import dependencies"
```

---

### Task 2: Deterministic identifiers, table normalization, CRS, and spatial normalization

**Files:**
- Create: `editor/import/import-identifiers.js`
- Create: `editor/import/table-normalizer.js`
- Create: `editor/import/crs.js`
- Create: `editor/import/spatial-normalizer.js`
- Modify: `tests/editor-data-import.test.mjs`
- Create: text/JSON/CSV fixtures from `tests/fixtures/data-import/`

**Interfaces:**
- Produces `friendlyLabel(filename) -> string`.
- Produces `createImportId(label, usedIds, { prefix = 'data' } = {}) -> string`.
- Produces `normalizeTableGrid(grid, { headerRow = 0 }) -> table-data-v1` and `normalizeRecordArray(records) -> table-data-v1`.
- Produces `resolveLocalCrs(value, proj4) -> { code, definition, label }`.
- Produces `reprojectFeatureCollection(collection, { sourceCrs, proj4 }) -> FeatureCollection` and `assertWgs84Coordinates(collection)`.
- Produces `normalizeSpatialSource(value, metadata) -> Array<SpatialCandidate>` where each candidate has `kind`, `label`, `id`, `geometry`, `value`, `featureCount`, `bounds`, `fields`, `warnings`, `sourceCrs`, and `outputCrs`.

- [ ] **Step 1: Write RED identity and table tests**

Cover Vietnamese labels/IDs, `đ`, collisions, digit prefixes, blank/duplicate headings, blank-to-null, integer/number/boolean/date inference, leading zeros, `61-2`, invalid nested JSON cells, and complete row keys:

```js
test('Vietnamese labels remain readable while IDs are stable ASCII', () => {
  assert.equal(friendlyLabel('Trạm dừng fix UTM.csv'), 'Trạm dừng fix UTM');
  assert.equal(createImportId('Trạm dừng fix UTM', []), 'tram-dung-fix-utm');
  assert.equal(createImportId('Điểm 1', ['diem-1']), 'diem-1-2');
  assert.equal(createImportId('2026 stops', []), 'data-2026-stops');
});

test('table inference preserves leading zero text and null blanks', () => {
  const table = normalizeTableGrid([
    ['Code', 'Count', 'Active', 'Date'],
    ['001', '7', 'TRUE', '2026-09-01'],
    ['', '', '', '']
  ]);
  assert.deepEqual(table.columns.map(({ id, type }) => [id, type]), [
    ['code', 'text'], ['count', 'integer'], ['active', 'boolean'], ['date', 'date']
  ]);
  assert.deepEqual(table.rows[1], { code: null, count: null, active: null, date: null });
});
```

- [ ] **Step 2: Run identity/table RED tests**

Run: `node --test tests/editor-data-import.test.mjs`

Expected: FAIL on missing identifier and table modules.

- [ ] **Step 3: Implement minimal identifier/table modules and run GREEN**

Keep Papa/SheetJS concerns out of the normalizer. Treat input strings as strings until conservative column inference; use calendar-valid `YYYY-MM-DD`; never coerce leading-zero text.

Run: `node --test tests/editor-data-import.test.mjs`

Expected: identity/table cases PASS.

- [ ] **Step 4: Write RED CRS and spatial tests**

Cover Feature wrapping, recursive GeometryCollection flattening, point/line/polygon partition order, null warning count, scalar properties, no legacy `crs`, stable bounds, Z retention, invalid nesting, NaN/Infinity, longitude/latitude bounds, 4326 no-op, 3857 conversion, 32648 conversion, and unsupported local EPSG with a no-fetch sentinel:

```js
test('EPSG:32648 transforms XY while preserving Z', async () => {
  const proj4 = await loaders.loadProj4();
  const source = featureCollection('Point', [686143.36, 1200320.45, 17]);
  const result = reprojectFeatureCollection(source, { sourceCrs: 'EPSG:32648', proj4 });
  const [lng, lat, z] = result.features[0].geometry.coordinates;
  assert.ok(Math.abs(lng - 106.7028563810) < 1e-7);
  assert.ok(Math.abs(lat - 10.8536676064) < 1e-7);
  assert.equal(z, 17);
});

test('mixed geometry partitions without a mixed candidate', () => {
  const result = normalizeSpatialSource(mixedFixture, metadata);
  assert.deepEqual(result.map(({ geometry }) => geometry), ['point', 'line', 'polygon']);
  assert.equal(result.some(({ geometry }) => geometry === 'mixed'), false);
});
```

- [ ] **Step 5: Run CRS/spatial RED tests**

Run: `node --test tests/editor-data-import.test.mjs`

Expected: FAIL on missing CRS/spatial modules.

- [ ] **Step 6: Implement minimal CRS/spatial modules and run GREEN**

Transform only coordinates `[0]` and `[1]`, copy later ordinates, cap geometry recursion at 64, preserve source order/properties, omit and count null geometry, and validate after every projected conversion.

Run: `node --test tests/editor-data-import.test.mjs`

Expected: all Task 2 cases PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- editor/import/import-identifiers.js editor/import/table-normalizer.js editor/import/crs.js editor/import/spatial-normalizer.js tests/editor-data-import.test.mjs tests/fixtures/data-import
git commit -m "feat: normalize imported spatial and table data"
```

---

### Task 3: Detect and parse every supported source format

**Files:**
- Create: `editor/import/spatial-adapters.js`
- Create: `editor/import/table-adapters.js`
- Create: `editor/import/geopackage-adapter.js`
- Create: `editor/import/data-import.js`
- Create: `tests/editor-data-import-adapters.test.mjs`
- Modify: `tests/editor-data-import.test.mjs`
- Create: all remaining tiny binary/XML fixtures from spec section 17.2

**Interfaces:**
- Produces `detectDataFiles(files) -> { format, files, groups? }` with explicit unsupported errors.
- Produces `parseSpatialSource(detection, options) -> { sourceItems, prepare(itemId, config), dispose }`.
- Produces `parseTableSource(detection, options) -> { sourceItems, prepare(itemId, config), dispose }`.
- Produces `openGeoPackageSource(bytes, { geoPackageApi, proj4 }) -> { sourceItems, prepare(itemId, config), dispose }`.
- Produces `createDataImportSession({ files, loaders, usedIds, replacement })` with `read()`, `selectSourceItem(id)`, `configure(patch)`, `prepare()`, `candidate(id)`, and `dispose()`; no mutation callback exists on the session.

- [ ] **Step 1: Create deterministic tiny fixtures**

Create all exact fixture categories from the spec. Use the pinned libraries or temporary fixture-generation tooling only; do not add runtime/dev dependencies. Record expected EPSG:32648 coordinates beside the fixtures in test constants. Confirm every binary fixture is small with:

```powershell
Get-ChildItem -Recurse tests\fixtures\data-import | Sort-Object FullName | Select-Object FullName,Length
```

- [ ] **Step 2: Write RED detection tests**

Prove GeoJSON, normalized table JSON, record array JSON, KML, KMZ, GPX, Shapefile ZIP, loose grouped Shapefile, GPKG signature, CSV, XLSX, and unsupported extension behavior. Include misleading JSON and malformed archive cases.

```js
test('loose Shapefile components group by case-insensitive basename', async () => {
  const detection = await detectDataFiles([
    fixtureFile('shapefile-loose/points.SHP'),
    fixtureFile('shapefile-loose/points.dbf'),
    fixtureFile('shapefile-loose/points.prj')
  ]);
  assert.equal(detection.format, 'shapefile');
  assert.deepEqual(detection.groups.map(({ basename }) => basename), ['points']);
});
```

- [ ] **Step 3: Run detection RED tests, implement explicit detection, run GREEN**

Run: `node --test --test-name-pattern="detect|group|unsupported" tests/editor-data-import.test.mjs tests/editor-data-import-adapters.test.mjs`

Expected first run: FAIL on missing modules. Expected after implementation: selected cases PASS.

- [ ] **Step 4: Write RED CSV/JSON/XLSX adapter tests**

Prove quoted comma, BOM/delimiter/CRLF, table vs points, explicit X/Y, EPSG:32648 stored-coordinate expectation, normalized/plain JSON, sheet chooser, selected sheet only, bounded header override, date/integer/text output, leading zeros, and formula cached-value/no-evaluation behavior.

- [ ] **Step 5: Implement CSV/JSON/XLSX adapters and run GREEN**

Use PapaParse with `dynamicTyping:false`. Use SheetJS ArrayBuffer parsing with formulas disabled from output, raw array-of-arrays, null defaults, and deterministic date-only conversion.

Run: `node --test --test-name-pattern="CSV|JSON|XLSX|sheet|header|32648" tests/editor-data-import.test.mjs tests/editor-data-import-adapters.test.mjs`

Expected: selected cases PASS.

- [ ] **Step 6: Write RED KML/KMZ/GPX/Shapefile tests**

Prove ExtendedData, Point+Line partitioning, GeometryCollection flattening, NetworkLink/no-fetch, DOCTYPE rejection, KMZ `doc.kml` priority/chooser, GPX waypoint+track split, safe zipped Shapefile chooser, loose components, PRJ recognition, missing-PRJ warning/manual requirement, projected coordinates, CPG/DBF fields, and no double reprojection.

- [ ] **Step 7: Implement spatial adapters and run GREEN**

Pass safely expanded Shapefile component objects to shpjs rather than raw ZIP. When PRJ is accepted, mark shpjs output WGS84 and only bounds-validate; when manually overridden, omit PRJ and run the shared proj4 transform once.

Run: `node --test --test-name-pattern="KML|KMZ|GPX|Shapefile|DOCTYPE|NetworkLink" tests/editor-data-import.test.mjs tests/editor-data-import-adapters.test.mjs`

Expected: selected cases PASS.

- [ ] **Step 8: Write RED GeoPackage tests**

Use fixture and injected fake cleanup seams to prove feature tables listed, tile tables excluded, selected feature table only, scalar attributes, projected fixture expected coordinates, explicit source SRS, verification failure blocking, result-set close, connection close, and local WASM locator.

```js
test('GeoPackage cleanup runs when projected verification fails', async () => {
  const events = [];
  await assert.rejects(
    openGeoPackageSource(projectedBytes, fakeApi(events, { mismatch: true })),
    /could not verify.*EPSG:4326/i
  );
  assert.deepEqual(events.slice(-2), ['result-set:close', 'geopackage:close']);
});
```

- [ ] **Step 9: Implement GeoPackage adapter and run GREEN**

Bind local SQL WASM, query `getFeatureTables()` only, read geometry-column/SRS metadata, compare a deterministic raw coordinate sample transformed with local proj4 to library GeoJSON output within `1e-7`, close iterators/result sets and connection in `finally`, and never expose SQL.

Run: `node --test --test-name-pattern="GeoPackage|GPKG|WASM" tests/editor-data-import-adapters.test.mjs`

Expected: selected cases PASS.

- [ ] **Step 10: Write RED transient session tests and implement orchestration**

Assert status progression, no serializer/mutation API, candidate option changes, mixed candidate selection, collision IDs, Cancel disposal, and file/aggregate ceiling errors. Then implement only the minimal session state machine.

Run: `node --test tests/editor-data-import.test.mjs tests/editor-data-import-adapters.test.mjs`

Expected: all import core/adapter tests PASS.

- [ ] **Step 11: Commit Task 3**

```powershell
git add -- editor/import/spatial-adapters.js editor/import/table-adapters.js editor/import/geopackage-adapter.js editor/import/data-import.js tests/editor-data-import.test.mjs tests/editor-data-import-adapters.test.mjs tests/fixtures/data-import
git commit -m "feat: add browser-local data import adapters"
```

---

### Task 4: Add preflight-safe production resource confirmation and replacement

**Files:**
- Modify: `editor/ui/inspectors.js:254-406`
- Modify: `editor/editor.js:359-404,616-713`
- Modify: `tests/editor-data-inspectors.test.mjs`
- Modify: `tests/editor-studio-preview.test.mjs`

**Interfaces:**
- Preserve `importGeoJson(value, descriptor)` and `importNormalizedTable(value, options)` as final validation authority.
- Add `preflightDatasetCandidate(candidate, { id, label, existingDescriptor }) -> { descriptor, value, path }` as a pure export from `inspectors.js`.
- Add editor-local `confirmDataWorkbenchCandidate(candidate, context)` that precomputes the Story command before calling existing inspector add/replace commands.

- [ ] **Step 1: Write RED inspector preflight tests**

Cover new point/line/polygon/table descriptors and paths, existing-ID collision, production validation failure with zero writes/mutations, same-family replacement, table replacement, incompatible geometry friendly error, and stable replacement ID/path:

```js
test('failed candidate preflight writes and mutates nothing', () => {
  const state = harness();
  assert.throws(() => preflightDatasetCandidate({
    kind: 'spatial', geometry: 'line', value: featureCollection('Point', [0, 0])
  }, { id: 'route', label: 'Route', manifest: state.manifest }), /declared line geometry/i);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.manifest.datasets, {});
});
```

- [ ] **Step 2: Run RED tests, implement pure preflight, run GREEN**

Run: `node --test tests/editor-data-inspectors.test.mjs`

Expected first run: FAIL on missing preflight export. Expected after implementation: suite PASS.

- [ ] **Step 3: Write RED editor confirmation tests**

Prove dropping/reading/configuring/Cancelling do not change manifest, Story, package revision, or Studio history; spatial Confirm writes one resource/descriptor and reuses active-Scene visibility semantics; table Confirm creates no Scene layer; preflight failure writes nothing; catalogs include the table immediately.

- [ ] **Step 4: Implement confirmation boundary and run GREEN**

Precompute `applyStudioStoryCommand(current.story, 'add-project-layer', ...)` before inspector mutation. For new candidates, call existing `add-geojson` / `add-table`; for replacement, call existing entity `replace`. Apply default renderer controls only after validated add. Render the Studio once after completion.

Run: `node --test tests/editor-data-inspectors.test.mjs tests/editor-studio-preview.test.mjs tests/editor-scene-commands.test.mjs`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- editor/ui/inspectors.js editor/editor.js tests/editor-data-inspectors.test.mjs tests/editor-studio-preview.test.mjs
git commit -m "feat: commit imported data through production contracts"
```

---

### Task 5: Build the Data Workbench dialog and integrate Studio Add/Replace Data

**Files:**
- Create: `editor/ui/data-workbench.js`
- Modify: `editor/ui/studio-shell.js:600-781`
- Modify: `editor/editor.js:180-713`
- Modify: `editor/editor.css:99-258`
- Create: `tests/editor-data-workbench.test.mjs`
- Modify: `tests/editor-studio-preview.test.mjs`
- Modify: `tests/editor-rich-content-authoring.test.mjs`

**Interfaces:**
- Produces `createDataWorkbench({ documentRef, windowRef, createSession, onConfirm }) -> { open(options), close(), state() }`.
- `open({ mode: 'add' | 'replace', existingDataset?, files? })` creates/reuses one dialog.
- Extend `mountStudioShell` options with `onAddData()` and `onReplaceData(datasetId)`.
- Keep `onRequestInsert(kind, insert)` behavior; when a Chart/Table lacks a table, route Add data through the same workbench and resume insertion after successful table import.

- [ ] **Step 1: Write RED dialog lifecycle and accessibility tests**

Use the repository's fake DOM pattern. Prove dialog/label relationships, drop target, multiple file picker, exact advertised formats, Browse/Cancel/Escape, progress text, error/status live region, focus return, and no project mutation callback before Confirm.

```js
test('Add Data starts with friendly supported formats and no technical fields', () => {
  const workbench = createDataWorkbench(harness());
  workbench.open({ mode: 'add' });
  assert.match(document.body.textContent, /Drop data files here/i);
  assert.match(document.body.textContent, /GeoJSON.*KML\/KMZ.*Shapefile.*GeoPackage.*CSV.*Excel.*GPX/s);
  assert.doesNotMatch(document.body.textContent, /Stable dataset ID|table-json|geometry declaration/i);
});
```

- [ ] **Step 2: Run dialog RED tests, implement initial dialog/session binding, run GREEN**

Run: `node --test tests/editor-data-workbench.test.mjs`

Expected first run: FAIL on missing UI module. Expected after implementation: lifecycle cases PASS.

- [ ] **Step 3: Write RED candidate configuration/preview tests**

Cover GPKG/KMZ/Shapefile/XLSX source choosers, CSV Table/Map points and X/Y/CRS, visible source/output CRS, warning rendering, Advanced ID/path, mixed candidate selector, SVG with no MapLibre, table first 20 rows only, progress state order, Confirm label, and disposal.

- [ ] **Step 4: Implement bounded preview/configuration UI and run GREEN**

Build every user-controlled node with native DOM. SVG uses at most 200 features / 4,000 vertices; table body uses at most 20 rows. Keep Add/Cancel visible in a sticky footer at compact height.

Run: `node --test tests/editor-data-workbench.test.mjs tests/editor-data-import.test.mjs`

Expected: selected tests PASS.

- [ ] **Step 5: Write RED Studio integration tests**

Prove `+ Add data` appears in Layers, existing rows show family/feature summary where available, spatial import appears immediately, table import stays out of Layers but is immediately available to Chart/Table, selected layer exposes `Replace data…`, table Dataset Properties exposes the same action, and replacement preserves ID/path.

- [ ] **Step 6: Implement Studio/editor integration and responsive CSS**

Add callbacks rather than import logic to `studio-shell.js`. Let `editor.js` own the workbench and inspector/package context. Replace the schema-first add and narrow replace file pickers in the normal Dataset panel with friendly workbench actions; keep stable fields under Advanced only.

- [ ] **Step 7: Run focused Studio/UI suites GREEN**

Run:

```powershell
node --test `
  tests/editor-data-import.test.mjs `
  tests/editor-data-import-adapters.test.mjs `
  tests/editor-data-workbench.test.mjs `
  tests/editor-data-inspectors.test.mjs `
  tests/editor-studio-preview.test.mjs `
  tests/editor-rich-content-authoring.test.mjs `
  tests/editor-scene-commands.test.mjs
```

Expected: all selected tests PASS.

- [ ] **Step 8: Commit Task 5**

```powershell
git add -- editor/ui/data-workbench.js editor/ui/studio-shell.js editor/editor.js editor/editor.css tests/editor-data-workbench.test.mjs tests/editor-studio-preview.test.mjs tests/editor-rich-content-authoring.test.mjs
git commit -m "feat: add Data Workbench authoring flow"
```

---

### Task 6: Lock the module-first worker construction and bounded protocol

**Files:**
- Create: `editor/import/data-import-worker-client.js`
- Create: `tests/editor-data-import-worker.test.mjs`
- Modify: `editor/import/vendor-loaders.js`

**Interfaces:**
- Produces `createDataImportWorkerClient({ files, usedIds, replacement, WorkerCtor, now, onStatus }) -> transient session` with the existing `read/selectSourceItem/configure/prepare/candidate/state/dispose` surface.
- Produces an explicit worker selection result: `module` for every worker-backed non-CSV source, `classic-papaparse` only for detected `.csv`, and `main-thread-xml` for KML/KMZ/GPX.
- Default module construction is exactly `new Worker(new URL('./data-import-worker.js', import.meta.url), { type: 'module' })`.
- The client records `lastResultReceivedAt` at entry to the accepted `result` handler and exposes it only in transient session timing state.

- [ ] **Step 1: Write RED construction/protocol tests**

Use a fake `WorkerCtor` to prove the exact module URL/options, CSV-only classic URL with no `type: 'module'`, monotonic session/request IDs, bounded message envelopes, stale-result rejection, normalized error mapping, progress routing, and absence of mutation dependencies. Assert that JSON, GeoJSON, XLSX, Shapefile, GeoPackage, and unsupported inputs never silently select classic.

```js
test('module worker is the default and CSV is the sole evidenced classic fallback', async () => {
  const workers = fakeWorkers();
  createDataImportWorkerClient({ files: [file('data.geojson')], WorkerCtor: workers.Ctor });
  createDataImportWorkerClient({ files: [file('data.csv')], WorkerCtor: workers.Ctor });
  assert.match(workers.instances[0].url.href, /data-import-worker\.js$/);
  assert.deepEqual(workers.instances[0].options, { type: 'module' });
  assert.match(workers.instances[1].url.href, /data-import-worker-classic\.js$/);
  assert.deepEqual(workers.instances[1].options, {});
});
```

- [ ] **Step 2: Run RED worker-client tests**

Run: `node --test tests/editor-data-import-worker.test.mjs`

Expected: FAIL because the worker client does not exist.

- [ ] **Step 3: Implement the minimal one-session client**

Keep one active request and one worker only. For CSV, structured-clone the `File` so PapaParse can use `FileStreamer`. For JSON/GeoJSON, XLSX, Shapefile, and GeoPackage, asynchronously read and transfer ArrayBuffers exactly once. Retain original File references only for an explicit retry. Do not add a registry, pool, scheduler, queue, or generic RPC surface.

- [ ] **Step 4: Write RED cancellation/teardown tests, then implement GREEN**

Prove `cancel()` posts the bounded cancellation envelope, immediately calls `terminate()`, rejects in-flight work with the stable cancellation error, clears callbacks, and ignores a late result. Prove `dispose()` is idempotent after success, error, Cancel, close, and replacement.

Run: `node --test tests/editor-data-import-worker.test.mjs`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 6**

```powershell
git add -- editor/import/data-import-worker-client.js editor/import/vendor-loaders.js tests/editor-data-import-worker.test.mjs
git commit -m "feat: add module-first data import worker client"
```

---

### Task 7: Execute existing adapters through the focused worker runtime

**Files:**
- Create: `editor/import/data-import-worker-runtime.js`
- Create: `editor/import/data-import-worker.js`
- Create: `editor/import/data-import-worker-classic.js`
- Modify: `editor/import/data-import.js`
- Modify: `editor/import/vendor-loaders.js`
- Modify: `tests/editor-data-import-worker.test.mjs`
- Modify: `tests/editor-data-import-adapters.test.mjs`

**Interfaces:**
- `data-import-worker.js` is a true module entry point that directly imports and boots `data-import-worker-runtime.js`.
- `data-import-worker-classic.js` is CSV-only, calls `importScripts` for the exact local PapaParse 5.7.0 bundle, then dynamically imports the same runtime.
- Produces `createDataImportWorkerRuntime({ scope, loaders, createSession })` for deterministic protocol tests; it owns no project/storage/history references.
- Preserves the existing normalized source-item and candidate contracts exactly.

- [ ] **Step 1: Write RED runtime tests**

Drive the runtime with an injected worker scope. Prove `read` reconstructs file-like inputs, calls the existing detector/session, reports allowed progress phases, returns public source items, and retains only transient session state. Prove `prepare` returns the existing candidates and clears large result/intermediate references after posting.

- [ ] **Step 2: Run RED runtime tests**

Run: `node --test --test-name-pattern="worker runtime|worker protocol|module worker|classic Papa" tests/editor-data-import-worker.test.mjs`

Expected: FAIL on missing runtime and entry points.

- [ ] **Step 3: Implement the shared runtime and explicit loaders**

Module-worker loaders use local dynamic imports/side effects for Proj4 and GeoPackage, direct ESM imports for shpjs and SheetJS, and explicit local SQL.js WASM redirection. The classic entry point loads only PapaParse through `importScripts`; it must not become a second implementation. Both entries boot the same runtime and import the existing adapters/normalizers rather than copying conversion logic.

- [ ] **Step 4: Run runtime tests GREEN**

Run: `node --test tests/editor-data-import-worker.test.mjs tests/editor-data-import-adapters.test.mjs`

Expected: all selected tests PASS.

- [ ] **Step 5: Run real-browser worker compatibility gate**

Through the product client/runtime boundary, prove:

- module worker: Proj4 transform, SheetJS sheet inventory, shpjs projected fixture, GeoPackage local WASM open/list/close, and pure normalizers;
- classic fallback: PapaParse CSV read/prepare plus shared ESM normalization;
- no parser/WASM/CDN/EPSG network request before use or outside the local origin.

If any non-CSV format requires classic fallback, stop and amend the spec with reproducible evidence before continuing. Do not silently switch.

- [ ] **Step 6: Commit Task 7**

```powershell
git add -- editor/import/data-import-worker-runtime.js editor/import/data-import-worker.js editor/import/data-import-worker-classic.js editor/import/data-import.js editor/import/vendor-loaders.js tests/editor-data-import-worker.test.mjs tests/editor-data-import-adapters.test.mjs
git commit -m "feat: run data adapters in dedicated workers"
```

---

### Task 8: Remove redundant CSV/table passes and preserve certification contracts

**Files:**
- Modify: `editor/import/table-adapters.js`
- Modify: `editor/import/table-normalizer.js`
- Modify: `tests/editor-data-import.test.mjs`
- Modify: `tests/editor-data-import-adapters.test.mjs`
- Modify: `tests/editor-data-import-worker.test.mjs`

**Interfaces:**
- PapaParse performs one chunked parse with `dynamicTyping:false`; there is no separate full-data delimiter-detection parse.
- Table normalization does not clone the full grid, create a second complete data-row array, or allocate one full value array per column.
- Candidate transport relies on `postMessage` ownership copy; `tableCandidate` does not perform an additional `structuredClone`.

- [ ] **Step 1: Write RED single-pass/copy tests**

Use an instrumented PapaParse fake and clone sentinel to prove one parse call, real chunk progress, bounded diagnostics, no explicit candidate clone, no `grid.map(row => [...row])`, and unchanged CSV table/points output. Add a tall narrow table case that would fail the old spread-based width scan.

- [ ] **Step 2: Run RED optimization tests**

Run: `node --test --test-name-pattern="single pass|chunk progress|copy|tall table|CSV|32648" tests/editor-data-import.test.mjs tests/editor-data-import-adapters.test.mjs tests/editor-data-import-worker.test.mjs`

Expected: new assertions FAIL against the current double-parse/clone path.

- [ ] **Step 3: Implement minimal one-pass parsing and direct normalization**

Accumulate each parser chunk once, trim trailing blank rows without copying all prior rows, track width and per-column inference state with loops, and construct normalized rows directly. Preserve leading-zero text, blank-to-null, date validity, scalar-only cells, complete row keys, and EPSG:32648 point output.

- [ ] **Step 4: Run focused adapter/normalizer suites GREEN**

Run: `node --test tests/editor-data-import.test.mjs tests/editor-data-import-adapters.test.mjs tests/editor-data-import-worker.test.mjs`

Expected: all selected tests PASS, including the hard EPSG:32648 gate and Shapefile no-double-reprojection cases.

- [ ] **Step 5: Commit Task 8**

```powershell
git add -- editor/import/table-adapters.js editor/import/table-normalizer.js tests/editor-data-import.test.mjs tests/editor-data-import-adapters.test.mjs tests/editor-data-import-worker.test.mjs
git commit -m "perf: remove redundant data import copies"
```

---

### Task 9: Install only production-valid candidates and emit real completion

**Files:**
- Modify: `editor/ui/data-workbench.js`
- Modify: `editor/editor.js`
- Modify: `tests/editor-data-workbench.test.mjs`
- Modify: `tests/editor-data-inspectors.test.mjs`
- Create: `scripts/map-story-studio-data-workbench-benchmark.mjs`
- Create: `tests/editor-data-workbench-benchmark.test.mjs`

**Interfaces:**
- Extend `createDataWorkbench` with injected `validateCandidate`, `requestAnimationFrame`, `now`, and completion-event construction seams; production defaults remain native browser APIs.
- The Workbench phase becomes `review-ready` only after worker result receipt, production validation with no mutation, candidate installation, preview DOM commit, and two animation-frame callbacks.
- Dispatch `data-workbench:review-ready` with matching `sessionId`, `requestId`, `receivedAt`, `completedAt`, and `postWorkerDurationMs`.
- The permanent benchmark listens for that event before starting import and never polls presentation DOM.

- [ ] **Step 1: Write RED validation/install/order tests**

Prove the returned candidate is passed through the existing `preflightDatasetCandidate` path before it appears in Workbench state/preview; validation failure installs nothing and leaves Confirm unavailable. With a deterministic fake animation-frame queue, prove no completion event occurs before validation, state install, preview commit, first frame, and second frame.

```js
assert.deepEqual(events, [
  'worker-result', 'production-validation', 'state-install', 'preview-commit',
  'animation-frame-1', 'animation-frame-2', 'review-ready'
]);
```

- [ ] **Step 2: Run RED Workbench tests**

Run: `node --test tests/editor-data-workbench.test.mjs tests/editor-data-inspectors.test.mjs`

Expected: new ordering/completion cases FAIL.

- [ ] **Step 3: Implement production-valid preview installation and explicit completion**

Use the worker client's accepted-result timestamp as the start. Validate without writing, install only the validated candidate, render the bounded preview, wait through two animation frames, set explicit state, and dispatch the matching event. Confirm repeats production preflight at the transaction boundary and remains the only mutation path.

- [ ] **Step 4: Write the permanent event-driven benchmark harness RED/GREEN**

The harness must register its listener before file selection, reject wrong session/request events, fail on timeout, record frame gaps/Long Tasks/progress/cancel/teardown, and calculate the complete post-worker duration from event detail. Add source-level regression assertions that the harness contains no `getAttribute('textContent')`, status-text completion predicate, or generic DOM-attribute polling.

Run: `node --test tests/editor-data-workbench-benchmark.test.mjs tests/editor-data-workbench.test.mjs`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 9**

```powershell
git add -- editor/ui/data-workbench.js editor/editor.js scripts/map-story-studio-data-workbench-benchmark.mjs tests/editor-data-workbench.test.mjs tests/editor-data-inspectors.test.mjs tests/editor-data-workbench-benchmark.test.mjs
git commit -m "feat: signal production-valid workbench completion"
```

---

### Task 10: Certify responsiveness, security, regression behavior, browser workflows, and Draft PR

**Files:**
- Modify: all new/affected tests only for real defects found during certification
- Modify: `review/map-story-studio-v1-2/DATA-WORKBENCH.md`
- Replace only if browser evidence materially changed: six bounded screenshots under `review/map-story-studio-v1-2/data-workbench/`

**Interfaces:**
- Produces the final evidence report with base SHA, executable SHA, module-worker/default and PapaParse-fallback evidence, dependency files/licenses/hashes, formats, normalized contracts, CRS evidence, mixed partitioning, complete post-worker timing, limits, browser flows, test counts, exclusions, and known issues.

- [x] **Step 1: Run the focused development suites once at the assembled feature head**

Run:

```powershell
node --test `
  tests/editor-data-import.test.mjs `
  tests/editor-data-import-adapters.test.mjs `
  tests/editor-data-import-worker.test.mjs `
  tests/editor-data-workbench.test.mjs `
  tests/editor-data-workbench-benchmark.test.mjs `
  tests/editor-data-inspectors.test.mjs `
  tests/editor-studio-preview.test.mjs `
  tests/editor-rich-content-authoring.test.mjs `
  tests/editor-scene-commands.test.mjs
```

Expected: PASS; record exact test count.

- [x] **Step 2: Run bounded regression set**

```powershell
node --test `
  tests/editor-data-import.test.mjs `
  tests/editor-data-import-adapters.test.mjs `
  tests/editor-data-import-worker.test.mjs `
  tests/editor-data-workbench.test.mjs `
  tests/editor-data-workbench-benchmark.test.mjs `
  tests/editor-data-inspectors.test.mjs `
  tests/editor-rich-content-authoring.test.mjs `
  tests/editor-studio-preview.test.mjs `
  tests/editor-scene-commands.test.mjs `
  tests/editor-zip-storage.test.mjs `
  tests/story-1.2-persistence.test.mjs `
  tests/project-loader.test.mjs `
  tests/generic-runtime-shell.test.mjs
```

Expected: PASS; record exact test count.

- [x] **Step 3: Run static security and freeze checks before browser QA**

```powershell
rg -n "eval\(|new Function|innerHTML" editor
rg -n "unpkg\.com|jsdelivr|cdn\.sheetjs\.com|epsg\.io|spatialreference\.org" editor --glob "*.js" --glob "*.html" --glob "*.css"
git diff --exit-code 045a8b4b4ea0680273c1e9b676fa1677d749de3e -- data/schemas/story-1.2.schema.json data/stories/route-61-2.story.json
(Get-FileHash data/stories/route-61-2.story.json -Algorithm SHA256).Hash.ToLower()
git diff --check origin/main...HEAD
```

Expected: no prohibited application use; schema/story diff empty; SHA-256 exactly `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`; diff check PASS.

- [x] **Step 4: Start an isolated headed Edge/Chromium profile and execute browser flows A–K**

Serve the repository locally, create a new temporary browser user-data directory outside the user's normal profile, and test at 1440x900 and 1366x768. Cover blank Cancel, GeoJSON line, KML, mixed KML partition, CSV table immediate Table/Chart use, critical CSV EPSG:32648 points, projected Shapefile ZIP, XLSX sheets, GeoPackage layers, replacement, compact layout, initial network lazy loading, and application-origin console.

KML/KMZ/GPX remain on the bounded main-thread XML path. If representative browser evidence shows a material freeze, stop at the XML worker/dependency design gate; do not add an XML dependency or broaden the worker design silently.

- [x] **Step 5: Run the corrected 20.43 MiB responsiveness/cancellation benchmark**

Generate the exact temporary 21,420,020-byte / 21,000-row CSV and register the matching `data-workbench:review-ready` listener before beginning each import. Record cold and three warm throughput runs, worker phases, frame gaps, Long Tasks, progress, cancellation latency, teardown, and memory diagnostics. Completion must come only from the explicit event.

The complete interval from accepted worker-result handler entry through production validation, Workbench state installation, preview DOM commit, and the subsequent paint opportunity must be below 250 ms. A result-delivery-only measurement does not pass. Cancel must terminate and recover within 250 ms with no late result or project/history/package mutation. Any failure is a stop gate for implementation investigation, not a report-only caveat.

- [x] **Step 6: Capture bounded evidence and write report**

Capture only the six approved PNGs. Write `DATA-WORKBENCH.md` with exact evidence, real limitations, inherited warnings, and no unsupported PASS claims.

- [x] **Step 7: Commit certification artifacts**

```powershell
git add -- scripts/map-story-studio-data-workbench-benchmark.mjs tests review/map-story-studio-v1-2 vendor/data-import/THIRD-PARTY.md
git commit -m "test: certify Data Workbench V2"
```

- [x] **Step 8: Invoke `superpowers:verification-before-completion` and run the full suite once**

Run: `npm test`

Expected: PASS; record the new real count. Re-run affected focused tests only if a fix is required; if any executable fix changes HEAD after the full suite, the final full suite must be run again at the new executable head before claiming completion.

- [x] **Step 9: Invoke `superpowers:requesting-code-review` and review the exact final diff locally**

Review base-to-HEAD requirements, security, tests, file scope, browser evidence, vendor notices, and freeze paths. Fix only evidenced findings, then rerun proportionate verification.

- [ ] **Step 10: Push and open a Draft PR**

```powershell
git push -u origin feat/map-story-studio-v1-2-data-workbench
gh pr create --draft --base main --head feat/map-story-studio-v1-2-data-workbench --title "feat: add Map Story Studio Data Workbench V2" --body "Implements browser-local GIS/table import through the existing GeoJSON and table-data-v1 production contracts. Includes pinned local parser assets, EPSG:32648 certification, mixed-geometry partitioning, Add/Replace Data workflows, automated coverage, and headed-browser evidence. Remains Draft for independent exact-head review; does not change Story/Manifest schemas, the production renderer, or Route 61-2."
```

Do not mark Ready and do not merge.

- [ ] **Step 11: Invoke `superpowers:finishing-a-development-branch` and perform final exact-head checks**

```powershell
git status --short --branch
git rev-parse HEAD
git diff --check origin/main...HEAD
```

Expected: clean worktree, pushed exact HEAD, Draft PR open, diff check PASS.

---

## Plan Execution Checkpoints

- Checkpoint A after Task 1: vendor provenance, lazy loading, and ZIP regression evidence.
- Checkpoint B after Task 3: all pure conversion/adapters pass, including EPSG:32648, projected Shapefile, XLSX, and GeoPackage cleanup.
- Checkpoint C after Task 5: complete author workflow passes focused automated suites.
- Checkpoint D after Task 7: module-worker production adapter boundary and CSV-only PapaParse fallback pass focused and real-browser gates.
- Checkpoint E after Task 9: production-valid preview installation and explicit completion ordering pass focused tests.
- Checkpoint F after Task 10: corrected responsiveness evidence, bounded regression, one final full suite at exact executable HEAD, review, push, and Draft PR.

Implementation must stop at any approved stop gate instead of broadening scope.
