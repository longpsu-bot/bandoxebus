# GUI Editor V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Subagents are disabled for this project. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static native-ESM GUI at `/editor/` that authors the locked production project package directly, validates it through `loadProject(...)`, and previews only the newest valid package through the real production composition.

**Architecture:** The editor keeps raw package entries, mutable plain production JSON, UI state, and the immutable last-valid package as distinct records. Normal `/` startup and editor-preview startup both call one exported production composition in `src/app.js`; preview changes only package transport through the loader's existing `fetchImpl` seam and one identity-by-default asset-URL hook. Folder and ZIP adapters feed the same package store, while production schemas, validators, installed capability registry, descriptors, Story Runtime, Story Shell, MapLibre, and content renderers remain authoritative.

**Tech Stack:** Static HTML/CSS, native browser DOM and ES modules, Node.js 24 `node:test`, File System Access API when available, iframe `postMessage`, MapLibre GL JS 5.24.0, vendored Chart.js 4.5.1, and vendored `fflate` 0.8.3 ESM in PR C.

**Spec:** `docs/superpowers/specs/2026-08-28-gui-editor-v1-design.md` at authoritative base `604aef7523ff3221f0174ac1143476d66a9c252d`.

## Global Constraints

- `BASELINE_AUTHORING_CONTRACT_V1: LOCKED`; consume `docs/baseline-authoring-contract-v1.md` and `review/well-rounded-map-story-template-v1/REPORT.md` without changing their vocabularies.
- Do not silently alter `PROJECT_MANIFEST_V1`, `CORE_CONTENT_PACK_V1`, `COMMON_MAP_ACTIONS_V1`, `DATA_METRIC_BINDING_V1`, `CAPABILITY_EXTENSION_BOUNDARY_V1`, Story Schema 1.0, or Story Schema 1.1. If implementation requires such a change, stop that PR and return for design review.
- Saved JSON is only plain production data. Never serialize editor selections, dirty flags, handles, diagnostics, object URLs, preview telemetry, or a GUI-only schema.
- Use native ESM and DOM only. Add no UI framework, build system, backend, database, authentication, state library, form library, sortable library, service worker, or temporary server.
- `loadProject(...)` is the definitive acceptance gate. Diagnostic orchestration may call existing production validators but may add no validation rules.
- Preview uses the production page, production composition, loader, bootstrap, Story Runtime, Story Shell, MapLibre setup, Route 61-2 adapter contexts, content renderers, and Chart.js. Do not duplicate any of those in editor code.
- Basemap is fixed/read-only: preserve opened values and write `openfreemap-dark` for New Project. Do not create a basemap catalog or accept a style URL.
- New Stories are Story 1.1. Story 1.0 opens/previews without serialization, remains 1.0 after supported state/content edits, and exposes legacy action parameters read-only.
- A capability may be newly declared only when its trusted descriptor has `gui.addable === true`; absent or false means existing-project-only. Route 61-2-specific packs remain non-addable.
- Computed metric descriptors are read-only/selectable. Do not add inspector metric-value telemetry.
- Folder Open reads `project.json` and declared resources only; it never recursively enumerates a selected directory. Unknown folder files remain untouched.
- ZIP import may retain safe unknown entry payloads byte-for-byte, but rejects unsafe, absolute, traversal, and duplicate-normalized paths. Export is project content, never a runtime/site bundle.
- V1 does not edit geometry, accept executable resources, expose private MapLibre IDs, migrate Story 1.0, or implement complex GIS/spreadsheet behavior.
- Use focused tests per task. Run `npm test` only once near the end of each PR, then `git diff --check` and one relevant browser smoke; CI is the full regression authority.

## Delivery and Branch Discipline

Keep exactly three meaningful implementation PRs. PR A starts from the main commit that merges this plan. PR B starts from merged PR A; PR C starts from merged PR B. Do not stack all three from the plan branch.

| PR | Branch | Review outcome |
| --- | --- | --- |
| A | `feat/gui-editor-v1-spine` | Static shell, package/draft/validation core, and real last-valid production preview. |
| B | `feat/gui-editor-v1-authoring` | Complete baseline project/data/Story/content/action/capability authoring. |
| C | `feat/gui-editor-v1-persistence` | Folder/ZIP persistence, accessibility/security hardening, and certification. |

At each PR start:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <branch-from-table>
```

At each PR end, run the PR's focused browser gate, `npm test` once, `git diff --check`, push, wait for CI, obtain approval, and merge before starting the next PR.

## Locked V1 File and Module Structure

The editor has ten focused JavaScript modules plus static markup/styles. Do not split one module per entity; split only if a file demonstrably becomes unreviewable during implementation and the PR reviewer approves the changed structure.

| Path | Responsibility and key exports | Consumers | Owner |
| --- | --- | --- | --- |
| `editor/index.html` | Static four-region shell, top commands, iframe, inspector, and validation drawer landmarks. | Browser entry; `editor/editor.js`. | PR A; labels hardened in C. |
| `editor/editor.css` | Desktop layout, desktop/mobile preview presets, focus/error/reduced-motion styling. | `editor/index.html`. | PR A; forms in B; a11y in C. |
| `editor/editor.js` | Composition root. Exports `createEditor(options)`; owns UI-only state and command routing. | `editor/index.html`; browser smoke. | PR A; extended B/C. |
| `editor/core/package-store.js` | Package paths, entry bytes, managed/pass-through classification, byte/revision dirty state, snapshots/change sets, and New Project package. Exports `normalizePackagePath`, `collectDeclaredPackageEntries`, `createPackageStore`, `createNewProjectEntries`. | Draft, validation, storage, preview. | PR A; folder/ZIP behavior completed C. |
| `editor/core/draft-store.js` | Mutable structured clones of parseable managed production JSON and explicit atomic mutations. Exports `createDraftStore`, `createStableId`, `moveArrayItem`. | Editor and all inspectors. | PR A; domain mutations B. |
| `editor/core/validation.js` | Debounce, abort/token staleness, production diagnostics, definitive `loadProject`, and last-valid promotion. Exports `createValidationCoordinator`, `toProductionDiagnostic`. | `editor/editor.js`, preview bridge, validation drawer. | PR A; navigation polish C. |
| `editor/core/descriptors.js` | Read-only adapter over installed/composed catalogs and bounded data-only field controls. Exports `createEditorDescriptorCatalog`, `isGuiAddable`, `renderSchemaControls`. It never validates. | Capability/action/content UI. | PR B. |
| `editor/preview/bridge.js` | Parent/iframe versioned protocol, source/origin checks, revision filtering, viewport and real-surface commands. Exports `createPreviewBridge`, `PREVIEW_PROTOCOL_VERSION`. | Editor composition; iframe host. | PR A; telemetry/a11y hardened C. |
| `editor/preview/package-resolver.js` | Structured-cloned in-memory fetch responses, declared image object URLs, path/media checks, URL revocation, and iframe host lifecycle. Exports `createPackageFetch`, `createPreviewPackageResolver`, `startEditorPreviewHost`. | Validation and opt-in production preview startup. | PR A. |
| `editor/storage/adapters.js` | `MemoryStorageAdapter`, folder and ZIP adapters, deterministic writes/export staging, capabilities/origin descriptions. Exports `createMemoryStorageAdapter`, `createFolderStorageAdapter`, `createZipStorageAdapter`. | `editor/editor.js`, package store. | Contract in PR A; folder/ZIP implementations C. |
| `editor/ui/inspectors.js` | Tailored Project, dataset/table, asset, metric, focus, attribution, and capability inspectors plus import/camera commands. Exports `renderEntityInspector`, `importGeoJson`, `importNormalizedTable`, `capturePreviewView`. | `editor/editor.js`. | PR B. |
| `editor/ui/story-editor.js` | Story/state lifecycle, ordering, version policy, and Story 1.0 preservation. Exports `createStory11`, `insertState`, `duplicateState`, `deleteState`, `updateSupportedStory10`, `renderStoryEditor`. | `editor/editor.js`, content/actions UI. | PR B. |
| `editor/ui/content-actions.js` | Tailored content editors and canonical descriptor-driven actions. Exports `createContentBlock`, `createCanonicalAction`, `renderContentActionEditor`. | Story editor and inspector. | PR B. |

Narrow existing-production changes are limited to:

| Path | Exact seam | Owner |
| --- | --- | --- |
| `src/app.js` | Export `createProductionApplicationOptions(transport)` and `startProductionApplication(transport)`; normal startup and `?editorPreview=1` both use them. | PR A. |
| `src/project/project-loader.js` | Add optional `resolveAssetUrl(url, context)`, identity by default, only when constructing validated asset resource records. | PR A. |
| `src/capabilities/descriptor-schema.js` | Validate optional trusted `gui.addable` as boolean without changing manifest or authored schemas. | PR B. |
| `vendor/fflate/0.8.3/fflate.esm.js`, `LICENSE` | Exact official browser ESM and MIT license; no package manager/build integration. | PR C. |

Test support stays compact: focused `tests/editor-*.test.mjs` modules, one reusable `scripts/editor-browser-smoke.mjs`, and a final `review/gui-editor-v1/REPORT.md`. Existing production fixtures remain authority.

## Locked Interfaces and Data Shapes

Use these names consistently across all three PRs:

```js
// Structured-cloneable. No handles, functions, blobs, or editor UI state.
PackageSnapshot = {
  revision: Number,
  entries: [{ path: String, bytes: Uint8Array, mediaType: String, kind: String }]
};

LastValid = {
  revision: Number,
  snapshot: PackageSnapshot,
  project: ValidatedProject
};

StorageOrigin =
  | { kind: 'memory', label: String }
  | { kind: 'folder', label: String, directoryHandle: FileSystemDirectoryHandle }
  | { kind: 'zip', label: String };

StorageResult = {
  written: String[],
  failed: [{ path: String, message: String }],
  skipped: String[]
};
```

`createPackageStore({ origin, entries })` returns methods `get(path)`, `list()`, `setCurrentBytes(path, bytes)`, `setManaged(path, descriptor)`, `removeManaged(path)`, `snapshot({ managedOnly = true })`, `changeSet()`, `markWritten(paths)`, and getters `revision`/`dirty`. Entry `originalBytes` never changes until successful explicit Save; `currentBytes` changes only through a draft/resource mutation. ZIP pass-through entries are excluded from validation/preview snapshots but included in ZIP export staging.

`createDraftStore({ packageStore })` parses known JSON entries and returns `get(path)`, `mutate(path, updater)`, `replaceText(path, text)`, `snapshot()`, `subscribe(listener)`, and `revision`. `mutate` clones first, serializes only the explicitly mutated file as two-space JSON plus one trailing newline, calls `packageStore.setCurrentBytes`, increments once, and notifies once. Untouched files retain original bytes.

`createProductionApplicationOptions({ manifestUrl = './project.json', fetchImpl = fetch, resolveAssetUrl, signal, owner, replaceExisting = false } = {})` returns the existing trusted registry, real `createRouteMap`, real Story binding, Route 61-2 capability contexts, `maplibregl`, `document`, and the passed transport/lifecycle fields. `startProductionApplication(transport)` calls `startApplication(createProductionApplicationOptions(transport))`. No caller may replace production map, capability, or Story composition through this API.

`loadProject(manifestUrl, { fetchImpl, capabilityRegistry, signal, resolveAssetUrl = (url) => url })` calls `resolveAssetUrl(url, { id, descriptor })` only after `resolveManifestResourceUrls` has validated the authored path and only for `kind: 'asset'` resource records. JSON/GeoJSON/table/metric loads continue through `fetchImpl`; normal production receives identity URLs.

`createPackageFetch(snapshot, { baseUrl = new URL('/__editor_package__/', location.origin) } = {})` returns `{ manifestUrl, fetchImpl }`. `createPreviewPackageResolver(snapshot, options)` adds `{ resolveAssetUrl, revoke }`; it materializes only declared supported image entries, caches one object URL per asset per revision, and revokes all URLs on replacement/restart/destroy.

`createValidationCoordinator({ draftStore, capabilityRegistry, loadProjectImpl = loadProject, debounceMs = 250, onChange = () => {} })` returns `schedule()`, `validateNow()`, `dispose()`, and getters `status`, `diagnostics`, `lastValid`. Every draft notification aborts the active run, captures a new token/revision, and schedules validation. Only a completion whose token and revision still match may replace diagnostics or promote `lastValid`.

`createPreviewBridge({ iframe, origin = location.origin, onEvent })` accepts only messages from `iframe.contentWindow` and the exact origin. `start(lastValid)` structured-clones `{ revision, entries }`; `command(name, payload)` supports `enter-story`, `explore`, `restart`, and `viewport`; the iframe invokes real DOM/runtime surfaces and never dispatches authored actions itself.

---

## PR A — Editor Spine and Real Production Preview

### Task 1: Extract one shared production composition/start seam

**Files:**
- Modify: `src/app.js`
- Create: `tests/application-composition.test.mjs`
- Modify: `tests/story-shell-integration.test.mjs`

**Interfaces:**
- Consumes: existing `startApplication`, `INSTALLED_CAPABILITY_REGISTRY`, `createRouteMap`, `bindRouteStoryExperience`, and `routeCapabilityContexts`.
- Produces: `createProductionApplicationOptions(transport)` and `startProductionApplication(transport)` with the exact signatures above.

- [ ] **Step 1: Write the focused failing composition test**

```js
test('normal and preview transports share the same production composition', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(source, /export function createProductionApplicationOptions\(/);
  assert.match(source, /export function startProductionApplication\(/);
  assert.match(source, /startApplication\(createProductionApplicationOptions\(transport\)\)/);
  assert.match(source, /capabilityRegistry:\s*INSTALLED_CAPABILITY_REGISTRY/);
  assert.match(source, /createMap:\s*createRouteMap/);
  assert.match(source, /bindStoryExperience:\s*bindRouteStoryExperience/);
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
});
```

Also assert from source that `initialize()` calls `startProductionApplication()` and that exactly one `new maplibregl.Map(` remains in `src/app.js`.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/application-composition.test.mjs tests/story-shell-integration.test.mjs`

Expected: FAIL because `createProductionApplicationOptions` and `startProductionApplication` are not exported.

- [ ] **Step 3: Implement the minimal shared seam**

```js
export function createProductionApplicationOptions({
  manifestUrl = './project.json', fetchImpl = fetch, resolveAssetUrl,
  signal, owner, replaceExisting = false
} = {}) {
  return {
    manifestUrl, fetchImpl, resolveAssetUrl, signal, owner, replaceExisting,
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY,
    maplibregl, documentRef: document, storyExperience,
    createMap: createRouteMap,
    bindStoryExperience: bindRouteStoryExperience,
    capabilityContexts: routeCapabilityContexts()
  };
}

export function startProductionApplication(transport = {}) {
  return startApplication(createProductionApplicationOptions(transport));
}
```

Keep `renderMetrics()`, `bindTabs()`, and `bindControls()` in `initialize()`. Normal mode calls `startProductionApplication()`; preview-mode waiting is added in Task 5. Do not move or duplicate route/map functions.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/application-composition.test.mjs tests/application-startup.test.mjs tests/story-shell-integration.test.mjs`

Expected: PASS; source check still reports one MapLibre constructor and unchanged Story Shell/legacy selection.

- [ ] **Step 5: Commit**

```powershell
git add src/app.js tests/application-composition.test.mjs tests/story-shell-integration.test.mjs
git commit -m "refactor: share production application composition"
```

### Task 2: Add package bytes, mutable draft, New Project, and memory adapter

**Files:**
- Create: `editor/core/package-store.js`
- Create: `editor/core/draft-store.js`
- Create: `editor/preview/package-resolver.js`
- Create: `editor/storage/adapters.js`
- Create: `tests/editor-package-draft.test.mjs`

**Interfaces:**
- Consumes: `resolvePackageUrl` for safe declared paths and native `TextEncoder`, `TextDecoder`, `structuredClone`.
- Produces: package/draft/storage interfaces and data shapes locked above, plus the JSON-resource-only `createPackageFetch(snapshot, options)` needed by validation.

- [ ] **Step 1: Write failing package/draft tests**

```js
test('New Project is production-shaped Story 1.1 with a fixed basemap', () => {
  const entries = createNewProjectEntries({ id: 'corridor-plan', title: 'Corridor plan', locale: 'en-US' });
  const manifest = json(entries, 'project.json');
  const story = json(entries, 'stories/main.story.json');
  assert.equal(manifest.schemaVersion, '1.0');
  assert.equal(manifest.map.basemap, 'openfreemap-dark');
  assert.deepEqual(manifest.capabilities, []);
  assert.equal(story.schemaVersion, '1.1');
  assert.equal(story.states.length, 1);
});

test('draft changes serialize only the mutated file and track byte dirtiness', () => {
  const store = createPackageStore({ origin: { kind: 'memory', label: 'New project' }, entries: createNewProjectEntries() });
  const originalStory = store.get('stories/main.story.json').currentBytes.slice();
  const draft = createDraftStore({ packageStore: store });
  draft.mutate('project.json', (manifest) => { manifest.title = ''; });
  assert.equal(draft.revision, 1);
  assert.equal(store.dirty, true);
  assert.deepEqual(store.get('stories/main.story.json').currentBytes, originalStory);
});

test('a package snapshot exposes fetch-compatible managed resources', async () => {
  const store = createPackageStore({ origin: { kind: 'memory', label: 'New project' }, entries: createNewProjectEntries() });
  const transport = createPackageFetch(store.snapshot());
  const response = await transport.fetchImpl(transport.manifestUrl);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).schemaVersion, '1.0');
});
```

Add cases for lowercase stable ID collision suffixes, atomic array moves, unsafe/absolute/traversal paths, `snapshot()` excluding pass-through entries, `changeSet()` using byte equality, and `markWritten()` clearing only successful entries.

Also cover syntactically invalid known JSON: retain its original text/bytes and a parse diagnostic, omit its tailored value from `get(path)`, allow `replaceText(path, text)`, and restore the parsed production value only when `JSON.parse` succeeds. This is repair of the real file, not an editor schema.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-package-draft.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the editor core modules.

- [ ] **Step 3: Implement the minimal stores and memory adapter**

New Project must emit exactly `project.json` and `stories/main.story.json`. The initial Story has a `heading` block and empty `enter`/`exit` arrays. Use:

```js
export function createStableId(label, used = []) {
  const base = String(label).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  const occupied = new Set(used);
  if (!occupied.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) if (!occupied.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
}
```

`normalizePackagePath` repeatedly percent-decodes before inspection, removes leading `./`, uses `/`, and rejects invalid encoding, empty segments, `.`, `..`, roots, schemes, query/fragment, backslashes, and drive prefixes. `collectDeclaredPackageEntries` reads only known manifest `src` fields and calls production `resolvePackageUrl` against `https://package.invalid/project.json` before returning normalized path/kind/media metadata. The first resolver implementation serves managed snapshot bytes as native `Response` objects but does not create object URLs; Task 4 adds the declared-image layer.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-package-draft.test.mjs tests/path-resolver.test.mjs`

Expected: PASS with production path tests unchanged.

- [ ] **Step 5: Commit**

```powershell
git add editor/core/package-store.js editor/core/draft-store.js editor/preview/package-resolver.js editor/storage/adapters.js tests/editor-package-draft.test.mjs
git commit -m "feat: add editor package and draft core"
```

### Task 3: Coordinate production validation and last-valid promotion

**Files:**
- Create: `editor/core/validation.js`
- Create: `tests/editor-validation.test.mjs`

**Interfaces:**
- Consumes: `createPackageFetch(snapshot)`, `loadProject`, `INSTALLED_CAPABILITY_REGISTRY`, and draft subscriptions.
- Produces: `createValidationCoordinator(...)`, production-shaped diagnostics, immutable `LastValid`.

- [ ] **Step 1: Write the four lifecycle tests with controlled deferred loads**

```js
test('invalid draft keeps the previous valid preview snapshot', async () => {
  const harness = validationHarness();
  await harness.validate({ title: 'Valid' });
  const first = harness.coordinator.lastValid;
  await harness.reject({ code: 'PROJECT_MANIFEST_INVALID', path: '$.title', message: 'Title is required.' });
  assert.equal(harness.coordinator.lastValid, first);
  assert.equal(harness.coordinator.status, 'invalid');
});

test('a stale validation completion cannot win', async () => {
  const harness = validationHarness({ deferred: true });
  const oldRun = harness.startRevision(1);
  const newRun = harness.startRevision(2);
  newRun.resolve({ manifest: { title: 'New' } });
  await newRun.done;
  oldRun.resolve({ manifest: { title: 'Old' } });
  await oldRun.done;
  assert.equal(harness.coordinator.lastValid.revision, 2);
});
```

Add exact cases: first invalid revision yields `lastValid === null` and `status === 'invalid'`; a valid repair promotes a new structured-cloned snapshot. Verify a new mutation aborts the prior signal and diagnostics carry `{ code, path, message, packagePath, revision }`.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-validation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `editor/core/validation.js`.

- [ ] **Step 3: Implement token/revision coordination around `loadProject`**

```js
async function run(revision, token) {
  activeController?.abort(new DOMException('Validation replaced.', 'AbortError'));
  const controller = new AbortController();
  activeController = controller;
  const snapshot = structuredClone(draftStore.snapshot());
  const { manifestUrl, fetchImpl } = createPackageFetch(snapshot);
  try {
    const project = await loadProjectImpl(manifestUrl, { fetchImpl, capabilityRegistry, signal: controller.signal });
    if (token !== currentToken || revision !== draftStore.revision) return;
    lastValid = Object.freeze({ revision, snapshot, project });
    diagnostics = Object.freeze([]);
    status = 'valid';
  } catch (error) {
    if (controller.signal.aborted || token !== currentToken || revision !== draftStore.revision) return;
    diagnostics = Object.freeze([toProductionDiagnostic(error, { revision })]);
    status = 'invalid';
  }
  onChange({ status, diagnostics, lastValid });
}
```

Use a 250 ms default debounce, `validateNow()` for explicit Validate, and `dispose()` to clear timers/abort. Parse diagnostics already held by the draft store join the loader diagnostic; do not parse error-message text into rules.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-validation.test.mjs tests/project-loader.test.mjs`

Expected: PASS; every successful promotion came from the injected production loader.

- [ ] **Step 5: Commit**

```powershell
git add editor/core/validation.js tests/editor-validation.test.mjs
git commit -m "feat: validate editor drafts with last-valid promotion"
```

### Task 4: Add in-memory fetch/image transport and the narrow production asset hook

**Files:**
- Modify: `editor/preview/package-resolver.js`
- Modify: `src/project/project-loader.js`
- Create: `tests/editor-package-resolver.test.mjs`
- Modify: `tests/project-loader.test.mjs`

**Interfaces:**
- Consumes: `PackageSnapshot`, the Task 2 `createPackageFetch`, production loader `fetchImpl`, validated manifest asset descriptors.
- Produces: `createPreviewPackageResolver`; extends `loadProject` with identity-default `resolveAssetUrl`.

- [ ] **Step 1: Write failing transport and loader-hook tests**

```js
test('preview resolver serves managed bytes and materializes declared images only', async () => {
  const urls = fakeUrlApi();
  const resolver = createPreviewPackageResolver(snapshotWithImage(), { urlApi: urls });
  assert.equal((await resolver.fetchImpl(resolver.manifestUrl)).status, 200);
  const objectUrl = resolver.resolveAssetUrl(new URL('assets/photo.png', resolver.manifestUrl), {
    id: 'photo', descriptor: { mediaType: 'image/png' }
  });
  assert.equal(objectUrl, 'blob:revision-1/photo');
  assert.throws(() => resolver.resolveAssetUrl(new URL('../outside.png', resolver.manifestUrl), {
    id: 'outside', descriptor: { mediaType: 'image/png' }
  }), /outside|absent|unsafe/i);
  resolver.revoke();
  assert.deepEqual(urls.revoked, ['blob:revision-1/photo']);
});
```

In `tests/project-loader.test.mjs`, assert `resolveAssetUrl` receives the already validated absolute URL plus `{ id, descriptor }`, changes only `resources.get(assetId).url`, and omitted hook preserves the existing URL exactly. Add absent paths, script kinds, media mismatch, abort, and repeated-asset URL cache cases.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-package-resolver.test.mjs tests/project-loader.test.mjs`

Expected: FAIL because the resolver module and loader option do not exist.

- [ ] **Step 3: Implement fetch-compatible responses and the asset-only hook**

```js
function resolvedResources(manifest, urls, values, resolveAssetUrl) {
  // Existing dataset and metric records stay unchanged.
  for (const [id, descriptor] of Object.entries(manifest.assets)) {
    resources.set(id, deepFreeze({
      id, kind: 'asset', descriptor,
      url: resolveAssetUrl(urls.assets[id], { id, descriptor })
    }));
  }
}

export async function loadProject(manifestUrl = './project.json', {
  fetchImpl = fetch, capabilityRegistry, signal, resolveAssetUrl = (url) => url
} = {}) { /* existing orchestration; pass hook only to resolvedResources */ }
```

The resolver maps URLs only under `/__editor_package__/`, returns native `Response` objects with declared media types, refuses entries absent from the snapshot, and never materializes scripts/modules. Object URLs are revision-scoped and idempotently revoked.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-package-resolver.test.mjs tests/project-loader.test.mjs tests/resource-loader.test.mjs tests/path-resolver.test.mjs`

Expected: PASS; normal production URL behavior remains identity.

- [ ] **Step 5: Commit**

```powershell
git add editor/preview/package-resolver.js src/project/project-loader.js tests/editor-package-resolver.test.mjs tests/project-loader.test.mjs
git commit -m "feat: add in-memory project preview transport"
```

### Task 5: Compose the static shell, safe bridge, iframe host, and PR A browser gate

**Files:**
- Create: `editor/index.html`
- Create: `editor/editor.css`
- Create: `editor/editor.js`
- Create: `editor/preview/bridge.js`
- Modify: `editor/preview/package-resolver.js`
- Modify: `src/app.js`
- Create: `tests/editor-shell-preview.test.mjs`
- Create: `scripts/editor-browser-smoke.mjs`

**Interfaces:**
- Consumes: Tasks 1–4, production `startProductionApplication`, bootstrap result `destroy()`, map/story shell DOM surfaces.
- Produces: `/editor/`, `createEditor`, versioned bridge, `startEditorPreviewHost`, and reusable `--gate=pr-a|pr-b|pr-c` browser smoke.

- [ ] **Step 1: Write failing shell/protocol/lifecycle tests**

```js
test('bridge accepts only the known iframe, origin, version, and newest revision', () => {
  const harness = bridgeHarness();
  harness.message({ source: {}, origin: harness.origin, data: envelope('loaded', 1) });
  harness.message({ source: harness.frame, origin: 'https://evil.example', data: envelope('loaded', 1) });
  harness.message({ source: harness.frame, origin: harness.origin, data: envelope('loaded', 0) });
  assert.deepEqual(harness.events, []);
  harness.message({ source: harness.frame, origin: harness.origin, data: envelope('loaded', 1) });
  assert.equal(harness.events[0].type, 'loaded');
});

test('replacement destroys runtime and revokes revision URLs before starting one map', async () => {
  const host = previewHostHarness();
  await host.start(revision(1));
  await host.start(revision(2));
  assert.deepEqual(host.events, ['start:1', 'destroy:1', 'revoke:1', 'start:2']);
});
```

Static assertions require semantic landmarks, persistent labels, an iframe titled `Production project preview`, `sandbox="allow-scripts allow-same-origin"` and no form/popup/download/navigation permissions, desktop/mobile preset buttons, status/dirty text, and no `innerHTML` in editor modules.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-shell-preview.test.mjs`

Expected: FAIL because shell and bridge files do not exist.

- [ ] **Step 3: Implement the shell and opt-in preview host**

Use envelopes shaped as:

```js
{ protocol: 1, type: 'editor-preview:start', revision, requestId, payload }
```

In `src/app.js`, normal initialization remains immediate. Only `?editorPreview=1` dynamically imports the iframe adapter and waits for a parent start:

```js
if (new URLSearchParams(window.location.search).get('editorPreview') === '1') {
  const { startEditorPreviewHost } = await import('../editor/preview/package-resolver.js');
  return startEditorPreviewHost({
    windowRef: window,
    startProductionApplication,
    expectedOrigin: window.location.origin
  });
}
return startProductionApplication();
```

The host keeps the active bootstrap result/resolver, destroys then revokes before replacement, posts ready/loaded/runtime-error/state/camera events, and implements Story/Explore by clicking the real launcher/exit controls. Restart reuses the last valid snapshot. The parent sends only `lastValid.snapshot`; invalid status adds a paused overlay without messaging the iframe. Viewport buttons resize the persistent iframe and do not restart it.

- [ ] **Step 4: Prove GREEN with focused tests**

Run: `node --test tests/editor-shell-preview.test.mjs tests/application-composition.test.mjs tests/story-shell-integration.test.mjs`

Expected: PASS; one production composition and one map constructor remain.

- [ ] **Step 5: Run the PR A browser gate**

Start the static server:

```powershell
python -m http.server 8080
```

In a second PowerShell, launch Edge with a temporary CDP profile and run the repository script:

```powershell
$editorProfile = Join-Path $env:TEMP 'bandoxebus-editor-pr-a'
Start-Process msedge -ArgumentList '--headless=new','--remote-debugging-port=9222',"--user-data-dir=$editorProfile",'http://127.0.0.1:8080/editor/'
node scripts/editor-browser-smoke.mjs --gate=pr-a --url=http://127.0.0.1:8080/editor/
```

The script must click New, wait for the actual Story preview, change the authored heading and observe a valid revision refresh, blank the required project title and observe the same last-valid preview plus paused status, repair the title and observe a newer revision, switch desktop/mobile presets, and assert one `.maplibregl-canvas` and no console errors.

- [ ] **Step 6: Run the efficient PR gate**

Run: `npm test`

Expected: all tests PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 7: Commit**

```powershell
git add editor src/app.js tests/editor-shell-preview.test.mjs scripts/editor-browser-smoke.mjs
git commit -m "feat: add GUI editor spine and production preview"
```

PR A review must confirm the browser flow, last-valid behavior, first-invalid neutral pause, desktop/mobile technical presets, and exactly one MapLibre instance. Do not add substantive inspector forms yet.

---

## PR B — Baseline Authoring and Descriptor-Driven Controls

### Task 6: Build trusted descriptor catalogs, `gui.addable`, and bounded schema controls

**Files:**
- Create: `editor/core/descriptors.js`
- Modify: `src/capabilities/descriptor-schema.js`
- Modify: `tests/capability-descriptors.test.mjs`
- Create: `tests/editor-descriptors.test.mjs`

**Interfaces:**
- Consumes: `INSTALLED_CAPABILITY_REGISTRY.catalog()`, `ValidatedProject.capabilities.catalog`, current manifest declarations, production schema fragments.
- Produces: `createEditorDescriptorCatalog`, `isGuiAddable`, `renderSchemaControls`.

- [ ] **Step 1: Write failing trusted-metadata and control-factory tests**

```js
test('only explicit trusted gui.addable true permits a new declaration', () => {
  assert.equal(isGuiAddable({ gui: { addable: true } }), true);
  assert.equal(isGuiAddable({ gui: { addable: false } }), false);
  assert.equal(isGuiAddable({ gui: { group: 'Existing only' } }), false);
  assert.equal(isGuiAddable({}), false);
});

test('installed Route 61-2 packs remain existing-project-only', () => {
  const catalog = createEditorDescriptorCatalog({ registry: INSTALLED_CAPABILITY_REGISTRY, declarations: [] });
  assert.equal(catalog.addable.some(({ id }) => id === 'route-comparison-v1'), false);
  assert.equal(catalog.addable.some(({ id }) => id === 'urban-context-v1'), false);
});
```

Add tests that `gui.addable: 'yes'` is rejected at `$.gui.addable`; a declared non-addable pack remains in `existing`; the factory renders object/string/enum/const/finite number/integer/boolean and only descriptor-used simple arrays; `gui.optionsFrom` reads named semantic catalogs; unsupported schema returns `GUI_SCHEMA_UNSUPPORTED` instead of a raw JSON input.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-descriptors.test.mjs tests/capability-descriptors.test.mjs`

Expected: FAIL because editor descriptors are absent and `gui.addable` is not type-checked.

- [ ] **Step 3: Implement metadata validation and the read-only adapter**

```js
function validateGui(gui) {
  if (gui === undefined) return;
  if (!isPlainObject(gui)) fail('$.gui', 'GUI metadata must be a serializable object.');
  if (gui.addable !== undefined && typeof gui.addable !== 'boolean') {
    fail('$.gui.addable', 'GUI addable metadata must be boolean.');
  }
}

export const isGuiAddable = (descriptor) => descriptor?.gui?.addable === true;
```

Keep other serializable trusted hints compatible. The field factory chooses controls only; it calls `onChange(path, plainValue)` and never reports production validity. Catalog selectors use public dataset/focus/metric/capability target/role IDs only.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-descriptors.test.mjs tests/capability-descriptors.test.mjs tests/capability-parity.test.mjs`

Expected: PASS; runtime/catalog parity remains unchanged.

- [ ] **Step 5: Commit**

```powershell
git add editor/core/descriptors.js src/capabilities/descriptor-schema.js tests/editor-descriptors.test.mjs tests/capability-descriptors.test.mjs
git commit -m "feat: add trusted GUI descriptor controls"
```

### Task 7: Author Project metadata, fixed map settings, provenance, and focus targets

**Files:**
- Create: `editor/ui/inspectors.js`
- Modify: `editor/editor.js`
- Modify: `editor/editor.css`
- Create: `tests/editor-project-focus.test.mjs`

**Interfaces:**
- Consumes: draft mutations, preview camera telemetry, production manifest schema bounds.
- Produces: `renderEntityInspector`, `capturePreviewView`; Project/attribution/focus commands.

- [ ] **Step 1: Write failing Project/focus tests**

```js
test('Project inspector preserves basemap and applies captured camera only on command', () => {
  const draft = fixtureDraft();
  const ui = renderInspectorHarness({ draft, telemetry: { center: [106.6, 11.1], zoom: 12, pitch: 20, bearing: -5 } });
  assert.equal(ui.control('map.basemap').readOnly, true);
  ui.click('use-current-view');
  assert.deepEqual(draft.manifest.map.initialView, { center: [106.6, 11.1], zoom: 12, pitch: 20, bearing: -5 });
  assert.equal(draft.manifest.map.basemap, 'openfreemap-dark');
});
```

Add exact cases for metadata/locale/organization/author/date/version, min/max zoom, attribution add/edit/remove and references, focus datasets/coordinate/bounds forms, camera hints, capture coordinate/bounds, stable read-only IDs, and delete confirmation listing broken references.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-project-focus.test.mjs`

Expected: FAIL because tailored inspectors do not exist.

- [ ] **Step 3: Implement Project/focus tailored controls**

Render with native labeled inputs and `textContent`. `capturePreviewView(kind, telemetry)` returns only production fields:

```js
export function capturePreviewView(kind, view) {
  if (kind === 'initial') return { center: [...view.center], zoom: view.zoom, pitch: view.pitch, bearing: view.bearing };
  if (kind === 'coordinate') return { type: 'coordinate', center: [...view.center], zoom: view.zoom, camera: { pitch: view.pitch, bearing: view.bearing } };
  return { type: 'bounds', bounds: structuredClone(view.bounds), camera: { maxZoom: view.zoom } };
}
```

Show captured values before the user confirms the single draft mutation. Keep basemap as text, never a select or URL input.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-project-focus.test.mjs tests/project-schema.test.mjs tests/project-references.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add editor/ui/inspectors.js editor/editor.js editor/editor.css tests/editor-project-focus.test.mjs
git commit -m "feat: author project and focus settings"
```

### Task 8: Author GeoJSON datasets and normalized tables without geometry editing

**Files:**
- Modify: `editor/ui/inspectors.js`
- Modify: `editor/editor.js`
- Create: `tests/editor-data-inspectors.test.mjs`

**Interfaces:**
- Consumes: `validateGeoJsonResource`, `validateTableData`, manifest renderer vocabulary, descriptor role catalogs.
- Produces: `importGeoJson`, `importNormalizedTable`, tailored dataset/table controls.

- [ ] **Step 1: Write failing data tests**

```js
test('GeoJSON import preserves coordinates and exposes only bounded renderer fields', () => {
  const source = featureCollection('LineString', [[[106, 11], [107, 12]]]);
  const result = importGeoJson(source, { geometry: 'line', path: '$.datasets.route' });
  assert.deepEqual(result.value, source);
  assert.deepEqual(result.observedFields, []);
  assert.deepEqual(result.allowedRenderKeys.sort(), ['color', 'label', 'lineStyle', 'opacity', 'type', 'width']);
});
```

Add line/point/polygon and mixed-open cases; renderer compatibility; feature-label property discovery and placement; role binding; replace/import without coordinate writes; normalized table columns/types/units; scalar/null row add/edit/remove; stable column IDs; invalid row/type errors from production validators; no manifest default-visibility field; and no CSV, formula, join, pivot, or geometry control.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-data-inspectors.test.mjs`

Expected: FAIL because import helpers/controls are absent.

- [ ] **Step 3: Implement bounded data authoring**

Call production validators directly for import admission, then store the unchanged parsed resource in a managed package path generated from its stable ID. Renderer controls write only schema fields. The table grid maps declared columns to native inputs and converts values by the declared production type; missing values are explicit `null`.

```js
export function importGeoJson(value, descriptor) {
  validateGeoJsonResource(value, descriptor, { path: descriptor.path });
  return { value: structuredClone(value), observedFields: observedTopLevelProperties(value) };
}
```

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-data-inspectors.test.mjs tests/resource-schemas.test.mjs tests/feature-labels.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add editor/ui/inspectors.js editor/editor.js tests/editor-data-inspectors.test.mjs
git commit -m "feat: author bounded datasets and tables"
```

### Task 9: Author declared images and static metrics; expose computed descriptors read-only

**Files:**
- Modify: `editor/ui/inspectors.js`
- Modify: `editor/editor.js`
- Create: `tests/editor-assets-metrics.test.mjs`

**Interfaces:**
- Consumes: manifest asset vocabulary, `validateMetricFile`, composed metric descriptors, package byte replacement.
- Produces: image add/replace/remove and static metric controls.

- [ ] **Step 1: Write failing asset/metric tests**

```js
test('computed descriptors are selectable but never written to static metrics', () => {
  const ui = inspectorHarness({ computed: [{ id: 'route-length', label: 'Route length', valueType: 'number', format: { type: 'distance' } }] });
  assert.equal(ui.metric('route-length').readOnly, true);
  assert.equal(ui.metricOptions().includes('route-length'), true);
  assert.equal(Object.hasOwn(ui.draft.metrics.metrics, 'route-length'), false);
});
```

Add declared image media/type/path bytes, replace/add/remove reference impact, preview thumbnails via local object URLs with cleanup, and per-block alt/caption/title/decorative metadata absence from manifest. Cover static scalar/null values and integer/decimal/percentage/distance/currency/text format fields. Assert no computed-value polling/event channel exists.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-assets-metrics.test.mjs`

Expected: FAIL because asset/metric authoring is absent.

- [ ] **Step 3: Implement exact asset and metric vocabularies**

Asset inspector writes only `{ type: 'image', src, mediaType, required?, attribution? }`; image block semantics remain in Story content. Static metrics update the existing metric JSON entry and call `validateMetricFile` for import feedback. Computed descriptors come from the composed trusted catalog and render disabled/read-only.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-assets-metrics.test.mjs tests/resource-schemas.test.mjs tests/metric-registry.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add editor/ui/inspectors.js editor/editor.js tests/editor-assets-metrics.test.mjs
git commit -m "feat: author assets and static metrics"
```

### Task 10: Implement Story/state lifecycle with exact Story 1.0 preservation

**Files:**
- Create: `editor/ui/story-editor.js`
- Modify: `editor/editor.js`
- Create: `tests/editor-story-editor.test.mjs`

**Interfaces:**
- Consumes: draft store, `createStableId`, `moveArrayItem`, Story version/content catalogs.
- Produces: Story 1.1 creation and ordered state commands; read-only legacy Story 1.0 action presentation.

- [ ] **Step 1: Write failing Story version tests**

```js
test('supported Story 1.0 content edit preserves version and legacy actions exactly', () => {
  const original = routeStory10();
  const actions = structuredClone(original.states.map(({ map }) => map));
  const edited = updateSupportedStory10(original, { stateIndex: 0, content: { presenterNote: 'Updated note' } });
  assert.equal(edited.schemaVersion, '1.0');
  assert.deepEqual(edited.states.map(({ map }) => map), actions);
});

test('new Stories are 1.1 and enable canonical actions', () => {
  const story = createStory11({ id: 'main', title: 'Main Story' });
  assert.equal(story.schemaVersion, '1.1');
  assert.deepEqual(story.states[0].map, { enter: [], exit: [] });
});
```

Add Story add/remove, collection order, primary Story selection, add/duplicate/delete/reorder state cases, unique cloned IDs, four layouts, presenter note, focus retention after move, non-empty Story/state constraints, Story 1.0 legacy actions visible/ordered/disabled, and refusal to add Story 1.1-only blocks to Story 1.0.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-story-editor.test.mjs`

Expected: FAIL because Story editor functions are absent.

- [ ] **Step 3: Implement version-aware Story mutations**

```js
export function updateSupportedStory10(story, { stateIndex, content }) {
  const next = structuredClone(story);
  const preservedActions = structuredClone(story.states[stateIndex].map);
  Object.assign(next.states[stateIndex].content, content);
  next.states[stateIndex].map = preservedActions;
  return next;
}
```

Render legacy action type/order and serialized parameters as read-only text/control values; never pass them to canonical field controls. Reordering uses native Move Up/Down and announces the new position.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-story-editor.test.mjs tests/story-versioning.test.mjs tests/story-1.0-normalizer.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add editor/ui/story-editor.js editor/editor.js tests/editor-story-editor.test.mjs
git commit -m "feat: author Stories with legacy preservation"
```

### Task 11: Author all content blocks and canonical descriptor-driven actions

**Files:**
- Create: `editor/ui/content-actions.js`
- Modify: `editor/ui/story-editor.js`
- Modify: `editor/editor.js`
- Create: `tests/editor-content-actions.test.mjs`

**Interfaces:**
- Consumes: composed content/action descriptors, `renderSchemaControls`, public resource catalogs.
- Produces: `createContentBlock`, `createCanonicalAction`, ordered content/enter/exit controls.

- [ ] **Step 1: Write failing content/action tests**

```js
test('canonical action objects come directly from production descriptors and semantic catalogs', () => {
  const action = createCanonicalAction('map.set-visibility', coreMapCatalog(), {
    target: 'service-area', visible: true
  });
  assert.deepEqual(action, { type: 'map.set-visibility', target: 'service-area', visible: true });
  assert.equal(action.target.includes('layer-'), false);
});
```

Add creators/editors for eyebrow, heading, paragraph, stat-group, callout, disclosure, table, chart, image, and legend. Cover table column selectors; bar/line/area and bar-only stacking; numeric series; image alt/decorative invariant; legend swatch/line/icon rules; move/duplicate/delete; Enter/Exit order; all four common actions; capability action discovery; and unsupported descriptor diagnostics. Assert no Chart.js config or raw MapLibre IDs are controls.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-content-actions.test.mjs`

Expected: FAIL because content/action editor does not exist.

- [ ] **Step 3: Implement production-shape factories and tailored controls**

`createContentBlock(type, catalogs)` selects the exact composed descriptor and returns the smallest valid production object for that type. `createCanonicalAction` starts with the descriptor's `properties.type.const`, applies plain values from bounded controls, and never translates names. The production loader remains the validation gate.

```js
export function createCanonicalAction(type, actionDescriptors, values = {}) {
  const descriptor = actionDescriptors.find((item) => item.type === type);
  if (!descriptor) throw Object.assign(new Error(`Unsupported action: ${type}`), { code: 'GUI_SCHEMA_UNSUPPORTED' });
  return { type: descriptor.parameters.properties.type.const, ...structuredClone(values) };
}
```

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-content-actions.test.mjs tests/story-schema.test.mjs tests/content-renderers.test.mjs tests/common-map-integration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add editor/ui/content-actions.js editor/ui/story-editor.js editor/editor.js tests/editor-content-actions.test.mjs
git commit -m "feat: author content blocks and map actions"
```

### Task 12: Complete capability declarations, role binding, integrated authoring, and PR B gate

**Files:**
- Modify: `editor/ui/inspectors.js`
- Modify: `editor/editor.js`
- Modify: `editor/editor.css`
- Create: `tests/editor-capability-authoring.test.mjs`
- Create: `tests/editor-authoring-flow.test.mjs`
- Modify: `scripts/editor-browser-smoke.mjs`

**Interfaces:**
- Consumes: installed/composed catalogs, descriptor field controls, data roles, all prior PR B inspectors.
- Produces: existing declaration edit/remove, explicit addable declaration flow, dependency explanation, end-to-end New Project authoring.

- [ ] **Step 1: Write failing capability and flow tests**

```js
test('existing non-addable declaration is editable but absent from Add Capability', () => {
  const ui = capabilityHarness({ declarations: [{ id: 'route-comparison-v1', settings: { adapter: 'route-61-2-current' } }] });
  assert.equal(ui.existingIds().includes('route-comparison-v1'), true);
  assert.equal(ui.addableIds().includes('route-comparison-v1'), false);
  assert.equal(ui.settingsControl('route-comparison-v1', 'adapter').value, 'route-61-2-current');
});
```

Add an installed fixture descriptor with `gui.addable: true`; verify new declaration, supported settings, declared dependencies, required/optional compatible roles, discovered actions/targets/metrics, remove impact, and a non-addable dependency explanation. Integrated flow creates a New Project, adds line/point/polygon/table/image/static metric/focus/state/content/actions using UI commands, validates with real `loadProject`, and asserts the output contains no editor metadata.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-capability-authoring.test.mjs tests/editor-authoring-flow.test.mjs`

Expected: FAIL because capability inspector/integrated commands are incomplete.

- [ ] **Step 3: Implement existing/addable capability behavior**

Use `registry.catalog()` for installed choices and the current valid composed catalog for owned actions/targets/metrics. Existing declarations render regardless of addability. Add uses only `descriptor.gui?.addable === true`; dependency resolution adds a dependency only when it is already declared/implicit or also explicitly addable. Settings controls use only `settingsSchema`; roles set `manifest.datasets[id].role` to public role IDs.

- [ ] **Step 4: Prove GREEN with focused tests**

Run: `node --test tests/editor-capability-authoring.test.mjs tests/editor-authoring-flow.test.mjs tests/capability-composer.test.mjs tests/capability-parity.test.mjs`

Expected: PASS.

- [ ] **Step 5: Run the PR B browser gate**

Use the same server/CDP launch from Task 5, then:

```powershell
node scripts/editor-browser-smoke.mjs --gate=pr-b --url=http://127.0.0.1:8080/editor/
```

The script creates a small project substantially through visible GUI controls: metadata/camera/provenance, imported line and point GeoJSON, renderer/label, normalized table, static metric, image, focus target, two states, table/chart/image/legend blocks, focus/visibility/emphasis actions, state reorder, desktop/mobile preview, and one MapLibre canvas. It also opens Route 61-2 and asserts Story 1.0 legacy parameters are disabled.

- [ ] **Step 6: Run the efficient PR gate**

Run: `npm test`

Expected: all tests PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 7: Commit**

```powershell
git add editor tests/editor-capability-authoring.test.mjs tests/editor-authoring-flow.test.mjs scripts/editor-browser-smoke.mjs
git commit -m "feat: complete GUI project authoring"
```

---

## PR C — Persistence, Hardening, and Certification

### Task 13: Implement bounded Folder Open and deterministic explicit Save

**Files:**
- Modify: `editor/storage/adapters.js`
- Modify: `editor/core/package-store.js`
- Modify: `editor/editor.js`
- Create: `tests/editor-folder-storage.test.mjs`

**Interfaces:**
- Consumes: `collectDeclaredPackageEntries`, package change sets, File System Access handles.
- Produces: `createFolderStorageAdapter`, exact `StorageResult`, runtime capability detection.

- [ ] **Step 1: Write failing folder-boundary/save tests with fake handles**

```js
test('Folder Open reads project.json and declared resources without enumeration', async () => {
  const fs = fakeDirectory({
    'project.json': manifestBytes(['stories/main.story.json', 'data/route.geojson']),
    'stories/main.story.json': storyBytes(),
    'data/route.geojson': geoJsonBytes(),
    'secret.txt': bytes('untouched')
  });
  const opened = await createFolderStorageAdapter({ directoryHandle: fs.root }).open();
  assert.deepEqual(opened.entries.map(({ path }) => path).sort(), ['data/route.geojson', 'project.json', 'stories/main.story.json']);
  assert.equal(fs.enumerationCalls, 0);
  assert.equal(fs.reads.includes('secret.txt'), false);
});
```

Add nested declared path traversal by explicit `getDirectoryHandle` segments, invalid/parse-repair opening, unknown files untouched, changed entries only, lexical resource writes then `project.json` last, permission denial preserving draft, partial failure reporting, and `markWritten` clearing only successes. If any resource write fails, skip `project.json` and report it in `skipped`.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-folder-storage.test.mjs`

Expected: FAIL because folder adapter methods are contracts only.

- [ ] **Step 3: Implement capability detection and explicit path walking**

```js
export const canOpenFolder = (windowRef = window) => typeof windowRef.showDirectoryPicker === 'function';

async function writeChanges(changeSet) {
  const ordered = changeSet.filter(({ path }) => path !== 'project.json').sort((a, b) => a.path.localeCompare(b.path));
  const result = { written: [], failed: [], skipped: [] };
  for (const change of ordered) await writeOne(change, result);
  if (result.failed.length) result.skipped.push('project.json');
  else if (changeSet.some(({ path }) => path === 'project.json')) await writeOne(changeSet.find(({ path }) => path === 'project.json'), result);
  return result;
}
```

Never call `values()`, `entries()`, recursive iteration, or directory-wide delete. Save may persist invalid drafts only after the UI confirmation; Export remains blocked by fatal diagnostics.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-folder-storage.test.mjs tests/editor-package-draft.test.mjs tests/path-resolver.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add editor/storage/adapters.js editor/core/package-store.js editor/editor.js tests/editor-folder-storage.test.mjs
git commit -m "feat: add bounded folder project storage"
```

### Task 14: Implement safe ZIP import/export with pinned `fflate` 0.8.3

**Files:**
- Create: `vendor/fflate/0.8.3/fflate.esm.js`
- Create: `vendor/fflate/0.8.3/LICENSE`
- Modify: `editor/storage/adapters.js`
- Modify: `editor/editor.js`
- Create: `tests/editor-zip-storage.test.mjs`
- Create: `tests/fixtures/editor/zip-entries/README.txt`

**Interfaces:**
- Consumes: official `fflate` 0.8.3 browser ESM `Unzip`, `UnzipInflate`, `zipSync`; package path normalization.
- Produces: `createZipStorageAdapter`, Import Project ZIP, Export Project ZIP.

- [ ] **Step 1: Vendor and verify the exact upstream files**

Copy `esm/browser.js` and `LICENSE` from `fflate@0.8.3`, whose npm integrity is `sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==`. Record the version/source comment in `editor/storage/adapters.js`; do not add `package.json`, a lockfile, CDN load, or build step. Version 0.8.3 is required because it is the current zero-dependency MIT release and fixes the Zip64 buffer over-read/denial-of-service issue affecting versions through 0.8.2.

- [ ] **Step 2: Write failing ZIP safety/preservation tests**

```js
test('ZIP re-export preserves safe unknown payload bytes and managed edits', async () => {
  const unknown = bytes('keep exactly\r\n');
  const imported = await zipAdapter(zipFixture({ 'README.txt': unknown })).open();
  imported.packageStore.setCurrentBytes('project.json', changedManifestBytes());
  const exported = await imported.adapter.export(imported.packageStore);
  const entries = await unzipForTest(exported);
  assert.deepEqual(entries['README.txt'], unknown);
  assert.deepEqual(entries['project.json'], changedManifestBytes());
  assert.equal(Object.hasOwn(entries, 'editor-state.json'), false);
});
```

Add rejection for `../escape`, `/absolute`, drive paths, backslashes, percent-decoded traversal, duplicate normalized `./b`/`b`, and duplicate exact names observed through streaming `Unzip` before object-key collapse. Add safe unknown binary preservation, removed declaration becoming pass-through, declared managed classification, fatal-validation export block, and export containing no runtime/editor files.

- [ ] **Step 3: Implement bounded streaming import and project-only export**

Use `Unzip` callbacks so duplicate normalized names are detected before any map assignment. Lock limits as editor security policy, not project schema: 2,048 entries, 64 MiB decompressed per entry, and 256 MiB total decompressed. Reject the archive before promotion when a limit/path/duplicate fails. Preserve unknown safe uncompressed entry payloads exactly and feed all staged payloads to `zipSync`; archive metadata/compression need not be byte-identical.

Export stages changed managed entries, unchanged managed bytes, and ZIP-origin safe pass-through entries. Folder-origin export includes only declared managed entries. `project.json` is required at the archive root. Never include editor code, runtime files, handles, diagnostics, preferences, object URLs, or preview state.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-zip-storage.test.mjs tests/editor-package-draft.test.mjs tests/path-resolver.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add vendor/fflate/0.8.3 editor/storage/adapters.js editor/editor.js tests/editor-zip-storage.test.mjs tests/fixtures/editor/zip-entries/README.txt
git commit -m "feat: add safe project ZIP persistence"
```

### Task 15: Harden keyboard access, validation navigation, message safety, and authored rendering

**Files:**
- Modify: `editor/index.html`
- Modify: `editor/editor.css`
- Modify: `editor/editor.js`
- Modify: `editor/core/validation.js`
- Modify: `editor/preview/bridge.js`
- Modify: `editor/preview/package-resolver.js`
- Modify: `editor/ui/inspectors.js`
- Modify: `editor/ui/story-editor.js`
- Modify: `editor/ui/content-actions.js`
- Create: `tests/editor-accessibility-security.test.mjs`

**Interfaces:**
- Consumes: diagnostics `{packagePath,path}`, selection index, preview telemetry/protocol.
- Produces: keyboard-complete UI, focus restoration, diagnostic-to-control navigation, safe bounded messages.

- [ ] **Step 1: Write failing accessibility/security contract tests**

```js
test('ordered items keep focus and announce Move Up/Down results', () => {
  const ui = storyHarness(['one', 'two']);
  ui.focusMoveDown('one');
  ui.clickMoveDown('one');
  assert.deepEqual(ui.order(), ['two', 'one']);
  assert.equal(ui.activeItem(), 'one');
  assert.match(ui.liveMessage(), /position 2 of 2/i);
});
```

Add persistent label/help/error associations, required state, landmarks/headings, dialog focus trap/restore, delete neighbor focus, validation drawer activation selecting/focusing closest control, source-repair textarea for syntactically invalid known JSON with tailored controls restored after valid parse, icon/text/code/path beyond color, iframe title, reduced-motion forwarding, browser zoom/narrow inspector operability, and safe error text. Security assertions scan editor sources for `.innerHTML`, `eval`, `Function(`, dynamic authored imports, unbounded `postMessage('*')`, file handles in payloads, and executable resource materialization.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-accessibility-security.test.mjs`

Expected: FAIL on missing focus/diagnostic/message hardening.

- [ ] **Step 3: Implement navigation and protocol limits**

Build a navigation-only index from production paths to `{ selection, controlId }`; it never validates. On diagnostic activation, select the owner, render inspector, focus the nearest existing control, and fall back to the source-repair view for parse errors. Protocol payloads accept only known keys/types, exact origin/source, monotonic revision, and a 256 MiB package ceiling; runtime errors serialize only `{ code, path, message }`. Forward reduced-motion preference as preview transport context. Use native buttons and `aria-live` for all ordering.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-accessibility-security.test.mjs tests/editor-shell-preview.test.mjs tests/content-renderers.test.mjs tests/manifest-bootstrap-integration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add editor tests/editor-accessibility-security.test.mjs
git commit -m "fix: harden editor accessibility and security"
```

### Task 16: Add production-package and Route 61-2 certification regressions

**Files:**
- Create: `tests/editor-certification.test.mjs`
- Create: `tests/fixtures/editor/invalid-reference/project.json`
- Create: `tests/fixtures/editor/invalid-reference/stories/main.story.json`
- Modify: `scripts/serve-project-fixture.mjs`
- Modify: `scripts/editor-browser-smoke.mjs`

**Interfaces:**
- Consumes: all editor commands/adapters, unchanged production fixture server/loader, root Route 61-2 project and Story bytes.
- Produces: automated evidence for exported package acceptance and compatibility protection.

- [ ] **Step 1: Write failing end-to-end certification tests**

```js
test('open, preview, and unrelated save preserve Route 61-2 Story bytes', async () => {
  const temporaryRoot = await copyRepositoryProjectToTemp();
  const storyPath = join(temporaryRoot, 'data/stories/route-61-2.story.json');
  const before = await readFile(storyPath);
  const opened = await openFolderFixture(temporaryRoot);
  await previewThroughProduction(opened);
  opened.draft.mutate('project.json', (manifest) => { manifest.subtitle = `${manifest.subtitle} `; });
  await opened.adapter.writeChanges(opened.packageStore.changeSet());
  const after = await readFile(storyPath);
  assert.deepEqual(after, before);
  assert.equal(sha256(after), '29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a');
});
```

Use a temporary copy for write tests, never the repository files. Add supported Story 1.0 content edit preserving `schemaVersion: '1.0'` and exact legacy action objects; invalid-reference repair mode; folder boundary; ZIP pass-through; New Project with line/point/polygon/table/static metric/image/focus/actions; optional `gui.addable` fixture or existing declaration; and export unzip/mount accepted by unchanged `loadProject` with no translation.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/editor-certification.test.mjs`

Expected: FAIL until the integrated export/mount helpers and fixtures are complete.

- [ ] **Step 3: Implement fixture serving for an exported package root**

Extend `createFixtureServer` only with an explicit `fixtureRoot` already supported by the script; do not change production runtime routes. The certification writes exported project content to an OS temporary directory, starts the existing fixture server with that directory as project root and the unchanged repository as application root, then loads `/` normally. Assert production `/`, default Story Shell, Explore exit/re-entry, `?storyShell=legacy`, `?storyShell=poc`, one map, and Route 61-2 transport POI source/ground-layer tests remain unchanged.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/editor-certification.test.mjs tests/route-61-2-project.test.mjs tests/route-61-2-action-contracts.test.mjs tests/story-shell-integration.test.mjs tests/transport-poi-beacons.test.mjs`

Expected: PASS; Route Story SHA-256 is unchanged and exported content loads through normal production startup.

- [ ] **Step 5: Commit**

```powershell
git add tests/editor-certification.test.mjs tests/fixtures/editor/invalid-reference scripts/serve-project-fixture.mjs scripts/editor-browser-smoke.mjs
git commit -m "test: certify GUI-authored production packages"
```

### Task 17: Run final browser certification, document evidence, and close PR C

**Files:**
- Create: `review/gui-editor-v1/REPORT.md`
- Modify: `scripts/editor-browser-smoke.mjs`
- Test: all tests named in Tasks 13–16 plus full suite.

**Interfaces:**
- Consumes: completed editor, fixtures, normal production startup, PR A/B/C browser gates.
- Produces: final acceptance report and CI-ready PR C.

- [ ] **Step 1: Extend the browser script with the exact PR C scenarios**

`--gate=pr-c` runs:

1. New ordinary project with line/point/polygon data, normalized table/static metric, table/chart/image/legend content, focus/actions, desktop/mobile preview, and one map.
2. Explicitly add a trusted test capability with `gui.addable: true` or edit an existing installed declaration; confirm installed non-addable Route packs are absent from Add.
3. Route 61-2 open/preview, Story 1.0 legacy controls read-only, unrelated save byte hash unchanged, Story/Explore/legacy alias behavior unchanged, transport POI treatment unchanged.
4. Valid → invalid → repair with last-valid preview retention and first-invalid neutral pause.
5. Folder Open access log contains only `project.json` and declared paths; unknown sentinel is untouched.
6. ZIP import/export retains unknown safe payload bytes and rejects traversal/duplicate fixtures.
7. Exported project content is mounted by `scripts/serve-project-fixture.mjs`; unchanged production `/` loads it with desktop `1920x1080` and mobile `390x844`, one MapLibre canvas, accessible table/chart/image/legend, and clean console.

- [ ] **Step 2: Run final browser certification**

With the same static server and CDP Edge launch from Task 5:

```powershell
node scripts/editor-browser-smoke.mjs --gate=pr-c --url=http://127.0.0.1:8080/editor/
```

Expected: `GUI_EDITOR_V1_BROWSER_RESULT: PASS`, one map in every preview/runtime scenario, and zero unexpected console errors. Do not rerun Route 61-2 performance certification because no editor change alters production rendering behavior; the startup/one-map regressions are sufficient.

- [ ] **Step 3: Write the evidence report**

`review/gui-editor-v1/REPORT.md` records base/head SHA, test counts, CI link, all seven design scenarios, desktop/mobile results, Route Story hash, folder read/write log, ZIP pass-through hash, exported-package mount, one-map result, accessibility/security checks, and explicit statements:

```text
BASELINE_AUTHORING_CONTRACT_V1: LOCKED
GUI_ONLY_SCHEMA: NONE
PRODUCTION_PREVIEW_COMPOSITION: SHARED
NEW_RUNTIME_DEPENDENCY: fflate 0.8.3 vendored ESM
GUI_EDITOR_V1_CERTIFICATION_RESULT: PASS
```

- [ ] **Step 4: Run the efficient final regression gate**

Run: `npm test`

Expected: all tests PASS.

Run: `git diff --check`

Expected: no output.

Confirm only the intended PR C files changed and `git diff -- data/stories/route-61-2.story.json` is empty.

- [ ] **Step 5: Commit**

```powershell
git add scripts/editor-browser-smoke.mjs review/gui-editor-v1/REPORT.md
git commit -m "docs: certify GUI Editor V1"
```

## PR-Level Acceptance Summary

- **PR A (5 tasks):** `/editor/` static shell; memory/new package; distinct draft/UI/last-valid state; definitive production validation; shared production composition; fetch/object-URL transport; valid preview; invalid pause; desktop/mobile presets; one map.
- **PR B (7 tasks):** complete Project, dataset, normalized table, asset, static/computed metric, focus, Story/state, ten content block, canonical action, capability/settings/role authoring; Story 1.0 preservation; browser-created ordinary project.
- **PR C (5 tasks):** bounded folder access/save, safe ZIP persistence with `fflate` 0.8.3, accessibility/security/navigation hardening, Route 61-2 and exported-package certification, final desktop/mobile browser evidence.

## Design Coverage and Self-Review Map

| Approved design section | Implemented/proved by |
| --- | --- |
| 1–4 problem, non-goals, locked authority, workflow | Global Constraints; Tasks 2, 5, 12, 17. |
| 5 UX shell, selection, ordering, IDs | Tasks 2, 5, 7, 10, 11, 15. |
| 6 technology decision | Header/Global Constraints; Tasks 5 and 14. |
| 7–10 architecture, package/persistence/state | Tasks 2, 3, 13, 14. |
| 11 validation and repair | Tasks 3, 15, 16. |
| 12 production preview, transport, protocol, lifecycle, presets, isolation | Tasks 1, 4, 5, 15, 17. |
| 13 tailored/generic form strategy | Tasks 6–12. |
| 14 Project editor | Task 7. |
| 15 datasets, tables, assets, metrics | Tasks 8–9. |
| 16 focus and actions | Tasks 7 and 11. |
| 17 Story/content | Tasks 10–11. |
| 18 capabilities | Tasks 6 and 12. |
| 19 Story 1.0 policy | Tasks 10, 12, 16, 17. |
| 20 errors | Tasks 3, 13–16. |
| 21 accessibility | Task 15 and final browser gate. |
| 22 security | Tasks 4, 5, 14, 15. |
| 23 static deployment/performance/dependencies | Tasks 5, 14, 17. |
| 24 module boundaries | Locked V1 File and Module Structure. |
| 25 acceptance scenarios | Tasks 12, 16, 17. |
| 26 testing | Every task's focused RED/GREEN cycle and PR gates. |
| 27 three-PR decomposition | Delivery table and 5/7/5 task grouping. |
| 28 deferred work | Global Constraints and absence from all tasks. |
| 29 design self-review decisions | Checklist below. |

Final plan audit:

- No GUI-only schema or editor-to-runtime translation exists; drafts and snapshots contain production resources directly.
- Preview composition is not duplicated: both modes call `startProductionApplication(createProductionApplicationOptions(...))` from `src/app.js`.
- Folder access is declaration-driven and contains no enumeration API.
- Story 1.0 open/preview/unrelated Save is byte-preserving; supported edits keep 1.0 and exact legacy action objects; legacy parameters are read-only.
- `gui.addable` is trusted descriptor metadata, must equal boolean `true`, and defaults false; no editor allowlist exists.
- Basemap is preserved/read-only and New Project uses `openfreemap-dark`; no catalog or style URL exists.
- Computed metrics are descriptor-only/read-only/selectable; no value telemetry subsystem exists.
- Every New Story is 1.1.
- ZIP export is authored project content with safe ZIP-origin pass-through payloads, never a runtime/site bundle.
- Exact module/function names match the Locked Interfaces section and all tasks.
- Review boundaries remain exactly PR A, PR B, and PR C with 5/7/5 internal tasks.
- Focused tests run per task; `npm test`, `git diff --check`, browser smoke, and CI run once per meaningful PR.
- Route 61-2 protection covers production `/`, Story bytes, Story Shell, Explore, legacy alias, one map, and transport POI treatment without unnecessary performance recertification.
- Planned runtime dependency is exactly one vendored library: `fflate` 0.8.3 ESM; no package/build dependency is added.
- No baseline production contract change is required. If contrary implementation evidence appears, that PR stops for design review.
