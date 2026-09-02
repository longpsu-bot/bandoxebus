# Map Story Studio V1.2 — Overture PMTiles Context Design

**Status:** Approved design

**Date:** 2026-09-02

**Repository baseline:** `main@8ecd1608ae4ff7a6d2e3808ddab999391c8e4a9d`

**Design branch:** `feat/map-story-studio-v1-2-overture-pmtiles`

## 1. Purpose

Map Story Studio currently renders Route 61-2's Overture building context from a checked-in AOI-specific GeoJSON extract at `data/context/my-phuoc-1-buildings.geojson`. That model proved the 3D visual stack and performance, but it does not scale conveniently to a Story whose Scenes move across a wider geography: each new context area would require another preprocessing/extraction step and another packaged GeoJSON asset.

This design replaces per-Scene or per-area extraction as the authoring workflow with a reusable PMTiles-backed Overture building source. During authoring and exploration, Studio uses the official Overture global `buildings.pmtiles` archive for a project-pinned release. MapLibre requests only the tile ranges required by the current camera. A Scene therefore changes only camera and semantic context visibility; it does not own a building extract.

For durable publication, an old Story must not depend indefinitely on an official Overture release URL because Overture retains public monthly release data only for a limited period. A frozen/published project therefore uses one project-area PMTiles snapshot for the whole project, derived from the same pinned Overture release and served as a static project asset. This is one snapshot per project publication, never one extract per Scene.

The runtime rendering contract remains the same in both cases: MapLibre + PMTiles + HTTP range requests. Only the trusted PMTiles location changes.

## 2. Goals

1. Eliminate per-Scene Overture building extraction for ordinary Studio authoring and exploration.
2. Allow the same Overture building source to follow the camera across geographically separated Scenes.
3. Keep Overture release selection reproducible and explicit; do not use an implicit `latest` release.
4. Preserve Route 61-2 Story bytes, Story schemas, Project Manifest schema, and the existing semantic `urban-context-v1` action contract.
5. Keep one MapLibre instance and reuse the existing trusted urban-context capability lifecycle.
6. Use the existing MapLibre `fill-extrusion` renderer; do not reintroduce Three.js for Overture buildings.
7. Keep arbitrary remote URLs out of authored project data.
8. Preserve the current 1,299-building Mỹ Phước GeoJSON as an explicit A/B benchmark while the online path is certified.
9. Fail gracefully when online Overture data is unavailable; the Story must continue without silently substituting another provider.
10. Establish a publication path that remains usable after the official release URL expires without introducing a tile server, proxy, service worker, or per-Scene preprocessing.

## 3. Non-goals

This slice does not build:

- a generic remote-vector-resource type in `project.json`;
- arbitrary PMTiles URL authoring;
- a generic tile-provider/plugin framework;
- a Cloudflare Worker or other proxy for Overture;
- a server-side tile service;
- a service worker or custom persistent cache;
- generic polygon-to-3D authoring;
- `building_part` rendering;
- a generic 3D material editor;
- raster or terrain support;
- a new Story action type;
- a second MapLibre map;
- image crop/framing;
- an automatic Overture `latest` updater;
- replacement of existing Route 61-2 route-comparison behavior.

The design explicitly prefers the narrow Overture integration over a more general remote-source subsystem until another project demonstrates the need for one.

## 4. Locked source policy

### 4.1 Authoring and exploration

The default source is the official Overture global buildings PMTiles archive for a pinned release.

For the first certified implementation:

```text
release = 2026-08-19.0
archive = buildings.pmtiles
```

Trusted runtime code derives the official endpoint from the release. The author does not enter or edit the URL.

Conceptually:

```text
Studio project
  urban-context-v1
    buildingSource = overture-pmtiles
    overtureRelease = 2026-08-19.0

             ↓ trusted URL derivation

Official Overture buildings.pmtiles
             ↓ HTTP Range
PMTiles protocol
             ↓
MapLibre vector source
             ↓
current Scene camera
```

No Overture or PMTiles network request occurs during initial application startup when no Scene has activated urban context.

### 4.2 Local benchmark

The existing checked-in Mỹ Phước source remains available through an explicit trusted source mode:

```text
buildingSource = local-geojson
```

That mode uses the current processed collection and existing `render_height_m` / `render_min_height_m` behavior. It exists for A/B visual comparison and regression certification. It is not an automatic online failure fallback.

### 4.3 Frozen publication

Official Overture release URLs are not a durable archival publication mechanism. When a Story is frozen/published for long-term use, the target architecture is:

```text
pinned Overture release
        ↓
one project-area PMTiles snapshot
        ↓
static hosted project asset
        ↓ HTTP Range
same PMTiles runtime
        ↓
all Scenes in that project
```

The publication snapshot covers the complete bounded geographic area required by the project, not an individual Scene. Camera movement and Scene changes still determine which tiles are fetched at runtime.

The published snapshot records provenance including at minimum the Overture release, source theme, creation timestamp, geographic bounds, and snapshot artifact hash.

## 5. Implementation phases

The approved architecture is implemented in two sequential phases so runtime streaming and publication packaging are independently testable.

### Phase C1 — Remote Overture PMTiles runtime

C1 proves and ships:

- trusted Overture release configuration;
- official global PMTiles URL derivation;
- locally vendored PMTiles reader;
- lazy protocol/source initialization;
- building vector rendering across multiple camera locations;
- Studio capability settings for source and release;
- graceful remote-unavailable behavior;
- explicit local benchmark mode;
- Route 61-2 migration to online authoring mode after certification.

C1 does not generate publication snapshots.

### Phase C2 — Durable project-area PMTiles publication snapshot

C2 adds a build/export-time snapshot step that produces one project-area `buildings.pmtiles` asset from the pinned Overture release or an equivalent locally held Overture data pack. It then points the frozen publication at that static asset using the same PMTiles rendering seam certified in C1.

C2 must not change Scene semantics or introduce per-Scene extraction.

C1 is a complete, reviewable implementation slice on its own. C2 receives a separate implementation plan after C1 is certified.

## 6. Capability contract and project configuration

`urban-context-v1` remains the semantic capability. Existing actions remain unchanged:

```text
context.set-mode
  off
  industrial-context
```

Legacy `map.urban-context` normalization remains unchanged. The canonical Route 61-2 Story therefore requires no modification.

The Route 61-2 project capability declaration becomes conceptually:

```json
{
  "id": "urban-context-v1",
  "settings": {
    "adapter": "route-61-2-current",
    "buildingSource": "overture-pmtiles",
    "overtureRelease": "2026-08-19.0"
  }
}
```

The installed trusted capability descriptor owns validation for these settings.

`buildingSource` is an enum:

```text
overture-pmtiles
local-geojson
```

`overtureRelease` is a bounded release identifier, not a URL. It must match the exact release form accepted by trusted URL derivation. The first implementation need not expose an arbitrary release picker populated from the network; Studio may expose the configured value as a validated text/select field with the current certified release.

No Project Manifest schema change is required because capability settings are already validated by installed trusted descriptors.

## 7. Trusted URL derivation and network security

The runtime never consumes an author-provided PMTiles URL for Overture online mode. Trusted code builds the official Overture buildings archive location from the validated release.

The derived endpoint is structurally equivalent to:

```text
https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/
tiles/<RELEASE>/buildings.pmtiles
```

The exact host/path template belongs in one focused trusted module and must be unit-tested. The release value may not introduce path separators, schemes, query strings, fragments, traversal, percent-encoded path escape, or other URL mutation.

The online path does not weaken the existing project resource URL security model. No new general external resource kind is introduced.

PMTiles JavaScript is vendored locally. Only the Overture PMTiles data itself is remote in authoring mode.

## 8. PMTiles library boundary

Use a pinned PMTiles browser library, initially version 4.5.0, vendored under a dedicated directory such as:

```text
vendor/pmtiles/4.5.0/
```

Include provenance, license, version, upstream URL, and SHA-256 in the same style as the existing vendored data-import dependencies.

Do not load PMTiles JavaScript from a CDN.

A focused application module owns protocol registration. Conceptually it provides:

```text
ensurePmtilesProtocol(maplibregl)
deriveOvertureBuildingsPmtilesUrl(release)
createOverturePmtilesLayerDefinitions(config)
```

The exact names may be adjusted during implementation planning, but responsibilities must remain separated:

- trusted URL derivation;
- PMTiles protocol lifecycle;
- Overture source/layer definitions.

Protocol registration is idempotent. Repeated context activation, preview refresh, or adapter connection must not register duplicate protocol handlers.

## 9. Runtime lifecycle

### 9.1 Startup

Normal app/editor-preview startup must not initialize the Overture PMTiles source solely because `urban-context-v1` is declared.

Before the first context activation:

```text
PMTiles library: not loaded
PMTiles protocol: not registered by this project
Overture vector source: absent
Overture building layers: absent
Overture network requests: zero
```

### 9.2 First activation

When `context.set-mode = industrial-context` first becomes active in `overture-pmtiles` mode:

1. lazy-load the local PMTiles library;
2. ensure the PMTiles protocol is registered exactly once;
3. derive the trusted URL from the pinned release;
4. add one MapLibre vector source;
5. add the bounded building context layers;
6. allow MapLibre/PMTiles to request the tile ranges needed by the current camera;
7. update diagnostics when data begins rendering or when loading fails.

The map, Scene controller, compositor, and route runtime remain the existing instances.

### 9.3 Later Scene/camera changes

When the context remains active and a later Scene moves to another geographic area, no source reconstruction occurs. MapLibre and PMTiles fetch newly required tile ranges from the same archive.

### 9.4 Context off/on

Turning context off hides the context layers. It does not destroy the PMTiles source or protocol. Turning it on again reuses the existing source and cache state.

The source is removed only as part of the owning runtime/controller destruction lifecycle.

## 10. Shared Route 61-2 adapter boundary

Route 61-2 currently shares one trusted runtime adapter instance across `route-comparison-v1` and `urban-context-v1`. The adapter is keyed by the active MapLibre map. This reuse must remain intact.

Because either capability can connect first, urban-context settings must not be captured only during initial adapter construction. The adapter needs a bounded configuration seam so `urban-context-v1` can supply or update its own trusted context settings without changing route-comparison settings.

Conceptually:

```text
getRoute612RuntimeAdapter(context)
        ↓ shared adapter
route-comparison-v1 connects route concerns
urban-context-v1 configures urban-context concerns
```

The seam must reject configuration after destruction and must not permit arbitrary URL injection.

This is a compatibility seam, not a generic adapter configuration framework.

## 11. Overture building rendering policy

### 11.1 Source layers

Phase C1 renders the Overture `building` vector source layer only.

`building_part` is excluded from C1. It may be added later if real Story visual review demonstrates a need for richer building-part geometry.

### 11.2 Low zoom

At lower zoom, render a subdued flat building footprint context. It must not depend on properties only available in the full high-zoom Overture tag set.

The exact minimum zoom and transition point should be certified against the official tile profile; the design target is a 3D transition around zoom 14, where the full building property set is available.

### 11.3 3D zoom

At the detailed zoom range use MapLibre `fill-extrusion`.

Height evaluation is bounded and declarative:

```text
height
→ valid Overture height
→ valid num_floors × bounded storey height
→ conservative fixed fallback
```

Base evaluation:

```text
base
→ valid min_height
→ valid min_floor × bounded storey height
→ 0
```

Reject or clamp implausible values using bounded MapLibre expressions or trusted expression construction. Do not execute authored expressions and do not add a runtime tile transformation layer solely to recreate `render_height_m`.

The online styling should visually harmonize with the current Route 61-2 benchmark but does not need pixel-identical geometry/height because the old local preprocessing applied custom illustrative fallback heights based on footprint area.

## 12. Local benchmark behavior

`local-geojson` continues to use the current checked-in processed source:

```text
data/context/my-phuoc-1-buildings.geojson
```

Its current collection validation and processed height fields remain valid for benchmark mode.

Local benchmark mode must still report the certified 1,299 features for the existing fixture and preserve the established visual/performance evidence unless a separately reviewed benchmark change is required.

Online failure must not silently switch to this mode. Source selection is explicit and observable.

## 13. Studio UX

The existing installed capability Properties surface is extended rather than introducing another panel.

For Route 61-2 `urban-context-v1`, expose a compact author-facing group:

```text
Urban context

Building source
[ Overture online ]

Overture release
[ 2026-08-19.0 ]

Status
Online · pinned release
```

Alternative trusted source:

```text
Building source
[ Local benchmark ]
```

When online mode is selected, Advanced/technical information may display the derived archive endpoint as read-only text. The URL is never editable.

Do not add an online release-list fetch in C1. Do not mutate settings merely by opening Properties. Changes go through the existing validated capability settings mutation/history path.

Studio status should distinguish at least:

```text
not requested
loading
available
unavailable
local benchmark
```

This status is transient UI/runtime state, not serialized project metadata.

## 14. Failure behavior

If Overture online data cannot be loaded because of network failure, CORS, range-request incompatibility, expired release, malformed tile data, or other remote error:

- keep the Story runtime alive;
- keep routes, stops, text, charts, and other Scene content usable;
- do not throw an uncaught fatal project-load error merely because optional urban context is unavailable;
- hide/omit the failed Overture context;
- expose a clear bounded diagnostic in Studio/development UI;
- do not switch automatically to synthetic buildings;
- do not switch automatically to the local benchmark;
- do not invent a proxy, service worker, alternate provider, or download path.

If the configured pinned release has expired from the official authoring endpoint, the diagnostic must identify the configured release so the author can consciously update it or use a frozen project snapshot.

## 15. Performance and network acceptance

C1 certification requires real headed Chromium against the official Overture archive, not mocks alone.

The browser evidence must demonstrate:

1. zero Overture/PMTiles requests before first urban-context activation;
2. first activation at the current Mỹ Phước Scene renders remote Overture buildings;
3. official archive access uses bounded HTTP range/tile requests rather than downloading the whole archive;
4. moving to at least one geographically separated area renders buildings from the same configured source without changing project settings;
5. returning to the first area does not create a duplicate MapLibre source/layer/protocol;
6. context off/on reuses the installed source;
7. only one MapLibre instance exists;
8. no sustained main-thread task/frame gap above 250 ms attributable to application PMTiles integration;
9. settled Route 61-2 performance remains near the existing ~60 FPS benchmark and does not introduce a material sustained regression;
10. remote failure leaves the remainder of the Story interactive;
11. local benchmark mode still renders the current fixture.

Record for at least the initial Mỹ Phước activation and one distant camera jump:

- request count;
- transferred bytes where browser tooling exposes them reliably;
- archive host/path;
- whether requests include byte ranges;
- time to visible building context;
- worst observed main-thread/frame gap during activation;
- settled FPS after the context is loaded.

Do not invent memory or transfer metrics that the controlled browser environment cannot measure reliably.

## 16. Visual acceptance

A/B the current Mỹ Phước Scene at the established Route 61-2 camera:

- local processed benchmark;
- official online PMTiles source.

The goal is not pixel identity. The online result must instead satisfy product-quality criteria:

- industrial context reads as coherent 3D built form;
- buildings remain visually subordinate to route/story information;
- no obvious vertical spikes from malformed heights;
- no large visual holes caused by incorrect source-layer/filter assumptions;
- camera transitions do not reveal persistent tile/layer artifacts;
- flat-to-3D zoom behavior is visually intentional rather than abrupt/noisy;
- route lines, stops, POIs, labels, and presentation overlays retain their visual hierarchy.

Capture evidence at desktop Story dimensions and at the current 1366×768 compact review size when practical.

## 17. Migration sequence

C1 follows this order:

1. Add the PMTiles dependency boundary and trusted Overture URL derivation without changing Route 61-2 default source.
2. Add online layer definitions and lazy controller lifecycle behind explicit configuration.
3. Add capability settings and the shared-adapter configuration seam.
4. Keep Route 61-2 on `local-geojson` while unit/integration tests establish compatibility.
5. Run real Chromium online certification at Mỹ Phước.
6. Run the geographically separate camera certification.
7. Perform visual A/B and performance/network review.
8. Only after all gates pass, change Route 61-2 `project.json` to `buildingSource: overture-pmtiles` and pin `2026-08-19.0`.
9. Keep the local benchmark fixture checked in.
10. Open a Draft PR; do not merge until independent exact-head review.

## 18. Hard stop gates

Implementation stops for design review instead of expanding scope if any of these conditions occur:

- the official Overture S3 PMTiles archive cannot be consumed directly by deployed Chromium because of CORS or byte-range behavior;
- the official archive requires an application proxy;
- PMTiles integration requires replacing MapLibre or adding a bundler;
- the real source-layer/property contract materially contradicts the certified official tile profile;
- a normal Scene activation causes the browser to download the complete global archive;
- implementing online rendering requires a generic remote-resource schema change;
- online PMTiles needs a second MapLibre instance;
- the application integration creates a sustained >250 ms main-thread/frame stall in the certified scenario;
- settled performance materially regresses from the existing Route 61-2 benchmark;
- correct operation requires a custom service worker/cache framework;
- correct operation requires per-Scene geometry extraction.

If a stop gate fires, preserve the evidence and review architecture before continuing. Do not automatically add a Cloudflare Worker, proxy, server tile system, or local global-archive mirror.

## 19. File boundaries for Phase C1

Expected primary application changes:

```text
src/capabilities/urban-context-v1.js
src/overture-pmtiles.js                  new
src/overture-buildings.js
src/urban-context.js
src/route-61-2/runtime-adapter.js
project.json
vendor/pmtiles/4.5.0/...                 new
vendor/pmtiles/THIRD-PARTY.md            new or equivalent provenance record
```

Expected focused tests include:

```text
tests/overture-pmtiles.test.mjs          new
tests/overture-buildings.test.mjs
tests/urban-context.test.mjs
tests/route-61-2-runtime-adapter.test.mjs
tests/capability-descriptor.test.mjs or the existing descriptor-focused suite
tests/route-61-2-project.test.mjs
```

Browser/network certification may add one focused script/review evidence area. It must not introduce a browser-test framework if the existing browser-control approach is sufficient.

Do not modify unless concrete implementation evidence requires it:

```text
data/schemas/story-1.2.schema.json
data/schemas/project-manifest-v1.schema.json
data/stories/route-61-2.story.json
src/map/geojson-renderer.js
```

## 20. Freeze invariants

At the final executable C1 head:

- canonical Route 61-2 Story SHA-256 remains:
  `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`;
- Story 1.0 behavior remains compatible;
- Story 1.1 behavior remains compatible;
- Story 1.2 behavior remains compatible;
- Story 1.2 schema diff from baseline is empty;
- Project Manifest schema diff from baseline is empty;
- production generic GeoJSON renderer diff is empty unless an explicitly reviewed stop-gate decision changes scope;
- no second MapLibre map is constructed;
- Route comparison modes/reveal/POI/simulation behavior remain unchanged;
- full `npm test` runs once at the final executable head after focused/bounded development tests.

## 21. Phase C2 publication snapshot contract

C2 is intentionally deferred until C1 proves the runtime seam. Its approved contract is nevertheless fixed here so C1 does not design itself into a dead end.

A frozen project-area snapshot:

- contains Overture buildings for one bounded project area, not individual Scene AOIs;
- represents the same pinned Overture release used during authoring unless the author explicitly updates the release before freezing;
- is a PMTiles artifact suitable for HTTP range access;
- is stored/hosted as a project static asset or equivalent durable object;
- uses the same MapLibre PMTiles source/layer builder as C1;
- records provenance and artifact hash;
- can be generated from the user's already-held Overture regional data pack when that is the authoritative input;
- does not require a long-running tile server;
- does not change Story Scene semantics;
- does not require authors to extract data for each slide.

The C2 design must determine the project-area extent from project/story needs and/or an explicit publish extent. It must not silently package an unbounded global dataset.

## 22. Acceptance outcome

Phase C1 succeeds when this workflow is true:

```text
Open Route 61-2 Studio project
        ↓
no Overture request yet
        ↓
activate an urban-context Scene
        ↓
lazy-load local PMTiles reader
        ↓
stream visible buildings from pinned official Overture release
        ↓
move to another Scene/location
        ↓
stream that location from the same source
        ↓
no extraction, no new dataset, no second map
```

The long-term C1 + C2 architecture succeeds when authoring convenience and publication durability coexist:

```text
AUTHORING
official Overture release PMTiles
        ↓
any camera / any Scene

FREEZE / PUBLISH
one project-area PMTiles snapshot
        ↓
any camera / any Scene
```

The project never returns to a model where every slide needs its own Overture extract.
