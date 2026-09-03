# Map Story Studio V1.2 — Overture PMTiles C2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic Publish/Freeze workflow that creates one durable project-area Overture buildings PMTiles snapshot from the pinned authoring release, packages it as a declared frozen-project asset, renders Folder/ZIP/R2 snapshots through the same certified MapLibre + PMTiles runtime, and preserves C1 camera/source stability.

**Architecture:** Keep Studio authoring on the official pinned Overture archive and generate a separate frozen publication package rather than mutating the authoring project. Extend Project Manifest V1 only with a bounded `pmtiles` asset kind; use upstream PMTiles `FetchSource` for official/R2 archives and `FileSource` for Folder/ZIP preview through one archive-binding seam. Studio computes the required snapshot extent from the existing production preview and exports a transient fingerprinted Freeze plan; a small Node orchestrator invokes pinned `go-pmtiles v1.31.2` for dry-run/extract/verify and atomically produces the frozen package.

**Tech Stack:** Existing native browser ESM Map Story Studio; MapLibre GL JS; vendored PMTiles JavaScript `4.5.0`; Node.js test runner and Web Crypto; vendored `fflate 0.8.3`; native Protomaps `go-pmtiles` CLI `1.31.2`; existing File System Access, Folder/ZIP package, preview bridge, and CDP browser-certification patterns; Cloudflare Pages for application assets and Cloudflare R2 for immutable PMTiles objects.

**Spec:** `docs/superpowers/specs/2026-09-03-map-story-studio-v1-2-overture-pmtiles-c2-design.md`

## Global Constraints

- Implementation starts from the approved design/plan branch `design/map-story-studio-v1-2-overture-pmtiles-c2`, whose design commit is `f570d9df02903ef8447d3b0cab14e92e73abb1cf`; create the implementation worktree/branch only at execution time.
- Before implementation, fetch and require `origin/main == 88e6c4c88088b8170d8c592aab004e275b1b8fc2` and merge-base exactly that commit. If main moved, STOP and review drift before rebasing.
- Baseline tree is `427ca7dc07b3889a8d250d013e21ff73c53ab684`.
- Canonical Route Story SHA-256 must remain `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`.
- Do not modify `data/schemas/story-1.1.schema.json`, `data/schemas/story-1.2.schema.json`, `data/stories/route-61-2.story.json`, or `src/map/geojson-renderer.js`.
- `data/schemas/project-manifest-v1.schema.json` is the one intentionally mutable production schema: add only the approved PMTiles asset variant; `schemaVersion` remains `1.0` and every existing Project Manifest V1 remains valid.
- Preserve `data/context/my-phuoc-1-buildings.geojson` and its 1,299-building benchmark semantics.
- Keep the C1 authoring mode name exactly `overture-pmtiles`; add only `project-snapshot`; retain `local-geojson`.
- Keep `urban-context-v1` actions exactly `context.set-mode` with modes `off` and `industrial-context`; preserve legacy `map.urban-context` normalization.
- Authoring release remains exactly `2026-08-19.0`; official URL remains trusted code derived from the release, never authored.
- PMTiles browser runtime remains vendored version `4.5.0`; do not add a PMTiles package dependency, CDN, bundler, or alternate client.
- Native extraction tool is exactly `go-pmtiles / pmtiles 1.31.2`; never execute unverified `latest` or an arbitrary PATH binary.
- Snapshot extraction uses one project bbox, source min/max zoom, `downloadThreads=4`, `overfetch=0.05`, and exactly one final project snapshot; never extract per Scene.
- Snapshot classifications: `<= 32 MiB` healthy, `> 32 MiB && <= 64 MiB` allowed with warning, `> 64 MiB` blocked. Do not raise `PROJECT_ZIP_LIMITS.maxEntryBytes`.
- Folder Open must not call full `arrayBuffer()` for declared PMTiles assets; unchanged Folder Save must not rewrite the PMTiles file.
- Frozen ZIP round-trip must preserve PMTiles bytes exactly.
- Cloudflare Pages must not serve the PMTiles snapshot. Hosted PMTiles lives on R2/custom-domain storage with real Range/206 support; no Worker, proxy, service worker, or tile server.
- Frozen-source failure is non-fatal optional context and must never fall back to official Overture, local GeoJSON, or synthetic buildings.
- Keep one MapLibre map/canvas, one PMTiles protocol, one building source, one flat layer, and one extrusion layer.
- Camera pan/zoom/bearing/pitch may request genuinely missing tiles, but may not recreate the source/layers/protocol/archive binding.
- Do not add a custom tile cache or depend on browser Range caching for correctness.
- The transient Freeze-plan JSON is build orchestration only. It is downloaded outside the production project package and must never be added to `project.json`, Folder managed resources, ZIP exports, Story data, or undo/history.
- Freeze input in C2 V1 must be a saved production-valid Folder whose `urban-context-v1.settings.buildingSource` is `overture-pmtiles`. Reject `project-snapshot` as a Freeze input; re-publication starts from the authoring project.
- Use focused tests during development. Run full `npm test` exactly once locally after all executable C2 changes are complete; exact-head GitHub Actions may run it again.
- Do not commit downloaded native `pmtiles` executables, downloaded Overture global archives, generated project snapshots, R2 credentials, or temporary frozen output folders.
- Keep implementation PR Draft until independent review and all available C2 gates pass. If no real R2 endpoint is available, leave the hosted-publication gate explicitly pending rather than claiming C2 certification.

---

## Locked File Structure

### New production/support files

- `editor/publish/freeze-plan.js` — browser-neutral C2 publication-plan helpers: context-active Scene derivation, bounds union/enlargement validation, declared-package fingerprinting, and immutable Freeze-plan construction.
- `scripts/tools/go-pmtiles-1.31.2.json` — exact official native release artifact names, URLs, and release-archive SHA-256 digests.
- `scripts/lib/pmtiles-tool.mjs` — pinned native-tool download/cache/verification/extraction boundary.
- `scripts/lib/freeze-project.mjs` — dry-run parsing, project fingerprint validation, Overture source identity, extraction/verify/show/hash, frozen manifest construction, production validation, and atomic output swap.
- `scripts/freeze-overture-snapshot.mjs` — thin CLI argument boundary over `freeze-project.mjs`.
- `src/project/hosted-asset-resolver.js` — trusted content-addressed PMTiles URL resolver for an explicitly configured hosted R2 origin; non-PMTiles assets remain unchanged.
- `scripts/r2-pmtiles-range-probe.mjs` — standalone real HTTP Range/206 validation for a hosted snapshot URL.
- `scripts/overture-pmtiles-c2-browser-certification.mjs` — bounded C2 browser/runtime/camera/performance evidence harness using the established CDP style.
- `tests/overture-freeze-plan.test.mjs` — publication-plan unit tests.
- `tests/overture-freeze-tool.test.mjs` — pinned tool-lock/acquisition unit tests with injected I/O/process boundaries.
- `tests/overture-freeze-project.test.mjs` — transactional Freeze/orchestrator unit tests with a fake `pmtiles` process runner.
- `tests/hosted-pmtiles-resolver.test.mjs` — content-addressed hosted resolver tests.
- `review/map-story-studio-v1-2/overture-pmtiles/C2.md` — final measured C2 evidence; create only during certification.

### Existing production/editor files expected to change

- `data/schemas/project-manifest-v1.schema.json` — additive `pmtiles` asset/media-type support only.
- `src/project/project-schema.js` — exact asset-type/media-type semantic pairing.
- `src/project/reference-validator.js` — bounded `project-snapshot` capability/asset cross-reference and snapshot metadata validation.
- `src/project/project-loader.js` — pass frozen manifest context into the existing `resolveAssetUrl` hook so a trusted hosted resolver can derive content-addressed R2 URLs.
- `src/overture-pmtiles.js` — official/project archive binding, local FileSource registration, bounded source URL/bounds construction, idempotent archive registration.
- `src/urban-context.js` — shared PMTiles install path for `overture-pmtiles` and `project-snapshot`, destination-first first activation, stable source reuse/status/failure behavior.
- `src/capabilities/urban-context-v1.js` — snapshot settings shape and trusted archive-binding construction from resolved project resources.
- `src/route-61-2/runtime-adapter.js` — carry the bounded archive binding through the existing shared adapter without changing route-comparison semantics.
- `src/runtime/generic-app.js` — carry the optional local PMTiles file resolver through production application context; no alternate composition.
- `editor/core/package-store.js` — one lazy file-backed package-entry form for declared PMTiles assets; unchanged byte-backed behavior for all other resources.
- `editor/storage/adapters.js` — Folder lazy PMTiles open and explicit materialization only for ZIP export; preserve resource-first/project-last writes.
- `editor/preview/bridge.js` — preview snapshots may contain byte-backed entries or a bounded file-backed PMTiles entry; add request/response for exact Scene-camera capture.
- `editor/preview/package-resolver.js` — preserve lazy File across preview transport and expose only a PMTiles-file resolver in addition to existing image Blob URLs.
- `editor/editor.js` — PMTiles excluded from image catalogs, transient urban status supports `project-snapshot`, and Prepare Freeze orchestration/dialog behavior.
- `editor/index.html` — one `Prepare Freeze` project/output command and one bounded extent confirmation dialog.
- `editor/editor.css` — only styles required by the Freeze dialog/status; no unrelated redesign.
- `.gitignore` — ignore `.cache/map-story-tools/`.
- `package.json` — add `freeze:overture` script only; no package dependencies.

### Existing tests expected to change

- `tests/project-schema.test.mjs`
- `tests/reference-validator.test.mjs` if present; otherwise extend the current project/reference test file discovered at execution time and do not create a duplicate-purpose file.
- `tests/project-loader.test.mjs`
- `tests/capability-descriptors.test.mjs`
- `tests/overture-pmtiles.test.mjs`
- `tests/urban-context.test.mjs`
- `tests/route-61-2-runtime-adapter.test.mjs`
- `tests/editor-folder-storage.test.mjs`
- `tests/editor-zip-storage.test.mjs`
- `tests/editor-package-resolver.test.mjs`
- `tests/editor-preview-bridge.test.mjs`
- `tests/editor-studio-preview.test.mjs`
- `tests/editor-capability-authoring.test.mjs`
- `tests/route-61-2-project.test.mjs`
- `tests/application-composition.test.mjs`

---

## PR / Review Slices

Implement in three reviewable slices without merging between slices:

1. **C2-A — Frozen resource/runtime contract:** Tasks 1–4. A synthetic `project-snapshot` project loads from remote URL and local FileSource while C1 remains unchanged.
2. **C2-B — Publish/Freeze generation:** Tasks 5–7. Studio produces a stale-safe publication plan and the native CLI produces a deterministic frozen Folder/ZIP package transactionally.
3. **C2-C — Hosted publication + certification:** Tasks 8–9. R2 mapping/Range probe and full Route 61-2 C1/C2 certification evidence.

Each task below ends in a commit and focused GREEN test set. Do not squash task commits before review.

---

### Task 1: Add the bounded PMTiles asset and project-snapshot contract

**Files:**
- Modify: `data/schemas/project-manifest-v1.schema.json`
- Modify: `src/project/project-schema.js`
- Modify: `src/project/reference-validator.js`
- Modify: `src/capabilities/urban-context-v1.js`
- Modify: `editor/editor.js`
- Modify: `tests/project-schema.test.mjs`
- Modify: `tests/capability-descriptors.test.mjs`
- Modify: the existing reference-validation test file that imports `validateManifestReferences` / `validateResolvedReferences`
- Modify: `tests/editor-capability-authoring.test.mjs`

**Interfaces:**
- Produces manifest asset form:

```js
{
  type: 'pmtiles',
  src: './assets/context/overture-buildings.pmtiles',
  mediaType: 'application/vnd.pmtiles',
  required: true,
  attribution: ['overture-maps']
}
```

- Produces `urban-context-v1.settings.buildingSource` enum exactly `['overture-pmtiles', 'project-snapshot', 'local-geojson']`.
- Produces snapshot settings with required logical fields `asset`, `theme`, `bounds`, `sha256`, `byteLength`, `generator`, `generatorVersion`, `generatedAt`; optional `sourceContentLength`, `sourceEtag`.
- `validateManifestReferences()` owns cross-resource semantics: `project-snapshot` requires exactly one valid snapshot object and a declared PMTiles asset; non-snapshot source modes must not serialize `snapshot`.
- Existing image assets remain unchanged and PMTiles assets are never included in Studio image selection catalogs.

- [ ] **Step 1: Write RED Project Manifest asset tests**

Extend `tests/project-schema.test.mjs` with an otherwise-valid manifest whose asset is:

```js
manifest.assets['overture-buildings-snapshot'] = {
  type: 'pmtiles',
  src: './assets/context/overture-buildings.pmtiles',
  mediaType: 'application/vnd.pmtiles',
  required: true,
  attribution: []
};
assert.equal(validateProjectManifest(manifest), manifest);
```

Also require these invalid combinations to throw `PROJECT_MANIFEST_INVALID` at the asset field:

```js
[
  { type: 'image', mediaType: 'application/vnd.pmtiles' },
  { type: 'pmtiles', mediaType: 'image/png' },
  { type: 'pmtiles', mediaType: 'application/octet-stream' }
]
```

Run:

```bash
node --test tests/project-schema.test.mjs
```

Expected: RED because the current schema only accepts `type: image` and image MIME types.

- [ ] **Step 2: Implement the additive asset schema and exact semantic pairing**

In `data/schemas/project-manifest-v1.schema.json`, expand only the current asset `type` and `mediaType` enums:

```json
"type": { "type": "string", "enum": ["image", "pmtiles"] },
"mediaType": {
  "type": "string",
  "enum": [
    "image/avif", "image/gif", "image/jpeg", "image/png", "image/svg+xml", "image/webp",
    "application/vnd.pmtiles"
  ]
}
```

Do not add `oneOf`/`if` because the repository's bounded schema validator does not implement those keywords. In `src/project/project-schema.js`, add exact semantic pairing:

```js
const IMAGE_MEDIA_TYPES = new Set([
  'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'
]);
const PMTILES_MEDIA_TYPE = 'application/vnd.pmtiles';

function validateAssetKinds(assets) {
  for (const [id, asset] of Object.entries(assets)) {
    const path = `$.assets.${id}`;
    if (asset.type === 'image' && !IMAGE_MEDIA_TYPES.has(asset.mediaType)) {
      fail(`${path}.mediaType`, 'Image asset media type is invalid.');
    }
    if (asset.type === 'pmtiles' && asset.mediaType !== PMTILES_MEDIA_TYPE) {
      fail(`${path}.mediaType`, 'PMTiles asset media type must be application/vnd.pmtiles.');
    }
  }
}
```

Call it after base schema validation and before returning the manifest.

Run the focused schema test; expected PASS.

- [ ] **Step 3: Write RED project-snapshot settings/reference tests**

In the existing reference/capability tests, construct this declaration and matching asset:

```js
const snapshot = {
  asset: 'overture-buildings-snapshot',
  theme: 'buildings',
  bounds: [106.58, 11.10, 106.62, 11.15],
  sha256: 'a'.repeat(64),
  byteLength: 12_345_678,
  generator: 'go-pmtiles',
  generatorVersion: '1.31.2',
  generatedAt: '2026-09-03T02:00:00Z'
};
```

Require PASS for `buildingSource: 'project-snapshot'` with that object and the declared PMTiles asset. Require failures for all of these cases, with path-specific errors:

```text
project-snapshot without snapshot
snapshot.asset missing from manifest.assets
snapshot.asset points to image asset
snapshot bounds length != 4
longitude outside [-180,180]
latitude outside [-90,90]
minLon >= maxLon or minLat >= maxLat
sha256 not 64 lowercase hex
byteLength <= 0
byteLength > 67108864
theme != buildings
generator != go-pmtiles
generatorVersion != 1.31.2
generatedAt is not a valid ISO instant
overture-pmtiles with a snapshot object
local-geojson with a snapshot object
```

Run the focused tests; expected RED on the new source mode/reference rules.

- [ ] **Step 4: Extend the trusted capability descriptor without weakening C1**

In `src/capabilities/urban-context-v1.js`, keep the existing descriptor structure and add:

```js
buildingSource: {
  type: 'string',
  enum: ['overture-pmtiles', 'project-snapshot', 'local-geojson']
},
snapshot: {
  type: 'object',
  additionalProperties: false,
  properties: {
    asset: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    theme: { type: 'string', const: 'buildings' },
    bounds: { type: 'array', items: { type: 'number' } },
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    byteLength: { type: 'integer', minimum: 1, maximum: 67108864 },
    generator: { type: 'string', const: 'go-pmtiles' },
    generatorVersion: { type: 'string', const: '1.31.2' },
    generatedAt: { type: 'string' },
    sourceContentLength: { type: 'integer', minimum: 0 },
    sourceEtag: { type: 'string' }
  }
}
```

Do not rely on descriptor schema alone for conditional presence or the exact bounds/ISO rules; Step 5 owns those semantic checks.

- [ ] **Step 5: Add one bounded capability-reference validator**

In `src/project/reference-validator.js`, add a local helper that finds the declared `urban-context-v1` capability and enforces the RED cases above. Keep this C2-specific rather than inventing a generic plugin-reference framework.

Use exact limits:

```js
const PMTILES_MEDIA_TYPE = 'application/vnd.pmtiles';
const PMTILES_MAX_BYTES = 64 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
```

For `generatedAt`, require a string ending in `Z` whose `Date.parse()` is finite and whose `new Date(value).toISOString()` equals the normalized input when milliseconds are represented consistently; accept both `2026-09-03T02:00:00Z` and `2026-09-03T02:00:00.000Z` by normalizing before comparison.

Call this helper from `validateManifestReferences(manifest)` after registry/attribution validation. Do not change Story reference semantics.

Run the focused reference/capability tests; expected PASS.

- [ ] **Step 6: Keep PMTiles out of image authoring catalogs**

In `editor/editor.js`, change the current asset catalog construction from all manifest assets to image assets only:

```js
assets: Object.entries(manifest.assets)
  .filter(([, descriptor]) => descriptor.type === 'image')
  .map(([id, descriptor]) => ({ id, label: descriptor.label ?? id }))
```

Extend `presentUrbanContextSetting('buildingSource')` with:

```js
{ value: 'project-snapshot', label: 'Project snapshot' }
```

Add tests proving image insertion does not list a PMTiles asset and capability authoring recognizes all three trusted modes.

Run:

```bash
node --test tests/project-schema.test.mjs tests/capability-descriptors.test.mjs tests/editor-capability-authoring.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add data/schemas/project-manifest-v1.schema.json src/project/project-schema.js src/project/reference-validator.js src/capabilities/urban-context-v1.js editor/editor.js tests/project-schema.test.mjs tests/capability-descriptors.test.mjs tests/editor-capability-authoring.test.mjs tests
 git diff --check
 git commit -m "feat: add frozen PMTiles project contract"
```

The broad `tests` add in this task is allowed only for the already-existing reference-validation test file edited in Step 3; inspect `git status --short` before committing and remove unrelated paths.

---

### Task 2: Preserve PMTiles lazily across Folder, ZIP, and preview transport

**Files:**
- Modify: `editor/core/package-store.js`
- Modify: `editor/storage/adapters.js`
- Modify: `editor/preview/bridge.js`
- Modify: `editor/preview/package-resolver.js`
- Modify: `src/runtime/generic-app.js`
- Modify: `tests/editor-folder-storage.test.mjs`
- Modify: `tests/editor-zip-storage.test.mjs`
- Modify: `tests/editor-package-resolver.test.mjs`
- Modify: `tests/editor-preview-bridge.test.mjs`
- Modify: `tests/application-composition.test.mjs`

**Interfaces:**
- Package entries are exactly one of:

```js
// byte-backed
{ path, originalBytes, currentBytes, mediaType, kind, managed, persisted }

// persisted lazy PMTiles Folder entry
{ path, file, byteLength, mediaType: 'application/vnd.pmtiles', kind: 'asset', managed: true, persisted: true }
```

- `PackageStore.snapshot()` emits regular entries as `{ path, bytes, mediaType, kind }` and lazy PMTiles as `{ path, file, mediaType, kind }`.
- Preview snapshot validation accepts only those two exact entry shapes. File-backed entries must be `kind === 'asset'`, PMTiles MIME, finite `file.size`, and count toward the existing 256 MiB preview ceiling.
- `createPreviewPackageResolver()` adds `resolvePmtilesAssetFile(url, { id, descriptor }) -> File`; existing image `resolveAssetUrl()` behavior is unchanged.
- `createGenericApplicationOptions()` carries `resolvePmtilesAssetFile` through application context; it does not use it itself.
- ZIP export may explicitly materialize the PMTiles File because export is an explicit user operation; ordinary Folder Open/Save may not.

- [ ] **Step 1: Write RED Folder lazy-read tests**

Extend the `fakeDirectory()` in `tests/editor-folder-storage.test.mjs` so returned fake files expose both `size`, `slice()`, and a counted `arrayBuffer()` call. Add a manifest PMTiles asset and assert after Folder Open:

```js
const entry = opened.entries.find(({ path }) => path === 'assets/context/overture-buildings.pmtiles');
assert.equal(entry.mediaType, 'application/vnd.pmtiles');
assert.equal(entry.kind, 'asset');
assert.equal(entry.bytes, undefined);
assert.equal(entry.file.size, pmtilesBytes.length);
assert.equal(fs.arrayBufferReads.get('assets/context/overture-buildings.pmtiles') ?? 0, 0);
```

Then open the package store, mutate only `project.json`, Save, and assert the PMTiles path is absent from writes and still has zero full `arrayBuffer()` reads.

Run:

```bash
node --test tests/editor-folder-storage.test.mjs
```

Expected: RED because Folder Open currently calls `file.arrayBuffer()` for every declared resource.

- [ ] **Step 2: Add one lazy PMTiles entry form to Folder/package store**

In `editor/storage/adapters.js`, keep ordinary `readEntry()` byte-backed but branch only on PMTiles MIME:

```js
if (descriptor.mediaType === 'application/vnd.pmtiles') {
  return { ...descriptor, file, byteLength: file.size, managed: true };
}
```

In `editor/core/package-store.js`, preserve byte-backed behavior and add exact lazy-file handling:

- constructor accepts `input.file` only when no byte fields are supplied;
- `get()`/`list()` retain `file` and `byteLength`;
- `setCurrentBytes()` rejects a lazy file-backed entry with a clear `TypeError`; C2 does not edit PMTiles bytes in Studio;
- `snapshot()` returns `{ path, file, mediaType, kind }` for lazy entries;
- `changeSet()` excludes an unchanged persisted lazy file entry;
- `markWritten()` leaves an unchanged lazy entry intact;
- `removeManaged()` may remove the declaration/entry normally.

Do not add a general stream/provider abstraction.

Run the Folder test; expected PASS.

- [ ] **Step 3: Write RED ZIP explicit-materialization tests**

Extend `tests/editor-zip-storage.test.mjs` with a package store containing a lazy PMTiles File and assert `exportProjectPackageZip()`/adapter export includes exact PMTiles bytes. Because materialization is asynchronous, require the export path to be awaitable:

```js
const zipBytes = await exportProjectPackageZip(store);
```

Round-trip through `createZipStorageAdapter({ zipBytes }).open()` and assert byte identity for `assets/context/overture-buildings.pmtiles`.

Run the ZIP test; expected RED until export handles lazy files.

- [ ] **Step 4: Materialize lazy files only during explicit ZIP export**

Make `exportProjectPackageZip(packageStore)` asynchronous and build `staged[path]` with:

```js
const bytes = entry.currentBytes
  ? entry.currentBytes.slice()
  : new Uint8Array(await entry.file.arrayBuffer());
staged[entry.path] = bytes;
```

Update `createZipStorageAdapter().export()` and existing call sites/tests to `await` the export. Keep `PROJECT_ZIP_LIMITS` unchanged and keep the private-path filtering/pass-through policy unchanged.

Run:

```bash
node --test tests/editor-folder-storage.test.mjs tests/editor-zip-storage.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write RED preview snapshot/file resolver tests**

In `tests/editor-preview-bridge.test.mjs`, require `validatePreviewSnapshot()` to accept one PMTiles file-backed entry and reject file-backed JSON/image/non-asset entries. Count `file.size` against `PREVIEW_PACKAGE_MAX_BYTES`.

In `tests/editor-package-resolver.test.mjs`, require:

```js
const file = resolver.resolvePmtilesAssetFile(
  new URL('assets/context/overture-buildings.pmtiles', resolver.manifestUrl),
  { id: 'overture-buildings-snapshot', descriptor: { type: 'pmtiles', mediaType: 'application/vnd.pmtiles' } }
);
assert.equal(file.size, sourceFile.size);
```

For byte-backed ZIP PMTiles entries, require resolver to return a `File` constructed from those bytes. Existing image resolver tests must remain unchanged.

Run the two tests; expected RED.

- [ ] **Step 6: Extend preview transport with a PMTiles-only File seam**

In `editor/preview/bridge.js`, replace the byte-only exact-key validation with a discriminated validator:

```text
byte entry keys: path, bytes, mediaType, kind
file entry keys: path, file, mediaType, kind
```

File entries are valid only for `kind === 'asset'` and `mediaType === 'application/vnd.pmtiles'`.

In `editor/preview/package-resolver.js`:

- clone byte entries with `.slice()` and retain `File` objects as structured-cloneable values;
- allow `fetchImpl` to return `new Response(entry.bytes ?? entry.file, ...)` if asked, but PMTiles runtime must use the dedicated file seam;
- keep `resolveAssetUrl()` image-only;
- add `resolvePmtilesAssetFile()` that validates package containment, declared PMTiles type/media type, and returns the existing File or `new File([entry.bytes], basename, { type: entry.mediaType })` for ZIP bytes.

Return it from the resolver alongside `manifestUrl`, `fetchImpl`, `resolveAssetUrl`, and `revoke`.

In `src/runtime/generic-app.js`, add `resolvePmtilesAssetFile` to `createGenericApplicationOptions()` arguments and returned context. Do not alter `startApplication()`; it already carries extra context into bootstrap/capabilities.

Run:

```bash
node --test tests/editor-package-resolver.test.mjs tests/editor-preview-bridge.test.mjs tests/application-composition.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add editor/core/package-store.js editor/storage/adapters.js editor/preview/bridge.js editor/preview/package-resolver.js src/runtime/generic-app.js tests/editor-folder-storage.test.mjs tests/editor-zip-storage.test.mjs tests/editor-package-resolver.test.mjs tests/editor-preview-bridge.test.mjs tests/application-composition.test.mjs
 git diff --check
 git commit -m "feat: keep frozen PMTiles lazy in project storage"
```

---

### Task 3: Add one remote/local PMTiles archive-binding runtime

**Files:**
- Modify: `src/overture-pmtiles.js`
- Modify: `src/capabilities/urban-context-v1.js`
- Modify: `src/route-61-2/runtime-adapter.js`
- Modify: `src/urban-context.js`
- Modify: `tests/overture-pmtiles.test.mjs`
- Modify: `tests/urban-context.test.mjs`
- Modify: `tests/route-61-2-runtime-adapter.test.mjs`
- Modify: `tests/project-loader.test.mjs`
- Modify: `tests/route-61-2-project.test.mjs`

**Interfaces:**
- Add to `src/overture-pmtiles.js`:

```js
export function createOverturePmtilesArchiveBinding({
  settings,
  resources,
  resolvePmtilesAssetFile
}) {}

export async function ensurePmtilesArchive(maplibregl, binding, {
  loadPmtiles = loadPmtilesBrowser
} = {}) {}
```

- Binding shapes are internal trusted runtime data:

```js
{ kind: 'url', source: 'overture-pmtiles', release, url, bounds: null, key }
{ kind: 'url', source: 'project-snapshot', release, url, bounds, key: `snapshot:${sha256}` }
{ kind: 'file', source: 'project-snapshot', release, file, bounds, key: `snapshot:${sha256}` }
```

- `createOverturePmtilesLayerDefinitions()` remains backward-compatible with `{ release }` and also accepts `{ archiveUrl, bounds }`; the source uses the same IDs/layers/expressions as C1 and adds `bounds` only for a project snapshot.
- `ensurePmtilesArchive()` returns `{ protocol, archiveUrl }`. For URL binding, `archiveUrl` is the remote URL. For File binding, it registers one `PMTiles(FileSource)` instance through the already-registered protocol and returns its collision-safe source key.
- `urban-context-v1` constructs the binding from trusted settings + `context.resources` + optional `context.resolvePmtilesAssetFile`; route adapter only carries that binding to the urban controller.

- [ ] **Step 1: Write RED archive-binding tests**

In `tests/overture-pmtiles.test.mjs`, build frozen resource fixtures and require:

```js
const remote = createOverturePmtilesArchiveBinding({
  settings: { buildingSource: 'project-snapshot', overtureRelease: '2026-08-19.0', snapshot },
  resources: new Map([['overture-buildings-snapshot', {
    id: 'overture-buildings-snapshot',
    descriptor: { type: 'pmtiles', mediaType: 'application/vnd.pmtiles' },
    url: new URL('https://r2.example.test/projects/route-61-2/a/overture-buildings.pmtiles')
  }]])
});
assert.equal(remote.kind, 'url');
assert.equal(remote.source, 'project-snapshot');
assert.deepEqual(remote.bounds, snapshot.bounds);
```

With an injected `resolvePmtilesAssetFile` returning a File, require `kind === 'file'` and the exact same bounds/key.

Also require C1 official binding to derive the unchanged official URL and local-geojson to return `null`.

Run:

```bash
node --test tests/overture-pmtiles.test.mjs
```

Expected: RED.

- [ ] **Step 2: Implement binding construction without loading PMTiles**

`createOverturePmtilesArchiveBinding()` must:

- return `null` for `local-geojson`;
- for `overture-pmtiles`, validate release with the existing pattern and return trusted official URL binding;
- for `project-snapshot`, fetch `resources.get(settings.snapshot.asset)`, require the already-validated PMTiles descriptor, then prefer `resolvePmtilesAssetFile(resource.url, { id: resource.id, descriptor: resource.descriptor })` when it returns a File; otherwise use `resource.url` as remote URL;
- never accept a URL from settings/snapshot authored data;
- clone/freeze bounds.

Run focused binding tests; expected PASS.

- [ ] **Step 3: Write RED FileSource protocol-registration tests**

Stub the loaded PMTiles global with fake `Protocol`, `FileSource`, and `PMTiles` classes. Require:

```text
ensurePmtilesArchive(url binding) does not call Protocol.add()
ensurePmtilesArchive(file binding) constructs exactly one FileSource and one PMTiles
ensurePmtilesArchive(file binding) calls Protocol.add() exactly once
repeating the same file binding reuses registration
same physical filename with a different snapshot SHA gets a distinct protocol key
```

The File passed to upstream `FileSource` must have a hash-qualified internal name such as:

```text
overture-buildings-a...a.pmtiles
```

where the full 64-character snapshot hash is used, not a truncated collision-prone key. Create that alias with `new File([originalFile], aliasName, { type: 'application/vnd.pmtiles' })`; this keeps upstream `FileSource` random reads and avoids application-written range logic.

Run focused tests; expected RED.

- [ ] **Step 4: Implement idempotent archive registration**

Keep the existing process-lifetime `protocolByMapLibre` WeakMap. Add a second WeakMap keyed by the returned protocol whose value is `Map<binding.key, Promise<string>>`.

For a file binding:

```js
const pmtiles = await loadPmtiles();
const alias = new File([binding.file], `overture-buildings-${binding.key.slice('snapshot:'.length)}.pmtiles`, {
  type: 'application/vnd.pmtiles'
});
const archive = new pmtiles.PMTiles(new pmtiles.FileSource(alias));
protocol.add(archive);
return archive.source.getKey();
```

If the vendored 4.5.0 IIFE exposes the same API under different property names, stop and verify the exact vendored exports rather than introducing another library. Preserve C1 protocol registration behavior.

- [ ] **Step 5: Generalize layer definitions only at the archive URL seam**

Keep existing style IDs/paint expressions unchanged. Implement:

```js
export function createOverturePmtilesLayerDefinitions({ release, archiveUrl, bounds } = {}) {
  const resolvedArchiveUrl = archiveUrl ?? deriveOvertureBuildingsPmtilesUrl(release);
  return {
    source: {
      type: 'vector',
      url: `pmtiles://${resolvedArchiveUrl}`,
      attribution: '© <a href="https://overturemaps.org/">Overture Maps Foundation</a>',
      ...(bounds ? { bounds: [...bounds] } : {})
    },
    flat: /* unchanged C1 definition */,
    extrusion: /* unchanged C1 definition */
  };
}
```

Add tests proving the old `{ release }` call produces exactly the existing URL and project snapshot produces source bounds.

- [ ] **Step 6: Thread the archive binding through the trusted capability/adapter**

In `selectUrbanContextAdapter(settings, context)`, construct the binding and call:

```js
adapter.configureUrbanContext({
  buildingSource: settings.buildingSource ?? 'local-geojson',
  overtureRelease: settings.overtureRelease ?? '2026-08-19.0',
  archiveBinding
});
```

Update the Route 61-2 adapter's bounded urban config to include `archiveBinding` and preserve its shared WeakMap identity. It must not inspect R2 URLs or FileSource internals.

Update adapter tests to prove route-comparison delegates/settings are unchanged.

- [ ] **Step 7: Use one PMTiles install path in `src/urban-context.js`**

Rename internal `installOnlineContext`/listener variables to PMTiles-neutral names only where needed for clarity. Both `overture-pmtiles` and `project-snapshot` use:

```text
ensure protocol/archive binding
→ create same MapLibre source/layers
→ same source IDs
→ same visibility/status lifecycle
```

Status payload `source` must equal the configured source mode, so `project-snapshot` is observable separately. Failure hides only urban context and preserves Story usability. Do not add fallback.

Run:

```bash
node --test tests/overture-pmtiles.test.mjs tests/urban-context.test.mjs tests/route-61-2-runtime-adapter.test.mjs tests/project-loader.test.mjs tests/route-61-2-project.test.mjs
```

Expected: PASS, including all existing C1 cases.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/overture-pmtiles.js src/capabilities/urban-context-v1.js src/route-61-2/runtime-adapter.js src/urban-context.js tests/overture-pmtiles.test.mjs tests/urban-context.test.mjs tests/route-61-2-runtime-adapter.test.mjs tests/project-loader.test.mjs tests/route-61-2-project.test.mjs
 git diff --check
 git commit -m "feat: render frozen PMTiles through shared runtime"
```

---

### Task 4: Make first activation destination-first and prove camera/source stability

**Files:**
- Modify: `src/urban-context.js`
- Modify: `tests/urban-context.test.mjs`
- Modify: `tests/overture-pmtiles.test.mjs` only if archive-install observability needs a focused assertion.

**Interfaces:**
- Add an internal `waitForSettledCamera(map)` helper; no public Story/action API changes.
- On first PMTiles activation: PMTiles library/protocol/archive binding may initialize immediately, but MapLibre source/layers are not installed while the map is actively moving.
- Once source/layers exist, later camera motion never calls archive/source installation again.

- [ ] **Step 1: Write RED destination-first test**

Create a map stub where `isMoving()` returns `true` after PMTiles protocol/archive resolution and `once('moveend', ...)` is controllable. Call `setMode('industrial-context')` and assert before firing `moveend`:

```js
assert.equal(map.addSourceCalls.length, 0);
assert.equal(map.addLayerCalls.length, 0);
```

After firing `moveend`, await activation and require exactly one source + flat + extrusion install.

Also cover `isMoving() === false` to prove no unnecessary delay.

Run:

```bash
node --test tests/urban-context.test.mjs
```

Expected: RED because C1 installs immediately after protocol readiness.

- [ ] **Step 2: Implement destination-first first install**

After `await ensureArchive(...)` and before `map.addSource(...)`, yield at least one microtask so the synchronously following `map.focus` action can start, then:

```js
async function waitForSettledCamera(map) {
  await Promise.resolve();
  if (!map.isMoving?.()) return;
  await new Promise((resolve) => map.once('moveend', resolve));
}
```

Guard destruction after the wait. Do not reorder Story actions or alter `story-action-runner.js`.

- [ ] **Step 3: Write and pass stable-reuse tests**

Activate snapshot context, then simulate:

```text
context off → on
moveend after pan
moveend after bearing change
moveend after pitch change
```

Require installation counters remain:

```text
protocol 1
archive registration 1
source 1
flat layer 1
extrusion layer 1
```

Do not assert zero tile reads; unit tests only assert no application-level reconstruction.

Run `tests/urban-context.test.mjs`; expected PASS.

- [ ] **Step 4: Commit Task 4 / C2-A review gate**

```bash
git add src/urban-context.js tests/urban-context.test.mjs tests/overture-pmtiles.test.mjs
 git diff --check
 git commit -m "perf: stabilize PMTiles camera activation"
```

At this point run only the focused C2-A regression set:

```bash
node --test tests/project-schema.test.mjs tests/capability-descriptors.test.mjs tests/project-loader.test.mjs tests/overture-pmtiles.test.mjs tests/urban-context.test.mjs tests/route-61-2-runtime-adapter.test.mjs tests/editor-folder-storage.test.mjs tests/editor-zip-storage.test.mjs tests/editor-package-resolver.test.mjs tests/editor-preview-bridge.test.mjs tests/editor-capability-authoring.test.mjs tests/route-61-2-project.test.mjs
```

Expected: PASS. Do not run full `npm test` yet.

---

### Task 5: Derive and export a stale-safe Freeze plan from the shared production preview

**Files:**
- Create: `editor/publish/freeze-plan.js`
- Create: `tests/overture-freeze-plan.test.mjs`
- Modify: `editor/preview/bridge.js`
- Modify: `editor/preview/package-resolver.js`
- Modify: `editor/editor.js`
- Modify: `editor/index.html`
- Modify: `editor/editor.css`
- Modify: `tests/editor-preview-bridge.test.mjs`
- Modify: `tests/editor-studio-preview.test.mjs`

**Interfaces:**
- `editor/publish/freeze-plan.js` exports:

```js
export const FREEZE_PLAN_KIND = 'overture-pmtiles-c2-freeze-plan';
export const FREEZE_PLAN_VERSION = 1;
export const FREEZE_VIEWPORT_PROFILES = Object.freeze([
  Object.freeze({ id: 'desktop', width: 1920, height: 1080 }),
  Object.freeze({ id: 'mobile', width: 390, height: 844 })
]);
export function contextActiveSceneIndices(story) {}
export function unionBounds(bounds) {}
export function validateFreezeBounds(requiredBounds, finalBounds) {}
export async function computeDeclaredPackageFingerprint(snapshot, { cryptoRef = globalThis.crypto } = {}) {}
export async function createOvertureFreezePlan(input) {}
```

- Freeze plan JSON shape is exactly:

```js
{
  kind: 'overture-pmtiles-c2-freeze-plan',
  version: 1,
  projectId,
  projectFingerprint,
  overtureRelease,
  requiredBounds: [minLon, minLat, maxLon, maxLat],
  finalBounds: [minLon, minLat, maxLon, maxLat],
  profiles: [
    { id: 'desktop', width: 1920, height: 1080, scenes: [{ index, id, bounds }] },
    { id: 'mobile', width: 390, height: 844, scenes: [{ index, id, bounds }] }
  ],
  createdAt
}
```

- Fingerprint algorithm: collect only `project.json` plus `collectDeclaredPackageEntries(manifest)`, sort by normalized path, SHA-256 each file, build UTF-8 material `${path}\0${fileHex}\n` for each entry, then SHA-256 that material. Browser and Node use the same function.
- Preview bridge adds `captureSceneCamera(index) -> Promise<{ index, center, zoom, pitch, bearing, bounds }>` implemented as one request/response pair; no production Story schema changes.

- [ ] **Step 1: Write RED pure Freeze-plan tests**

In `tests/overture-freeze-plan.test.mjs`, require `contextActiveSceneIndices()` to replay only these action forms:

```js
{ type: 'map.urban-context', mode: 'industrial-context' }
{ type: 'context.set-mode', mode: 'industrial-context' }
```

Replay previous state's `exit` context actions before current state's `enter` context actions, starting at `off`. Test persistence when a state omits a context action and deactivation through an exit action.

Require `unionBounds()` and `validateFreezeBounds()` to enforce ordered WGS84 bounds and allow enlargement only:

```js
assert.deepEqual(unionBounds([
  [106.59, 11.12, 106.60, 11.13],
  [106.58, 11.11, 106.62, 11.15]
]), [106.58, 11.11, 106.62, 11.15]);
assert.throws(() => validateFreezeBounds(
  [106.58, 11.11, 106.62, 11.15],
  [106.59, 11.12, 106.61, 11.14]
), /must contain/i);
```

Run:

```bash
node --test tests/overture-freeze-plan.test.mjs
```

Expected: RED because the module does not exist.

- [ ] **Step 2: Implement pure bounds/context helpers**

Implement only the two recognized context action types and exact `industrial-context`/`off` modes. Do not import route-specific Story constants. Bounds must be `[minLon,minLat,maxLon,maxLat]` with longitude `[-180,180]`, latitude `[-90,90]`, and strict min < max.

Run the test; bounds/context cases PASS.

- [ ] **Step 3: Add fingerprint RED/GREEN tests**

Build two snapshots with the same declared entries in different order and an extra undeclared managed file. Require the same fingerprint. Change one declared GeoJSON byte and require a different fingerprint.

Implement `computeDeclaredPackageFingerprint()` by parsing `project.json`, using existing `collectDeclaredPackageEntries()`, and hashing only the declared production paths plus `project.json`. Support byte-backed entries; Freeze input is authoring mode, so a lazy PMTiles entry is not required here. If encountered, materialize only that entry explicitly for fingerprinting rather than silently omitting it.

Use `cryptoRef.subtle.digest('SHA-256', bytes)` and lowercase hex.

- [ ] **Step 4: Write RED camera-capture request/response tests**

Extend `tests/editor-preview-bridge.test.mjs` so:

```js
const promise = bridge.captureSceneCamera(4);
```

posts `editor-preview:command` with name `capture-scene-camera` and `{ index: 4 }`, then resolves only when the iframe replies with a matching request ID and payload:

```js
{
  index: 4,
  center: [106.6, 11.13],
  zoom: 13.6,
  pitch: 52,
  bearing: -10,
  bounds: [[106.58, 11.11], [106.62, 11.15]]
}
```

Ignore stale revision/wrong request ID replies. Run bridge tests; expected RED.

- [ ] **Step 5: Implement bounded camera capture in bridge/preview host**

Add event type `editor-preview:freeze-camera` and command `capture-scene-camera` without changing existing event payloads.

Parent bridge keeps a `pendingCameraCaptures` Map by request ID and returns a Promise from `captureSceneCamera(index)`.

Preview host handles the command by:

1. call `activeRuntime.shell.activateScene(index, { animate: false })`;
2. call `activeRuntime.map.resize()`;
3. await one microtask and, if `map.isMoving()`, one `moveend`;
4. read `getCenter/getZoom/getPitch/getBearing/getBounds`;
5. post `freeze-camera` with the same request ID.

Do not add camera math in Studio.

Run bridge and Studio preview tests; expected PASS.

- [ ] **Step 6: Add a `Prepare Freeze` UI with exact profile sizing**

Add `button#prepare-freeze` in the Project/output command area and a dialog `#freeze-dialog` containing:

```text
Required bounds (read-only display)
Final min longitude [number]
Final min latitude  [number]
Final max longitude [number]
Final max latitude  [number]
Download Freeze Plan
Cancel
```

Keep the button disabled unless all are true:

```text
storage origin kind === folder
packageStore.dirty === false
validation.status === valid
lastValid snapshot exists
urban-context-v1 buildingSource === overture-pmtiles
at least one context-active Scene exists
```

When preparing:

- remember `viewportPreset` and current `stateSelection`;
- temporarily set the preview frame's inline width/height to exactly `1920px × 1080px`, capture every context-active Scene via `bridge.captureSceneCamera()`;
- repeat at exactly `390px × 844px`;
- collect each returned southwest/northeast pair as `[west,south,east,north]`;
- union all bounds;
- restore frame inline dimensions, original viewport preset, and selected Scene in `finally` even on error;
- compute the last-valid declared-package fingerprint;
- open the dialog prefilled with final bounds equal to required bounds.

The planning operation may activate official Overture context because it is part of authoring; do not build a second map or a hidden map.

- [ ] **Step 7: Validate enlargement and download the transient plan**

On download, parse the four fields, call `validateFreezeBounds(required, final)`, construct the plan, and download it as:

```text
<project-id>-overture-freeze-plan.json
```

using a temporary Blob URL that is revoked immediately after click. Do not add the plan to packageStore or history.

`createdAt` is `new Date().toISOString()` and is not part of PMTiles determinism.

Extend `tests/editor-studio-preview.test.mjs` with a fake bridge returning known bounds for desktop/mobile and assert the exported plan contains their union and the package remains byte-for-byte unchanged.

Run:

```bash
node --test tests/overture-freeze-plan.test.mjs tests/editor-preview-bridge.test.mjs tests/editor-studio-preview.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add editor/publish/freeze-plan.js editor/preview/bridge.js editor/preview/package-resolver.js editor/editor.js editor/index.html editor/editor.css tests/overture-freeze-plan.test.mjs tests/editor-preview-bridge.test.mjs tests/editor-studio-preview.test.mjs
 git diff --check
 git commit -m "feat: plan durable Overture freeze extent"
```

---

### Task 6: Pin and verify go-pmtiles 1.31.2 without committing native binaries

**Files:**
- Create: `scripts/tools/go-pmtiles-1.31.2.json`
- Create: `scripts/lib/pmtiles-tool.mjs`
- Create: `tests/overture-freeze-tool.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Tool-lock JSON maps `${process.platform}-${process.arch}` to exact official release artifact metadata.
- `ensurePmtilesTool(options) -> Promise<string>` returns an absolute verified executable path in `.cache/map-story-tools/pmtiles/1.31.2/<platform>-<arch>/`.
- No fallback to PATH.
- Download and process calls are injectable for tests.

- [ ] **Step 1: Add the exact official tool lock**

Create `scripts/tools/go-pmtiles-1.31.2.json` with exactly these release-asset digests:

```json
{
  "version": "1.31.2",
  "releaseBase": "https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/",
  "artifacts": {
    "darwin-arm64": {
      "name": "go-pmtiles-1.31.2_Darwin_arm64.zip",
      "sha256": "40528f7f616fcbf91207cd48c8fc023d213f6d86c0cbf1f748732803d1880f3d"
    },
    "darwin-x64": {
      "name": "go-pmtiles-1.31.2_Darwin_x86_64.zip",
      "sha256": "1f0dc02eee6c58312dd6c509faee1b5c32f0596568af1bf51f1b034e7a88a65b"
    },
    "linux-arm64": {
      "name": "go-pmtiles_1.31.2_Linux_arm64.tar.gz",
      "sha256": "f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1"
    },
    "linux-x64": {
      "name": "go-pmtiles_1.31.2_Linux_x86_64.tar.gz",
      "sha256": "3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f"
    },
    "win32-arm64": {
      "name": "go-pmtiles_1.31.2_Windows_arm64.zip",
      "sha256": "8780a17453c63af757917a694cbbb50b943db89cc3f1b07e6fd62c1ff8e6963b"
    },
    "win32-x64": {
      "name": "go-pmtiles_1.31.2_Windows_x86_64.zip",
      "sha256": "a658baa4d7e55020aef6ca17bd9ff9faa1582671266b36f58c52db0ac8e785a1"
    }
  }
}
```

These hashes are release-archive hashes published by GitHub for Protomaps release `v1.31.2`.

- [ ] **Step 2: Write RED tool-resolution tests**

Test with injected fake fetch/filesystem/process boundaries:

```text
supported platform selects exact artifact URL
cached executable with `pmtiles 1.31.2` is reused without download
archive SHA mismatch rejects before extraction
version output not 1.31.2 rejects
unsupported platform/arch rejects
no PATH lookup is attempted
```

Run:

```bash
node --test tests/overture-freeze-tool.test.mjs
```

Expected: RED.

- [ ] **Step 3: Implement download/hash/cache boundary**

Use only Node built-ins plus vendored fflate:

- `fetch()` official release asset;
- SHA-256 downloaded archive bytes with `node:crypto` or Web Crypto;
- ZIP artifacts: `unzipSync` from `vendor/fflate/0.8.3/fflate.esm.js`, select the single regular-file entry whose basename is `pmtiles` or `pmtiles.exe`;
- Linux `.tar.gz`: write verified archive to cache temp path and run system `tar -xzf <archive> -C <tempDir>`; select basename `pmtiles` afterward;
- write/move executable into the versioned cache and chmod `0o755` on POSIX;
- run `<exe> version` and require output matching `/^pmtiles 1\.31\.2,/` before returning.

Use an atomic temp cache directory and rename only after verification. If system `tar` is absent on Linux, fail with a clear prerequisite error; do not add a tar parser.

Add `.cache/map-story-tools/` to `.gitignore`.

Run tool tests; expected PASS.

- [ ] **Step 4: Commit Task 6**

```bash
git add scripts/tools/go-pmtiles-1.31.2.json scripts/lib/pmtiles-tool.mjs tests/overture-freeze-tool.test.mjs .gitignore
 git diff --check
 git commit -m "build: pin go-pmtiles 1.31.2"
```

---

### Task 7: Build the transactional Freeze orchestrator

**Files:**
- Create: `scripts/lib/freeze-project.mjs`
- Create: `scripts/freeze-overture-snapshot.mjs`
- Create: `tests/overture-freeze-project.test.mjs`
- Modify: `package.json`
- Reuse: `editor/publish/freeze-plan.js`
- Reuse: `editor/core/package-store.js` declaration helpers where Node-compatible.

**Interfaces:**
- CLI syntax is exactly:

```bash
npm run freeze:overture -- --project=/absolute/or/relative/authoring-folder --plan=/path/to/route-61-2-overture-freeze-plan.json --output=/path/to/frozen-route-61-2
```

- `freezeProject({ projectDir, planPath, outputDir, ...injected }) -> Promise<FrozenResult>`.
- `FrozenResult` includes `outputDir`, `snapshotPath`, `snapshotSha256`, `snapshotBytes`, `bounds`, `release`, `warning`, `sourceEtag`, `sourceContentLength`.
- Real process command contract:

```text
pmtiles extract <source> <temp.pmtiles> --bbox=minLon,minLat,maxLon,maxLat --download-threads=4 --overfetch=0.05 --dry-run
pmtiles extract <source> <temp.pmtiles> --bbox=... --download-threads=4 --overfetch=0.05
pmtiles verify <temp.pmtiles>
pmtiles show <temp.pmtiles> --header-json
pmtiles show <temp.pmtiles> --metadata
```

- Source URL is built by imported trusted `deriveOvertureBuildingsPmtilesUrl(plan.overtureRelease)`; never read from the plan.

- [ ] **Step 1: Write RED dry-run/size parser tests**

Export and test:

```js
export function parseHumanBytes(value) {}
export function parsePmtilesDryRun(output) {}
```

Accept units `B`, `kB`, `MB`, `GB`, `TB`, `KiB`, `MiB`, `GiB`, `TiB` with decimal units base 1000 and IEC units base 1024. Parse the pinned tool's line form:

```text
Extract transferred 12 MB (overfetch 0.05) for an archive size of 9.4 MB
```

Require `{ archiveBytes: 9_400_000 }`. Reject output with no archive-size line.

- [ ] **Step 2: Write RED plan/fingerprint validation tests**

Create a temporary authoring Folder fixture with `buildingSource: overture-pmtiles`, declared Story/data, and a plan generated by `createOvertureFreezePlan()`. Require PASS when fingerprint matches.

Require rejection before any `pmtiles` process call for:

```text
plan kind/version mismatch
project id mismatch
project fingerprint mismatch
project has unsaved concept not applicable to Folder: represented by changed disk bytes after plan creation
buildingSource != overture-pmtiles
release mismatch between plan and project capability
finalBounds does not contain requiredBounds
```

The CLI recomputes the same declared-package fingerprint from disk using only project.json + manifest-declared resources.

- [ ] **Step 3: Write RED transactional process tests**

Inject `ensureTool`, `runProcess`, and `fetchImpl` so no native binary/network is required. Model these stages and assert command ordering:

```text
dry-run
extract
verify
show header
show metadata
```

Test:

```text
dry-run >64 MiB => no extract call
32–64 MiB => warning = large
extract failure => outputDir absent/previous output unchanged
verify failure => previous output unchanged
frozen production validation failure => previous output unchanged
success => final output atomically replaces previous output only after validation
```

- [ ] **Step 4: Implement source preflight and optional identity evidence**

Derive source with the existing C1 trusted URL function. Attempt `HEAD` with injected/default fetch and record only when present:

```text
Content-Length -> nonnegative integer sourceContentLength
ETag -> sourceEtag string
```

HEAD failure or missing headers is non-fatal because those fields are optional. A later extract failure remains fatal.

- [ ] **Step 5: Implement dry-run and hard size gate**

Invoke the pinned executable returned by `ensurePmtilesTool()` with the exact dry-run args. Parse predicted archive bytes.

Use:

```js
const HEALTHY_MAX = 32 * 1024 * 1024;
const HARD_MAX = 64 * 1024 * 1024;
```

If predicted `> HARD_MAX`, throw before full extract. If `> HEALTHY_MAX`, set warning `large` but continue.

After real extraction, independently `stat()` the PMTiles and enforce the same hard limit again; dry-run is preflight, not the sole safety check.

- [ ] **Step 6: Verify PMTiles structure/metadata/hash**

After `pmtiles verify` exits zero:

- parse `pmtiles show --header-json`; require `tileType === 1` (MVT), clustered archive, minZoom <= 11, maxZoom >= 14, and bounds that contain/intersect the requested final bounds according to the pinned extractor's bbox header semantics;
- parse `pmtiles show --metadata` as JSON and require vector layer metadata includes source layer `building` when `vector_layers` is present;
- obtain source metadata with `pmtiles show <official-url> --metadata` and require deep equality with extracted metadata when both commands return JSON successfully; source metadata inspection failure is fatal because C2 requires preservation evidence;
- compute lowercase SHA-256 of final PMTiles bytes after all verification.

Do not edit PMTiles metadata.

- [ ] **Step 7: Construct the frozen manifest exactly**

Clone authoring `project.json` and add/replace only:

```js
manifest.assets['overture-buildings-snapshot'] = {
  type: 'pmtiles',
  src: './assets/context/overture-buildings.pmtiles',
  mediaType: 'application/vnd.pmtiles',
  required: true,
  attribution: ['overture-maps']
};
```

Set or validate attribution ID `overture-maps`:

```js
{
  name: 'Overture Maps Foundation — Buildings',
  url: 'https://overturemaps.org/',
  license: 'ODbL-1.0',
  updated: plan.overtureRelease.slice(0, 10),
  notes: `Frozen from Overture release ${plan.overtureRelease}.`
}
```

If the ID already exists with different name/license, fail instead of overwriting unrelated provenance.

Replace only the `urban-context-v1.settings` source fields with:

```js
{
  adapter: originalSettings.adapter,
  buildingSource: 'project-snapshot',
  overtureRelease: plan.overtureRelease,
  snapshot: {
    asset: 'overture-buildings-snapshot',
    theme: 'buildings',
    bounds: [...plan.finalBounds],
    sha256: snapshotSha256,
    byteLength: snapshotBytes,
    generator: 'go-pmtiles',
    generatorVersion: '1.31.2',
    generatedAt: new Date().toISOString(),
    ...(sourceContentLength === null ? {} : { sourceContentLength }),
    ...(sourceEtag === null ? {} : { sourceEtag })
  }
}
```

Do not modify Story files.

- [ ] **Step 8: Build a staging Folder from declared production resources only**

Create a sibling staging directory. Copy:

```text
project.json (write frozen version last inside staging)
all authoring manifest-declared stories/datasets/assets/metrics
new assets/context/overture-buildings.pmtiles
```

Do not copy `.git`, editor-state, source code, review files, hidden arbitrary files, downloaded tools, or the Freeze plan.

Write non-manifest resources first, then frozen `project.json`.

- [ ] **Step 9: Production-validate the staged frozen package**

Create a small Node `fileFetch` inside `freeze-project.mjs` that maps `file:`/staging URLs to `Response` objects and invoke real production:

```js
await loadProject(new URL('project.json', pathToFileURL(stagingDir + path.sep)), {
  fetchImpl: fileFetch,
  capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY
});
```

Assets are URL-resolved but not eagerly loaded, so validation must not read the full PMTiles file through `fileFetch`.

Require this production validation before output swap.

- [ ] **Step 10: Atomically swap output while preserving the previous publication on failure**

If `outputDir` is absent, rename staging to output.

If present:

1. rename current output to a sibling backup path;
2. rename staging to output;
3. if Step 2 fails, restore backup and throw;
4. after successful swap, remove backup recursively.

Clean temporary PMTiles/work directories in `finally`. Never mutate `projectDir`.

- [ ] **Step 11: Add the thin CLI and package script**

`scripts/freeze-overture-snapshot.mjs` parses only `--project=`, `--plan=`, `--output=` and rejects duplicates/unknown args. It calls `freezeProject()` and prints a concise JSON result to stdout.

Add:

```json
"freeze:overture": "node scripts/freeze-overture-snapshot.mjs"
```

to `package.json` scripts. Add no dependencies.

- [ ] **Step 12: Run focused orchestrator tests**

Run:

```bash
node --test tests/overture-freeze-plan.test.mjs tests/overture-freeze-tool.test.mjs tests/overture-freeze-project.test.mjs tests/project-schema.test.mjs tests/project-loader.test.mjs
```

Expected: PASS.

- [ ] **Step 13: Commit Task 7 / C2-B review gate**

```bash
git add scripts/lib/freeze-project.mjs scripts/freeze-overture-snapshot.mjs tests/overture-freeze-project.test.mjs package.json
 git diff --check
 git commit -m "feat: freeze durable Overture project snapshots"
```

Do not commit any generated snapshot/frozen folder created during manual exercise.

---

### Task 8: Add content-addressed hosted PMTiles resolution and explicit R2 Range probe

**Files:**
- Create: `src/project/hosted-asset-resolver.js`
- Create: `tests/hosted-pmtiles-resolver.test.mjs`
- Create: `scripts/r2-pmtiles-range-probe.mjs`
- Modify: `src/project/project-loader.js`
- Modify: `tests/project-loader.test.mjs`

**Interfaces:**
- `createContentAddressedPmtilesResolver({ pmtilesOrigin }) -> resolveAssetUrl`.
- `project-loader.js` invokes resolver as:

```js
resolveAssetUrl(url, { id, descriptor, manifest })
```

while preserving compatibility with resolvers that ignore the extra `manifest` field.
- Hosted PMTiles object URL is exactly:

```text
<pmtilesOrigin>/projects/<manifest.id>/<snapshot.sha256>/overture-buildings.pmtiles
```

- Resolver may remap only `descriptor.type === 'pmtiles'`; all non-PMTiles assets return the original resolved URL unchanged.
- `scripts/r2-pmtiles-range-probe.mjs --url=<absolute https URL>` performs a real `Range: bytes=0-16383` request and exits nonzero unless it receives correct PMTiles partial-content semantics.

- [ ] **Step 1: Write RED hosted resolver tests**

Use frozen manifest fixture `route-61-2`, hash `'a'.repeat(64)`, origin `https://maps.example.test/`. Require:

```js
assert.equal(
  resolver(new URL('https://pages.example.test/assets/context/overture-buildings.pmtiles'), {
    id: 'overture-buildings-snapshot',
    descriptor: { type: 'pmtiles', mediaType: 'application/vnd.pmtiles' },
    manifest
  }).href,
  `https://maps.example.test/projects/route-61-2/${'a'.repeat(64)}/overture-buildings.pmtiles`
);
```

Require image URL identity unchanged. Require rejection if PMTiles asset is not referenced by exactly one `project-snapshot` declaration or its snapshot hash is invalid.

Run `tests/hosted-pmtiles-resolver.test.mjs`; expected RED.

- [ ] **Step 2: Implement the trusted resolver and loader context**

`src/project/hosted-asset-resolver.js` validates `pmtilesOrigin` as absolute HTTPS once. For a PMTiles asset, locate the `urban-context-v1` capability declaration whose `settings.buildingSource === 'project-snapshot'` and `settings.snapshot.asset === id`; construct the immutable path from trusted manifest ID/hash. Do not read any authored URL.

In `src/project/project-loader.js`, change only the call metadata:

```js
url: resolveAssetUrl(urls.assets[id], { id, descriptor, manifest })
```

Do not change asset eager-loading semantics.

Run hosted resolver + project-loader tests; expected PASS.

- [ ] **Step 3: Add standalone real R2 Range probe**

The script parses exact `--url=` only, requires HTTPS, then:

```js
const response = await fetch(url, { headers: { Range: 'bytes=0-16383' } });
```

Require:

```text
status === 206
Content-Range matches /^bytes 0-16383\/\d+$/
body.byteLength === 16384
new DataView(body).getUint16(0, true) === 0x4d50
```

Print JSON with URL, status, contentRange, byteLength, etag. Do not log credentials/headers beyond those public response values.

Unit-test its pure response validator in `tests/hosted-pmtiles-resolver.test.mjs` by exporting `validatePmtilesRangeResponse()` from the script helper or placing that pure function in `hosted-asset-resolver.js`; keep the executable script thin.

- [ ] **Step 4: Commit Task 8**

```bash
git add src/project/hosted-asset-resolver.js tests/hosted-pmtiles-resolver.test.mjs scripts/r2-pmtiles-range-probe.mjs src/project/project-loader.js tests/project-loader.test.mjs
 git diff --check
 git commit -m "feat: resolve frozen PMTiles to immutable R2 objects"
```

---

### Task 9: Generate Route 61-2 C2 evidence and run the final certification gates

**Files:**
- Create: `scripts/overture-pmtiles-c2-browser-certification.mjs`
- Create: `review/map-story-studio-v1-2/overture-pmtiles/C2.md`
- Modify: `.github/workflows/ci.yml` only if a deterministic, credential-free focused C2 test command must be added; do not put R2 credentials/live network certification in CI.
- Do not modify `project.json`; the canonical authoring project stays `overture-pmtiles`.

**Interfaces:**
- Browser certification accepts explicit arguments rather than embedding production credentials:

```bash
node scripts/overture-pmtiles-c2-browser-certification.mjs --url=http://127.0.0.1:8080/ --snapshot=/absolute/path/to/frozen/assets/context/overture-buildings.pmtiles --manifest=/absolute/path/to/frozen/project.json
```

- Hosted Range probe is a separate command requiring a public R2/custom-domain snapshot URL.
- C2 evidence records actual measured values and exact artifact SHA; no generated PMTiles binary is committed.

- [ ] **Step 1: Verify exact implementation base and protected-file freeze before real extraction**

Run:

```bash
git fetch origin
git status --short
git rev-parse HEAD
git rev-parse origin/main
git merge-base HEAD origin/main
sha256sum data/stories/route-61-2.story.json
```

Expected main/merge base remain `88e6c4c88088b8170d8c592aab004e275b1b8fc2`; Story SHA is exactly the canonical value. If not, STOP.

Also run:

```bash
git diff 88e6c4c88088b8170d8c592aab004e275b1b8fc2 -- data/schemas/story-1.1.schema.json data/schemas/story-1.2.schema.json data/stories/route-61-2.story.json src/map/geojson-renderer.js
```

Expected: empty.

- [ ] **Step 2: Exercise Studio Prepare Freeze on canonical Route 61-2**

Serve the repository with the existing static server and open Studio. Use the new Prepare Freeze command on the saved canonical Folder. Confirm it captures only context-active Scenes at both exact profiles and inspect the displayed required/final bounds.

Download the plan without enlargement for the benchmark. Record in scratch notes:

```text
projectFingerprint
requiredBounds
finalBounds
desktop Scene bounds
mobile Scene bounds
```

Do not add the plan to git.

- [ ] **Step 3: Run the real pinned Freeze twice from a clean temporary output**

Run the exact CLI twice with two distinct temporary output folders against the same saved Folder and same plan. For each run, capture stdout JSON and compute snapshot SHA.

Require:

```text
snapshot size <= 67108864
run 1 snapshot SHA == run 2 snapshot SHA
pmtiles verify already passed inside both runs
frozen project production validation passed
canonical authoring Folder bytes unchanged
```

Record exact size, dry-run predicted size, bounds, tool version, source ETag/content length when available, and SHA. Delete one duplicate output after comparison.

- [ ] **Step 4: Certify Folder lazy behavior and ZIP byte identity**

Use focused automated tests plus a browser/manual smoke of the frozen Folder:

```text
Folder Open full PMTiles arrayBuffer before activation: 0
PMTiles protocol/source activity before activation: 0
first activation: FileSource-backed PMTiles
unrelated Save: snapshot file mtime/hash unchanged
Folder → ZIP → import: PMTiles SHA unchanged
```

Record evidence in `C2.md`.

- [ ] **Step 5: Create the bounded C2 browser certification harness**

Use the existing `scripts/overture-pmtiles-browser-certification.mjs` CDP style without modifying its C1 constants/evidence. The C2 harness must measure against the frozen project-snapshot path:

```text
map instances / canvases
protocol/source/flat/extrusion counts
first activation requests/slices or network requests
360° bearing sweep
pitch 0 → target → 0
bounded pan away/back
Scene A → B → A when the frozen extent includes both tested cameras
settled FPS
worst attributable activation frame/task gap
```

For local FileSource, instrument upstream FileSource/getBytes or the injected File's `slice()` to count random reads/bytes without changing production code. For hosted R2, record actual Range requests/statuses via CDP Network events.

Require no source/layer/protocol reinstall during camera sweeps.

- [ ] **Step 6: Re-run the unchanged C1 official-source browser gate**

Run the existing C1 certification harness against the exact C2 head and require its behavioral gates still pass:

```text
no request before first activation
Range/206 official archive
multi-location reuse
remote failure graceful
no fallback
~60 FPS / <250 ms attributable gap
```

Do not overwrite C1 evidence; record the C2-head C1 regression result in `C2.md`.

- [ ] **Step 7: Run the real hosted R2 Range gate when an endpoint is available**

Upload the verified snapshot to the approved R2/custom-domain object path using the deployment owner's normal Cloudflare tooling, not application code:

```text
projects/<project-id>/<snapshot-sha256>/overture-buildings.pmtiles
```

No credential/upload command is committed to the repo.

Run:

```bash
node scripts/r2-pmtiles-range-probe.mjs --url=https://the-configured-r2-custom-domain.example/projects/route-61-2/the-real-snapshot-sha/overture-buildings.pmtiles
```

Before execution replace the example command with the actual public custom-domain URL supplied by the deployment owner; do not commit that URL if it is environment-specific.

Expected: 206, valid Content-Range, 16,384 bytes, PMTiles magic. Then run C2 browser certification with a trusted hosted `resolveAssetUrl` configuration and require zero official Overture requests in `project-snapshot` mode.

If no real R2 endpoint is available, mark only this subsection `PENDING_EXTERNAL_ENDPOINT` in `C2.md` and do not claim final C2 certification.

- [ ] **Step 8: Run the final focused tests, then full suite exactly once**

First run the complete focused C2 set:

```bash
node --test tests/project-schema.test.mjs tests/capability-descriptors.test.mjs tests/project-loader.test.mjs tests/overture-pmtiles.test.mjs tests/urban-context.test.mjs tests/route-61-2-runtime-adapter.test.mjs tests/editor-folder-storage.test.mjs tests/editor-zip-storage.test.mjs tests/editor-package-resolver.test.mjs tests/editor-preview-bridge.test.mjs tests/editor-studio-preview.test.mjs tests/editor-capability-authoring.test.mjs tests/overture-freeze-plan.test.mjs tests/overture-freeze-tool.test.mjs tests/overture-freeze-project.test.mjs tests/hosted-pmtiles-resolver.test.mjs tests/route-61-2-project.test.mjs tests/application-composition.test.mjs
```

Expected: PASS.

Then run exactly once locally:

```bash
npm test
```

Expected: all tests PASS. Record exact count and runtime in `C2.md`; do not rerun locally merely to obtain a prettier number. Exact-head GitHub Actions may rerun independently.

- [ ] **Step 9: Write final `C2.md` with no placeholders**

The evidence file must contain actual values for every completed gate:

```text
implementation head SHA
base/main SHA + tree
full test count/runtime
canonical Story SHA
Freeze-plan project fingerprint + bounds
pinned go-pmtiles version
real dry-run predicted size
real snapshot byte size + SHA
second clean freeze SHA match
Folder lazy-open evidence
ZIP round-trip SHA
C1 regression values
C2 camera stability counts/read bytes/FPS/frame gap
R2 Range status/content-range/bytes/etag when completed
protected-file diff result
```

If hosted R2 is the sole external pending gate, state it explicitly and classify overall result `PARTIAL — HOSTED R2 GATE PENDING`; otherwise when all gates pass classify `PASS`.

Do not write `TBD`, `TODO`, or guessed metrics.

- [ ] **Step 10: Commit certification artifacts only after evidence is truthful**

```bash
git add scripts/overture-pmtiles-c2-browser-certification.mjs scripts/r2-pmtiles-range-probe.mjs review/map-story-studio-v1-2/overture-pmtiles/C2.md .github/workflows/ci.yml
 git diff --check
 git status --short
 git commit -m "test: certify Overture PMTiles C2"
```

Only add `.github/workflows/ci.yml` if it actually changed for credential-free tests. Never commit generated PMTiles snapshots, Freeze plans, native tools, or credentials.

- [ ] **Step 11: Open a Draft PR for independent review**

Before opening:

```bash
git status --short
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: clean worktree; only C2 contract/runtime/freeze/certification files plus the already-approved spec/plan commits.

Open a Draft PR titled:

```text
Map Story Studio V1.2 — Durable Overture PMTiles C2
```

PR body must state:

```text
Canonical base: 88e6c4c88088b8170d8c592aab004e275b1b8fc2
C1 preserved: yes
Story/schema/generic renderer freeze: exact result from C2.md
Project Manifest intentional change: PMTiles asset variant only
Authoring source: official pinned Overture
Frozen source: one project snapshot
Per-Scene extraction: none
Tile server/proxy/Worker/service worker/custom cache: none
Local Folder/ZIP: FileSource
Hosted publication: R2 FetchSource
Certification result: exact C2.md result
```

Keep Draft and unmerged for independent review.

---

## Plan Self-Review Checklist

Before execution handoff, verify this plan against the approved spec:

- C2 source-generation approach A is implemented; B remains compatible as an exact retained input path only if later wired explicitly; C is not implemented.
- Extent comes from actual production preview camera bounds at 1920×1080 and 390×844, unioned once; no per-Scene extraction.
- PMTiles asset declaration is additive inside Project Manifest V1 and external runtime URLs remain forbidden in authored data.
- Live authoring project remains `overture-pmtiles`; frozen output is a separate `project-snapshot` package.
- Folder PMTiles is lazy File-backed; ZIP export/import is exact; hosted PMTiles uses R2/Range 206.
- One renderer/protocol/source/layer set handles official, local-file snapshot, and hosted snapshot bindings.
- First install waits for a moving destination camera to settle; later camera movement does not rebuild source state.
- Native tool is pinned 1.31.2 with exact official release-archive digests and no PATH fallback.
- Freeze dry-runs, size-gates, extracts once, verifies, hashes, constructs frozen manifest, production-validates, and swaps output atomically.
- Snapshot bytes are deterministic; `generatedAt` lives only in manifest provenance.
- No custom tiler/cache/server/proxy/Worker/service worker was introduced.
- Canonical Route Story and Story schemas remain frozen; full suite is run exactly once at the end.
- Hosted R2 is never claimed PASS without a real 206 probe.
