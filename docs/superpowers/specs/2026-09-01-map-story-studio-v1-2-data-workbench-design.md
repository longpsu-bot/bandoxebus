# Map Story Studio V1.2 — Slice B: Data Workbench V2 Design

Status: worker architecture revision ready for human approval

Date: 2026-09-01; worker responsiveness revision 2026-09-02

Authoritative repository base: `main` at `045a8b4b4ea0680273c1e9b676fa1677d749de3e`

Certified base tree: `262a6a1df37dbc04f28c8f48c7047d89218c9538`

Certified base suite: 547 tests

Feature branch: `feat/map-story-studio-v1-2-data-workbench`

## 1. Decision summary

Data Workbench V2 is a browser-local import boundary for ordinary GIS and table files. It changes the normal author workflow from entering stable IDs, managed paths, production types, geometry declarations, and normalized JSON into choosing files, configuring only source-specific choices, reviewing a useful preview, and confirming one import candidate.

The production model does not change. Every confirmed spatial candidate is stored as an existing `geojson` dataset at `./data/<id>.geojson`; every confirmed tabular candidate is stored as an existing `table-json` dataset at `./data/<id>.json`. Existing production validators remain the final authority. KML, KMZ, Shapefile, GeoPackage, GPX, CSV, and XLSX parsing exists only in Studio and is never added to the production loader.

The selected architecture uses explicit format adapters, focused normalization modules, a thin stateful dialog, locally vendored pinned parser builds, one dedicated Data Import worker/client boundary for expensive formats, and a preflight-then-commit mutation boundary. The worker prepares transient candidates only; production validation, project/history mutation, managed writes, manifest writes, and the existing Story layer command remain on the main thread. No bundler, runtime CDN, parser plugin framework, worker pool/framework, second MapLibre map, schema change, or production renderer change is introduced.

## 2. Approved scope and invariants

This specification formalizes the approved product direction. It does not reopen broad product discovery.

Locked invariants:

- the application remains a static browser application with native ESM and no build step;
- `package.json` gains no runtime dependencies;
- all parser code and matching WASM are local and version-pinned;
- parsers load only after a source requiring them is selected;
- one dedicated import worker may parse and normalize transient input, but it cannot access project, history, Story, manifest, storage, or production mutation APIs;
- pending import state is transient and never enters the package, Story, revision history, or authoring history;
- confirmation produces only existing managed resource and manifest shapes;
- spatial confirmation reuses `addProjectLayerToStory12` / the `add-project-layer` command semantics;
- a new spatial layer is visible in the active Scene and hidden in all other existing Scenes;
- table confirmation creates no Scene layer and refreshes resource-backed authoring catalogs immediately;
- replacement retains the existing dataset ID, path, type family, and spatial geometry family;
- all stored spatial coordinates are EPSG:4326 longitude/latitude;
- the Story 1.2 schema, project-manifest schema, production GeoJSON renderer, and Route 61-2 Story remain unchanged;
- exactly one production MapLibre instance remains active in Studio.

## 3. Repository evidence and integration seams

The base already provides the required production boundary:

- `editor/ui/inspectors.js` owns `importGeoJson`, `importNormalizedTable`, `datasetInspector`, and `writeValidatedResource`;
- `src/project/resource-schemas.js` validates `FeatureCollection` resources against the descriptor geometry family and validates normalized `table-data-v1` resources;
- `editor/editor.js` turns managed resource writes into package-store and draft-store changes, and re-derives table/dataset catalogs from the current draft without reload;
- `editor/core/scene-commands.js` owns `addProjectLayerToStory12`, including the active-Scene-visible / other-Scenes-hidden rule;
- `editor/ui/studio-shell.js` renders the human-labelled Layers list and contextual layer Properties;
- `editor/storage/adapters.js` already uses vendored `fflate` and demonstrates bounded streaming ZIP expansion and normalized path rejection;
- `editor/core/package-store.js` already rejects traversal, absolute, URL, drive, backslash, dot-segment, query, and fragment package paths.

The existing schema-oriented Dataset panel remains available as an advanced resource-management surface, but its normal add/replace file controls are routed to the same Data Workbench. Studio's Layers panel becomes the primary entry point through `+ Add data`.

## 4. Considered architectures

### 4.1 Selected: explicit vendored adapters plus shared normalizers

Each supported source is detected explicitly and parsed by a mature pinned library. Adapters return ordinary transient candidates. Spatial and table normalizers make the candidates deterministic, and confirmation delegates to the existing resource validators and dataset inspector commands.

This fits the static application, makes lazy loading obvious, keeps production format-neutral, allows focused tests around the application's glue, and avoids a generic loader or plugin framework.

### 4.2 Selected responsiveness addition: one classic Data Import worker per workbench session

The main thread owns the dialog and transaction boundary. A focused client starts one classic dedicated worker for an active Workbench session, sends bounded commands, receives progress and normalized results, and terminates the worker deterministically. The worker dynamically imports the existing pure ESM normalizers/adapters and uses `importScripts` only for the pinned UMD parser artifacts that cannot execute as module-worker imports.

This is selected over PapaParse's built-in `worker: true` mode because the product needs the same cancellation, progress, local-vendor, and teardown boundary for JSON/GeoJSON, XLSX, Shapefile, GeoPackage, and CRS work—not a CSV-only nested blob worker. A classic worker is selected over a module worker because the pinned PapaParse 5.7.0 browser build assigns through top-level `this`; it loads correctly with `importScripts` but not as a side-effect module. Dynamic `import()` remains available from the classic worker for shpjs, SheetJS, safe ZIP handling, and the pure normalizer modules.

The worker is not a manager, pool, scheduler, job queue, or concurrency subsystem. Only one import session is active for one dialog.

### 4.3 Rejected: one monolithic importer in `editor/editor.js`

This would minimize file count but would mix file security, parser globals, CRS rules, geometry recursion, table inference, dialog state, and package mutation in an already large controller. It would be difficult to test without DOM setup and easy to couple to production persistence.

### 4.4 Rejected: npm runtime dependencies plus a bundler

This would simplify package imports but changes the certified deployment architecture, eagerly risks pulling parser dependency graphs into initial Studio startup, and violates the explicit no-bundler boundary. The required packages all expose browser-usable artifacts, so a bundler is unnecessary.

## 5. Dependency and vendoring decision

Upstream versions were verified once on 2026-09-01 using official npm registry metadata, official project repositories/documentation, and the official SheetJS distribution. Versions are exact; no floating `latest` URL is retained in source or documentation.

| Purpose | Package | Pin | License | Local files | Provenance |
| --- | --- | ---: | --- | --- | --- |
| KML / GPX | `@tmcw/togeojson` | 7.1.2 | BSD-2-Clause | `vendor/data-import/togeojson/7.1.2/togeojson.es.mjs`, `LICENSE` | official npm tarball `@tmcw/togeojson@7.1.2` |
| Shapefile / DBF | `shpjs` | 6.2.0 | MIT | `vendor/data-import/shpjs/6.2.0/shp.esm.min.js`, `LICENSE.md` | official npm tarball `shpjs@6.2.0` |
| CRS | `proj4` | 2.22.0 | MIT | `vendor/data-import/proj4/2.22.0/proj4.js`, `LICENSE.md` | official npm tarball `proj4@2.22.0` |
| CSV | `papaparse` | 5.7.0 | MIT | `vendor/data-import/papaparse/5.7.0/papaparse.min.js`, `LICENSE` | official npm tarball `papaparse@5.7.0` |
| XLSX | SheetJS Community Edition | 0.20.3 | Apache-2.0 | `vendor/data-import/sheetjs/0.20.3/xlsx.mjs`, `LICENSE` | official `cdn.sheetjs.com/xlsx-0.20.3/package/` distribution; downloaded only while vendoring |
| GeoPackage | `@ngageoint/geopackage` | 4.2.9 | MIT | `vendor/data-import/geopackage/4.2.9/geopackage.min.js`, `sql-wasm.wasm`, `geopackage.min.js.LICENSE.txt`, `LICENSE` | official npm tarball `@ngageoint/geopackage@4.2.9` |
| ZIP | `fflate` | existing 0.8.3 | MIT | existing `vendor/fflate/0.8.3/fflate.esm.js`, `LICENSE` | already certified and vendored |

`vendor/data-import/THIRD-PARTY.md` records package, exact version, upstream URL, license, each local file, its source URL/tarball, and SHA-256. Upstream license and bundled-transitive notice files are preserved byte-for-byte.

The stale public npm `xlsx@0.18.5` package is not used.

### 5.1 Browser loading form

- togeojson, shpjs, and SheetJS use vendored ESM with dynamic `import()`;
- proj4, PapaParse, and GeoPackage use their official browser bundles and are loaded by one explicit local script loader;
- only `editor/import/vendor-loaders.js` on the main thread and `editor/import/data-import-worker.js` inside its isolated realm may read the parser globals (`proj4`, `Papa`, or `GeoPackage`);
- the GeoPackage loader calls `setSqljsWasmLocateFile` with the local versioned `sql-wasm.wasm` URL before opening bytes;
- successful loader promises are cached; rejected promises are cleared so a later retry is possible;
- no parser script or WASM is referenced by `editor/index.html`, so opening Studio does not load it.

This is a few explicit loaders, not a generic module-loader framework.

## 6. Proposed application modules

### 6.1 New modules

| Path | Responsibility |
| --- | --- |
| `editor/core/safe-zip.js` | Shared bounded ZIP inventory/expansion using fflate; normalized paths, duplicate detection, encryption rejection, size/ratio ceilings, and deterministic entry order. Existing project ZIP behavior retains its current limits through a separate limit profile. |
| `editor/import/vendor-loaders.js` | Explicit cached main-thread lazy loaders and local parser URL exports; together with the worker entry point, this is the only parser-global isolation boundary. |
| `editor/import/import-identifiers.js` | Unicode-preserving labels and deterministic ASCII dataset/column ID slugging and collision suffixing. |
| `editor/import/crs.js` | CRS state, local definition resolution, coordinate recursion/reprojection, Z preservation, and post-transform bounds/finite validation. |
| `editor/import/spatial-normalizer.js` | Feature/FeatureCollection normalization, GeometryCollection flattening, null counting, geometry-family partitioning, bounds/field summaries, and SVG-preview sampling model. |
| `editor/import/table-normalizer.js` | Header selection, column ID generation, blank normalization, conservative type inference, and canonical `table-data-v1` construction. |
| `editor/import/spatial-adapters.js` | GeoJSON/JSON, KML, KMZ, GPX, and safe grouped zipped/loose Shapefile parsing. |
| `editor/import/table-adapters.js` | CSV, normalized/plain JSON table, and XLSX workbook/sheet/header parsing. |
| `editor/import/geopackage-adapter.js` | Local GeoPackage open/list/extract/verify/close lifecycle and feature-table-only chooser model. |
| `editor/import/data-import.js` | File-set detection, transient session state machine, candidate configuration, warnings, replacement constraints, and confirm preflight model. It does not write package state. |
| `editor/import/data-import-worker.js` | Classic dedicated-worker entry point, parser loading inside the worker, read/prepare command dispatch, progress events, candidate preparation, error normalization, cancellation acknowledgement, and resource cleanup. It imports existing adapters/normalizers rather than duplicating them. |
| `editor/import/data-import-worker-client.js` | Main-thread one-session client, request/session IDs, input transfer, progress/result routing, prompt cancellation via termination, stale-message rejection, and deterministic disposal. It exposes the same transient session shape consumed by the Workbench. |
| `editor/ui/data-workbench.js` | Accessible dialog, drop/browse surface, source-item/configuration sections, progress states, previews, Advanced details, Cancel/dispose, and Confirm callback. |

### 6.2 Modified application files

| Path | Change |
| --- | --- |
| `editor/storage/adapters.js` | Reuse `safe-zip.js` with the unchanged project-package limits and behavior. |
| `editor/ui/inspectors.js` | Keep validation/write authority; expose a preflight-safe candidate add/replace path without duplicating validators. |
| `editor/ui/studio-shell.js` | Add `+ Add data`, candidate layer summaries, and `Replace data…` callback points. |
| `editor/editor.js` | Own workbench lifecycle, preflight all deterministic confirmation operations, call existing dataset and Scene commands, refresh Studio, and route table/chart resource requests to the workbench. |
| `editor/editor.css` | Responsive dialog, drop zone, source chooser, preview, warnings, SVG silhouette, table viewport, and compact 1366×768 rules. |
| `editor/import/vendor-loaders.js` | Preserve main-thread loaders and add only worker-safe URL exports/helpers needed by the dedicated worker; no generic loader registry. |
| `editor/import/table-adapters.js` | Use one chunked PapaParse pass in worker CSV sessions and remove full-grid copies that are not ownership boundaries. |
| `editor/import/table-normalizer.js` | Preserve its pure public API while replacing temporary full row/column arrays with bounded per-column inference state and direct normalized-row construction. |
| `editor/import/data-import.js` | Keep the existing direct session for lightweight DOM-bound XML paths and tests; route heavy formats through the dedicated client without changing candidate contracts. |
| `editor/ui/data-workbench.js` | Render worker progress phases and dispose the active worker on Cancel, close, replacement, success, or error. |

No change is proposed to `editor/index.html`; the workbench creates one dialog with native DOM construction when first opened.

## 7. Import data flow and transaction boundary

```text
File selection / drop
  -> enforce selection byte ceilings
  -> for heavy formats, start the dedicated Data Import worker
       -> transfer bytes or pass a CSV File for chunk streaming
       -> detect source and lazy-load only the required local parser
       -> parse into source items
       -> receive source-item result on the main thread
       -> choose sheet/layer/shapefile item and source configuration
       -> start worker prepare operation
       -> normalize into one or more candidates
       -> prepare summaries and bounded preview data
       -> receive normalized candidate result on the main thread
  -> for DOM-bound KML/GPX/KMZ, use the existing bounded main-thread path
  -> user confirms exactly one candidate
  -> preflight existing production validation
  -> preflight add-project-layer for new spatial imports
  -> write one managed resource
  -> write one manifest dataset descriptor
  -> apply precomputed Story 1.2 layer command for new spatial imports
  -> refresh Studio and resource catalogs
```

Everything before confirmation lives in a disposable transient session split across `data-import-worker-client.js` and one worker realm. The main side contains file references, public source items, configuration, candidates, warnings, and status. The worker side may temporarily contain transferred bytes, parser state, source inventory, and normalization intermediates. Neither side has project mutation authority or a serializer into package state, and neither is passed to the draft store, package store, preview bridge, or Story history.

Progress messages for `Reading`, `Parsing`, `Inferring`, `Reprojecting`, and `Preparing preview` cross the worker boundary before the corresponding expensive phase. CSV chunk callbacks additionally report byte/row progress. The main thread remains free to repaint and terminate the worker; it does not wait for a cooperative cancel handler inside a synchronous parser call.

### 7.1 Confirm preflight

Confirmation first performs all deterministic failure-prone work without mutation:

1. verify candidate ID collision and replacement compatibility;
2. build the exact descriptor and managed path;
3. call `importGeoJson` or `importNormalizedTable` for production validation;
4. for a new spatial import, compute the next Story through the pure `addProjectLayerToStory12` command;
5. only after all preflight succeeds, call the existing validated resource/dataset write path and apply the precomputed Story.

A validation, compatibility, collision, or Scene-command error therefore writes nothing. No new cross-resource undo architecture is claimed. After confirmation, the existing package dirty/revision behavior applies normally.

### 7.2 New spatial import

The descriptor remains ordinary project-manifest data:

```json
{
  "type": "geojson",
  "geometry": "line",
  "src": "./data/proposed-route.geojson",
  "label": "Proposed Route",
  "render": {
    "type": "line",
    "color": "#00AAFF"
  }
}
```

Geometry and managed path are derived implementation details. The workbench does not ask for them. Existing default renderer selection remains point -> point, line -> line, polygon -> fill.

### 7.3 Table import

The descriptor is `{ type: "table-json", src: "./data/<id>.json", label }`. It is added to `manifest.datasets` and immediately appears in `productionContentCatalogs`, enabling Chart/Table insertion without reload. It is never passed to the Scene layer command.

### 7.4 Replacement

Replacement opens the same workbench in a constrained mode:

- the existing technical ID and managed path are read-only;
- the existing human label remains unchanged and can still be edited through normal Properties;
- a table accepts table candidates from CSV, XLSX, normalized table JSON, or plain record-array JSON;
- a spatial dataset accepts spatial sources but only a candidate matching its existing `point`, `line`, or `polygon` family;
- an incompatible family is rejected before writing with `Geometry changed. Import this as a new layer.`;
- the existing dataset descriptor and Story layer membership are not changed;
- `datasetEntity.command('replace', ...)` remains the final validated write path.

## 8. Detection and source-item model

File extension narrows the adapter, but magic/root/content checks prevent misleading extensions from silently reaching the wrong parser.

| Input | Detection and source items |
| --- | --- |
| `.geojson` | JSON object; FeatureCollection or Feature only. |
| `.json` | FeatureCollection, Feature, valid table-data-v1, or top-level array of plain scalar records; otherwise unsupported JSON shape. |
| `.kml` | XML root local name `kml`; one source item. |
| `.kmz` | safe ZIP; prefer root `doc.kml`, otherwise one source item per contained KML. |
| zipped Shapefile | `.zip` plus safe grouped `.shp` entries; one source item per basename. |
| loose Shapefile | multi-file selection grouped case-insensitively by basename; `.shp` required, `.dbf/.prj/.cpg` attached when present. |
| `.gpkg` | SQLite header `SQLite format 3\0`; one source item per GeoPackage feature table. Tile/attribute tables are excluded. |
| `.gpx` | XML root local name `gpx`; one source item. |
| `.csv` | CSV extension; one parsed grid, then author chooses Table or Map points. |
| `.xlsx` | XLSX extension plus OOXML ZIP markers; one source item per sheet. |

The picker advertises and accepts only `.geojson,.json,.kml,.kmz,.zip,.shp,.dbf,.prj,.cpg,.gpkg,.gpx,.csv,.xlsx`. Unsupported extensions fail with a supported-format list. MIME type is advisory only.

XML input is decoded locally, rejects a case-insensitive `<!DOCTYPE` before `DOMParser`, and is passed directly to togeojson. The application never follows NetworkLink, fetches external KML resources, or imports GroundOverlay images.

## 9. Dataset identity and labels

The friendly label is derived from the selected source item, sheet, layer, or final filename basename. Only the final extension is removed. Unicode spelling is preserved.

Technical IDs use one shared deterministic algorithm:

1. trim and Unicode-normalize with NFKD;
2. map Vietnamese `đ/Đ` to `d/D`;
3. remove combining marks;
4. lowercase;
5. replace remaining whitespace, punctuation, and non-ASCII runs with `-`;
6. collapse and trim hyphens;
7. use `data` if empty;
8. prefix `data-` when the result does not start with a letter;
9. resolve collisions as `id`, `id-2`, `id-3`, and so on.

Example: `Trạm dừng fix UTM.csv` keeps label `Trạm dừng fix UTM` and proposes ID `tram-dung-fix-utm`.

The ID is visible only under Advanced / Technical details and is editable until confirmation. Editing revalidates the same stable-ID and collision rules. The managed path is derived live and remains read-only.

Column IDs use the same transformation with `column` / `column-` fallbacks. Duplicate human headings are preserved as labels and deduplicated internally in source order.

## 10. Spatial normalization

Every spatial adapter returns GeoJSON-like source data plus explicit coordinate state. One shared normalizer produces production candidates.

### 10.1 Canonical output

- output is always a `FeatureCollection`;
- a single Feature is wrapped;
- supported leaf geometries are Point, MultiPoint, LineString, MultiLineString, Polygon, and MultiPolygon;
- GeometryCollection is recursively flattened into ordinary Features while cloning the original properties;
- emitted order follows source feature order and depth-first geometry order, which is sufficient deterministic part identity, so `_import_part` is not added by default;
- null, empty, and unsupported geometries are omitted and counted;
- recursion depth is capped at 64 with a clear malformed-input error;
- scalar properties and feature IDs are preserved where the adapter supplies them;
- legacy top-level GeoJSON `crs` is consumed as input metadata and removed from output.

### 10.2 Family partitioning

Leaf geometry types map to three renderable families:

- Point / MultiPoint -> `point`;
- LineString / MultiLineString -> `line`;
- Polygon / MultiPolygon -> `polygon`.

A source containing more than one family produces separate candidates in the stable order point, line, polygon. Candidate labels append ` · Points`, ` · Lines`, or ` · Polygons`, and IDs append `-points`, `-lines`, or `-polygons` before collision resolution. No imported descriptor uses `geometry: "mixed"`.

The author confirms one candidate at a time. Multi-candidate atomic import is not part of V1.2.

### 10.3 Warnings and summaries

The normalizer reports feature count, null/empty count, geometry family, scalar field names, and normalized bounds. A non-zero omitted count produces a visible warning such as `3 records had no usable geometry and will not be imported.`

Invalid coordinate nesting, non-numeric coordinates, NaN/Infinity, or normalized lon/lat outside valid bounds is a blocking error, not a warning.

## 11. CRS strategy

Each spatial candidate carries:

- `sourceCrs`: normalized local identifier/definition and detection basis;
- `coordinateState`: `source` or `wgs84`;
- `outputCrs`: fixed `EPSG:4326`;
- `reprojected`: boolean;
- any warning or manual-declaration requirement.

Production GeoJSON never retains a `crs` member.

### 11.1 Local definitions only

`proj4@2.22.0` is the sole manual reprojection authority. A direct local probe confirmed its pinned browser build recognizes EPSG:4326, EPSG:3857, and EPSG:32648. The probe converted `[686143.36, 1200320.45]` in EPSG:32648 to approximately `[106.7028563810, 10.8536676064]`.

Resolution rules:

- accept normalized EPSG codes already registered in the local proj4 build;
- accept projection/WKT text locally understood by proj4;
- show Source CRS for every spatial candidate and allow an explicit pre-confirm override; KML and GPX still default to their standards-defined EPSG:4326;
- never fetch epsg.io, spatialreference.org, or any other definition service;
- an unavailable code fails with `Projection definition for EPSG:xxxx is not available locally.`;
- no heuristic chooses an unknown projected CRS.

### 11.2 Coordinate transformation

The shared recursion transforms only ordinates 0 and 1. Z and all later ordinates are copied unchanged. The result must contain finite numbers and pass longitude `[-180,180]` and latitude `[-90,90]` checks. Inputs and results are interpreted in degrees where the CRS says degrees; radians are never inferred or used as the public contract.

### 11.3 Format-specific CRS behavior

| Format | Source CRS behavior |
| --- | --- |
| GeoJSON | assume RFC 7946 EPSG:4326; a recognized legacy `crs` is reported and, if projected, transformed once; manual override remains available. |
| KML / KMZ | EPSG:4326. |
| GPX | EPSG:4326. |
| CSV points | explicit visible source CRS; obvious lon/lng + lat fields may suggest EPSG:4326, while x/y/easting/northing never do. |
| Shapefile with PRJ | pass `.prj` to shpjs, which documents WGS84 GeoJSON output; mark output `wgs84` and validate it, with no second transform. |
| Shapefile manual override | omit `.prj` from the shpjs object so coordinates remain source-native, then transform exactly once with the chosen local proj4 definition. |
| Shapefile without PRJ | if every sampled coordinate fits geographic bounds, offer an explicit `Assume EPSG:4326` warning; otherwise require manual CRS. |
| GeoPackage | read feature-table SRS metadata; compare a deterministic non-null raw sample transformed through local proj4 with the library GeoJSON sample before accepting library output as WGS84. Failure to verify blocks import. |

The GeoPackage comparison prevents both silent source-coordinate storage and double reprojection. Projected Shapefile, projected GeoPackage, and CSV EPSG:32648 fixtures certify the paths independently.

## 12. Format adapters

### 12.1 CSV

PapaParse receives the local `File` inside the dedicated worker with `dynamicTyping: false` and one chunked parse. It owns quoting, embedded commas, line endings, BOM, delimiter detection, and file streaming. The adapter accumulates owned chunk rows once, reports honest chunk progress, and converts parser errors into bounded row/message diagnostics. PapaParse's built-in `worker: true` option stays off because parsing already runs inside the product-owned worker.

The author chooses Table or Map points after parsing. For Map points, X and Y selectors and Source CRS remain visible and editable. The adapter converts selected finite numeric X/Y cells into Point features and reports rows with blank coordinates separately from invalid numeric coordinates.

### 12.2 KML / KMZ / GPX

togeojson parses a DOM created from local XML text. KML ExtendedData and GPX waypoint/route/track attributes are preserved as scalar properties where provided. Resulting GeometryCollections and mixed families are normalized centrally.

KMZ is inventoried with the safe ZIP boundary. Root `doc.kml` is preferred; otherwise KML entries are listed with friendly paths. Embedded icons and rasters are ignored and never decoded or fetched.

### 12.3 Shapefile

Both zipped and loose sources are converted into grouped `{ shp, dbf?, prj?, cpg? }` byte objects after the application's own archive/path checks. Raw ZIP bytes are not handed to shpjs. This preserves the same chooser and CRS behavior for zipped and loose files, prevents shpjs from bypassing application archive limits, and supports multiple shapefiles deterministically.

`.shp` is required. Missing `.dbf` produces an attribute warning rather than a geometry failure. `.cpg` is passed through when present.

### 12.4 XLSX

Only `.xlsx` is accepted. SheetJS reads a local ArrayBuffer and exposes sheet names. The selected sheet is converted to an array-of-arrays with raw values and blanks preserved. The first non-empty row in the first 50 rows is suggested as the header; the author may choose another row within that same bounded range.

Formula evaluation is never requested or implemented. Formula metadata is not imported. A cached scalar value is used when present; otherwise the cell becomes null or safe text according to SheetJS output. Spreadsheet date cells are converted to `YYYY-MM-DD` from workbook calendar components without locale formatting or timezone shifting.

### 12.5 GeoPackage

The adapter opens local bytes with GeoPackage JS after binding the local SQL.js WASM path. It lists `getFeatureTables()` only, shows friendly table names, reads the selected table SRS metadata, extracts scalar attributes and GeoJSON features, performs the CRS verification described above, and closes every result set and the GeoPackage in `finally` blocks.

The transient session may hold an open connection only while the feature-table chooser is active. File replacement, Cancel, dialog close, successful extraction, and errors all call session disposal. Tiles, rasters, attributes-only tables, SQL UI, authored SQL, and GeoPackage modification are excluded.

## 13. Table normalization

The table normalizer accepts a rectangular array plus chosen header row, or a top-level array of plain records with scalar/null cells. Nested objects and arrays fail with `Unsupported JSON data shape`; no deep flattening is invented.

Rules:

- blank header labels become `Column N`;
- duplicate human headings remain visible and get unique internal IDs;
- omitted and blank cells become `null`;
- every row contains every declared column ID;
- CSV parsing keeps strings raw until inference, preserving leading zeros;
- inference ignores nulls and uses: all blank -> text; spreadsheet dates or valid `YYYY-MM-DD` -> date; exact boolean values -> boolean; finite integer values -> integer; finite numeric values -> number; otherwise text;
- numeric-looking source strings with a leading zero, other than the scalar `0`, force text;
- identifiers such as `61-2` remain text;
- mixed incompatible types become text without lossy coercion;
- integer and number output values are finite numbers; boolean output values are booleans; dates are canonical date-only strings.

The normalized shape is exactly:

```json
{
  "schemaVersion": "1.0",
  "columns": [{ "id": "ridership", "label": "Ridership", "type": "integer" }],
  "rows": [{ "ridership": 120 }]
}
```

## 14. Workbench interaction design

The normal Layers section becomes:

```text
LAYERS
[ + Add data ]

Existing Route
Line · 428 features

Proposed Route
Line · 436 features
```

`+ Add data` opens an accessible native dialog. The initial state contains one large keyboard- and pointer-operable drop target, a Browse files button, and only the supported format list.

The single dialog reveals stateful sections rather than introducing a wizard framework:

1. Choose files;
2. choose a source item when a workbook/archive/database has several;
3. configure name, CSV mode/X/Y, header row, or source CRS when relevant;
4. preview;
5. Add layer / Add table.

The initial state never asks for technical ID, managed path, production type, or geometry. Advanced / Technical details contains the editable pre-confirm ID and read-only derived path.

### 14.1 Spatial preview

The preview shows friendly name, detected format, geometry family, feature count, source/output CRS, reprojection status, WGS84 bounds, scalar fields, and warnings.

A small non-interactive SVG silhouette is fit to normalized candidate bounds. It uses native SVG DOM nodes, no HTML strings, no basemap, and no MapLibre instance. Sampling is deterministic and capped at 200 features / 4,000 coordinate vertices so preview construction does not dump the full dataset into DOM.

### 14.2 Table preview

The preview shows source/sheet, total rows x columns, inferred labels/types, warnings, and at most the first 20 data rows. It uses a scrollable viewport and does not virtualize or render the remaining rows.

All source-controlled labels and cell text are assigned through `textContent` / native DOM properties. No parser-generated HTML is inserted.

### 14.3 Cancel and errors

Cancel, Escape, file replacement, and dialog close dispose parser resources and discard the session with no project mutation. Blocking errors stay in the dialog with a useful format/item/field context. Warnings remain visible before the Confirm button.

## 15. File and archive safety

Input is local but untrusted. Limits are binary MiB (`1024 * 1024`).

### 15.1 Direct-file limits

- maximum individual selected file: 512 MiB;
- maximum aggregate loose-file selection: 768 MiB;
- maximum loose files in one selection: 256;
- XML text maximum: 128 MiB after byte-size precheck;
- preview DOM limits are independent of parse limits.

These limits allow normal files in the hundreds-of-MB range where browser memory permits, but do not promise that every 512 MiB XLSX/GPKG/SHP will fit a device. XLSX and GeoPackage can require several times source size in transient browser memory. The UI documents 100 MiB or less as the reliable cross-device target and reports allocation/parser failures honestly.

### 15.2 Import-archive limits

- maximum archive entries: 2,048;
- maximum single uncompressed entry: 512 MiB;
- maximum cumulative uncompressed size: 1 GiB;
- maximum declared expansion ratio: 100:1 for an entry or whole archive once compressed size exceeds 1 MiB;
- only stored and DEFLATE compression methods are accepted;
- general-purpose encrypted flag is rejected before decompression;
- absolute, drive, URL, backslash, dot/traversal, empty-segment, query, and fragment paths are rejected;
- normalized paths are compared case-insensitively and duplicates are rejected;
- directories do not count as import candidates but do count toward the entry ceiling.

`safe-zip.js` reads only the ZIP metadata required to enforce flags, names, declared sizes, compression type, and entry bounds, then delegates decompression to fflate. It does not implement DEFLATE or a competing archive parser. Streaming output counters re-enforce actual per-entry and aggregate ceilings even when declared metadata is false.

The existing project-package ZIP profile remains at its certified 2,048 entries / 64 MiB per entry / 256 MiB total limits.

## 16. Responsiveness and performance stop gate

### 16.1 Corrected baseline profile

The 2026-09-02 profiling fixture is a generated 20.4277 MiB UTF-8 CSV with 21,000 data rows and three columns, including enough text payload to exercise a realistic 20 MiB table. It is temporary certification input and is not committed.

The earlier reported 38.615-second review-ready time was not application throughput. The browser harness polled `getAttribute('textContent')`; that attribute does not exist, so the harness always added 30 seconds of polling after the import had completed. Correct measurement reads the status node's `textContent` property. The actual Workbench reached `Review the preview` in 1.009 seconds in the real isolated Chromium flow.

Three isolated page-side phase runs produced a measured pipeline subtotal of 1,171.6 ms cold, then 728.9 ms and 771.0 ms warm. Median phase timings are:

| Phase | Median ms | Observed range ms | Notes |
| --- | ---: | ---: | --- |
| fetch/open plus ArrayBuffer read | 162.6 | 134.4–262.4 | Diagnostic server read; browser file reads are asynchronous. |
| byte-view construction | 0.0 | 0.0–0.2 | No material cost. |
| UTF-8 decode | 39.5 | 30.6–45.4 | Creates the complete 20 MiB string in the current path. |
| PapaParse delimiter-detection parse | 129.4 | 126.8–141.6 | Current code parses the complete text once to choose a delimiter. |
| PapaParse full parse | 41.5 | 30.1–58.1 | Current code parses the same text a second time. |
| full grid clone/trailing trim | 7.9 | 4.6–11.5 | `grid.map(row => [...row])` duplicates every row array. |
| table normalization | 201.9 | 181.3–331.8 | Includes width scan, another row-array copy, inference arrays, and normalized row objects. |
| production table validation | 73.7 | 66.4–88.7 | Required and retained on the main thread after the worker result. |
| candidate `structuredClone` | 125.9 | 108.9–253.4 | Avoidable before a worker result; `postMessage` already provides an ownership copy. |
| candidate metadata | 0.2 | 0.1–0.3 | Negligible. |
| bounded 20-row preview DOM | 1.5 | 1.2–9.6 | Not a bottleneck. |
| `JSON.stringify` diagnostic | 157.2 | 97.3–214.4 | Not part of review-ready time; recorded because later persistence serialization is a large copy. |
| CRS work | 0.0 | 0.0 | This benchmark is a table import. Projected CSV has a separate CRS certification flow. |

The normalization-only diagnostic measured median costs of 19.0 ms for the width/slice temporary array, 47.5 ms for the second data-row array copy, 7.7 ms for scalar validation, 68.0 ms for per-column inference arrays, and 86.9 ms for normalized row-object construction. No O(n²) row algorithm was found; the hot path is O(rows × columns), but it performs too many complete passes and allocations. `Math.max(...grid.slice(...).map(...))` also creates an avoidable row-count-sized array and risks the engine argument ceiling on much taller tables.

One cold heap observation grew from about 10.2 MiB at start to 56.8 MiB after parsing, 63.5 MiB after normalization, 84.4 MiB after the candidate clone, and 106.5 MiB after the diagnostic stringify. Repeated-page heap readings reached 179–189 MiB because garbage collection is nondeterministic; those repeated peaks are not treated as retained-memory proof.

Actual importer runs were 744.5, 787.6, and 874.7 ms review-ready. They contained one 662–794 ms main-thread long task and one 650–800 ms animation-frame gap. The corrected diagnosis is therefore:

- **throughput is already sub-second for the 20.43 MiB benchmark, not 38 seconds;**
- **responsiveness still needs work because read, parse, normalize, validate, clone, and preview preparation chain into one long main-thread task;**
- the worker must preserve roughly sub-second warm throughput rather than hiding a 30–40 second algorithm.

### 16.2 Worker feasibility evidence

A temporary, uncommitted classic-worker probe loaded and executed the pinned local artifacts without a bundler or CDN:

- PapaParse 5.7.0 via `importScripts`, exposing `Papa.parse`;
- proj4 2.22.0 via `importScripts`, exposing `proj4`;
- GeoPackage 4.2.9 via `importScripts`, local SQL.js WASM redirection, actual open/list of `stops` and `stations`, and close;
- shpjs 6.2.0 via dynamic `import()`, with the projected ZIP fixture parsed to one Point;
- SheetJS CE 0.20.3 via dynamic `import()`, with both `Ridership` and `Other` sheets listed;
- the existing pure table normalizer via dynamic `import()`.

This removes the browser-artifact feasibility blocker. Implementation must repeat these operations through production adapters and must not retain the probe files.

### 16.3 Dedicated worker boundary

`data-import-worker-client.js` is the only main-thread worker API. `data-import-worker.js` is the only worker entry point. One Workbench dialog owns at most one worker; there is no global registry or concurrency. The worker may detect, parse, normalize, reproject, infer types, and produce bounded preview metadata. It cannot import or receive project, Story, draft-store, package-store, history, inspector, or storage mutation functions.

The main thread retains:

- selection size checks before reading;
- Workbench DOM and accessibility state;
- replacement compatibility presentation;
- existing production resource validation;
- descriptor/resource/manifest writes;
- history/revision effects;
- existing `add-project-layer` semantics;
- final worker disposal.

### 16.4 Message contract

Every message has `type`, `sessionId`, and `requestId`. IDs are monotonically generated by the client and stale responses are ignored.

Main to worker:

```js
{ type: 'start', sessionId, requestId, operation: 'read', inputs, usedIds, replacement }
{ type: 'start', sessionId, requestId, operation: 'prepare', itemId, config }
{ type: 'cancel', sessionId, requestId, reason }
```

Worker to main:

```js
{ type: 'progress', sessionId, requestId, phase, completed, total, unit, message }
{ type: 'result', sessionId, requestId, operation: 'read', format, sourceItems }
{ type: 'result', sessionId, requestId, operation: 'prepare', candidates }
{ type: 'error', sessionId, requestId, phase, code, message, recoverable }
{ type: 'cancel', sessionId, requestId, state: 'cancelled' }
```

Allowed progress phases are `Reading`, `Parsing`, `Inferring`, `Reprojecting`, and `Preparing preview`. `completed`, `total`, and `unit` are omitted when a parser cannot expose honest progress; fake percentages are prohibited. Errors expose bounded application codes/messages and do not send parser stacks into UI text.

The repeated `start` type deliberately covers the two existing session operations (`read` and `prepare`) instead of creating a generic RPC protocol. No arbitrary method names or callable code cross the boundary.

### 16.5 Formats by execution surface

| Format/work | Worker | Main thread | Reason |
| --- | --- | --- | --- |
| CSV table/points | parse, chunk progress, inference, normalization, CRS, preview data | UI, validation, confirm/write | Largest measured main-thread path; Papa File streaming is available. |
| JSON table / GeoJSON | decode, JSON parse, normalize, CRS override, preview data | UI, validation, confirm/write | Native worker operations and transferable input. |
| XLSX | workbook parse, sheet inventory, selected-sheet grid, inference, preview data | sheet choice UI, validation, confirm/write | SheetJS ESM works in the worker. |
| zipped/loose Shapefile | safe ZIP work, shpjs parse, CRS decision/application, normalize, preview data | missing-PRJ choice UI, validation, confirm/write | shpjs and pure CRS modules work in the worker. |
| GeoPackage | open/inventory/extract/reproject/verify/close, preview data | layer choice UI, validation, confirm/write | Actual local bundle and WASM open successfully in the worker. |
| KML, KMZ, GPX | — initially | bounded XML/DOM parse, togeojson, normalize, preview | Worker DOMParser is unavailable; the approved direction permits this bounded path rather than adding an XML DOM dependency. Browser certification records timing and reopens design if representative inputs become unresponsive. |

KMZ continues to use safe local ZIP inspection and never fetches embedded/external resources. The XML path does not become an exception to transaction safety; it remains transient before Confirm.

### 16.6 Transfer and copy strategy

- CSV sends the `File` object to the worker so PapaParse's `FileStreamer` can read bounded chunks. The Blob/File backing store is structured-cloned by the platform; the application does not copy it into a main-thread text string or ArrayBuffer first.
- JSON/GeoJSON, XLSX, Shapefile components/archives, and GeoPackage use transferable ArrayBuffers. The client reads bytes asynchronously, posts them in the transfer list, and treats the detached buffers as worker-owned. The original `File` references remain available for an explicit retry.
- KML/GPX/KMZ remain on the main thread and do not cross the worker boundary.
- Normalized candidates return through one structured-clone `result`. Production contracts require ordinary nested arrays/objects on the main thread, so replacing this with a transferable JSON buffer would merely move decode/`JSON.parse` back into a blocking main-thread phase.
- The explicit `structuredClone` in `tableCandidate` is removed where the adapter/normalizer already created a worker-owned value. The `postMessage` result is the ownership copy.
- CSV delimiter detection and parsing become one PapaParse operation. Chunk results are appended without cloning every row for trailing-blank removal.
- `normalizeTableGrid` retains its pure API but tracks per-column inference state while validating cells, then constructs normalized rows directly. It does not create `dataRows` plus one temporary full column array per type inference.
- No `JSON.stringify` is used for worker transport, preview, or progress.

### 16.7 Progress, cancellation, and teardown

The worker emits a progress phase before expensive work. PapaParse chunk callbacks report real byte or row progress. Other parsers report phase transitions only unless their API exposes a trustworthy completed/total value.

Cancel is controlled by the main thread. `client.cancel(reason)` marks the request cancelled, posts the bounded cancel message for cooperative cleanup, immediately terminates the worker, rejects the outstanding promise with a stable cancellation error, and clears callbacks/references. Termination is the authority because a synchronous third-party parser cannot process an inbound cancel message until it yields. Cancel therefore remains operable even when worker code is busy.

The same idempotent `dispose(reason)` path runs after confirmed success, any worker error, Cancel/Escape, dialog close, project close, selecting replacement files, or replacing the active import session. A recoverable error means the UI may retry from its retained File references by creating a fresh worker; it never means retaining a failed worker realm. GeoPackage/result-set cleanup still runs in adapter `finally` blocks on normal completion; worker termination is the final resource boundary on cancellation.

After a prepared result is posted, large normalization intermediates and the worker's candidate reference are cleared. The worker may retain only the original File/source inventory and parser-specific state needed for another item/configuration while the dialog remains open. CSV reparses from the retained File when configuration changes rather than retaining both a full raw grid and normalized result. GeoPackage connections never remain open while the worker is idle. In this lifecycle, "success teardown" means confirmation or another dialog-closing completion; an idle worker after a preview result is still the explicitly owned active Workbench session and is terminated if that session ends.

### 16.8 Expected memory behavior

For the 20.43 MiB CSV, the design removes the full decoded main-thread string, the first complete delimiter-detection parse result, the cloned grid, the second row-array copy, per-column value arrays, and the explicit normalized-candidate clone. The worker still must hold parsed cell strings and construct the normalized production object, and the main thread ultimately receives one normalized candidate for production validation. Peak memory is therefore expected to be dominated by the source Blob backing, one raw worker representation during conversion, one normalized worker result during posting, and one main-thread normalized result after delivery—not by several deliberate duplicate representations.

Because browser GC and parser internals are nondeterministic, certification records `performance.memory` only as diagnostic evidence where available. It does not claim a universal byte ceiling. A repeated import/cancel loop must show that disposed workers disappear and heap use returns toward a stable band after forced navigation/ordinary GC opportunities; monotonic growth is a failure.

### 16.9 Revised 20 MiB acceptance procedure

The final browser gate regenerates the same 21,420,020-byte / 21,000-row CSV outside the committed fixture tree and removes it afterward. It runs in isolated headed Chromium at both approved viewports.

Measurements are independent:

1. **Throughput:** record cold first-run and three warm review-ready wall times plus worker phase timings. Report median/min/max. A 30–40 second result is an automatic stop. Any material regression from the corrected sub-second main-thread baseline must be attributed to parser load, transport, normalization, or result delivery before certification; worker responsiveness alone cannot excuse it.
2. **Responsiveness:** run a requestAnimationFrame gap sampler and Long Tasks observer on the main thread while importing. Progress must visibly advance, the Studio must repaint, and the main thread must have no frame gap above 250 ms during parsing/normalization. A large final-result delivery pause is measured separately and must also stay below 250 ms.
3. **Cancel:** start the same import, activate Cancel during parsing, and require dialog recovery plus worker termination within 250 ms. No result may arrive afterward and project revision, resources, manifest, Story, and history remain unchanged.
4. **Memory/teardown:** repeat import/cancel and import/success cycles, verify only one worker exists per active dialog, and verify termination on success, failure, Cancel, project close, and replacement.
5. **Correctness:** confirm the completed candidate still passes the existing production validator; repeat the EPSG:32648 CSV coordinate gate independently.

Vendor code remains absent from initial Studio loading. The worker lazily loads only the selected format's local parser. No worker, parser, WASM, or CRS request may target a CDN or network lookup.

## 17. Test and fixture design

Tests prove application conversion and production contracts, not complete upstream parser behavior or snapshots of third-party output.

### 17.1 Proposed test files

- `tests/editor-data-import.test.mjs` — detection, IDs, normalization, CRS, archive limits, and pure session behavior;
- `tests/editor-data-import-adapters.test.mjs` — actual parser fixtures for CSV, KML/KMZ, GPX, Shapefile, XLSX, and GeoPackage;
- `tests/editor-data-import-worker.test.mjs` — explicit protocol envelopes, stale-result rejection, transfer lists, progress, prompt termination, error mapping, and deterministic client disposal with a fake Worker plus real-browser parser probes;
- `tests/editor-data-workbench.test.mjs` — DOM workflow, bounded previews, no-before-confirm mutation, confirm, Cancel, and replacement;
- modify `tests/editor-zip-storage.test.mjs` — prove the shared ZIP helper preserves the certified project-package safety limits and behavior;
- modify `tests/editor-data-inspectors.test.mjs` — validated add/replace boundary and stable replacement path;
- modify `tests/editor-studio-preview.test.mjs` — Layers entry point, immediate layer/table refresh, and Scene visibility semantics;
- modify `tests/editor-rich-content-authoring.test.mjs` — imported table immediately available for Table/Chart insertion;
- retain `tests/editor-scene-commands.test.mjs` coverage for the reused project-layer command.

### 17.2 Exact fixture paths

- `tests/fixtures/data-import/utf8-table.csv`
- `tests/fixtures/data-import/quoted-comma.csv`
- `tests/fixtures/data-import/points-4326.csv`
- `tests/fixtures/data-import/points-32648.csv`
- `tests/fixtures/data-import/point.geojson`
- `tests/fixtures/data-import/line.geojson`
- `tests/fixtures/data-import/mixed.geojson`
- `tests/fixtures/data-import/mixed.kml`
- `tests/fixtures/data-import/route.gpx`
- `tests/fixtures/data-import/mixed.kmz`
- `tests/fixtures/data-import/shapefile-wgs84.zip`
- `tests/fixtures/data-import/shapefile-32648.zip`
- `tests/fixtures/data-import/shapefile-loose/points.shp`
- `tests/fixtures/data-import/shapefile-loose/points.dbf`
- `tests/fixtures/data-import/shapefile-loose/points.prj`
- `tests/fixtures/data-import/shapefile-loose/points.cpg`
- `tests/fixtures/data-import/tables.xlsx`
- `tests/fixtures/data-import/features.gpkg`
- `tests/fixtures/data-import/features-32648.gpkg`
- `tests/fixtures/data-import/normalized-table.json`
- `tests/fixtures/data-import/records.json`
- `tests/fixtures/data-import/malformed.json`
- `tests/fixtures/data-import/doctype.kml`
- `tests/fixtures/data-import/unsafe-path.zip`
- `tests/fixtures/data-import/unsupported.xyz`

Fixtures are tiny and authored specifically for these tests. `tables.xlsx` contains at least two sheets and date/integer/text cells. `features.gpkg` contains at least two feature tables plus a tile table where practical; `features-32648.gpkg` certifies projected SRS output. Shapefile ZIPs include DBF and PRJ. No large public dataset is added.

### 17.3 Required behavioral coverage

The 64 numbered acceptance behaviors in the approved prompt are test requirements. In particular:

- EPSG:32648 CSV output is compared to independently known WGS84 coordinates with `1e-7` degree tolerance (about one centimetre in latitude; comfortably above proj4 floating noise and below source-fixture precision);
- projected Shapefile and GeoPackage outputs are compared with separately calculated expected coordinates;
- Z is asserted unchanged while X/Y change;
- no network function is called during CRS resolution;
- GeoPackage result sets and connections are closed on success, error, Cancel, and source replacement;
- changing workbench options and preparing previews leave package revision, manifest, Story, and history unchanged;
- confirmation writes one resource/descriptor pair and spatial confirmation uses the existing Scene command;
- replacement retains exact ID/path and blocks incompatible geometry.
- worker `read`/`prepare` results remain transient, confirmation still crosses the production validator on the main thread, and the worker cannot receive mutation dependencies;
- Cancel terminates an in-flight parser promptly, ignores late messages, and leaves project/history/package state byte-for-byte unchanged;
- worker parser loading remains local/lazy and actual CSV, XLSX, Shapefile, GeoPackage/WASM, proj4, and pure normalizer operations execute in the classic-worker realm;
- the generated 20.43 MiB browser benchmark reports phase, throughput, frame-gap, long-task, cancellation, and teardown evidence without committing the large file.

## 18. Browser and visual certification

Implementation certification uses headed Edge/Chromium with an isolated profile at 1440x900 and 1366x768. It covers the approved workflows A–K: blank open/cancel, GeoJSON, KML, mixed KML, CSV table, critical CSV EPSG:32648 points, projected Shapefile ZIP, multi-sheet XLSX, multi-feature-table GeoPackage, replacement, and compact dialog layout.

Spatial rendering is checked in the one existing production map. Browser network inspection proves parser artifacts are absent from initial load and no parser CDN / EPSG lookup occurs. The application-origin console must have no new errors.

The worker certification additionally performs the section 16.9 benchmark. It records cold and warm throughput separately, captures actual progress transitions, proves Cancel remains clickable and terminates work, checks that no late result mutates UI/project state, and repeats success/cancel cycles to detect leaked worker realms or monotonically retained heap. KML/GPX/KMZ remain on the main thread only while their representative browser timing stays responsive; a material XML-path freeze is a new design stop gate rather than permission to add an XML dependency silently.

Bounded evidence is stored at:

- `review/map-story-studio-v1-2/data-workbench/01-add-data-empty.png`
- `review/map-story-studio-v1-2/data-workbench/02-csv-32648-preview.png`
- `review/map-story-studio-v1-2/data-workbench/03-gpkg-layer-chooser.png`
- `review/map-story-studio-v1-2/data-workbench/04-xlsx-table-preview.png`
- `review/map-story-studio-v1-2/data-workbench/05-imported-layer-studio.png`
- `review/map-story-studio-v1-2/data-workbench/06-compact-1366x768.png`
- `review/map-story-studio-v1-2/DATA-WORKBENCH.md`

## 19. Security certification

The implementation must prove:

- no new `eval(` or `new Function`;
- no authored JavaScript execution;
- no formula evaluation or macro execution;
- no authored SQL and no general database browser;
- no runtime parser CDN;
- no CRS network lookup;
- no KML NetworkLink or external-resource fetch;
- XML DOCTYPE rejected;
- encrypted/unsupported-compression archives rejected;
- archive traversal and duplicate normalized paths rejected;
- bounded archive entry count and expansion;
- no user/parser-controlled HTML inserted with `innerHTML`;
- no second MapLibre map.

## 20. Regression and freeze boundaries

Development uses focused affected suites. Before the single final `npm test`, the bounded regression set includes the new Data Workbench suites plus:

- `tests/editor-data-inspectors.test.mjs`
- `tests/editor-rich-content-authoring.test.mjs`
- `tests/editor-studio-preview.test.mjs`
- `tests/editor-scene-commands.test.mjs`
- `tests/editor-zip-storage.test.mjs`
- `tests/story-1.2-persistence.test.mjs`
- `tests/project-loader.test.mjs`
- `tests/generic-runtime-shell.test.mjs`

The final full suite runs once at the executable head and reports its actual count.

No full Route 61-2 settled-FPS benchmark is run because this slice remains editor-side. If implementation needs the production Scene runtime, MapLibre render loop, Route adapter, bus animation, or core Scene controller changed, work stops.

Freeze checks require:

- empty diff from the base for `data/schemas/story-1.2.schema.json`;
- empty diff from the base for `data/stories/route-61-2.story.json`;
- Route Story SHA-256 `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`;
- no material project-manifest schema change;
- no `src/map/geojson-renderer.js` change;
- `git diff --check origin/main...HEAD` passes.

## 21. Exact proposed file set

The implementation is limited to the following application, vendor, test, fixture, documentation, and evidence paths:

```text
editor/core/safe-zip.js
editor/storage/adapters.js
editor/import/vendor-loaders.js
editor/import/import-identifiers.js
editor/import/crs.js
editor/import/spatial-normalizer.js
editor/import/table-normalizer.js
editor/import/spatial-adapters.js
editor/import/table-adapters.js
editor/import/geopackage-adapter.js
editor/import/data-import.js
editor/import/data-import-worker.js
editor/import/data-import-worker-client.js
editor/ui/data-workbench.js
editor/ui/inspectors.js
editor/ui/studio-shell.js
editor/editor.js
editor/editor.css
vendor/data-import/THIRD-PARTY.md
vendor/data-import/togeojson/7.1.2/{togeojson.es.mjs,LICENSE}
vendor/data-import/shpjs/6.2.0/{shp.esm.min.js,LICENSE.md}
vendor/data-import/proj4/2.22.0/{proj4.js,LICENSE.md}
vendor/data-import/papaparse/5.7.0/{papaparse.min.js,LICENSE}
vendor/data-import/sheetjs/0.20.3/{xlsx.mjs,LICENSE}
vendor/data-import/geopackage/4.2.9/{geopackage.min.js,sql-wasm.wasm,geopackage.min.js.LICENSE.txt,LICENSE}
tests/editor-data-import.test.mjs
tests/editor-data-import-adapters.test.mjs
tests/editor-data-import-worker.test.mjs
tests/editor-data-workbench.test.mjs
tests/editor-zip-storage.test.mjs
tests/editor-data-inspectors.test.mjs
tests/editor-rich-content-authoring.test.mjs
tests/editor-studio-preview.test.mjs
tests/fixtures/data-import/**
review/map-story-studio-v1-2/DATA-WORKBENCH.md
review/map-story-studio-v1-2/data-workbench/*.png
docs/superpowers/specs/2026-09-01-map-story-studio-v1-2-data-workbench-design.md
docs/superpowers/plans/2026-09-01-map-story-studio-v1-2-data-workbench.md
```

The plan document, review report, and screenshots are created only after design approval during implementation/certification. A small fixture-generation helper may be added under `tests/fixtures/data-import/` only if binary fixture reproducibility requires it; that would be recorded as a plan-level file-list clarification, not application scope.

## 22. Non-goals

This slice does not add GeoTIFF, raster GIS layers, MBTiles, vector tiles, FlatGeobuf, GeoParquet, XLSM/XLSB/XLS/ODS, TCX, WKT/WKB columns, database connections, image crop/fill/pan/zoom, a media manager, fill extrusion, building-height mapping, generic 3D UI, geometry editing, a generic importer plugin framework, a generic worker manager/pool/scheduler, a second preview map, or cross-resource Undo.

It does not persist original source format/filename provenance. After confirmation the resource is intentionally ordinary GeoJSON or table-data-v1 JSON.

## 23. Deviations and open blockers

The original design deliberately omitted workers and required a browser stop gate. That gate was reported after a faulty 38.615-second measurement; the corrected application throughput is 0.745–1.009 seconds, but real profiling still found a 0.662–0.794 second main-thread long task. The user explicitly authorized this focused worker revision on 2026-09-02. No smaller main-thread file limit is adopted as the primary solution.

Version resolution filled the two intentionally unspecified pins with current verified releases:

- `proj4`: 2.22.0;
- `papaparse`: 5.7.0.

The candidate versions supplied in the prompt remain current for togeojson 7.1.2, shpjs 6.2.0, SheetJS CE 0.20.3, and GeoPackage 4.2.9.

Open design blockers: none.

No new dependency is required. Temporary design probes proved actual GeoPackage/WASM open/list/close, projected Shapefile parsing, XLSX sheet inventory, PapaParse, proj4, and pure normalizer loading inside the classic worker. Implementation still has mandatory production-adapter and projected-fixture gates; inability to reproduce those results through the final worker/client boundary is a stop condition, not grounds to fake support.

## 24. Approval gate

This revision is the focused worker-architecture design deliverable. No worker/client product code, worker tests, implementation-plan revision, final browser certification, push, or PR work resumes until the user explicitly approves it.

After approval, the next process step is `superpowers:writing-plans`, revising `docs/superpowers/plans/2026-09-01-map-story-studio-v1-2-data-workbench.md` with the worker tasks, followed by self-review and inline execution with TDD.
