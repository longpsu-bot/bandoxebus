# Map Story Studio V1.2 — Data Workbench V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-local Add/Replace Data Workbench that converts ordinary GIS and tabular files into the existing managed GeoJSON and table-data-v1 contracts without changing production schemas or renderers.

**Architecture:** Explicit lazy format adapters produce transient source items and normalized candidates. Shared identifier, archive, CRS, spatial, and table modules make conversion deterministic; the workbench previews one candidate and calls existing inspector validators/resource writes only after Confirm. Studio continues to render through one production MapLibre instance and reuses the existing Story 1.2 add-project-layer command.

**Tech Stack:** Native browser ESM, Node test runner, native DOM/dialog/SVG, vendored fflate 0.8.3, togeojson 7.1.2, shpjs 6.2.0, proj4 2.22.0, PapaParse 5.7.0, SheetJS CE 0.20.3, GeoPackage JS 4.2.9 + local SQL.js WASM.

**Spec:** `docs/superpowers/specs/2026-09-01-map-story-studio-v1-2-data-workbench-design.md`

## Global Constraints

- Base is exactly `045a8b4b4ea0680273c1e9b676fa1677d749de3e`; branch is `feat/map-story-studio-v1-2-data-workbench`.
- No changes to `data/schemas/story-1.2.schema.json`, `data/schemas/project-manifest-v1.schema.json`, `data/stories/route-61-2.story.json`, or `src/map/geojson-renderer.js`.
- No bundler, `package.json` runtime dependency, runtime CDN, EPSG network lookup, worker subsystem, second MapLibre map, authored SQL/JavaScript/formula execution, parser HTML insertion, image work, or 3D work.
- Pending imports remain memory-only until Confirm; Cancel and failed validation write nothing.
- Stored spatial output is a valid EPSG:4326 FeatureCollection partitioned into point, line, or polygon candidates; never create a new mixed dataset.
- Source CRS remains visible and locally overridable; EPSG:4326, EPSG:3857, and EPSG:32648 are hard cases.
- Shapefile PRJ output is not reprojected twice; GeoPackage projected output is independently verified; result sets and connections always close.
- Use `textContent`, DOM properties, and `createElementNS`; do not insert user/parser content through `innerHTML`.
- Direct file ceiling is 512 MiB, loose aggregate 768 MiB / 256 files, XML 128 MiB; import ZIP ceiling is 2,048 entries, 512 MiB per entry, 1 GiB total, and 100:1 expansion after 1 MiB compressed.
- Develop with focused suites. Run the full `npm test` once at the final executable head.
- Use no subagents and no parallel agents.

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
- `tests/editor-data-workbench.test.mjs`
- modify `tests/editor-zip-storage.test.mjs`
- modify `tests/editor-data-inspectors.test.mjs`
- modify `tests/editor-studio-preview.test.mjs`
- modify `tests/editor-rich-content-authoring.test.mjs`
- add exact tiny fixtures under `tests/fixtures/data-import/` from spec section 17.2.

### Vendor and certification artifacts

- exact version directories and disclosures under `vendor/data-import/` from spec section 5;
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

### Task 6: Certify security, regression behavior, real browser workflows, and Draft PR

**Files:**
- Modify: all new/affected tests only for real defects found during certification
- Create: `review/map-story-studio-v1-2/DATA-WORKBENCH.md`
- Create: six exact screenshots under `review/map-story-studio-v1-2/data-workbench/`

**Interfaces:**
- Produces the final evidence report with base SHA, executable SHA, dependency files/licenses/hashes, formats, normalized contracts, CRS evidence, mixed partitioning, limits, browser flows, test counts, exclusions, and known issues.

- [ ] **Step 1: Run the focused development suites once at the assembled feature head**

Run the Task 5 focused command.

Expected: PASS; record exact test count.

- [ ] **Step 2: Run bounded regression set**

```powershell
node --test `
  tests/editor-data-import.test.mjs `
  tests/editor-data-import-adapters.test.mjs `
  tests/editor-data-workbench.test.mjs `
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

- [ ] **Step 3: Run static security and freeze checks before browser QA**

```powershell
rg -n "eval\(|new Function|innerHTML" editor
rg -n "unpkg\.com|jsdelivr|cdn\.sheetjs\.com|epsg\.io|spatialreference\.org" editor --glob "*.js" --glob "*.html" --glob "*.css"
git diff --exit-code 045a8b4b4ea0680273c1e9b676fa1677d749de3e -- data/schemas/story-1.2.schema.json data/stories/route-61-2.story.json
(Get-FileHash data/stories/route-61-2.story.json -Algorithm SHA256).Hash.ToLower()
git diff --check origin/main...HEAD
```

Expected: no prohibited application use; schema/story diff empty; SHA-256 exactly `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`; diff check PASS.

- [ ] **Step 4: Start an isolated headed Edge/Chromium profile and execute browser flows A–K**

Serve the repository locally, create a new temporary browser user-data directory outside the user's normal profile, and test at 1440x900 and 1366x768. Cover blank Cancel, GeoJSON line, KML, mixed KML partition, CSV table immediate Table/Chart use, critical CSV EPSG:32648 points, projected Shapefile ZIP, XLSX sheets, GeoPackage layers, replacement, compact layout, initial network lazy loading, and application-origin console.

If a realistic 20–50 MiB input freezes the editor unacceptably, stop and report instead of adding workers.

- [ ] **Step 5: Capture bounded evidence and write report**

Capture only the six approved PNGs. Write `DATA-WORKBENCH.md` with exact evidence, real limitations, inherited warnings, and no unsupported PASS claims.

- [ ] **Step 6: Commit certification artifacts**

```powershell
git add -- tests review/map-story-studio-v1-2 vendor/data-import/THIRD-PARTY.md
git commit -m "test: certify Data Workbench V2"
```

- [ ] **Step 7: Invoke `superpowers:verification-before-completion` and run the full suite once**

Run: `npm test`

Expected: PASS; record the new real count. Re-run affected focused tests only if a fix is required; if any executable fix changes HEAD after the full suite, the final full suite must be run again at the new executable head before claiming completion.

- [ ] **Step 8: Invoke `superpowers:requesting-code-review` and review the exact final diff locally**

Review base-to-HEAD requirements, security, tests, file scope, browser evidence, vendor notices, and freeze paths. Fix only evidenced findings, then rerun proportionate verification.

- [ ] **Step 9: Push and open a Draft PR**

```powershell
git push -u origin feat/map-story-studio-v1-2-data-workbench
gh pr create --draft --base main --head feat/map-story-studio-v1-2-data-workbench --title "feat: add Map Story Studio Data Workbench V2" --body "Implements browser-local GIS/table import through the existing GeoJSON and table-data-v1 production contracts. Includes pinned local parser assets, EPSG:32648 certification, mixed-geometry partitioning, Add/Replace Data workflows, automated coverage, and headed-browser evidence. Remains Draft for independent exact-head review; does not change Story/Manifest schemas, the production renderer, or Route 61-2."
```

Do not mark Ready and do not merge.

- [ ] **Step 10: Final clean-worktree and exact-head checks**

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
- Checkpoint D after Task 6: browser evidence, bounded regression, one final full suite at exact executable HEAD, review, push, and Draft PR.

Implementation must stop at any approved stop gate instead of broadening scope.
