# Map Story Studio V1.2 — Overture PMTiles C1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Route 61-2's per-area Overture authoring workflow with a lazy, pinned, official Overture `buildings.pmtiles` source that follows the current camera across Scenes, while retaining the existing 1,299-building local GeoJSON as an explicit benchmark and deferring durable project-area snapshot generation to C2.

**Architecture:** `urban-context-v1` remains the semantic capability. It passes bounded source settings into the existing shared Route 61-2 adapter; `src/urban-context.js` owns visibility/lifecycle; a new focused `src/overture-pmtiles.js` owns trusted URL derivation, lazy local PMTiles loading, process-lifetime protocol registration, and online MapLibre source/layer definitions. Route 61-2 remains on `local-geojson` until real headed-Chromium network, visual, responsiveness, and FPS gates pass; only then does `project.json` switch to `overture-pmtiles`.

**Tech Stack:** Existing MapLibre GL JS runtime, native browser ESM/DOM, vendored PMTiles JavaScript `4.5.0` browser bundle, Node.js 24 test runner, existing Chrome DevTools/browser-control scripts, Cloudflare Pages preview.

**Spec:** `docs/superpowers/specs/2026-09-02-map-story-studio-v1-2-overture-pmtiles-design.md`

## Global Constraints

- Start from design branch `feat/map-story-studio-v1-2-overture-pmtiles`; approved design HEAD before this plan is `721b832a4693ca855e7586e3a1d3f99655cfadf1` and repository implementation baseline is `main@8ecd1608ae4ff7a6d2e3808ddab999391c8e4a9d`.
- Do not rebase onto a newer `main` without stopping for review if `main` moved; fetch first and report drift.
- Canonical Route 61-2 Story SHA-256 must remain `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`.
- Do not modify `data/schemas/story-1.2.schema.json`, `data/schemas/project-manifest-v1.schema.json`, `data/stories/route-61-2.story.json`, or `src/map/geojson-renderer.js`.
- Keep one MapLibre instance. Do not add another map for Overture, Studio preview, or certification.
- Keep `urban-context-v1` actions exactly `context.set-mode` with modes `off` and `industrial-context`; preserve legacy `map.urban-context` normalization.
- C1 source modes are exactly `overture-pmtiles` and `local-geojson`.
- C1 certified release is exactly `2026-08-19.0`; release validation is `^[0-9]{4}-[0-9]{2}-[0-9]{2}\.0$`.
- Official archive template is exactly `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/<RELEASE>/buildings.pmtiles`; no authored or arbitrary URL is accepted.
- PMTiles JavaScript is exactly version `4.5.0`, vendored locally. Do not use a PMTiles CDN or add a package/runtime dependency/bundler.
- Online mode renders only Overture source-layer `building`; do not add `building_part` in C1.
- Flat layer: `minzoom: 11`, `maxzoom: 14`, `fill-color: #748a9c`, `fill-opacity: 0.14`.
- 3D layer: `minzoom: 14`, `fill-extrusion-color: #8298aa`, `fill-extrusion-opacity: 0.78`, `fill-extrusion-vertical-gradient: true`.
- Online height policy: valid `height` in `(0,300]`; else valid `num_floors` in `(0,80] * 3.5`; else `8.5` metres.
- Online base policy: valid `min_height >= 0 && min_height < finalHeight`; else valid `min_floor in [0,80] * 3.5 < finalHeight`; else `0`.
- Before first online context activation: PMTiles library not loaded, protocol not registered by this project, online source/layers absent, Overture PMTiles network requests zero.
- Context off/on hides/reuses the existing source; do not remove/re-add on each Scene. Protocol registration is process-lifetime/idempotent.
- Online failure is optional-context failure: Story remains interactive; no synthetic or local automatic fallback.
- Do not introduce a proxy, Cloudflare Worker, server tile service, service worker, custom cache framework, generic remote-resource schema, or per-Scene geometry extraction.
- A browser gate must prove at least one `Range` request and/or `206 Partial Content` response for the configured `buildings.pmtiles`; if controlled Chromium cannot expose either, stop rather than infer.
- Certified PMTiles activation may not cause an application-attributable main-thread task/frame gap above `250 ms`.
- Same-device/camera settled online-context average FPS may not regress by more than `10%` from the immediately measured local benchmark.
- C1 does not implement durable publication snapshots. C2 is separate.
- Use focused tests during development. Run full `npm test` exactly once locally after all executable C1 changes are complete; exact-head GitHub Actions may run it again.
- Keep PR Draft and unmerged for independent review.

---

## Locked File Structure

### New production/support files

- `src/overture-pmtiles.js` — trusted release/URL boundary, lazy local PMTiles loader, idempotent MapLibre protocol registration, online source/layer expressions.
- `vendor/pmtiles/4.5.0/pmtiles.js` — exact PMTiles 4.5.0 browser bundle from the npm package.
- `vendor/pmtiles/4.5.0/LICENSE` — exact BSD-3-Clause license file from the package.
- `vendor/pmtiles/THIRD-PARTY.md` — version, upstream artifact, license, and SHA-256 provenance.
- `tests/overture-pmtiles.test.mjs` — vendor/trusted URL/protocol/source/layer unit tests.
- `scripts/overture-pmtiles-browser-certification.mjs` — bounded CDP/browser certification using existing browser-control patterns.
- `review/map-story-studio-v1-2/overture-pmtiles/C1.md` — measured browser/network/performance evidence.

### Existing application files expected to change

- `src/overture-buildings.js` — retain local benchmark definitions/IDs and expose shared constants only where needed.
- `src/urban-context.js` — explicit local vs online source strategy; lazy online lifecycle; optional-context failure/status.
- `src/capabilities/urban-context-v1.js` — bounded settings contract and adapter configuration.
- `src/route-61-2/runtime-adapter.js` — remove online reliance on eager local GeoJSON fetch; add bounded urban-context configuration seam while retaining shared adapter identity.
- `editor/preview/bridge.js` — one exact bounded urban-context telemetry event.
- `editor/preview/package-resolver.js` — forward transient production urban-context status from the active preview only.
- `editor/editor.js` — display configured source/release and transient status in the existing capability inspector.
- `project.json` — first make local benchmark source explicit; switch to online only after Task 6 certification passes.

### Existing tests expected to change

- `tests/overture-buildings.test.mjs`
- `tests/overture-buildings-data.test.mjs`
- `tests/capability-descriptors.test.mjs`
- `tests/editor-capability-authoring.test.mjs`
- `tests/editor-preview-bridge.test.mjs` or the current bridge-focused test file if named differently; use the existing file discovered in the repo, do not duplicate it.
- `tests/editor-studio-preview.test.mjs`
- `tests/route-61-2-runtime-adapter.test.mjs`
- `tests/route-61-2-project.test.mjs`

---

### Task 1: Vendor PMTiles 4.5.0 with a tested provenance boundary

**Files:**
- Create: `vendor/pmtiles/4.5.0/pmtiles.js`
- Create: `vendor/pmtiles/4.5.0/LICENSE`
- Create: `vendor/pmtiles/THIRD-PARTY.md`
- Create: `tests/overture-pmtiles.test.mjs`

**Interfaces:**
- Produces local browser global `globalThis.pmtiles` when `pmtiles.js` is loaded.
- No application file references the vendor path until Task 2.

- [ ] **Step 1: Verify branch/base before downloading anything**

Run:

```bash
git fetch origin
git status --short
git rev-parse HEAD
git rev-parse origin/main
git merge-base HEAD origin/main
```

Expected before implementation: clean worktree; branch contains only the approved design/plan commits above `8ecd1608ae4ff7a6d2e3808ddab999391c8e4a9d`; `origin/main` is still that baseline. If `origin/main` moved, STOP and report the new SHA before rebasing.

- [ ] **Step 2: Vendor only the exact browser artifact and license from the npm tarball**

Use the canonical npm artifact:

```bash
curl -fsSLo /tmp/pmtiles-4.5.0.tgz https://registry.npmjs.org/pmtiles/-/pmtiles-4.5.0.tgz
rm -rf /tmp/pmtiles-4.5.0
mkdir -p /tmp/pmtiles-4.5.0 vendor/pmtiles/4.5.0
tar -xzf /tmp/pmtiles-4.5.0.tgz -C /tmp/pmtiles-4.5.0
cp /tmp/pmtiles-4.5.0/package/dist/pmtiles.js vendor/pmtiles/4.5.0/pmtiles.js
cp /tmp/pmtiles-4.5.0/package/LICENSE vendor/pmtiles/4.5.0/LICENSE
sha256sum /tmp/pmtiles-4.5.0.tgz vendor/pmtiles/4.5.0/pmtiles.js vendor/pmtiles/4.5.0/LICENSE
```

Do not copy `node_modules`, package source, declarations, examples, or another build unless the exact 4.5.0 tarball proves the expected paths differ. If the package does not contain `dist/pmtiles.js` and `LICENSE`, STOP and report the tarball inventory rather than selecting a different artifact silently.

- [ ] **Step 3: Write provenance and the failing vendor test**

`vendor/pmtiles/THIRD-PARTY.md` must record:

```text
Package: pmtiles
Version: 4.5.0
License: BSD-3-Clause
Artifact: https://registry.npmjs.org/pmtiles/-/pmtiles-4.5.0.tgz
Browser file: vendor/pmtiles/4.5.0/pmtiles.js
License file: vendor/pmtiles/4.5.0/LICENSE
SHA-256: use the exact values printed by sha256sum in Step 2
```

Add a test with these invariants:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('PMTiles 4.5.0 is pinned locally with no CDN runtime dependency', async () => {
  const bundle = await readFile(new URL('vendor/pmtiles/4.5.0/pmtiles.js', root), 'utf8');
  const license = await readFile(new URL('vendor/pmtiles/4.5.0/LICENSE', root), 'utf8');
  const provenance = await readFile(new URL('vendor/pmtiles/THIRD-PARTY.md', root), 'utf8');
  assert.match(bundle.slice(0, 4000), /PMTiles|Protocol/);
  assert.match(license, /BSD/i);
  assert.match(provenance, /Version:\s*4\.5\.0/);
  assert.match(provenance, /SHA-256:/);
});
```

- [ ] **Step 4: Run the focused vendor test**

Run:

```bash
node --test tests/overture-pmtiles.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add vendor/pmtiles tests/overture-pmtiles.test.mjs
git commit -m "build: vendor PMTiles 4.5.0"
```

---

### Task 2: Add the trusted online Overture PMTiles module

**Files:**
- Create: `src/overture-pmtiles.js`
- Modify: `tests/overture-pmtiles.test.mjs`
- Modify: `src/overture-buildings.js` only for shared source/layer IDs if needed; do not alter local benchmark semantics.

**Interfaces:**
- Produces:

```js
export const OVERTURE_PMTILES_RELEASE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.0$/;
export const OVERTURE_PMTILES_FLAT_LAYER_ID = 'overture-industrial-buildings-flat';
export function deriveOvertureBuildingsPmtilesUrl(release) {}
export async function loadPmtilesBrowser({ documentRef = globalThis.document, globalRef = globalThis } = {}) {}
export async function ensurePmtilesProtocol(maplibregl, options = {}) {}
export function createOverturePmtilesLayerDefinitions({ release }) {}
```

- `ensurePmtilesProtocol(...)` owns process-lifetime registration per `maplibregl` object. It does not call `removeProtocol` in C1.
- `createOverturePmtilesLayerDefinitions(...)` reuses current `OVERTURE_BUILDING_SOURCE_ID` and `OVERTURE_BUILDING_LAYER_ID` for the mutually exclusive online/local source modes and adds only the flat layer ID above.

- [ ] **Step 1: Extend the focused tests first**

Add tests that require all of the following:

```js
assert.equal(
  deriveOvertureBuildingsPmtilesUrl('2026-08-19.0'),
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles'
);
for (const invalid of [
  'latest', '2026-08-19', '2026-08-19.1', '../2026-08-19.0',
  'https://example.com/x', '2026-08-19.0?x=1', '2026-08-19.0#x', '2026%2f08%2f19.0'
]) assert.throws(() => deriveOvertureBuildingsPmtilesUrl(invalid), /Overture release/i);
```

Also assert:

```js
const definitions = createOverturePmtilesLayerDefinitions({ release: '2026-08-19.0' });
assert.equal(definitions.source.type, 'vector');
assert.equal(definitions.source.url,
  'pmtiles://https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles');
assert.equal(definitions.flat['source-layer'], 'building');
assert.equal(definitions.flat.minzoom, 11);
assert.equal(definitions.flat.maxzoom, 14);
assert.equal(definitions.extrusion['source-layer'], 'building');
assert.equal(definitions.extrusion.minzoom, 14);
```

Create a fake `maplibregl` with an `addProtocol` counter and inject a fake loader returning `{ Protocol }`; call `ensurePmtilesProtocol` twice and assert the loader and `addProtocol('pmtiles', ...)` each run once.

- [ ] **Step 2: Run RED**

```bash
node --test tests/overture-pmtiles.test.mjs
```

Expected: FAIL because `src/overture-pmtiles.js` does not exist.

- [ ] **Step 3: Implement the trusted URL and lazy browser loader**

Use this boundary, not arbitrary URL composition:

```js
const OVERTURE_HOST = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com';
const PMTILES_VENDOR_URL = new URL('../vendor/pmtiles/4.5.0/pmtiles.js', import.meta.url);
const protocolByMapLibre = new WeakMap();
let pmtilesLoadPromise;

export function deriveOvertureBuildingsPmtilesUrl(release) {
  if (typeof release !== 'string' || !OVERTURE_PMTILES_RELEASE_PATTERN.test(release)) {
    throw new TypeError(`Invalid Overture release: ${release}.`);
  }
  return `${OVERTURE_HOST}/tiles/${release}/buildings.pmtiles`;
}
```

`loadPmtilesBrowser(...)` must:

1. return an already-present `globalRef.pmtiles` only if it exposes `Protocol`;
2. otherwise append exactly one `<script>` whose `src` is `PMTILES_VENDOR_URL.href`;
3. cache the in-flight/success promise;
4. reject if the script errors or finishes without `globalRef.pmtiles.Protocol`;
5. never fetch the Overture data archive itself.

`ensurePmtilesProtocol(...)` must:

```js
const existing = protocolByMapLibre.get(maplibregl);
if (existing) return existing;
const pmtiles = await loadPmtiles();
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);
protocolByMapLibre.set(maplibregl, protocol);
return protocol;
```

Do not add protocol teardown in C1.

- [ ] **Step 4: Implement exact trusted MapLibre expressions**

Construct immutable expression arrays in trusted code. The height expression must implement exactly:

```text
valid height (0,300] → height
else valid num_floors (0,80] → num_floors * 3.5
else → 8.5
```

The base expression must compare `min_height` / `min_floor * 3.5` against that same final height and otherwise return `0`.

Use MapLibre `to-number` with bounded fallback and `let`/`var` or an equivalent deterministic expression; never use authored expression input.

Build definitions:

```js
{
  source: {
    type: 'vector',
    url: `pmtiles://${deriveOvertureBuildingsPmtilesUrl(release)}`,
    attribution: '© <a href="https://overturemaps.org/">Overture Maps Foundation</a>'
  },
  flat: {
    id: OVERTURE_PMTILES_FLAT_LAYER_ID,
    type: 'fill',
    source: OVERTURE_BUILDING_SOURCE_ID,
    'source-layer': 'building',
    minzoom: 11,
    maxzoom: 14,
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#748a9c', 'fill-opacity': 0.14 }
  },
  extrusion: {
    id: OVERTURE_BUILDING_LAYER_ID,
    type: 'fill-extrusion',
    source: OVERTURE_BUILDING_SOURCE_ID,
    'source-layer': 'building',
    minzoom: 14,
    layout: { visibility: 'none' },
    paint: {
      'fill-extrusion-color': '#8298aa',
      'fill-extrusion-height': heightExpression,
      'fill-extrusion-base': baseExpression,
      'fill-extrusion-opacity': 0.78,
      'fill-extrusion-vertical-gradient': true
    }
  }
}
```

- [ ] **Step 5: Run focused GREEN plus existing local Overture tests**

```bash
node --test \
  tests/overture-pmtiles.test.mjs \
  tests/overture-buildings.test.mjs \
  tests/overture-buildings-data.test.mjs
```

Expected: all PASS; existing local 1,299-feature benchmark tests remain unchanged.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/overture-pmtiles.js src/overture-buildings.js tests/overture-pmtiles.test.mjs
git commit -m "feat: add trusted Overture PMTiles source"
```

---

### Task 3: Add bounded capability settings and configure the shared Route adapter

**Files:**
- Modify: `src/capabilities/urban-context-v1.js`
- Modify: `src/route-61-2/runtime-adapter.js`
- Modify: `project.json` only to make current local benchmark settings explicit at this stage.
- Modify: `tests/capability-descriptors.test.mjs`
- Modify: `tests/editor-capability-authoring.test.mjs`
- Modify: `tests/route-61-2-runtime-adapter.test.mjs`
- Modify: `tests/route-61-2-project.test.mjs`

**Interfaces:**
- `urban-context-v1.settings` supports `adapter`, `buildingSource`, `overtureRelease`.
- Shared Route adapter produces:

```js
configureUrbanContext({ buildingSource, overtureRelease })
```

- The adapter is still one object per MapLibre map; route-comparison settings are untouched by urban-context configuration.

- [ ] **Step 1: Write RED descriptor/project tests**

Require descriptor settings to accept:

```js
{
  adapter: 'route-61-2-current',
  buildingSource: 'local-geojson',
  overtureRelease: '2026-08-19.0'
}
```

and:

```js
{
  adapter: 'route-61-2-current',
  buildingSource: 'overture-pmtiles',
  overtureRelease: '2026-08-19.0'
}
```

Reject invalid source values and invalid release strings. Preserve `gui.addable !== true` unless already explicitly true.

Update Route project expectation for this task to remain local:

```js
assert.deepEqual(urban.settings, {
  adapter: 'route-61-2-current',
  buildingSource: 'local-geojson',
  overtureRelease: '2026-08-19.0'
});
```

- [ ] **Step 2: Write RED shared-adapter ordering tests**

Cover both capability connection orders:

```text
route-comparison first → urban-context second
urban-context first → route-comparison second
```

In both cases assert:

- one shared adapter object for the map;
- `configureUrbanContext(...)` receives the urban settings;
- later route-comparison connection does not overwrite them;
- calling configuration after `destroy()` throws a bounded `TypeError`;
- no arbitrary `url` field is accepted by the configuration seam.

- [ ] **Step 3: Implement the descriptor settings contract**

In `URBAN_CONTEXT_V1_DESCRIPTOR.settingsSchema`, keep a closed object and add:

```js
buildingSource: {
  type: 'string',
  enum: ['overture-pmtiles', 'local-geojson']
},
overtureRelease: {
  type: 'string',
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.0$'
}
```

Do not add a URL property.

When the capability selects `route-61-2-current`, obtain the shared adapter, then call:

```js
adapter.configureUrbanContext({
  buildingSource: settings.buildingSource ?? 'local-geojson',
  overtureRelease: settings.overtureRelease ?? '2026-08-19.0'
});
```

before returning the handler wrapper.

- [ ] **Step 4: Implement adapter configuration without eager online loading**

The shared adapter owns a small immutable configuration value initialized to the legacy-safe default:

```js
let urbanContextConfig = Object.freeze({
  buildingSource: 'local-geojson',
  overtureRelease: '2026-08-19.0'
});
```

`configureUrbanContext(next)` validates exactly the two known keys/values, replaces the frozen config, and passes it to the urban controller if that controller already exists. It must not fetch/load PMTiles itself.

If an online controller has not yet been created, configuration is stored for first activation.

- [ ] **Step 5: Make `project.json` explicit but keep local mode**

At this task only, set:

```json
"settings": {
  "adapter": "route-61-2-current",
  "buildingSource": "local-geojson",
  "overtureRelease": "2026-08-19.0"
}
```

Do not switch to online yet.

- [ ] **Step 6: Run focused capability/adapter GREEN**

```bash
node --test \
  tests/capability-descriptors.test.mjs \
  tests/editor-capability-authoring.test.mjs \
  tests/route-61-2-runtime-adapter.test.mjs \
  tests/route-61-2-project.test.mjs
```

Expected: PASS with Route still using local benchmark mode.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/capabilities/urban-context-v1.js src/route-61-2/runtime-adapter.js project.json \
  tests/capability-descriptors.test.mjs tests/editor-capability-authoring.test.mjs \
  tests/route-61-2-runtime-adapter.test.mjs tests/route-61-2-project.test.mjs
git commit -m "feat: configure Overture context source"
```

---

### Task 4: Make online Overture lazy, reusable, and non-fatal

**Files:**
- Modify: `src/urban-context.js`
- Modify: `src/route-61-2/runtime-adapter.js`
- Modify: `src/overture-buildings.js` only as needed to keep local benchmark source builder isolated.
- Modify: `tests/route-61-2-runtime-adapter.test.mjs`
- Create or modify the existing closest urban-context controller test file; if none exists, create `tests/urban-context.test.mjs`.

**Interfaces:**
- `createUrbanContextController(...)` accepts the existing local inputs plus:

```js
buildingConfig: { buildingSource, overtureRelease },
ensureOnlineProtocol,
createOnlineDefinitions,
onStatus
```

Use dependency injection defaults pointing to Task 2 production functions so Node tests do not load the real browser vendor.
- Controller exposes:

```js
configureBuildings(nextConfig)
setMode(mode)
getDiagnostics()
destroy()
```

- Status payload shape is always:

```js
{
  status: 'not-requested' | 'loading' | 'available' | 'unavailable' | 'local-benchmark',
  source: 'overture-pmtiles' | 'local-geojson',
  release: string,
  failureCategory: null | string
}
```

- [ ] **Step 1: Write RED lifecycle tests**

For online mode, assert before first `setMode('industrial-context')`:

```text
ensureOnlineProtocol calls = 0
online source additions = 0
online layer additions = 0
status = not-requested
```

After first activation:

```text
ensureOnlineProtocol calls = 1
source added once
flat + extrusion layers added once
status transitions loading → available
```

After off/on and repeated activation:

```text
source additions still = 1
layer additions still = 2
protocol ensure calls still = 1
```

For online injected failure, assert:

```text
status = unavailable
failureCategory is bounded/non-empty
no synthetic layer is created
local benchmark is not installed
setMode/off and route runtime remain callable
```

For local mode, assert exact existing collection inspection, one GeoJSON source, 1,299 fixture semantics, and `local-benchmark` status.

- [ ] **Step 2: Run RED**

```bash
node --test tests/urban-context.test.mjs tests/route-61-2-runtime-adapter.test.mjs
```

If the repo already had a differently named controller test, use that filename instead of creating a duplicate.

- [ ] **Step 3: Refactor source preparation into explicit local/online branches**

Do not use the current `inspectOvertureCollection(...)` result to decide online source availability. Instead:

```text
buildingSource === local-geojson
→ validate/install current processed FeatureCollection

buildingSource === overture-pmtiles
→ do nothing until first industrial-context activation
→ ensure protocol
→ create vector source/layers
→ leave them installed across off/on
```

Synthetic industrial generation remains only the existing legacy fallback for the explicit local path when its current contract says it should run. Online failure must not enter that branch.

- [ ] **Step 4: Remove eager local fetch from the online path**

The adapter's current `loadTrustedOvertureBuildings(context)` may remain solely for `local-geojson`, but online mode must not call it.

The adapter should create/configure the urban controller without awaiting the 0.97 MiB local file when `buildingSource === 'overture-pmtiles'`.

Do not initialize PMTiles merely because the adapter installs.

- [ ] **Step 5: Implement status + diagnostics**

Every status update must call injected `onStatus(payload)` and update bounded map datasets for browser evidence. Use exact stable tokens:

```text
data-urban-context-source
data-urban-context-status
data-urban-overture-release
data-urban-context-failure
```

Do not serialize these into Story or project data.

- [ ] **Step 6: Run bounded runtime regression**

```bash
node --test \
  tests/overture-pmtiles.test.mjs \
  tests/overture-buildings.test.mjs \
  tests/overture-buildings-data.test.mjs \
  tests/urban-context.test.mjs \
  tests/route-61-2-runtime-adapter.test.mjs \
  tests/route-61-2-project.test.mjs
```

Expected: all PASS; Route project remains explicit `local-geojson` at this point.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/urban-context.js src/route-61-2/runtime-adapter.js src/overture-buildings.js \
  tests/urban-context.test.mjs tests/route-61-2-runtime-adapter.test.mjs
git commit -m "feat: stream Overture context lazily"
```

---

### Task 5: Surface source/release/status in the existing Studio capability inspector

**Files:**
- Modify: `editor/preview/bridge.js`
- Modify: `editor/preview/package-resolver.js`
- Modify: `editor/editor.js`
- Modify: `tests/editor-capability-authoring.test.mjs`
- Modify: the existing bridge-focused test file discovered from `editor/preview/bridge.js` imports.
- Modify: `tests/editor-studio-preview.test.mjs`

**Interfaces:**
- Add one preview event only:

```text
editor-preview:urban-context-status
```

with exact payload keys:

```js
{
  status,
  source,
  release,
  failureCategory
}
```

- Production status remains transient; parent editor never writes it to project data.

- [ ] **Step 1: Write RED bridge validation tests**

Accept only the exact event type/payload shape. Reject extra keys, unknown status/source values, missing release, and non-string/non-null failure category.

Allowed status labels in transport are machine tokens:

```text
not-requested
loading
available
unavailable
local-benchmark
```

Allowed source tokens:

```text
overture-pmtiles
local-geojson
```

- [ ] **Step 2: Write RED Studio inspector tests**

With Route 61-2's `urban-context-v1` selected, assert the existing capability inspector exposes editable persisted controls for:

```text
Building source
Overture release
```

and a read-only transient Status showing one of:

```text
Not requested
Loading
Available
Unavailable
Local benchmark
```

Changing source/release must use the existing capability settings/history mutation path. Merely opening the inspector must make zero project mutations.

The derived PMTiles endpoint, if displayed, is read-only and never becomes an input.

- [ ] **Step 3: Forward status from the active production preview**

Use the existing preview host/bridge lifecycle rather than direct parent DOM poking. When the production urban controller emits `onStatus`, expose it through the current Route adapter/runtime context so the preview host sends `editor-preview:urban-context-status` with current revision/source checks.

If the cleanest existing seam is a DOM event from the production map host, use one namespaced event with exact detail and attach/remove one listener in `startEditorPreviewHost`; do not create a generic telemetry bus.

- [ ] **Step 4: Render the compact Studio copy**

In the existing capability panel, only tailor presentation copy for installed `urban-context-v1`; do not add a new panel.

Persisted controls map to:

```text
buildingSource → Building source
overtureRelease → Overture release
```

Option presentation:

```text
overture-pmtiles → Overture online
local-geojson → Local benchmark
```

Keep `adapter` as the existing technical setting; it may remain visible if hiding it would require expanding descriptor GUI vocabulary in this slice.

Status is read-only transient text. When no matching runtime event has been received for the current preview revision, show `Not requested` for online mode and `Local benchmark` for local mode only if the current preview has positively reported it; do not guess `Available`.

- [ ] **Step 5: Run focused Studio/bridge tests**

```bash
node --test \
  tests/editor-capability-authoring.test.mjs \
  tests/editor-studio-preview.test.mjs \
  tests/*preview*bridge*.test.mjs
```

If shell glob expands to no file on the current platform, run the exact existing bridge-focused filename discovered before editing.

Expected: PASS with no raw arbitrary URL field.

- [ ] **Step 6: Commit Task 5**

```bash
git add editor/preview/bridge.js editor/preview/package-resolver.js editor/editor.js \
  tests/editor-capability-authoring.test.mjs tests/editor-studio-preview.test.mjs tests/*preview*bridge*.test.mjs
git commit -m "feat: expose Overture context status in Studio"
```

---

### Task 6: Certify official Overture streaming in real Chromium before migration

**Files:**
- Create: `scripts/overture-pmtiles-browser-certification.mjs`
- Create: `review/map-story-studio-v1-2/overture-pmtiles/C1.md`
- Create browser screenshots under `review/map-story-studio-v1-2/overture-pmtiles/`.
- Do **not** switch `project.json` to online until every hard gate below passes.

**Interfaces:**
- Script exits non-zero on a hard gate and writes no false PASS report.
- Use existing Chrome DevTools/browser-control utilities/patterns already in `scripts/`; do not add Playwright/Puppeteer or a new browser framework.

- [ ] **Step 1: Write the certification script with exact scenarios**

Scenario A — startup gate:

```text
open current app/editor preview with Route project still local by default
switch draft capability source to overture-pmtiles only after network listeners are installed
before activating industrial-context: count requests matching /buildings\.pmtiles/ == 0
```

Scenario B — local benchmark at the exact existing service-area Scene/camera:

```text
buildingSource = local-geojson
activate service-area / industrial-context
wait for idle/available
measure settled FPS on same device/browser for >= 4 seconds
capture screenshot
```

Scenario C — online Mỹ Phước at the same camera:

```text
buildingSource = overture-pmtiles
overtureRelease = 2026-08-19.0
activate industrial-context
wait for status Available
capture PMTiles requests/responses
assert Range header and/or 206 response observed
measure activation→visible duration
measure worst RAF/frame gap
measure settled FPS using same window length as local
capture screenshot
```

Scenario D — geographically separate camera with the same installed source/config:

```js
const THU_DAU_MOT_CAMERA = {
  center: [106.6500, 10.9800],
  zoom: 15,
  pitch: 48,
  bearing: -12
};
```

Move the current production MapLibre map to that camera without changing the configured source/release and assert visible/queryable `building` features or rendered building layers after load. Then return to Mỹ Phước and assert source/layer/protocol counts did not increase.

Scenario E — failure:

Inject a bounded test-only fetch/range failure through the existing controlled browser fixture seam or a request interception rule; assert status `Unavailable`, route/Story interaction still works, and neither synthetic nor local benchmark is silently installed.

- [ ] **Step 2: Instrument only measurements we can defend**

Enable CDP `Network` before source activation. Record for requests matching the exact archive URL:

```text
request count
request Range header when exposed
response status when exposed
encodedDataLength / transfer bytes when reliable
```

Use RAF timestamps / PerformanceObserver long tasks to compute worst application-visible frame/task gap during activation. Do not invent heap/memory data if the browser surface cannot expose a trustworthy combined number.

- [ ] **Step 3: Run the browser gate from the deployed or equivalent HTTP origin**

Use the same route/application origin policy as existing browser certification. Do not certify PMTiles from a `file://` page.

Run the script and preserve its machine-readable/stdout summary in `C1.md`.

Hard PASS criteria:

```text
pre-activation PMTiles requests = 0
Mỹ Phước online status = Available
at least one Range request and/or 206 response = true
distant camera buildings = visible
source count remains 1
flat layer count remains 1
3D layer count remains 1
protocol registration count remains 1
worst attributable frame/task gap <= 250 ms
online settled average FPS >= 90% of local settled average FPS
remote failure leaves Story usable
one MapLibre instance
```

If any criterion fails, STOP. Do not change `project.json` to online, do not add proxy/cache/tile-server work, and return the evidence for architectural review.

- [ ] **Step 4: Perform visual A/B at two review sizes**

Capture same-camera local vs online evidence at:

```text
1440×900
1366×768
```

At minimum create:

```text
01-my-phuoc-local-1440x900.png
02-my-phuoc-online-1440x900.png
03-my-phuoc-online-1366x768.png
04-thu-dau-mot-online-1440x900.png
```

Review for coherent 3D built form, no height spikes, no wrong source-layer holes, route/POI/label hierarchy, and intentional flat→3D behavior.

If the locked color/opacity constants need adjustment, STOP and report the visual defect rather than changing them silently.

- [ ] **Step 5: Run the bounded C1 regression set after browser success**

Run only once here before migration:

```bash
node --test \
  tests/overture-pmtiles.test.mjs \
  tests/overture-buildings.test.mjs \
  tests/overture-buildings-data.test.mjs \
  tests/urban-context.test.mjs \
  tests/capability-descriptors.test.mjs \
  tests/editor-capability-authoring.test.mjs \
  tests/editor-studio-preview.test.mjs \
  tests/route-61-2-runtime-adapter.test.mjs \
  tests/route-61-2-project.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit the certification harness/evidence**

```bash
git add scripts/overture-pmtiles-browser-certification.mjs review/map-story-studio-v1-2/overture-pmtiles
git commit -m "test: certify Overture PMTiles streaming"
```

---

### Task 7: Migrate Route 61-2 to online current-release mode and freeze C1

**Files:**
- Modify: `project.json`
- Modify: `tests/route-61-2-project.test.mjs`
- Modify: `review/map-story-studio-v1-2/overture-pmtiles/C1.md` with final exact executable head and freeze results.

**Interfaces:**
- Final Route C1 declaration:

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

- Local fixture remains checked in for benchmark mode.

- [ ] **Step 1: Switch only the project capability source after Task 6 PASS**

Change `buildingSource` from `local-geojson` to `overture-pmtiles`. Do not delete `data/context/my-phuoc-1-buildings.geojson`, its metadata, preparation script, or local tests.

- [ ] **Step 2: Update the project test and freeze tests**

Require final project settings exactly as above. Also retain/assert:

```js
assert.deepEqual(project.manifest.capabilities.map(({ id }) => id), [
  'route-comparison-v1', 'urban-context-v1'
]);
```

and canonical Story identity.

Run explicit freeze commands before the full suite:

```bash
git diff 8ecd1608ae4ff7a6d2e3808ddab999391c8e4a9d -- \
  data/schemas/story-1.2.schema.json \
  data/schemas/project-manifest-v1.schema.json \
  data/stories/route-61-2.story.json \
  src/map/geojson-renderer.js
sha256sum data/stories/route-61-2.story.json
```

Expected: diff output EMPTY and Story hash exactly `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`.

- [ ] **Step 3: Run focused final migration test**

```bash
node --test tests/route-61-2-project.test.mjs tests/route-61-2-runtime-adapter.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run full local suite exactly once at the final executable head**

```bash
npm test
```

Expected: all tests PASS. Record exact totals and duration. Do not run `npm test` repeatedly unless this run fails and code must change.

- [ ] **Step 5: Commit the final executable C1 migration**

```bash
git add project.json tests/route-61-2-project.test.mjs
git commit -m "feat: use online Overture context for Route 61-2"
git rev-parse HEAD
```

Record this SHA as **C1 certified executable head candidate**.

- [ ] **Step 6: Update evidence with exact heads without changing executable code**

Update `C1.md` with:

```text
base SHA
final executable SHA
full npm test totals/duration
bounded regression totals
browser gate metrics
Range/206 evidence
local FPS
online FPS
FPS delta %
worst frame/task gap
request counts/bytes where reliable
screenshot paths
freeze diff EMPTY
Story SHA
one-MapLibre result
C1 current-release retention warning
C2 deferred publication note
```

Then:

```bash
git add review/map-story-studio-v1-2/overture-pmtiles/C1.md
git commit -m "docs: record Overture PMTiles C1 evidence"
git diff --check
git status --short
```

Expected: clean worktree after commit.

- [ ] **Step 7: Push and open one Draft PR only**

```bash
git push -u origin feat/map-story-studio-v1-2-overture-pmtiles
```

Open a Draft PR against `main` titled:

```text
feat: stream Overture buildings with PMTiles
```

PR body must state:

```text
Phase C1 only: official pinned Overture buildings.pmtiles for authoring/current-release use.
C2 durable project-area PMTiles publication snapshot is intentionally deferred.
No Story/Manifest schema or generic GeoJSON renderer changes.
Canonical Route Story unchanged.
Local 1,299-building benchmark retained.
Exact browser Range/206, performance, and multi-location evidence is committed under review/map-story-studio-v1-2/overture-pmtiles/.
```

Do not mark Ready. Do not merge. Do not delete the branch.

---

## Plan Self-Review Checklist

Before declaring implementation complete, verify every item below from evidence rather than intent:

- [ ] PMTiles runtime code is local; Overture data alone is remote in C1.
- [ ] No online request before first context activation.
- [ ] No arbitrary authored URL.
- [ ] Official release URL derives only from validated release.
- [ ] Only `building` source-layer is used.
- [ ] Flat and 3D zoom/style/height/base policies match the spec exactly.
- [ ] Shared Route adapter remains one object per map regardless of capability connection order.
- [ ] Online off/on and distant camera movement reuse one source/layer/protocol set.
- [ ] Online failure does not invoke local or synthetic fallback.
- [ ] Studio edits source/release through existing capability mutation/history.
- [ ] Studio transient status is not serialized.
- [ ] Real browser shows Range and/or 206 evidence.
- [ ] Real browser proves at least Mỹ Phước + Thủ Dầu Một from the same source.
- [ ] Worst attributable activation frame/task gap is `<=250 ms`.
- [ ] Online settled FPS is at least `90%` of local benchmark on same browser/device/camera.
- [ ] Local benchmark still reports 1,299 features.
- [ ] One MapLibre instance.
- [ ] Story/schema/renderer freeze diffs are empty.
- [ ] Canonical Story hash unchanged.
- [ ] Full local `npm test` run exactly once at final executable head and passed.
- [ ] C1 evidence clearly warns official Overture release retention is not durable publication.
- [ ] C2 snapshot generation is not implemented in this PR.
- [ ] Draft PR only; no merge.
