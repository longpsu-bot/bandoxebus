# Map Story Studio V1.2 — Overture PMTiles C2 Durable Publication Snapshot Design

**Status:** Approved architecture; pending written-spec review

**Date:** 2026-09-03

**Repository baseline:** `main@88e6c4c88088b8170d8c592aab004e275b1b8fc2`

**Baseline tree:** `427ca7dc07b3889a8d250d013e21ff73c53ab684`

**Design branch:** `design/map-story-studio-v1-2-overture-pmtiles-c2`

## 1. Purpose

Map Story Studio V1.2 Phase C1 established a certified authoring/current-release Overture building path using the official pinned Overture global `buildings.pmtiles` archive, HTTP Range requests, vendored PMTiles JavaScript 4.5.0, one MapLibre vector source, one flat building layer below zoom 14, and one fill-extrusion building layer at zoom 14 and above.

That architecture is correct for authoring and current-release exploration, but the official Overture archive is not a durable publication source because releases are retained only for a limited period. A frozen Story must remain reproducible after its source release disappears.

Phase C2 therefore adds one durable project-area Overture PMTiles snapshot per frozen publication. The snapshot is derived from the same pinned Overture release, preserves the C1 tile/runtime semantics, covers the complete geographic area required by the published project, and is consumed through the same MapLibre + PMTiles rendering path.

C2 is a publication/freeze concern. It does not return to per-Scene extraction and does not change Story semantics.

## 2. Canonical baseline and C1 freeze

C2 starts from the exact integrated C1 baseline:

```text
main 88e6c4c88088b8170d8c592aab004e275b1b8fc2
tree 427ca7dc07b3889a8d250d013e21ff73c53ab684
```

C1 certification remains authoritative:

- full executable suite: `653/653`;
- canonical Route Story SHA-256: `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`;
- one MapLibre instance and one canvas;
- one PMTiles protocol;
- one Overture vector source;
- one flat building layer and one extrusion building layer;
- official authoring release: `2026-08-19.0`;
- no Overture request before first context activation;
- remote failure leaves Story and route usable;
- no synthetic or local silent fallback in online mode.

C2 must preserve those C1 behaviors unless this design explicitly states otherwise.

The existing local benchmark remains retained:

```text
data/context/my-phuoc-1-buildings.geojson
1,299 buildings
```

It is not removed by C2.

## 3. Goals

C2 must:

1. make a frozen/published project reproducible after the official Overture release disappears;
2. produce exactly one project-area Overture buildings PMTiles snapshot per frozen publication;
3. preserve Overture release semantics and tile payloads rather than retiling when direct extraction is available;
4. keep the runtime Story schema and canonical Route 61-2 Story unchanged;
5. keep one MapLibre instance, one PMTiles protocol, one source, and the same building renderer;
6. make camera movement stable and inexpensive by retaining the source and streaming only missing tile coverage;
7. support durable Folder, ZIP, and Cloudflare-hosted publication forms;
8. preserve Overture release/provenance metadata plus the exact frozen artifact hash;
9. integrate snapshot generation with Publish/Freeze rather than normal authoring;
10. remain deterministic and independently verifiable;
11. use mature upstream PMTiles tooling with custom code limited primarily to orchestration/glue.

## 4. Non-goals

C2 does not build:

- per-Scene or per-slide Overture extracts;
- a tile server;
- a proxy;
- a Cloudflare Worker;
- a service worker;
- a custom persistent tile cache;
- a custom PMTiles writer or tiler;
- arbitrary PMTiles URL authoring;
- a generic provider/plugin framework;
- a generic remote-vector-resource subsystem;
- `building_part` rendering;
- new Story actions;
- a second MapLibre map;
- automatic fallback from a frozen snapshot to official Overture, synthetic buildings, or the local benchmark;
- a speculative generic virtual filesystem.

## 5. Source-generation approaches

Three source-generation approaches were considered.

### 5.1 Approach A — Direct PMTiles subset extraction — selected

```text
official pinned Overture buildings.pmtiles
        ↓
pinned go-pmtiles extract
        ↓
one project-area buildings.pmtiles
```

This is the C2 default because it preserves the exact C1 tile product, minimizes transformation, uses mature tooling, and copies source tile payload bytes rather than recreating vector tiles.

### 5.2 Approach B — Exact retained source archive — supported fallback input

If an exact Overture `buildings.pmtiles` archive for the pinned release has already been retained locally, C2 may use that archive as the extraction input provided its identity is verified. The same extraction and verification contract applies.

This is not a requirement to retain the global archive during ordinary Studio use.

### 5.3 Approach C — Overture GeoParquet to Planetiler — contingency only

Rebuilding PMTiles from Overture GeoParquet with the official Overture/Planetiler pipeline is a credible contingency, but it retiles/re-encodes data and introduces profile/tool-version drift relative to the already-certified C1 tile product.

C2 V1 does not use this path unless direct extraction becomes impossible in a future Overture release model.

## 6. Project snapshot extent

### 6.1 Extent is a project publication property

The snapshot covers the complete geographic area required by the frozen project, never an individual Scene.

The Freeze planner determines which canonical Story states have urban context active after production normalization. It resolves the settled production camera for those states using the same production Story/runtime/focus behavior used by the application.

The proposed publication extent is the union of actual settled map viewport bounds for every context-active state at these fixed publication profiles:

```text
desktop/projector: 1920 × 1080
mobile:             390 × 844
```

Pitch, bearing, focus target behavior, shell padding, and fit/ease camera behavior are therefore accounted for through production MapLibre camera calculation rather than custom geographic approximations.

The extent planner is a planning step only. It does not create per-Scene extracts.

### 6.2 Review and enlargement

Studio/Freeze presents the proposed project extent before extraction. The author may enlarge it.

The author may not shrink the final extent below the union required by the context-active production cameras. A smaller override fails Freeze validation.

### 6.3 Published coverage guarantee

A frozen snapshot guarantees Overture context for all authored context-active Scene cameras included at Freeze time.

Arbitrary manual panning outside the frozen snapshot extent is not guaranteed to contain Overture buildings. The base map remains usable there.

### 6.4 One extraction

Regardless of how many Scenes contributed to extent derivation, Freeze performs exactly one extraction against the final project extent.

```text
context-active Scene viewport bounds
        ↓ union
one canonical project extent
        ↓
one pmtiles extract
        ↓
one project snapshot
```

## 7. Snapshot extraction semantics

C2 preserves source zoom/tile semantics.

The extractor must inherit the source archive minimum and maximum zoom unless a future separately approved design changes that rule.

C2 must not:

- lower the source max zoom to save space;
- simplify buildings;
- strip attributes;
- regenerate MVT;
- change the C1 source layer;
- recreate processed `render_height_m` fields.

The frozen renderer continues to use:

```text
source-layer: building
flat layer: z11 ≤ zoom < z14
3D extrusion: zoom ≥ z14
```

with the same trusted C1 height/base expressions and styling contract.

## 8. Manifest and resource model

C2 intentionally makes one narrow additive Project Manifest schema extension because an undeclared PMTiles file cannot safely round-trip through the existing Folder/ZIP package lifecycle.

The Project Manifest `schemaVersion` remains `1.0`; the schema document evolves additively within Project Manifest V1 so all existing V1 projects remain valid.

### 8.1 PMTiles asset kind

The existing `assets` registry becomes a discriminated union supporting existing images plus one PMTiles asset form.

Frozen project example:

```json
{
  "assets": {
    "overture-buildings-snapshot": {
      "type": "pmtiles",
      "src": "./assets/context/overture-buildings.pmtiles",
      "mediaType": "application/vnd.pmtiles",
      "required": true,
      "attribution": ["overture-maps"]
    }
  }
}
```

The PMTiles asset kind does not allow arbitrary executable or external URLs. Existing same-origin/package-relative resource-path security continues to apply.

### 8.2 Image behavior remains unchanged

Existing image assets remain unchanged. Studio image insert/catalog behavior must continue to show only image assets and must not present PMTiles resources as selectable images.

### 8.3 Capability source modes

The certified C1 enum is preserved and extended:

```text
overture-pmtiles
project-snapshot
local-geojson
```

`overture-pmtiles` remains the official pinned-release authoring/current-release mode.

`local-geojson` remains the explicit 1,299-building benchmark mode.

`project-snapshot` is the frozen publication mode.

### 8.4 Frozen snapshot settings

A frozen `urban-context-v1` declaration uses a bounded snapshot object. The final schema must require the following logical fields:

```json
{
  "adapter": "route-61-2-current",
  "buildingSource": "project-snapshot",
  "overtureRelease": "2026-08-19.0",
  "snapshot": {
    "asset": "overture-buildings-snapshot",
    "theme": "buildings",
    "bounds": [106.58, 11.10, 106.62, 11.15],
    "sha256": "<64 lowercase hex characters>",
    "byteLength": 12345678,
    "generator": "go-pmtiles",
    "generatorVersion": "1.31.2",
    "generatedAt": "2026-09-03T00:00:00Z",
    "sourceContentLength": 0,
    "sourceEtag": "<optional upstream identity>"
  }
}
```

`sourceContentLength` and `sourceEtag` are optional evidence fields because some valid sources may not expose them consistently. All other fields above are required in `project-snapshot` mode.

No URL is authored in the capability settings.

### 8.5 Asset-reference validation

When `buildingSource = project-snapshot`, the trusted capability must reject the project unless:

- `snapshot.asset` resolves to an existing declared asset;
- the asset type is exactly `pmtiles`;
- the asset media type is exactly `application/vnd.pmtiles`;
- the asset remains inside the package security boundary.

A missing or wrong-kind snapshot asset is a fatal frozen-project configuration error, not an online-context warning.

## 9. Authoring versus frozen publication state

Freeze produces a new frozen publication package. It does not convert the live authoring project in place.

```text
authoring project
buildingSource = overture-pmtiles
        ↓ Freeze
frozen publication copy
buildingSource = project-snapshot
```

The authoring project remains current-release capable so later edits, added Scenes, and camera changes do not accidentally author against yesterday's bounded snapshot.

The PMTiles snapshot therefore does not participate in ordinary authoring history/undo operations.

## 10. Physical package layout

The logical frozen project path is stable across Folder and ZIP forms:

```text
project/
├── project.json
├── data/
├── assets/
│   └── context/
│       └── overture-buildings.pmtiles
└── ...
```

The release is not embedded in the filename. Release identity belongs in structured metadata/provenance.

A re-freeze replaces the logical frozen asset in the newly generated publication package rather than accumulating release-named files.

## 11. Freeze execution ownership

Studio remains a static browser application. C2 must not implement PMTiles extraction/writing in browser JavaScript or invent a WASM tiler.

C2 V1 uses a small local publication orchestrator around the mature native Protomaps `pmtiles` CLI.

The local helper owns only:

- production validation orchestration;
- extent planning invocation;
- pinned-tool acquisition/verification;
- dry-run invocation;
- extraction invocation;
- PMTiles verification invocation;
- hashing/provenance;
- frozen package construction;
- final frozen-package validation.

It does not implement PMTiles internals, MVT encoding, simplification, tile serving, or caching.

## 12. Pinned extraction tool

C2 pins:

```text
go-pmtiles / pmtiles CLI
version 1.31.2
```

A small tool lock records official platform artifact names and expected SHA-256 values.

The repository does not vendor every native executable. The helper may obtain the official pinned release artifact when absent from its local tool cache, but it must verify its expected SHA-256 before execution.

C2 must reject:

- an unpinned `latest` tool;
- an arbitrary `pmtiles` executable found on `PATH` without identity verification;
- a mismatched downloaded binary.

## 13. Extraction configuration

C2 V1 pins this extraction behavior:

```text
input:           official trusted Overture buildings.pmtiles URL
                 derived from overtureRelease,
                 or an identity-verified exact retained archive
region:          canonical final project bbox
minzoom:         inherit source
maxzoom:         inherit source
downloadThreads: 4
overfetch:        0.05
```

The pinned `go-pmtiles v1.31.2` `extract` implementation supports `--dry-run`; C2 uses it as part of Freeze preflight.

## 14. Size guardrails

The current project ZIP security ceiling is 64 MiB per entry. C2 keeps that existing ceiling unchanged.

Snapshot classifications are:

```text
≤ 32 MiB   Healthy / recommended
32–64 MiB  Large / allowed with warning
> 64 MiB   Blocked in C2 V1
```

The hard limit applies to the resulting PMTiles artifact size, not transferred overfetch bytes.

If `--dry-run` predicts an artifact above 64 MiB, Freeze stops before downloading the full tile payload.

C2 does not increase current project ZIP limits unless later dogfooding proves a legitimate need.

## 15. Transactional Freeze pipeline

Freeze is transactional.

```text
1. require saved production-valid authoring Folder
2. derive/confirm final project extent
3. derive trusted source archive from overtureRelease
4. ensure pinned go-pmtiles 1.31.2
5. run pmtiles extract --dry-run
6. apply size guardrail
7. extract to temporary PMTiles path
8. run pmtiles verify
9. inspect header/metadata
10. compute PMTiles SHA-256
11. construct frozen manifest/package copy
12. validate frozen production package
13. commit final frozen output atomically
```

No final publication asset or manifest is committed before all validation succeeds.

### 15.1 Temporary output

Extraction writes to a temporary work location, never directly to the final publication path.

On failure, temporary output is discarded.

### 15.2 Failure atomicity

If any of these occur:

- source release unavailable;
- network failure;
- extraction failure;
- PMTiles verification failure;
- size limit exceeded;
- hash/provenance failure;
- frozen project validation failure;

then:

```text
authoring project unchanged
previous frozen publication unchanged
no project-snapshot manifest points to a missing artifact
```

## 16. PMTiles verification and provenance

After extraction C2 must:

1. run `pmtiles verify`;
2. inspect the PMTiles header;
3. require MVT tile semantics compatible with the C1 renderer;
4. verify the snapshot bounds/zoom range are compatible with the requested extent and source;
5. preserve source archive metadata;
6. compute SHA-256 over final PMTiles bytes;
7. record artifact byte length and generator identity;
8. record the pinned Overture release and buildings theme;
9. record upstream `ETag` and source content length when available.

The extractor copies source PMTiles metadata and tile payload bytes while rewriting the subset archive directory/header. C2 must not inject `generatedAt` or other publication-specific data into the PMTiles file itself.

Publication provenance belongs in the frozen project manifest around the artifact so it does not perturb snapshot bytes.

## 17. Determinism

C2 defines deterministic snapshot generation as:

> Given the same exact source PMTiles archive, canonical final bbox, pinned `go-pmtiles` version, and fixed extraction options, Freeze produces byte-identical PMTiles output.

Certification must generate the same snapshot twice from a clean state and require identical SHA-256 values.

The extractor may download ranges concurrently, but destination offsets and final archive layout are deterministic. Concurrency must not affect the resulting bytes.

At least one certification cycle should compare Windows and Linux output for the same source/extent when practical because the main authoring environment is Windows while CI commonly runs Linux.

## 18. Re-freeze and reuse

A snapshot generation identity is defined by:

```text
Overture release
+ exact source archive identity when known
+ canonical final extent
+ generator name/version
+ fixed extraction options
```

If an already-generated verified snapshot with matching identity is available, the publication helper may reuse it.

This is artifact reuse only. It is not a custom cache framework.

Any change to release, extent, tool version, or extraction contract requires a new extraction and new artifact hash.

## 19. Runtime archive-binding seam

The renderer must not branch by hosting environment.

Trusted C2 runtime resolves one PMTiles archive binding:

```text
urban-context-v1
        ↓
resolve archive binding
        ├── overture-pmtiles
        │      ↓
        │   official URL / FetchSource
        │
        └── project-snapshot
               ↓
          declared PMTiles asset
               ↓
        remote URL / FetchSource
              OR
          local File / FileSource
               ↓
             PMTiles
               ↓
          same protocol
               ↓
          same MapLibre source/layers
```

There must not be separate official, R2, Folder, or ZIP building renderers.

## 20. Remote authoring binding

`overture-pmtiles` remains the C1 trusted official source mode.

The host, release path template, and `buildings.pmtiles` name remain constants in trusted code. The author supplies only the validated release identifier.

No request occurs before first context activation.

## 21. Remote frozen publication binding

A frozen project still authors the PMTiles asset as the package-relative path:

```text
./assets/context/overture-buildings.pmtiles
```

For hosted publication the deployment layer maps that declared PMTiles asset to an immutable R2 object. The hosted object path is content-addressed:

```text
projects/<project-id>/<snapshot-sha256>/overture-buildings.pmtiles
```

The R2 URL is deployment infrastructure and is not serialized as an author-editable capability URL.

The existing production `resolveAssetUrl` transport seam is the trusted place to supply hosted asset resolution. A deployment-specific resolver may map only declared PMTiles assets to their immutable hosted objects.

## 22. Cloudflare hosting contract

Cloudflare Pages hosts the application/runtime and ordinary project assets.

Cloudflare Pages must not host the PMTiles snapshot itself because Pages static assets do not provide the `206 Partial Content` byte-range behavior required for efficient PMTiles streaming.

Cloudflare R2 hosts the immutable PMTiles snapshot.

```text
Cloudflare Pages
├── runtime/application
├── project.json
├── Story/data
├── GeoJSON
├── images
└── ordinary assets

Cloudflare R2
└── projects/<project-id>/<sha256>/overture-buildings.pmtiles
```

There is no Worker, proxy, or tile server between MapLibre and R2.

The R2 bucket/custom-domain CORS configuration must allow the Pages publication origin and Range-capable `GET`/`HEAD` access required by PMTiles. Relevant response headers including `Content-Range`, `Content-Length`, and `ETag` must be available to the browser as required by the client/runtime verification path.

Hosted publication is not considered certified until an explicit Range probe returns valid HTTP `206` behavior.

## 23. Local Folder binding and lazy bytes

Current Folder Open eagerly materializes every declared resource with `file.arrayBuffer()`. C2 must not do that for declared PMTiles assets.

A declared PMTiles asset opened from a Folder remains backed by the browser `File`/file handle until an operation explicitly needs full bytes.

```text
Folder Open
PMTiles full arrayBuffer read: zero
PMTiles protocol initialization: none
```

On first context activation the local preview/runtime constructs upstream PMTiles `FileSource` from the browser `File`; random reads are performed by upstream `File.slice()` behavior.

C2 does not implement its own random-access file reader.

Normal JSON/GeoJSON/image package entries retain their existing byte-backed behavior.

## 24. Folder Save behavior

Unrelated edits to a frozen Folder project must not rewrite the PMTiles snapshot.

For example, editing a title, paragraph, or Story Scene then saving must write only the actual changed managed entries. The unchanged PMTiles asset remains untouched.

The existing resource-first, `project.json`-last Folder write ordering remains the persistence safety rule.

## 25. ZIP binding

A frozen ZIP contains the same logical file:

```text
assets/context/overture-buildings.pmtiles
```

ZIP import already materializes/decompresses entries under explicit security ceilings. C2 accepts that import cost for V1 because the PMTiles entry is bounded to at most 64 MiB.

For runtime rendering, the imported PMTiles bytes are exposed as a browser `File`/Blob compatible with upstream `FileSource`. Rendering therefore retains PMTiles random-access semantics and does not emulate HTTP Range requests in application code.

The ZIP round-trip must preserve the PMTiles bytes exactly.

## 26. Studio preview transport

The existing Studio preview resolver currently supports Blob URLs for declared images only. C2 must not force PMTiles through that image-specific URL path.

The production transport gains one narrow optional seam conceptually equivalent to:

```text
resolvePmtilesAssetSource(assetResource)
```

Behavior:

- normal hosted production: seam absent; runtime uses resolved asset URL with PMTiles `FetchSource`;
- Folder/ZIP Studio preview: seam returns upstream `FileSource` for the declared PMTiles asset.

This seam is transport-only. It does not change authored project data or Story semantics.

The existing production composition remains shared; preview and normal output still call the same production application/bootstrap path.

## 27. Protocol and source ownership

C1 process-lifetime/idempotent PMTiles protocol ownership remains.

C2 must preserve:

```text
MapLibre maps:       1
map canvases:        1
PMTiles protocols:   1
building sources:    1
flat layers:         1
extrusion layers:    1
```

For a local `FileSource`, a PMTiles instance may be registered with the existing protocol through upstream `Protocol.add()` or equivalent supported PMTiles 4.5.0 API.

Local runtime identity must include the snapshot SHA or another collision-safe internal key so two different snapshot bytes cannot collide merely because both use the logical filename `overture-buildings.pmtiles`.

That identity is runtime-internal and is never authored.

## 28. Rendering stability and camera behavior

Overture context is a persistent streamed map source, not a Scene render artifact.

### 28.1 First activation

C2 should avoid significant building-tile payload work for transient camera positions during the first context Scene transition where feasible.

Cheap initialization such as loading the local PMTiles library and ensuring protocol registration may overlap the Scene transition, but expensive visible building-tile loading should target the settled destination camera rather than intermediate frames.

This optimization must not change Story action order or canonical Story bytes.

### 28.2 Context off/on

Turning urban context off hides layers; it does not destroy the PMTiles source/protocol/archive binding.

Turning it on again reuses the existing source.

### 28.3 Pan, bearing, pitch, zoom

Camera interaction may legitimately request missing tile coverage, especially when rotation or pitch exposes previously unseen viewport corners.

Camera interaction must never recreate the MapLibre map, PMTiles protocol, Overture source, or building layers.

Warm revisits should reuse MapLibre's normal live-session tile cache where available.

### 28.4 No custom cache

Cache ownership remains:

```text
PMTiles     → archive header/directory knowledge
MapLibre    → visible/recent vector tiles
browser/CDN → normal transport caching
Studio      → no custom tile cache
```

C2 must not depend on browser Range caching for correctness.

## 29. Snapshot bounds at runtime

The final snapshot bounds are recorded in both the PMTiles header and frozen snapshot metadata.

The trusted project-snapshot MapLibre source must use those bounds so MapLibre does not request Overture tiles outside the frozen coverage where the source contract supports explicit bounds.

Manual panning outside the snapshot keeps the base map and Story usable; the Overture layer simply has no coverage there.

No provider fallback occurs.

## 30. Runtime status and failure semantics

Existing user-facing status categories remain:

```text
Not requested
Loading
Available
Unavailable
Local benchmark
```

Source identity is reported separately:

```text
overture-pmtiles
project-snapshot
local-geojson
```

A UI may therefore present, for example:

```text
Available · Project snapshot
Release 2026-08-19.0
```

If a frozen R2/object source is unavailable:

- Story remains usable;
- route/stops/text/charts remain usable;
- urban context becomes `Unavailable`;
- diagnostics identify `project-snapshot`, release, and bounded failure category;
- runtime does not fall back to official Overture;
- runtime does not fall back to local GeoJSON;
- runtime does not fall back to synthetic buildings.

A frozen publication must never silently escape its frozen dataset.

## 31. Overture attribution and licensing

The frozen artifact remains Overture Buildings data.

The frozen project must preserve an attribution declaration identifying at minimum:

```text
Overture Maps Foundation — Buildings
ODbL-1.0
pinned Overture release
```

The project should reference Overture's official attribution guidance for contributing-source details rather than duplicating a custom contributor rules engine.

Source PMTiles metadata remains preserved in the extracted archive.

## 32. Certification matrix

C2 is complete only after all categories below pass.

### 32.1 Snapshot generation

- one project extent derived and recorded;
- exactly one snapshot extraction;
- no per-Scene extract artifacts;
- `pmtiles verify` passes;
- resulting PMTiles is at most 64 MiB;
- Overture source metadata is retained;
- artifact SHA-256 recorded;
- two identical clean freezes produce identical PMTiles SHA-256.

### 32.2 Story/runtime freeze

- canonical Route Story SHA remains `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`;
- Story schemas unchanged;
- generic Story renderer unchanged;
- existing Story 1.0 / 1.1 / 1.2 loading remains passing;
- intentional Project Manifest change is limited to the additive PMTiles asset variant and the trusted capability snapshot settings.

### 32.3 C1 authoring regression

Re-run the certified official-source behavior:

- zero Overture request before first activation;
- HTTP Range/206 against official archive;
- multi-location camera movement;
- one map/canvas/protocol/source/layer set;
- graceful failure;
- no fallback.

### 32.4 Frozen Folder

- Folder Open does not call full `arrayBuffer()` for the PMTiles asset;
- no PMTiles source activity before context activation;
- first activation uses upstream FileSource slicing;
- context off/on reuses the same archive/source;
- unrelated Save leaves PMTiles bytes untouched.

### 32.5 Frozen ZIP

- frozen Folder exports to ZIP;
- ZIP imports successfully;
- production validation passes;
- project snapshot renders;
- PMTiles SHA before ZIP equals PMTiles SHA after ZIP round-trip.

### 32.6 Hosted R2 publication

- Pages application loads frozen project;
- PMTiles asset resolves to immutable R2 object;
- explicit `Range: bytes=0-16383` probe returns HTTP 206;
- `Content-Range` is valid;
- returned byte count is correct;
- PMTiles header is valid;
- no official Overture request occurs in project-snapshot mode;
- no Worker, proxy, service worker, or tile server is involved.

### 32.7 Camera stability

At a settled context location, certify:

- 360° bearing sweep;
- pitch sweep from 0° through the target presentation pitch and back;
- bounded pan away and back;
- Scene A → Scene B → Scene A.

Throughout those tests require:

```text
maps:       1
canvases:   1
protocols:  1
sources:    1
flat:       1
extrusion:  1
```

Additional reads are allowed only for genuinely missing tile coverage or normal MapLibre cache eviction; repeated source/layer/protocol installation is forbidden.

### 32.8 Performance

Preserve C1 hard performance guardrails:

```text
settled FPS approximately 60
worst attributable activation frame/task gap < 250 ms
```

Record, but do not pre-invent fixed byte ceilings for:

- first project-snapshot activation requests/bytes;
- warm bearing sweep requests/bytes;
- warm pitch sweep requests/bytes;
- Scene A → B requests/bytes;
- Scene B → A requests/bytes.

The project snapshot path must not be materially more expensive than the same C1 official-source camera sequence.

## 33. Final architecture

```text
AUTHORING / EXPLORATION

Studio static browser
        ↓
official pinned Overture buildings.pmtiles
        ↓ HTTP Range
PMTiles 4.5.0
        ↓
one MapLibre source/layer set


PUBLISH / FREEZE

saved production-valid project Folder
        ↓
production extent planner
        ↓
one final project bbox
        ↓
pinned go-pmtiles 1.31.2
   dry-run → extract → verify
        ↓
one project-area buildings.pmtiles
        ↓
SHA-256 + provenance
        ↓
new frozen publication package
buildingSource = project-snapshot


LOCAL FROZEN OUTPUT

Folder / ZIP
        ↓
FileSource
        ↓
PMTiles 4.5.0
        ↓
same MapLibre renderer


HOSTED FROZEN OUTPUT

Cloudflare Pages: application/project
Cloudflare R2: immutable snapshot object
        ↓ HTTP Range / 206
FetchSource
        ↓
PMTiles 4.5.0
        ↓
same MapLibre renderer
```

## 34. Locked prohibitions

C2 must not introduce:

```text
per-Scene extraction
tile server
proxy
Cloudflare Worker
service worker
custom tile cache
custom tiler
arbitrary PMTiles URL authoring
second MapLibre map
silent provider fallback
in-place conversion of the live authoring project into frozen mode
```

## 35. Relationship to V1.2 roadmap

C2 completes only the durable Overture publication snapshot slice.

The wider V1.2 roadmap remains:

```text
✓ Canvas Manipulation V2
✓ Data Workbench V2
✓ Overture PMTiles C1
→ Overture PMTiles C2 durable publication snapshot
□ Image Fit / Fill / Crop
□ full Route 61-2 Studio dogfood
□ fix only dogfooding-observed friction
```

C2 must not absorb Image Fit/Fill/Crop or speculative dogfooding improvements.

## 36. Design approval boundary

This document records the approved C2 architecture only.

No implementation code is authorized by this design document alone. After written-spec review and approval, the next workflow step is a separate implementation plan using the Superpowers writing-plans process.
