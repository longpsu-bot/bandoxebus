# Map Story Studio V1.2 — Overture PMTiles Context Design

**Status:** Approved design

**Date:** 2026-09-02

**Repository baseline:** `main@8ecd1608ae4ff7a6d2e3808ddab999391c8e4a9d`

**Design branch:** `feat/map-story-studio-v1-2-overture-pmtiles`

## 1. Purpose

Map Story Studio currently renders Route 61-2's Overture building context from a checked-in AOI-specific GeoJSON extract at `data/context/my-phuoc-1-buildings.geojson`. That model proved the 3D visual stack and performance, but it does not scale conveniently to a Story whose Scenes move across a wider geography: each new context area would require another preprocessing/extraction step and another packaged GeoJSON asset.

This design replaces per-Scene or per-area extraction as the authoring workflow with a reusable PMTiles-backed Overture building source. During authoring and exploration, Studio uses the official Overture global `buildings.pmtiles` archive for a project-pinned release. MapLibre requests only the tile ranges required by the current camera. A Scene therefore changes only camera and semantic context visibility; it does not own a building extract.

Official Overture public data releases are retained for a maximum of 60 days, approximately the latest two monthly releases. Therefore an old Story cannot depend indefinitely on an official release URL. A frozen/published project uses one project-area PMTiles snapshot for the whole project, derived from the same pinned Overture release and served as a static project asset. This is one snapshot per project publication, never one extract per Scene.

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

Official Overture release URLs are not a durable archival publication mechanism because public release files are automatically removed after the retention window. When a Story is frozen/published for long-term use, the target architecture is:

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

A C1 project using the official Overture URL is an authoring/current-release deployment, not an archival publication. A Story must not be declared durably frozen until C2 has produced the project-area snapshot.

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
- Route 61-2 migration to online current-release mode after certification.

C1 does not generate publication snapshots and must not be presented as the archival publication solution.

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

The Route 61-2 project capability declaration becomes:

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

`buildingSource` is exactly one of:

```text
overture-pmtiles
local-geojson
```

`overtureRelease` is a bounded release identifier, not a URL. In C1 it must match:

```text
^[0-9]{4}-[0-9]{2}-[0-9]{2}\.0$
```

This syntactic validation is not a claim that every matching release is still publicly available. Availability is a runtime condition because of Overture's retention policy.

Studio does not fetch an online release catalog in C1. It exposes the configured release through the existing trusted capability settings UI, with `2026-08-19.0` as the certified initial value.

No Project Manifest schema change is required because capability settings are already validated by installed trusted descriptors.

## 7. Trusted URL derivation and network security

The runtime never consumes an author-provided PMTiles URL for Overture online mode. Trusted code builds the official Overture buildings archive location from the validated release.

The exact C1 HTTP template is:

```text
https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/<RELEASE>/buildings.pmtiles
```

The host, theme name, and path structure are constants in trusted code. Only `<RELEASE>` is substituted after descriptor validation. The release value may not introduce path separators, schemes, query strings, fragments, traversal, percent-encoded path escape, or other URL mutation.

The online path does not weaken the existing project resource URL security model. No new general external resource kind is introduced.

PMTiles JavaScript is vendored locally. Only the Overture PMTiles data itself is remote in authoring/current-release mode.

## 8. PMTiles library boundary

Use PMTiles JavaScript version `4.5.0`, vendored under:

```text
vendor/pmtiles/4.5.0/
```

Include provenance, BSD-3-Clause license, exact version, upstream artifact URL, and SHA-256 in the same style as the existing vendored data-import dependencies.

Do not load PMTiles JavaScript from a CDN.

A focused application module owns protocol registration and Overture PMTiles layer construction. The implementation plan must lock exact exported names, but responsibilities are fixed:

- trusted Overture buildings URL derivation;
- lazy PMTiles library loading;
- idempotent `pmtiles://` protocol registration;
- online Overture vector source definition;
- online flat/3D layer definitions.

Protocol registration is idempotent. Repeated context activation, preview refresh, or adapter connection must not register duplicate protocol handlers.

## 9. Runtime lifecycle

### 9.1 Startup

Normal app/editor-preview startup must not initialize the Overture PMTiles source solely because `urban-context-v1` is declared.

Before the first context activation in online mode:

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

The source is removed only as part of the owning runtime/controller destruction lifecycle. Protocol ownership must not remove a globally shared PMTiles protocol while another live MapLibre runtime still depends on it; the implementation plan must use either process-lifetime registration or reference-counted teardown, preferring process-lifetime registration unless the existing MapLibre lifecycle demands otherwise.

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

### 11.1 Source layer

Phase C1 renders only the Overture vector source layer named:

```text
building
```

The official Overture buildings tile profile preserves the original source-layer name and adds the full property/tag set at zoom 14.

`building_part` is excluded from C1. It may be added later only if real Story visual review demonstrates a need for richer building-part geometry.

### 11.2 Flat context layer

Create one subdued flat fill layer for any `building` features present below the detailed zoom threshold:

```text
minzoom: 11
maxzoom: 14
fill-color: #748a9c
fill-opacity: 0.14
```

The layer must not filter on high-zoom properties; lower-zoom Overture tiles may retain only larger geometries and may omit full tags.

### 11.3 3D context layer

Create one MapLibre `fill-extrusion` layer:

```text
minzoom: 14
fill-extrusion-color: #8298aa
fill-extrusion-opacity: 0.78
fill-extrusion-vertical-gradient: true
```

Use a trusted MapLibre expression with the following exact bounded height policy:

```text
if numeric height > 0 and <= 300 m:
    height = height
else if numeric num_floors > 0 and <= 80:
    height = num_floors * 3.5 m
else:
    height = 8.5 m
```

Use the following exact base policy:

```text
if numeric min_height >= 0 and min_height < final height:
    base = min_height
else if numeric min_floor >= 0 and min_floor <= 80 and min_floor * 3.5 < final height:
    base = min_floor * 3.5 m
else:
    base = 0
```

All conversion is declarative/trusted; no authored expression is accepted. Do not add a runtime tile transformation layer solely to recreate `render_height_m`.

The online styling visually harmonizes with the current Route 61-2 benchmark but is not required to be pixel-identical because the old local preprocessing applied custom illustrative fallback heights based on footprint area.

## 12. Local benchmark behavior

`local-geojson` continues to use the current checked-in processed source:

```text
data/context/my-phuoc-1-buildings.geojson
```

Its current collection validation and processed height fields remain valid for benchmark mode.

Local benchmark mode must still report exactly 1,299 features for the existing fixture and preserve the established benchmark semantics.

Online failure must not silently switch to this mode. Source selection is explicit and observable.

## 13. Studio UX

The existing installed capability Properties surface is extended rather than introducing another panel.

For Route 61-2 `urban-context-v1`, expose:

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

When online mode is selected, Advanced/technical information displays the derived archive endpoint as read-only text. The URL is never editable.

Do not add an online release-list fetch in C1. Do not mutate settings merely by opening Properties. Changes go through the existing validated capability settings mutation/history path.

Studio status distinguishes exactly these user-facing states in C1:

```text
Not requested
Loading
Available
Unavailable
Local benchmark
```

This status is transient UI/runtime state, not serialized project metadata.

## 14. Failure behavior

If Overture online data cannot be loaded because of network failure, CORS, range-request incompatibility, expired release, malformed tile data, or other remote error:

- keep the Story runtime alive;
- keep routes, stops, text, charts, and other Scene content usable;
- do not throw an uncaught fatal project-load error merely because optional urban context is unavailable;
- hide/omit the failed Overture context;
- set runtime/Studio status to `Unavailable`;
- expose a bounded diagnostic including the configured release and failure category;
- do not switch automatically to synthetic buildings;
- do not switch automatically to the local benchmark;
- do not invent a proxy, service worker, alternate provider, or download path.

If the configured pinned release has expired from the official authoring endpoint, the diagnostic identifies that release so the author can consciously update it or use a frozen project snapshot.

## 15. Performance and network acceptance

C1 certification requires real headed Chromium against the official Overture archive, not mocks alone.

The browser evidence must demonstrate:

1. zero Overture/PMTiles requests before first urban-context activation;
2. first activation at the current Mỹ Phước Scene renders remote Overture buildings;
3. official archive access uses bounded HTTP range requests rather than downloading the whole archive;
4. moving to at least one geographically separated area renders buildings from the same configured source without changing project settings;
5. returning to the first area does not create a duplicate MapLibre source/layer/protocol;
6. context off/on reuses the installed source;
7. only one MapLibre instance exists;
8. no application-attributable main-thread task or frame gap exceeds 250 ms during PMTiles activation in the certified browser run;
9. on the same browser/device and camera, settled online-context average FPS does not regress by more than 10% from the immediately measured local-GeoJSON benchmark;
10. remote failure leaves the remainder of the Story interactive;
11. local benchmark mode still renders the current fixture.

For the range-request gate, browser network evidence must show at least one request to the configured `buildings.pmtiles` archive carrying a byte `Range` request and/or a `206 Partial Content` response. If the controlled browser surface cannot expose either fact, certification stops rather than inferring range behavior from small transfer size alone.

Record for at least the initial Mỹ Phước activation and one geographically separate camera jump:

- request count;
- transferred bytes where browser tooling exposes them reliably;
- archive host/path;
- observed Range/206 evidence;
- time from context activation to visible building context;
- worst observed main-thread task/frame gap during activation;
- settled FPS after the context is loaded.

Do not invent memory or transfer metrics that the controlled browser environment cannot measure reliably.

## 16. Visual acceptance

A/B the current Mỹ Phước Scene at the same camera and browser/device:

- local processed benchmark;
- official online PMTiles source.

The goal is not pixel identity. The online result must satisfy these product criteria:

- industrial context reads as coherent 3D built form;
- buildings remain visually subordinate to route/story information;
- no obvious vertical spikes from malformed heights;
- no large visual holes caused by incorrect source-layer/filter assumptions;
- camera transitions do not reveal persistent tile/layer artifacts;
- the flat-to-3D transition at zoom 14 is visually intentional rather than noisy;
- route lines, stops, POIs, labels, and presentation overlays retain their visual hierarchy.

Capture evidence at the current desktop Story review size and at 1366×768. If a visual defect requires changing the locked color/opacity constants, stop and review that bounded visual change rather than silently broadening the renderer vocabulary.

## 17. Migration sequence

C1 follows this order:

1. Add the PMTiles dependency boundary and trusted Overture URL derivation without changing Route 61-2 default source.
2. Add online layer definitions and lazy controller lifecycle behind explicit configuration.
3. Add capability settings and the shared-adapter configuration seam.
4. Keep Route 61-2 on `local-geojson` while unit/integration tests establish compatibility.
5. Run real Chromium online certification at Mỹ Phước.
6. Run the geographically separate camera certification.
7. Perform visual A/B and performance/network review.
8. Only after all C1 gates pass, change Route 61-2 `project.json` to `buildingSource: overture-pmtiles` and pin `2026-08-19.0`.
9. Keep the local benchmark fixture checked in.
10. Open a Draft PR; do not merge until independent exact-head review.

A C1 Cloudflare/current-release deployment is allowed for authoring and review, but it must be labeled operationally as dependent on the current Overture retention window. Durable publication requires C2.

## 18. Hard stop gates

Implementation stops for design review instead of expanding scope if any of these conditions occur:

- the official Overture S3 PMTiles archive cannot be consumed directly by deployed Chromium because of CORS or byte-range behavior;
- the official archive requires an application proxy;
- PMTiles integration requires replacing MapLibre or adding a bundler;
- the real source-layer/property contract materially contradicts the official tile profile used by this design;
- a normal Scene activation causes the browser to download the complete global archive;
- implementing online rendering requires a generic remote-resource schema change;
- online PMTiles needs a second MapLibre instance;
- an application-attributable main-thread task/frame gap exceeds 250 ms during the certified activation scenario;
- settled online-context FPS regresses by more than 10% from the local benchmark measured immediately before/after on the same browser/device and camera;
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

Do not modify unless a hard stop is explicitly reviewed and the design is amended:

```text
data/schemas/story-1.2.schema.json
data/schemas/project-manifest-v1.schema.json
data/stories/route-61-2.story.json
src/map/geojson-renderer.js
```

## 20. Freeze invariants

At the final executable C1 head:

- canonical Route 61-2 Story SHA-256 remains `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`;
- Story 1.0 behavior remains compatible;
- Story 1.1 behavior remains compatible;
- Story 1.2 behavior remains compatible;
- Story 1.2 schema diff from baseline is empty;
- Project Manifest schema diff from baseline is empty;
- production generic GeoJSON renderer diff from baseline is empty;
- no second MapLibre map is constructed;
- Route comparison modes/reveal/POI/simulation behavior remain unchanged;
- focused tests run during development;
- the bounded C1 regression set runs before browser certification;
- full `npm test` runs once at the final executable head after all executable changes are complete.

## 21. Phase C2 publication snapshot contract

C2 is intentionally deferred until C1 proves the runtime seam. Its approved contract is fixed here so C1 does not design itself into a dead end.

A frozen project-area snapshot:

- contains Overture buildings for one bounded project area, not individual Scene AOIs;
- represents the same pinned Overture release used during authoring unless the author explicitly updates the release before freezing;
- is a PMTiles artifact suitable for HTTP range access;
- is stored/hosted as a project static asset or equivalent durable object;
- uses the same MapLibre PMTiles source/layer builder as C1;
- records Overture release, source theme, geographic bounds, creation timestamp, and artifact SHA-256;
- can be generated with the official `pmtiles extract` path while the global release archive is available;
- can alternatively be generated from the user's already-held Overture regional data pack when that is the authoritative retained input;
- does not require a long-running tile server;
- does not change Story Scene semantics;
- does not require authors to extract data for each slide.

The exact publish-extent selection and snapshot generation workflow receives its own C2 design/plan after C1 certification. C1 must therefore expose a PMTiles source seam that can later accept a trusted project-local PMTiles URL without changing the rendering implementation, but C1 must not expose that URL as arbitrary author input.

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
AUTHORING / CURRENT RELEASE
official Overture release PMTiles
        ↓
any camera / any Scene

FREEZE / DURABLE PUBLISH
one project-area PMTiles snapshot
        ↓
any camera / any Scene
```

The project never returns to a model where every slide needs its own Overture extract.
