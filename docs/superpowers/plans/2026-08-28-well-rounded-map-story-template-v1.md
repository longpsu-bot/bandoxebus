# Well-Rounded Map Story Template V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Subagents are disabled for this project. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish `BASELINE_AUTHORING_CONTRACT_V1` so an ordinary static map-story project launches from `project.json`, Story JSON, normalized data, and assets without project-specific JavaScript or HTML edits.

**Architecture:** A fixed `./project.json` is validated and resolved into a project definition, then implicit core capabilities and trusted optional capabilities are composed before the existing Generic Story Runtime and Story Shell start around one persistent MapLibre instance. Story 1.0 remains immutable and is normalized once into canonical capability actions; Story 1.1 adds only the four approved content blocks. `app.js` becomes the composition root while schemas, loading, capability composition, metrics, rendering, and compatibility live in focused ESM modules.

**Tech Stack:** Static HTML/CSS, browser-native ES modules, Node.js `node:test`, MapLibre GL JS 5.24.0, Three.js 0.185.0, native DOM/`Intl`, and vendored Chart.js 4.5.1 UMD.

**Spec:** `docs/superpowers/specs/2026-08-28-well-rounded-map-story-template-v1-design.md` at commit `ad1f1233c66a94db41127e5e1a295bc3639cca31`.

## Global Constraints

- Preserve `data/stories/route-61-2.story.json` byte-for-byte as Story Schema `1.0` through all ten slices.
- Compose exactly one implicit `core-content-v1` and one implicit `core-map-v1`; reject either ID in manifest `capabilities`.
- Manifest `capabilities` selects trusted application registry IDs and data-only settings only; authored files never contain code, callbacks, expressions, DOM/MapLibre/class instances, script/module URLs, raw MapLibre expressions, or raw Chart.js options.
- Dataset `role` remains optional unless a selected capability descriptor requires it.
- Baseline map rendering is limited to safe line, point, and fill descriptors, bounded non-interactive feature labels, and semantic targets.
- Story 1.1 is additive; Story 1.0 legacy actions validate and normalize before runtime, never through duplicate handlers.
- Runtime table data is normalized JSON with `text|integer|number|boolean|date`; there is no CSV/Excel parser, formula engine, join, aggregation, or spreadsheet runtime.
- One read-only metric namespace combines static and capability-computed metrics and formats through project locale with `Intl`.
- Chart.js is pinned to `4.5.1`; vendor `chart.umd.min.js` and `LICENSE.md` under `vendor/chart.js/4.5.1/` and do not load Chart.js from a CDN.
- Keep one MapLibre instance, the existing Story Shell and explicit legacy fallback, desktop/mobile behavior, accessibility, reduced motion, and the settled performance envelope.
- Do not add a framework, database, CMS, GUI Editor, project selector, generic popup system, runtime plugin download, or any other explicit non-goal from the spec.

## Delivery and Branch Discipline

Each slice is a separate PR-level review unit. After the previous slice is approved and merged, run:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
npm test
git switch -c <slice-branch>
```

The test run must pass before work starts. Implement the slice with focused RED/GREEN cycles, run `npm test`, run `git diff --check`, push, wait for CI, obtain review approval, merge, then discard the slice branch as authority. The next slice starts from freshly updated `origin/main`, never from an earlier feature branch. Documentation-only Slice 10 follows the same main-authority rule. Do not keep ten stacked branches.

## Locked Module and Resource Structure

| Path | Single responsibility |
| --- | --- |
| `data/schemas/project-manifest-v1.schema.json` | Canonical serializable Manifest 1.0 schema used by runtime and future GUI discovery. |
| `data/schemas/table-data-v1.schema.json` | Canonical normalized table schema. |
| `data/schemas/metric-file-v1.schema.json` | Canonical static metric file schema. |
| `data/schemas/story-1.1.schema.json` | Additive Story 1.1 content/action envelope. |
| `src/contracts/schema-validator.js` | Small dependency-free validator for the JSON-Schema subset used by canonical descriptors. |
| `src/project/project-error.js` | Stable `ProjectLoadError { code, path, message, cause }` and safe error conversion. |
| `src/project/project-schema.js` | Manifest validation plus structural resource/focus/provenance checks. |
| `src/project/resource-schemas.js` | Table, metric, GeoJSON, and image metadata payload validation. |
| `src/project/path-resolver.js` | Same-origin package-relative URL resolution and executable-path rejection. |
| `src/project/reference-validator.js` | Cross-resource IDs, roles, columns, metrics, assets, attribution, focus, and Story references. |
| `src/project/resource-loader.js` | Abort-aware JSON/image resource fetching with required/optional outcomes. |
| `src/project/project-loader.js` | Orchestrate manifest, capabilities, resources, Story validation/normalization, and return a frozen project definition. |
| `src/project/bootstrap.js` | Create the map/capabilities/runtime/shell from a validated project; render safe fatal errors. |
| `src/application.js` | Own the fixed manifest startup sequence and ensure fatal project loads never enter interactive bootstrap. |
| `src/capabilities/descriptor-schema.js` | Validate capability descriptors, settings schemas, and GUI-readable metadata. |
| `src/capabilities/capability-registry.js` | Trusted installed capability entries keyed by exact ID. |
| `src/capabilities/capability-composer.js` | Add implicit cores, resolve dependencies, roles and ownership, check handler/descriptor parity, order create/destroy. |
| `src/capabilities/story-1.0-normalizer.js` | Versioned compatibility validation and one-time normalization into canonical actions. |
| `src/capabilities/core-content-v1.js` | Core content descriptor catalog and renderer bindings. |
| `src/capabilities/core-map-v1.js` | Core map descriptor, action handlers, targets, and lifecycle factory. |
| `src/capabilities/route-comparison-v1.js` | Route actions, roles, computed metrics, legacy normalizers, and existing Route 61-2 adapter bindings. |
| `src/capabilities/urban-context-v1.js` | Context action/role descriptor and adapter around existing `urban-context.js`. |
| `src/capabilities/installed-capabilities.js` | Application-owned registry assembly for implicit core and installed optional capability entries. |
| `src/data/table-registry.js` | Immutable lookup boundary for validated normalized table datasets. |
| `src/metrics/metric-registry.js` | Collision-free immutable static/computed metric registry and unavailable outcomes. |
| `src/metrics/locale-formatter.js` | Shared `Intl` formatting for all approved formats. |
| `src/map/geojson-renderer.js` | Translate bounded authored render/label descriptors into application-owned MapLibre definitions. |
| `src/map/focus-registry.js` | Resolve datasets, coordinate, bounds, and capability logical focus targets. |
| `src/map/core-map-controller.js` | Visibility, emphasis, clear, focus, reset, and destroy over semantic target IDs. |
| `src/content/content-descriptors.js` | One serializable block catalog shared by Story validation, runtime, and future GUI discovery. |
| `src/content/content-renderers.js` | Trusted renderers for all ten block types using native DOM semantics. |
| `src/content/chart-config.js` | Narrow Story chart-to-Chart.js translation and accessible summary data. |
| `src/content/chart-renderer.js` | Chart lifecycle using injected `Chart`, reduced motion, canvas semantics, and fallback table. |
| `vendor/chart.js/4.5.1/chart.umd.min.js` | Exact locally pinned Chart.js browser build. |
| `vendor/chart.js/4.5.1/LICENSE.md` | License from the exact Chart.js 4.5.1 package. |
| `project.json` | Route 61-2 deployment manifest after Slice 4. |

Existing `src/story-runtime.js` and `src/story-shell.js` retain their state/lifecycle semantics. `src/story-schema.js` becomes version routing around the shared descriptors. `src/presentation-renderer.js` becomes a compatibility re-export of the new content renderer during migration. `src/presentation-metrics.js` delegates to the shared metric/formatter boundary. `src/app.js` is reduced incrementally; unrelated route simulation and certified spatial behavior stay in their existing modules.

## Dependency Graph and Review Stops

```text
Slice 1 contracts
  -> Slice 2 capability descriptors
  -> STOP Gate A
  -> Slice 3 generic bootstrap
  -> Slice 4 Route 61-2 migration
  -> STOP Gate B
  -> Slice 5 data/metrics
  -> Slice 6 common map capability
  -> Slice 7 Story 1.1/content
  -> STOP Gate C
  -> Slice 8 complete synthetic package
  -> Slice 9 certification
  -> STOP Gate D
  -> Slice 10 contract lock
```

Every slice leaves Route 61-2 deployable. Contract-only Slices 1–2 do not trigger browser performance work. Executable Slices 3, 5, 6, and 7 use a short settled sanity sample when map/bootstrap behavior changes. Slice 4 Gate B and Slice 9 certification use the full certified CDP method: typical about 59.9 FPS, sustained-low about 59.5 FPS, average about 60.0 FPS, hard floor `>=30 FPS` sustained-low, no recurring settled source mutations, and no runaway render/repaint loop.

---

## Slice 1 — Contract Foundations

**Branch/PR:** `feat/template-v1-contracts` — start from fresh `main`.

### Task 1: Canonical schema subset and Manifest 1.0 structure

**Files:**
- Create: `src/contracts/schema-validator.js`
- Create: `src/project/project-error.js`
- Create: `src/project/project-schema.js`
- Create: `data/schemas/project-manifest-v1.schema.json`
- Create: `tests/project-schema.test.mjs`
- Create: `tests/fixtures/contracts/project.valid.json`
- Create: `tests/fixtures/contracts/project.invalid-executable.json`

**Interfaces:**
- Produce `validateSchema(value, schema, { path = '$' } = {}) -> ReadonlyArray<{ code, path, message }>`.
- Produce `ProjectLoadError(code, path, message, { cause } = {})` with enumerable `code`, `path`, `message`.
- Produce `validateProjectManifest(manifest) -> manifest`, throwing `ProjectLoadError('PROJECT_MANIFEST_INVALID', path, message)` on the first deterministic issue.
- Produce `PROJECT_MANIFEST_V1_SCHEMA`, the frozen runtime form of the checked-in schema.
- Produce `PROJECT_MANIFEST_SCHEMA_URL`, a URL to the checked-in canonical JSON schema.

- [ ] **Step 1: Write the failing contract test and fixtures**

```js
test('Manifest 1.0 accepts the minimal safe package and rejects executable fields', async () => {
  const valid = JSON.parse(await readFile(fixture('project.valid.json'), 'utf8'));
  assert.equal(validateProjectManifest(valid), valid);
  const unsafe = JSON.parse(await readFile(fixture('project.invalid-executable.json'), 'utf8'));
  assert.throws(() => validateProjectManifest(unsafe), (error) =>
    error.code === 'PROJECT_MANIFEST_INVALID'
      && error.path === '$.capabilities[0].module'
      && /unknown property/i.test(error.message));
});
```

The valid fixture contains every required empty registry, one primary Story reference, and a bounded camera. The invalid fixture adds `"module": "./project-code.js"` to an optional capability declaration. Add table-driven assertions for unknown top-level properties, invalid IDs, duplicate Story IDs, explicit `core-content-v1`/`core-map-v1`, camera longitude/latitude/zoom/pitch/bearing bounds, and `minZoom <= initialView.zoom <= maxZoom`.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/project-schema.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/project/project-schema.js`.

- [ ] **Step 3: Add the minimal schema and validator**

```js
export function validateProjectManifest(manifest) {
  const issues = validateSchema(manifest, PROJECT_MANIFEST_V1_SCHEMA);
  if (issues.length) throw projectError('PROJECT_MANIFEST_INVALID', issues[0]);
  validateReservedCapabilities(manifest.capabilities);
  validateInitialViewRange(manifest.map);
  return manifest;
}
```

Support only the schema keywords actually checked in: `type`, `const`, `enum`, `required`, `properties`, `additionalProperties`, `items`, `minItems`, `pattern`, `minimum`, `maximum`, and `format: date`. Freeze the schema export, keep issue ordering stable by object/schema order, and use text-only error messages.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/project-schema.test.mjs`

Expected: all Manifest structure cases PASS.

- [ ] **Step 5: Run slice regression**

Run: `npm test`

Expected: existing 143 tests plus the new contract cases PASS; no browser benchmark is required.

- [ ] **Step 6: Commit the behavior**

```powershell
git add data/schemas/project-manifest-v1.schema.json src/contracts/schema-validator.js src/project/project-error.js src/project/project-schema.js tests/project-schema.test.mjs tests/fixtures/contracts
git commit -m "feat: define project manifest v1 contract"
```

### Task 2: Normalized table and static metric contracts

**Files:**
- Create: `data/schemas/table-data-v1.schema.json`
- Create: `data/schemas/metric-file-v1.schema.json`
- Create: `src/project/resource-schemas.js`
- Create: `tests/resource-schemas.test.mjs`
- Create: `tests/fixtures/contracts/table.valid.json`
- Create: `tests/fixtures/contracts/table.invalid-row.json`
- Create: `tests/fixtures/contracts/metrics.valid.json`
- Create: `tests/fixtures/contracts/metrics.invalid-expression.json`

**Interfaces:**
- Produce `validateTableData(value, { path = '$' } = {}) -> value`.
- Produce `validateMetricFile(value, { path = '$' } = {}) -> value`.
- Produce `validateGeoJsonResource(value, descriptor, { path = '$' } = {}) -> value` for structural FeatureCollection/declared geometry checks used later.

- [ ] **Step 1: Write failing payload tests**

```js
test('normalized tables enforce declared scalar columns and exact row keys', () => {
  assert.equal(validateTableData(validTable), validTable);
  assert.throws(() => validateTableData({ ...validTable, rows: [{ year: 2026, extra: 1 }] }),
    (error) => error.code === 'TABLE_DATA_INVALID' && error.path === '$.rows[0].extra');
});

test('metric files permit literal scalar/null values and reject expression-shaped fields', () => {
  assert.equal(validateMetricFile(validMetrics), validMetrics);
  assert.throws(() => validateMetricFile(expressionMetrics),
    (error) => error.code === 'METRIC_FILE_INVALID' && /expression|unknown property/i.test(error.message));
});
```

Cover duplicate column IDs, missing values represented by omitted keys instead of `null`, unknown row keys, integer/finite-number/boolean/date mismatches, non-finite values, duplicate metric IDs after JSON object parsing is not possible and therefore ID-pattern failure, unsupported format types, percentage/distance decimal bounds, and required ISO 4217 currency.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/resource-schemas.test.mjs`

Expected: FAIL with missing exports from `src/project/resource-schemas.js`.

- [ ] **Step 3: Add minimal semantic validation over canonical schemas**

```js
export function validateTableData(value, options = {}) {
  assertCanonical(value, TABLE_DATA_V1_SCHEMA, 'TABLE_DATA_INVALID', options.path);
  const columns = new Map(value.columns.map((column) => [column.id, column]));
  assertUnique(value.columns.map(({ id }) => id), '$.columns', 'TABLE_DATA_INVALID');
  value.rows.forEach((row, index) => validateRow(row, columns, `$.rows[${index}]`));
  return value;
}
```

`validateMetricFile` applies the common format descriptor and accepts only string, finite number, boolean, or `null`. Neither validator coerces data.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/resource-schemas.test.mjs`

Expected: all table/metric cases PASS.

- [ ] **Step 5: Run regression**

Run: `npm test`

Expected: PASS; no application source is imported by the new fixture tests.

- [ ] **Step 6: Commit**

```powershell
git add data/schemas/table-data-v1.schema.json data/schemas/metric-file-v1.schema.json src/project/resource-schemas.js tests/resource-schemas.test.mjs tests/fixtures/contracts
git commit -m "feat: define table and metric resource contracts"
```

### Task 3: Safe package-relative resource resolution

**Files:**
- Create: `src/project/path-resolver.js`
- Create: `tests/path-resolver.test.mjs`
- Modify: `src/project/project-schema.js`

**Interfaces:**
- Produce `resolvePackageUrl(manifestUrl, authoredPath, { kind = 'resource' } = {}) -> URL`.
- Produce `resolveManifestResourceUrls(manifest, manifestUrl) -> frozen normalized URL registry` without mutating the manifest.

- [ ] **Step 1: Write the failing security test**

```js
test('resource resolution stays inside the same-origin manifest package', () => {
  assert.equal(resolvePackageUrl('https://host/maps/project.json', './data/a.json').href,
    'https://host/maps/data/a.json');
  for (const value of ['https://evil.test/a.json', '//evil.test/a.json', '/root/a.json', '../a.json', './code.js', './code.mjs']) {
    assert.throws(() => resolvePackageUrl('https://host/maps/project.json', value),
      (error) => error.code === 'UNSAFE_RESOURCE_PATH' && error.path === '$.src');
  }
});
```

Also reject `javascript:`, `data:`, backslashes, encoded traversal, query/hash mutation, `script|module|plugin` kinds, and allow external `https:` only in attribution `url` fields because those are provenance links, not fetched project resources.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/path-resolver.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement URL resolution with decoded-segment checks**

```js
export function resolvePackageUrl(manifestUrl, authoredPath, { kind = 'resource' } = {}) {
  assertSafeAuthoredPath(authoredPath, kind);
  const manifest = new URL(manifestUrl, globalThis.location?.href ?? 'http://localhost/');
  const resolved = new URL(authoredPath, manifest);
  if (resolved.origin !== manifest.origin || !resolved.pathname.startsWith(packageDirectory(manifest))) {
    throw new ProjectLoadError('UNSAFE_RESOURCE_PATH', '$.src', 'Resource must stay inside the manifest package.');
  }
  return resolved;
}
```

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/path-resolver.test.mjs`

Expected: all path/security cases PASS.

- [ ] **Step 5: Run regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/project/path-resolver.js src/project/project-schema.js tests/path-resolver.test.mjs
git commit -m "feat: enforce safe project resource paths"
```

### Task 4: Structural focus, provenance, and registry references

**Files:**
- Create: `src/project/reference-validator.js`
- Create: `tests/project-references.test.mjs`
- Modify: `tests/fixtures/contracts/project.valid.json`

**Interfaces:**
- Produce `validateManifestReferences(manifest) -> manifest` for references decidable without fetched resource payloads.
- Produce `validateResolvedReferences({ manifest, story, resources, metrics, capabilities }) -> true` for later cross-file use.

- [ ] **Step 1: Write failing structural-reference tests**

```js
test('manifest structural references resolve to declared IDs', () => {
  assert.equal(validateManifestReferences(validManifest), validManifest);
  const invalid = structuredClone(validManifest);
  invalid.focusTargets.overview.datasets = ['missing-route'];
  assert.throws(() => validateManifestReferences(invalid), (error) =>
    error.code === 'PROJECT_REFERENCE_INVALID'
      && error.path === '$.focusTargets.overview.datasets[0]');
});
```

Cover primary Story ID, dataset/asset attribution IDs, datasets/coordinate/bounds mutual exclusivity, southwest/northeast ordering, camera hints, duplicate attribution references, malformed provenance dates/URLs, and structurally detectable bad IDs.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/project-references.test.mjs`

Expected: FAIL with missing `validateManifestReferences`.

- [ ] **Step 3: Implement deterministic registry lookups**

```js
export function validateManifestReferences(manifest) {
  requireRegistryKey(manifest.stories.items, manifest.stories.primary, '$.stories.primary');
  validateAttributionReferences(manifest);
  validateFocusStructures(manifest.focusTargets, manifest.datasets);
  return manifest;
}
```

Leave resource payload semantics, capability role compatibility, Story metric/column/asset references, and optional-resource reachability to `validateResolvedReferences` tasks in later slices.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/project-references.test.mjs`

Expected: PASS.

- [ ] **Step 5: Run complete Slice 1 checks**

Run: `npm test`

Run: `git diff --check`

Expected: all tests PASS and no whitespace errors. Do not run browser performance certification.

- [ ] **Step 6: Commit and open the Slice 1 PR**

```powershell
git add src/project/reference-validator.js tests/project-references.test.mjs tests/fixtures/contracts/project.valid.json
git commit -m "feat: validate manifest registry references"
git push -u origin feat/template-v1-contracts
```

CI and review must pass before this slice is merged.

---

## Slice 2 — Capability Descriptors

**Branch/PR:** `feat/template-v1-capabilities` — create from fresh `main` after Slice 1 merges.

### Task 5: Trusted registry and descriptor schema

**Files:**
- Create: `src/capabilities/descriptor-schema.js`
- Create: `src/capabilities/capability-registry.js`
- Create: `tests/capability-descriptors.test.mjs`
- Create: `tests/fixtures/capabilities/valid-capability.mjs`

**Interfaces:**
- Produce `validateCapabilityDescriptor(descriptor) -> descriptor`.
- Produce `createCapabilityRegistry(entries) -> { ids, get(id), has(id), catalog() }`.
- Registry entry shape: `{ descriptor: plainObject, createCapability: Function }`.

- [ ] **Step 1: Write failing descriptor/registry tests**

```js
test('trusted registry exposes a serializable catalog but keeps factories private', () => {
  const registry = createCapabilityRegistry([fixtureEntry]);
  assert.deepEqual(registry.ids, ['fixture-capability-v1']);
  assert.equal(JSON.stringify(registry.catalog()).includes('createCapability'), false);
  assert.throws(() => createCapabilityRegistry([fixtureEntry, fixtureEntry]), /duplicate capability/i);
});
```

Validate descriptor ID/version/label/description, `requires`, dataset roles, action parameter schemas, targets, metric descriptors, lifecycle declarations, settings schema, and GUI metadata. Reject functions or non-plain values anywhere inside the descriptor and reject `src`, `module`, `script`, `plugin`, and URL-like factory fields.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/capability-descriptors.test.mjs`

Expected: FAIL with missing capability modules.

- [ ] **Step 3: Implement the immutable trusted boundary**

```js
export function createCapabilityRegistry(entries) {
  const byId = new Map(entries.map((entry) => [validateCapabilityDescriptor(entry.descriptor).id, validateEntry(entry)]));
  if (byId.size !== entries.length) throw new ProjectLoadError('CAPABILITY_DUPLICATE', '$.capabilities', 'Capability IDs must be unique.');
  return Object.freeze({
    ids: Object.freeze([...byId.keys()]),
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    catalog: () => deepFreeze([...byId.values()].map(({ descriptor }) => structuredClone(descriptor)))
  });
}
```

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/capability-descriptors.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/capabilities/descriptor-schema.js src/capabilities/capability-registry.js tests/capability-descriptors.test.mjs tests/fixtures/capabilities
git commit -m "feat: add trusted capability descriptors"
```

### Task 6: Deterministic capability composition and ownership

**Files:**
- Create: `src/capabilities/capability-composer.js`
- Create: `tests/capability-composer.test.mjs`

**Interfaces:**
- Produce `composeCapabilities({ registry, declarations, datasets }) -> ComposedCapabilities`.
- `ComposedCapabilities` exposes frozen `ordered`, `actionDescriptors`, `metricDescriptors`, `datasetRoles`, `targetDescriptors`, `contentDescriptors`, `legacyNormalizers`, and `catalog`.

- [ ] **Step 1: Write failing composition tests**

```js
test('composition installs implicit cores once and topologically sorts optional packs', () => {
  const composed = composeCapabilities({ registry, declarations: [{ id: 'route-comparison-v1' }], datasets });
  assert.deepEqual(composed.ordered.map(({ descriptor }) => descriptor.id),
    ['core-content-v1', 'core-map-v1', 'route-comparison-v1']);
});

test('composition rejects collisions before factories run', () => {
  assert.throws(() => composeCapabilities({ registry: collisionRegistry, declarations: [], datasets }),
    (error) => error.code === 'CAPABILITY_ACTION_COLLISION');
});
```

Add exact cases for unknown capability IDs, reserved core declarations, missing dependencies, cycles, duplicate canonical action ownership, duplicate legacy normalizer ownership, duplicate render responsibility, settings-schema failure, role uniqueness/type/geometry mismatch, and optional dataset roles not being globally required.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/capability-composer.test.mjs`

Expected: FAIL with missing composer export.

- [ ] **Step 3: Implement validate-then-compose**

```js
export function composeCapabilities({ registry, declarations, datasets }) {
  rejectReservedDeclarations(declarations);
  const entries = resolveEntries(registry, declarations);
  const ordered = topologicalSort(entries);
  validateSettingsAndRoles(ordered, declarations, datasets);
  return freezeComposition(assertUniqueOwnership(ordered));
}
```

Manifest order must not override dependency order. Cleanup order is represented as `ordered.toReversed()`; factories do not run during contract composition.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/capability-composer.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/capabilities/capability-composer.js tests/capability-composer.test.mjs
git commit -m "feat: compose capability dependencies safely"
```

### Task 7: Descriptor-to-runtime and GUI catalog parity

**Files:**
- Create: `src/capabilities/core-content-v1.js`
- Create: `src/capabilities/core-map-v1.js`
- Create: `tests/capability-parity.test.mjs`
- Modify: `src/capabilities/capability-composer.js`

**Interfaces:**
- Produce `CORE_CONTENT_V1_DESCRIPTOR`, `createCoreContentCapability(context)`.
- Produce `CORE_MAP_V1_DESCRIPTOR`, `createCoreMapCapability(context)`.
- Produce `assertCapabilityImplementationParity(entry) -> true`.

- [ ] **Step 1: Write the failing parity test**

```js
test('GUI catalog and runtime handlers derive from the same descriptors', () => {
  const composed = composeCapabilities({ registry: coreRegistry, declarations: [], datasets: {} });
  assert.deepEqual(Object.keys(composed.handlers).sort(), composed.catalog.actions.map(({ type }) => type).sort());
  assert.deepEqual(composed.catalog.content.map(({ type }) => type).sort(), Object.keys(composed.renderers).sort());
  assert.equal(assertCapabilityImplementationParity(coreRegistry.get('core-map-v1')), true);
});
```

Mutation cases remove/add a handler, renderer, metric provider, or dataset role and must fail with `CAPABILITY_IMPLEMENTATION_MISMATCH`. Parameter validation must call the descriptor's canonical schema fragment; no private validator vocabulary is allowed.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/capability-parity.test.mjs`

Expected: FAIL because core entries/parity do not exist.

- [ ] **Step 3: Add descriptor-first core stubs**

```js
export const CORE_MAP_V1_DESCRIPTOR = deepFreeze({
  schemaVersion: '1.0', id: 'core-map-v1', requires: [],
  actions: [MAP_FOCUS, MAP_SET_VISIBILITY, MAP_SET_EMPHASIS, MAP_CLEAR_EMPHASIS],
  metrics: [], datasetRoles: []
});
```

Core factories expose matching named handlers/renderers that throw `CAPABILITY_NOT_INITIALIZED` until Slice 6 injects the map controller. This task locks discovery/runtime parity without changing application behavior.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/capability-parity.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/capabilities/core-content-v1.js src/capabilities/core-map-v1.js src/capabilities/capability-composer.js tests/capability-parity.test.mjs
git commit -m "feat: lock capability catalog runtime parity"
```

### Task 8: Story 1.0 validation and canonical normalization architecture

**Files:**
- Create: `src/capabilities/story-1.0-normalizer.js`
- Create: `src/capabilities/route-comparison-v1.js`
- Create: `src/capabilities/urban-context-v1.js`
- Create: `tests/story-1.0-normalizer.test.mjs`
- Modify: `src/route-61-2-story-actions.js`

**Interfaces:**
- Produce `normalizeStory10(definition, { normalizers, actionDescriptors, bindings }) -> frozen normalized definition`.
- Normalizer shape: `{ legacyType, validate(action, path), normalize(action, bindings) -> canonicalAction }`.
- Produce `ROUTE_COMPARISON_V1_DESCRIPTOR`, `URBAN_CONTEXT_V1_DESCRIPTOR`, and trusted factories adapting existing controller functions.
- Preserve existing `ROUTE_612_STORY_ACTION_CONTRACTS` as a temporary compatibility export until Slice 4 switches bootstrap.

- [ ] **Step 1: Write failing byte-preservation and mapping tests**

```js
test('Route 61-2 Story 1.0 normalizes in order without mutating source', async () => {
  const sourceText = await readFile(STORY_URL, 'utf8');
  const source = JSON.parse(sourceText);
  const normalized = normalizeStory10(source, { normalizers, actionDescriptors, bindings });
  assert.equal(await readFile(STORY_URL, 'utf8'), sourceText);
  assert.deepEqual(normalized.states[0].map.enter.map(({ type }) => type),
    ['route.set-mode', 'transport.set-poi-emphasis', 'context.set-mode', 'map.focus']);
  assert.equal(findAction(normalized, 'route.reveal').target, 'proposed-route');
  assert.equal(findAction(normalized, 'transport.set-poi-emphasis').target, 'connection-pois');
});
```

Cover `map.mode`, pass-through `map.focus`, `map.poi-emphasis`, `map.urban-context`, target insertion for targetless `route.reveal`, phase/order/camera/delay preservation, invalid legacy descriptors rejected before normalization, and normalized canonical descriptors rejected if invalid.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/story-1.0-normalizer.test.mjs`

Expected: FAIL with missing normalizer/capability modules.

- [ ] **Step 3: Add one-time pure normalization**

```js
export function normalizeStory10(definition, { normalizers, actionDescriptors, bindings }) {
  const copy = structuredClone(definition);
  for (const state of copy.states) for (const phase of ['enter', 'exit']) {
    state.map[phase] = state.map[phase].map((action, index) =>
      normalizeAndValidate(action, `$.states.${state.id}.map.${phase}[${index}]`, normalizers, actionDescriptors, bindings));
  }
  return deepFreeze(copy);
}
```

Canonical factories own exactly one handler per action. Normalizers contain no handlers and are absent from the Story 1.1 GUI catalog.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/story-1.0-normalizer.test.mjs tests/route-61-2-action-contracts.test.mjs`

Expected: both suites PASS and the production Story stays byte-identical.

- [ ] **Step 5: Run complete Slice 2 checks**

Run: `npm test`

Run: `git diff --check`

Expected: PASS; no browser performance run.

- [ ] **Step 6: Commit and open the Slice 2 PR**

```powershell
git add src/capabilities src/route-61-2-story-actions.js tests/story-1.0-normalizer.test.mjs
git commit -m "feat: normalize story v1 actions to capability contracts"
git push -u origin feat/template-v1-capabilities
```

### Gate A — Contract Foundation Review (mandatory STOP)

Do not begin Slice 3 until reviewers inspect the canonical schemas and fixture failures, run `npm test`, verify implicit-core/reserved-core behavior, dependency/cycle ordering, unique action/render ownership, descriptor/handler parity, optional role semantics, and Route 61-2 Story 1.0 normalization.

Record in the Slice 2 PR review:

```text
TEMPLATE_V1_CONTRACT_FOUNDATION_RESULT: PASS
```

If the marker is `REVISE`, repair Slices 1–2 on a bounded follow-up branch and repeat Gate A.

---

## Slice 3 — Generic Project Bootstrap

**Branch/PR:** `feat/template-v1-bootstrap` — fresh `main` after Gate A PASS and Slice 2 merge.

### Task 9: Abort-aware resource loader and structured outcomes

**Files:**
- Create: `src/project/resource-loader.js`
- Create: `tests/resource-loader.test.mjs`

**Interfaces:**
- Produce `loadJsonResource(url, { fetchImpl = fetch, signal, code, path, validate }) -> Promise<value>`.
- Produce `loadProjectResources(requests, { fetchImpl = fetch, signal }) -> Promise<{ values: Map, warnings: readonly ProjectLoadError[] }>`.

- [ ] **Step 1: Write failing fetch/error/cancellation tests**

```js
test('fatal resource failure aborts siblings and keeps structured location', async () => {
  const controller = new AbortController();
  await assert.rejects(loadProjectResources(requests, { fetchImpl, signal: controller.signal }), (error) =>
    error.code === 'RESOURCE_HTTP_ERROR' && error.path === '$.datasets.routes.src');
  assert.equal(observedSiblingAbort, true);
});
```

Also cover JSON parse errors, validator errors retaining their path, optional unreferenced resource warnings, referenced optional resource becoming fatal, HTTP status, and no late callback after abort.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/resource-loader.test.mjs`

Expected: FAIL with missing loader.

- [ ] **Step 3: Implement fetch/abort mapping**

```js
export async function loadJsonResource(url, options) {
  const response = await options.fetchImpl(url, { signal: options.signal });
  if (!response.ok) throw new ProjectLoadError('RESOURCE_HTTP_ERROR', options.path, `Resource request failed (${response.status}).`);
  const value = await parseJson(response, options.path);
  return options.validate ? options.validate(value, { path: options.path }) : value;
}
```

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/resource-loader.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/project/resource-loader.js tests/resource-loader.test.mjs
git commit -m "feat: load project resources with cancellation"
```

### Task 10: Validated project definition pipeline

**Files:**
- Create: `src/project/project-loader.js`
- Create: `tests/project-loader.test.mjs`
- Create: `tests/fixtures/project-loader/minimal/project.json`
- Create: `tests/fixtures/project-loader/minimal/stories/main.story.json`

**Interfaces:**
- Produce `loadProject(manifestUrl = './project.json', { fetchImpl = fetch, capabilityRegistry, signal } = {}) -> Promise<ValidatedProject>`.
- `ValidatedProject` includes frozen `manifest`, `metadata`, `locale`, `map`, `story`, `resources`, `focusTargets`, `attribution`, `capabilities`, `warnings`, and absolute resolved URLs.

- [ ] **Step 1: Write the failing orchestration test**

```js
test('project loader resolves fixed manifest package into a frozen definition', async () => {
  const project = await loadProject('https://host/demo/project.json', { fetchImpl, capabilityRegistry });
  assert.equal(project.story.id, 'main');
  assert.equal(project.locale, 'en-US');
  assert.equal(project.resources.get('route').url.href, 'https://host/demo/data/route.geojson');
  assert.equal(Object.isFrozen(project), true);
});
```

Assert the exact operation order: manifest structure → structural references → URL resolution → capability composition → required resource load → resource semantics → cross references → Story version validation → Story 1.0 normalization/canonical validation. Unknown actions and fatal references must fail before map creation is possible.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/project-loader.test.mjs`

Expected: FAIL with missing project loader.

- [ ] **Step 3: Implement the project-only pipeline**

```js
export async function loadProject(manifestUrl = './project.json', options = {}) {
  const manifest = await loadManifest(manifestUrl, options);
  const urls = resolveManifestResourceUrls(manifest, manifestUrl);
  const capabilities = composeCapabilities({ registry: options.capabilityRegistry, declarations: manifest.capabilities, datasets: manifest.datasets });
  const loaded = await loadDeclaredResources(manifest, urls, options);
  const story = validateAndNormalizeStory(loaded.story, capabilities, manifest);
  validateResolvedReferences({ manifest, story, resources: loaded.resources, capabilities });
  return freezeValidatedProject({ manifest, urls, loaded, story, capabilities });
}
```

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/project-loader.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/project/project-loader.js tests/project-loader.test.mjs tests/fixtures/project-loader
git commit -m "feat: assemble validated project definitions"
```

### Task 11: Bootstrap composition root and safe fatal-error panel

**Files:**
- Create: `src/project/bootstrap.js`
- Create: `tests/project-bootstrap.test.mjs`
- Modify: `src/app.js`
- Modify: `index.html`

**Interfaces:**
- Produce `bootstrapProject({ project, maplibregl, documentRef = document, createMap, storyExperience }) -> Promise<AppRuntime>`.
- Produce `renderProjectLoadError(error, { documentRef = document }) -> HTMLElement` using `textContent` only.
- `AppRuntime.destroy()` is idempotent and destroys capabilities in reverse order without creating another map.

- [ ] **Step 1: Write failing bootstrap boundary tests**

```js
test('bootstrap creates one map and destroys capabilities in reverse order', async () => {
  const runtime = await bootstrapProject({ project, maplibregl, documentRef, createMap });
  assert.equal(createMap.mock.calls.length, 1);
  runtime.destroy(); runtime.destroy();
  assert.deepEqual(events, ['create:core-map-v1', 'create:fixture-v1', 'destroy:fixture-v1', 'destroy:core-map-v1']);
});

test('error text is never parsed as HTML', () => {
  const panel = renderProjectLoadError(new ProjectLoadError('X', '$.title', '<img src=x onerror=1>'), { documentRef });
  assert.equal(panel.querySelector('img'), null);
  assert.match(panel.textContent, /<img src=x/);
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test tests/project-bootstrap.test.mjs`

Expected: FAIL with missing bootstrap module.

- [ ] **Step 3: Add bootstrap without switching production yet**

```js
export async function bootstrapProject(context) {
  const map = context.createMap(context.project.map);
  const instances = await createCapabilities(context.project.capabilities.ordered, { ...context, map });
  const runner = createStoryActionRunner(mergeHandlers(instances));
  const runtime = createStoryRuntime({ definition: context.project.story, actionRunner: runner });
  const shell = bindSelectedShell({ runtime, context });
  return createAppRuntime({ map, instances, runtime, shell });
}
```

Add a hidden `#project-load-error` region and keep a minimal static loading label. `app.js` imports the new functions but continues using the existing Route 61-2 path until Slice 4.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/project-bootstrap.test.mjs tests/story-shell-integration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Short executable regression**

Run: `npm test`

Run: `node --check src/project/bootstrap.js`

Expected: PASS; no full CDP certification yet because production bootstrap is not switched.

- [ ] **Step 6: Commit**

```powershell
git add src/project/bootstrap.js src/app.js index.html tests/project-bootstrap.test.mjs
git commit -m "feat: add generic project bootstrap boundary"
```

### Task 12: Startup ownership and failed-load cancellation

**Files:**
- Create: `src/application.js`
- Create: `tests/application-startup.test.mjs`
- Modify: `src/app.js`

**Interfaces:**
- Produce `startApplication({ manifestUrl = './project.json', loadProjectImpl = loadProject, bootstrapImpl = bootstrapProject, signal } = {}) -> Promise<AppRuntime>`.
- `src/app.js` calls `startApplication()` once and catches only to log the already-structured safe failure.

- [ ] **Step 1: Write failing startup tests**

```js
test('fatal load never enters interactive bootstrap', async () => {
  await assert.rejects(startApplication({ loadProjectImpl: async () => { throw failure; }, bootstrapImpl }));
  assert.equal(bootstrapImpl.mock.calls.length, 0);
});
```

Cover forwarded abort signals, a second start aborting an in-flight first start only when explicitly requested by an owner, and one call each to loader/bootstrap on success.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/application-startup.test.mjs`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement small startup orchestration**

```js
export async function startApplication(options = {}) {
  const project = await options.loadProjectImpl(options.manifestUrl ?? './project.json', options);
  return options.bootstrapImpl({ ...options, project });
}
```

Do not migrate Route 61-2 to this path until its manifest/adapters exist in Slice 4.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/application-startup.test.mjs`

Expected: PASS.

- [ ] **Step 5: Complete Slice 3 checks**

Run: `npm test`

Run: `git diff --check`

Expected: PASS. If startup code is exercised in browser during review, use one 5-second stationary sample only; full certification waits for Gate B.

- [ ] **Step 6: Commit and open Slice 3 PR**

```powershell
git add src/application.js src/app.js tests/application-startup.test.mjs
git commit -m "feat: orchestrate application from project loader"
git push -u origin feat/template-v1-bootstrap
```

---

## Slice 4 — Route 61-2 Manifest Migration

**Branch/PR:** `feat/template-v1-route-61-2-manifest` — fresh `main` after Slice 3 merge.

### Task 13: Route 61-2 manifest and trusted compatibility adapters

**Files:**
- Create: `project.json`
- Create: `src/capabilities/installed-capabilities.js`
- Create: `tests/route-61-2-project.test.mjs`
- Modify: `src/capabilities/route-comparison-v1.js`
- Modify: `src/capabilities/urban-context-v1.js`
- Modify: `src/project/project-loader.js`

**Interfaces:**
- Produce `INSTALLED_CAPABILITY_REGISTRY` containing implicit core entries plus `route-comparison-v1` and `urban-context-v1`.
- Route adapter bindings expose semantic targets `existing-route`, `proposed-route`, `connection-pois`, and derived `route-changes` without moving current JS geometry.

- [ ] **Step 1: Write the failing production-manifest proof**

```js
test('Route 61-2 loads from project.json and preserves Story 1.0 bytes/seven states', async () => {
  const before = await readFile(STORY_URL, 'utf8');
  const project = await loadProject(PROJECT_URL, { fetchImpl: fileFetch, capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY });
  assert.equal(project.manifest.id, 'route-61-2');
  assert.equal(project.story.schemaVersion, '1.0');
  assert.equal(project.story.states.length, 7);
  assert.equal(await readFile(STORY_URL, 'utf8'), before);
});
```

Assert optional capabilities are exactly route comparison/context, role bindings resolve uniquely, Story path remains `./data/stories/route-61-2.story.json`, and compatibility adapters point to current route/stops/POI/context sources.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/route-61-2-project.test.mjs`

Expected: FAIL because root `project.json` and installed registry do not exist.

- [ ] **Step 3: Add manifest and adapters**

```js
export const INSTALLED_CAPABILITY_REGISTRY = createCapabilityRegistry([
  coreContentEntry, coreMapEntry, routeComparisonEntry, urbanContextEntry
]);
```

The manifest owns current metadata, `vi-VN`, initial camera, Story reference, dataset/asset registries, focus targets, attribution/provenance, and optional capability declarations. Where route geometry remains in `route-data.js`, use an application-owned adapter ID/settings value rather than an authored module path.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/route-61-2-project.test.mjs tests/route-61-2-action-contracts.test.mjs`

Expected: PASS and `git diff --exit-code -- data/stories/route-61-2.story.json` produces no diff.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add project.json src/capabilities/installed-capabilities.js src/capabilities/route-comparison-v1.js src/capabilities/urban-context-v1.js src/project/project-loader.js tests/route-61-2-project.test.mjs
git commit -m "feat: describe route 61-2 with project manifest"
```

### Task 14: Switch production bootstrap and manifest-owned chrome

**Files:**
- Modify: `src/app.js`
- Modify: `src/application.js`
- Modify: `src/project/bootstrap.js`
- Modify: `index.html`
- Modify: `tests/story-shell-integration.test.mjs`
- Create: `tests/manifest-bootstrap-integration.test.mjs`

**Interfaces:**
- `startApplication` uses `INSTALLED_CAPABILITY_REGISTRY` and fixed `./project.json` by default.
- Produce `applyProjectMetadata(project, { documentRef = document }) -> void` for title/subtitle/document title/map/panel labels and locale.

- [ ] **Step 1: Replace source-string expectation with manifest bootstrap proof**

```js
test('application boots fixed project.json and keeps one map/runtime/shell path', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /startApplication\(/);
  assert.doesNotMatch(source, /loadStoryDefinition\(['"]\.\/data\/stories\/route-61-2\.story\.json/);
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
});
```

DOM tests assert manifest metadata replaces the static placeholders through `textContent`, explicit `?story=legacy` selection remains, and fatal load leaves map/runtime/shell uninitialized.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/manifest-bootstrap-integration.test.mjs tests/story-shell-integration.test.mjs`

Expected: FAIL because `app.js` still directly loads the Story and hardcodes startup metadata/camera.

- [ ] **Step 3: Make `app.js` the composition root**

```js
startApplication({
  manifestUrl: './project.json',
  capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY,
  maplibregl,
  storyExperience: resolveStoryExperience(window.location.search),
  createMap: createRouteMap
}).catch((error) => renderProjectLoadError(error));
```

Move only manifest-owned bootstrap concerns. Keep established route sources/layers, simulation, bounded popups, and urban controller behind trusted capability adapters. Preserve one `new maplibregl.Map(...)` call and the same map options apart from manifest-supplied camera/metadata.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/manifest-bootstrap-integration.test.mjs tests/story-shell-integration.test.mjs tests/story-config-proof.test.mjs`

Expected: PASS.

- [ ] **Step 5: Full unit regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app.js src/application.js src/project/bootstrap.js index.html tests/story-shell-integration.test.mjs tests/manifest-bootstrap-integration.test.mjs
git commit -m "feat: boot route 61-2 through project manifest"
```

### Task 15: Route 61-2 browser, visual, lifecycle, and performance certification

**Files:**
- Create: `review/template-v1-bootstrap/REPORT.md`
- Create: `review/template-v1-bootstrap/bootstrap-evidence.test.mjs`
- Modify only if evidence exposes a regression: files already in Slice 4 scope

**Interfaces:**
- Evidence test produces machine-checkable invariants for seven states, Story/Explore/legacy lifecycle, one map instance, console cleanliness, and manifest bootstrap.

- [ ] **Step 1: Write failing certification evidence assertions**

```js
test('bootstrap certification records required invariant fields', async () => {
  const report = await readFile(REPORT_URL, 'utf8');
  for (const marker of ['Story 1.0 byte-identical: PASS', 'One MapLibre instance: PASS', 'Desktop/mobile: PASS', 'Settled sustained-low FPS:']) {
    assert.match(report, new RegExp(escapeRegExp(marker)));
  }
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test review/template-v1-bootstrap/bootstrap-evidence.test.mjs`

Expected: FAIL because the report/evidence does not exist.

- [ ] **Step 3: Execute existing certified methodology and record actual evidence**

Serve with `npm run serve`, launch Chrome with remote debugging as required by `scripts/performance-root-cause-v1.mjs`, then run:

```powershell
node scripts/performance-root-cause-v1.mjs regression
node scripts/performance-root-cause-v1.mjs reduced-motion
node scripts/performance-root-cause-v1.mjs story-shell-lifecycle
$env:SAMPLE_MS='15000'; $env:REPETITIONS='3'; node scripts/performance-root-cause-v1.mjs story-shell-benchmark 1920 1080
$env:SAMPLE_MS='15000'; $env:REPETITIONS='3'; node scripts/performance-root-cause-v1.mjs story-shell-benchmark 390 844
```

Capture certified viewports `1920x1080`, `1366x768`, `390x844`, and `320x568`; compare same seven states, visuals, actions, shell/explore/legacy behavior, attribution, and console. Record actual typical/sustained-low/average FPS and source/render counters in the report; do not substitute transition FPS.

- [ ] **Step 4: Prove GREEN**

Run: `node --test review/template-v1-bootstrap/bootstrap-evidence.test.mjs`

Expected: PASS only when all recorded markers and numeric hard floors are satisfied.

- [ ] **Step 5: Complete Slice 4 regression**

Run: `npm test`

Run: `git diff --check`

Expected: PASS and Story JSON remains unchanged.

- [ ] **Step 6: Commit, push, and open Slice 4 PR**

```powershell
git add review/template-v1-bootstrap
git commit -m "test: certify route 61-2 manifest bootstrap"
git push -u origin feat/template-v1-route-61-2-manifest
```

### Gate B — Generic Bootstrap / Route 61-2 Migration Review (mandatory STOP)

Review the actual desktop/mobile screenshots and CDP output. Require unchanged Story 1.0 bytes, seven states, visuals, map actions, Story Shell, Explore and legacy behavior, one map instance, clean console, and the settled performance envelope.

Record:

```text
TEMPLATE_V1_PROJECT_BOOTSTRAP_RESULT: PASS
```

If `REVISE`, do not start Slice 5.

---

## Slice 5 — Data and Metric Binding

**Branch/PR:** `feat/template-v1-data-metrics` — fresh `main` after Gate B PASS and Slice 4 merge.

### Task 16: Load and index normalized table resources

**Files:**
- Create: `src/data/table-registry.js`
- Create: `tests/table-registry.test.mjs`
- Modify: `src/project/project-loader.js`
- Modify: `src/project/reference-validator.js`

**Interfaces:**
- Produce `createTableRegistry(datasetEntries) -> { has(id), get(id), columns(id), rows(id), catalog() }`.
- Registry accepts only validated `table-json` resources and exposes frozen data.

- [ ] **Step 1: Write failing registry/binding tests**

```js
test('table registry exposes normalized columns and immutable rows by dataset ID', () => {
  const tables = createTableRegistry([['demand', validTable]]);
  assert.deepEqual(tables.columns('demand').map(({ id }) => id), ['year', 'boardings']);
  assert.throws(() => { tables.rows('demand')[0].boardings = 0; }, TypeError);
  assert.throws(() => tables.get('missing'), (error) => error.code === 'TABLE_DATASET_UNKNOWN');
});
```

Add loader integration cases for declared `table-json`, a GeoJSON dataset passed to a table binding, and optional table failure referenced by Story becoming fatal.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/table-registry.test.mjs`

Expected: FAIL with missing table registry.

- [ ] **Step 3: Build the read-only table index**

```js
export function createTableRegistry(entries) {
  const tables = new Map(entries.map(([id, value]) => [id, deepFreeze(structuredClone(validateTableData(value)))]));
  return freezeRegistry(tables);
}
```

The project loader classifies loaded resources by manifest type and returns `project.tables`; it never parses CSV/Excel or coerces cell values.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/table-registry.test.mjs tests/project-loader.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/data/table-registry.js src/project/project-loader.js src/project/reference-validator.js tests/table-registry.test.mjs
git commit -m "feat: register normalized project tables"
```

### Task 17: Immutable static and computed metric namespace

**Files:**
- Create: `src/metrics/metric-registry.js`
- Create: `tests/metric-registry.test.mjs`
- Modify: `src/project/project-loader.js`
- Modify: `src/capabilities/route-comparison-v1.js`

**Interfaces:**
- Produce `createMetricRegistry({ staticMetrics = {}, providers = [], context }) -> Promise<MetricRegistry>`.
- `MetricRegistry.resolve(id) -> { id, label, value, format, status: 'available'|'unavailable', attribution }`.
- `MetricRegistry.catalog() -> serializable descriptor list`; no mutators are public.
- Route comparison provider exports current length/delta/stop counts behind descriptor-owned metric IDs.

- [ ] **Step 1: Write failing namespace/provider tests**

```js
test('static and computed metrics share one collision-free namespace', async () => {
  await assert.rejects(createMetricRegistry({
    staticMetrics: { 'route-length': literalMetric },
    providers: [{ descriptor: computedDescriptor('route-length'), compute: async () => 10 }]
  }), (error) => error.code === 'METRIC_ID_COLLISION');
});

test('provider failure yields an unavailable known metric, not an invented value', async () => {
  const registry = await createMetricRegistry({ providers: [failingKnownProvider] });
  assert.deepEqual(registry.resolve('route-length').status, 'unavailable');
  assert.throws(() => registry.resolve('unknown'), (error) => error.code === 'METRIC_UNKNOWN');
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test tests/metric-registry.test.mjs`

Expected: FAIL with missing metric registry.

- [ ] **Step 3: Compose descriptors before values**

```js
export async function createMetricRegistry({ staticMetrics = {}, providers = [], context } = {}) {
  const descriptors = claimMetricIds(staticMetrics, providers);
  const values = await resolveMetricValues(descriptors, providers, context);
  return createReadOnlyMetricRegistry(descriptors, values);
}
```

Provider errors are recorded as structured diagnostics and return the known descriptor with `value: null, status: 'unavailable'`. Unknown Story metric IDs remain fatal during cross-reference validation.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/metric-registry.test.mjs tests/presentation-metrics.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/metrics/metric-registry.js src/project/project-loader.js src/capabilities/route-comparison-v1.js tests/metric-registry.test.mjs
git commit -m "feat: compose static and capability metrics"
```

### Task 18: Shared locale formatting boundary

**Files:**
- Create: `src/metrics/locale-formatter.js`
- Create: `tests/locale-formatter.test.mjs`
- Modify: `src/presentation-metrics.js`
- Modify: `src/presentation-renderer.js`

**Interfaces:**
- Produce `createLocaleFormatter(locale) -> { format(value, descriptor), unavailableLabel }`.
- `format` supports exactly `integer|decimal|percentage|distance|currency|text`.
- Keep `formatPresentationMetric` as a compatibility wrapper accepting an injected/default formatter until all callers migrate.

- [ ] **Step 1: Write failing exact-format tests**

```js
test('formatter uses project locale for every numeric boundary', () => {
  const en = createLocaleFormatter('en-US');
  const vi = createLocaleFormatter('vi-VN');
  assert.equal(en.format(1234.5, { type: 'decimal', decimals: 1 }), '1,234.5');
  assert.equal(vi.format(1234.5, { type: 'decimal', decimals: 1 }), '1.234,5');
  assert.equal(en.format(0.64, { type: 'percentage', decimals: 0 }), '64%');
  assert.match(en.format(1500, { type: 'distance', decimals: 1 }), /^1\.5 km$/);
  assert.equal(en.format(null, { type: 'integer' }), '—');
});
```

Cover integer, decimal limits, percent fraction semantics, deterministic `<1000 m`/`>=1000 km` threshold, ISO currency, text escaping by caller through `textContent`, invalid locale fallback, boolean/text compatibility, and unavailable accessible label.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/locale-formatter.test.mjs`

Expected: FAIL with missing formatter.

- [ ] **Step 3: Implement cached `Intl.NumberFormat` instances**

```js
export function createLocaleFormatter(locale) {
  const resolvedLocale = Intl.NumberFormat.supportedLocalesOf([locale])[0] ?? 'en';
  return Object.freeze({
    unavailableLabel: 'unavailable',
    format(value, descriptor) { return formatValue(value, descriptor, resolvedLocale); }
  });
}
```

Remove the hardcoded `vi-VN` formatting inside `presentation-metrics.js`; Route 61-2 passes its manifest locale and retains the same visible Vietnamese number formatting.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/locale-formatter.test.mjs tests/presentation-metrics.test.mjs tests/presentation-renderer.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/metrics/locale-formatter.js src/presentation-metrics.js src/presentation-renderer.js tests/locale-formatter.test.mjs
git commit -m "feat: format metrics with project locale"
```

### Task 19: Story metric, table, and chart reference validation

**Files:**
- Modify: `src/project/reference-validator.js`
- Create: `tests/data-binding-references.test.mjs`

**Interfaces:**
- Complete `validateResolvedReferences({ manifest, story, resources, metrics, capabilities }) -> true`.
- Produce structured codes `METRIC_UNKNOWN`, `TABLE_DATASET_INVALID`, `TABLE_COLUMN_UNKNOWN`, `TABLE_COLUMN_TYPE_INVALID`, and `ASSET_UNKNOWN` with JSON paths.

- [ ] **Step 1: Write failing cross-file tests**

```js
test('table/chart/metric bindings resolve against loaded registries', () => {
  assert.equal(validateResolvedReferences(validContext), true);
  const missing = structuredClone(validContext);
  missing.story.states[0].content.blocks[0].data.series[0].y = 'missing';
  assert.throws(() => validateResolvedReferences(missing), (error) =>
    error.code === 'TABLE_COLUMN_UNKNOWN'
      && error.path.endsWith('.data.series[0].y'));
});
```

Cover stat metric IDs, table/chart dataset type, x/series/selected column existence, numeric chart y compatibility, text/date/integer x compatibility, format compatibility, image asset type, legend icon asset, attribution IDs, and unknown resource IDs.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/data-binding-references.test.mjs`

Expected: FAIL because resolved reference checks are incomplete.

- [ ] **Step 3: Walk descriptors, not renderer internals**

```js
export function validateResolvedReferences(context) {
  for (const state of context.story.states) for (const [index, block] of state.content.blocks.entries()) {
    validateBlockReferences(block, `$.states.${state.id}.content.blocks[${index}]`, context);
  }
  validateCapabilityResourceRequirements(context);
  return true;
}
```

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/data-binding-references.test.mjs`

Expected: PASS.

- [ ] **Step 5: Complete Slice 5 checks**

Run: `npm test`

Run: `git diff --check`

If project bootstrap code changed, run one 5-second settled sample: `$env:SAMPLE_MS='5000'; $env:REPETITIONS='1'; node scripts/performance-root-cause-v1.mjs story-shell-benchmark 1920 1080`. Expected sustained-low remains `>=30 FPS` with no recurring source mutations.

- [ ] **Step 6: Commit and open Slice 5 PR**

```powershell
git add src/project/reference-validator.js tests/data-binding-references.test.mjs
git commit -m "feat: validate story data and metric bindings"
git push -u origin feat/template-v1-data-metrics
```

---

## Slice 6 — Common Map Capability

**Branch/PR:** `feat/template-v1-core-map` — fresh `main` after Slice 5 merge.

### Task 20: Validate GeoJSON semantics and translate safe render descriptors

**Files:**
- Create: `src/map/geojson-renderer.js`
- Create: `tests/geojson-renderer.test.mjs`
- Modify: `src/project/resource-schemas.js`

**Interfaces:**
- Produce `buildGeoJsonLayerDefinitions(datasetId, descriptor, collection) -> { source, layers, publicTarget }`.
- Produce `validateFeatureLabel(descriptor, collection, { path }) -> descriptor|undefined`.

- [ ] **Step 1: Write failing line/point/fill/security tests**

```js
test('safe descriptors translate to application-owned MapLibre definitions', () => {
  const result = buildGeoJsonLayerDefinitions('stops', pointDescriptor, points);
  assert.equal(result.source.id, 'project-stops');
  assert.equal(result.layers[0].type, 'circle');
  assert.equal(JSON.stringify(result.layers).includes('callback'), false);
});

test('raw expressions and unsupported renderer properties fail before translation', () => {
  assert.throws(() => buildGeoJsonLayerDefinitions('routes', { ...lineDescriptor, color: ['get', 'color'] }, lines),
    (error) => error.code === 'GEOJSON_RENDER_INVALID');
});
```

Cover `#RRGGBB|#RRGGBBAA`, width/radius/opacity/stroke bounds, solid/dashed, line/point/polygon geometry compatibility, mixed geometry restrictions, no fill-extrusion, and no raw filter/layer/source/expression fields.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/geojson-renderer.test.mjs`

Expected: FAIL with missing renderer.

- [ ] **Step 3: Implement pure definitions only**

```js
export function buildGeoJsonLayerDefinitions(datasetId, descriptor, collection) {
  validateGeoJsonResource(collection, descriptor, { path: `$.datasets.${datasetId}` });
  const sourceId = internalId('project', datasetId);
  return deepFreeze({ source: { id: sourceId, spec: { type: 'geojson', data: collection } }, layers: translateLayers(sourceId, descriptor), publicTarget: datasetId });
}
```

No map access occurs in this module, which makes descriptor translation testable without MapLibre.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/geojson-renderer.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/map/geojson-renderer.js src/project/resource-schemas.js tests/geojson-renderer.test.mjs
git commit -m "feat: translate safe geojson render descriptors"
```

### Task 21: Bounded feature labels

**Files:**
- Modify: `src/map/geojson-renderer.js`
- Create: `tests/feature-labels.test.mjs`

**Interfaces:**
- `buildFeatureLabelLayer(datasetId, descriptor, collection) -> layer|null` is exported for narrow tests.
- Placement maps `auto` to point/line/centroid by declared geometry; mixed accepts only `auto`.

- [ ] **Step 1: Write failing label tests**

```js
test('point label uses a top-level property and bounded zoom', () => {
  const layer = buildFeatureLabelLayer('stops', { field: 'name', minZoom: 12, placement: 'point' }, points);
  assert.equal(layer.type, 'symbol');
  assert.deepEqual(layer.layout['text-field'], ['to-string', ['get', 'name']]);
  assert.equal(layer.minzoom, 12);
});
```

Assert missing/null values omit individual labels, field absent from every feature is `FEATURE_LABEL_FIELD_MISSING`, scalar conversion only, invalid geometry placement fails, and templates/nested paths/font/CSS/click/popup configuration are rejected.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/feature-labels.test.mjs`

Expected: FAIL with missing export/label layer.

- [ ] **Step 3: Add fixed application-owned label paint/layout**

```js
export function buildFeatureLabelLayer(datasetId, label, collection) {
  validateFeatureLabel(label, collection, { path: `$.datasets.${datasetId}.render.label` });
  return createFixedLabelLayer(datasetId, effectivePlacement(label, collection), label.field, label.minZoom ?? 0);
}
```

Use fixed typography, halo, collision behavior, and a safe scalar filter owned by the application.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/feature-labels.test.mjs tests/geojson-renderer.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/map/geojson-renderer.js tests/feature-labels.test.mjs
git commit -m "feat: add bounded geojson feature labels"
```

### Task 22: Semantic focus registry and common map actions

**Files:**
- Create: `src/map/focus-registry.js`
- Create: `src/map/core-map-controller.js`
- Create: `tests/focus-registry.test.mjs`
- Create: `tests/core-map-controller.test.mjs`
- Modify: `src/capabilities/core-map-v1.js`

**Interfaces:**
- Produce `createFocusRegistry({ manifestTargets, capabilityTargets, datasets }) -> { get(id), ids }`.
- Produce `createCoreMapController({ map, datasets, focusRegistry, reducedMotion, shellPadding })` with `focus`, `setVisibility`, `setEmphasis`, `clearEmphasis`, `reset`, `destroy`.
- Core action handlers accept canonical descriptors and resolve semantic targets only.

- [ ] **Step 1: Write failing focus/action lifecycle tests**

```js
test('common actions never expose private layer IDs', () => {
  const controller = createCoreMapController(fixtureContext);
  controller.setVisibility('stops', false);
  controller.setEmphasis('route', true);
  controller.clearEmphasis();
  assert.deepEqual(mapCalls.map(({ semantic }) => semantic), ['stops', 'route', 'route']);
});

test('focus resolves datasets, coordinate, bounds, and shell padding', () => {
  controller.focus('overview', { maxZoom: 12 });
  assert.deepEqual(lastFit.bounds, expectedCombinedBounds);
  assert.deepEqual(lastFit.padding, expectedShellPlusManifestPadding);
});
```

Cover capability logical targets, unknown targets, camera hints constrained by manifest/application bounds, reduced-motion duration zero, cooperative emphasis clear, base visibility unaffected by emphasis, reset defaults, and idempotent destroy.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/focus-registry.test.mjs tests/core-map-controller.test.mjs`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement semantic target registry/controller**

```js
export function createCoreMapController(context) {
  const overrides = new Map();
  return Object.freeze({
    focus: (target, camera = {}) => focusTarget(context, target, camera),
    setVisibility: (target, visible) => applyVisibility(context, overrides, target, visible),
    setEmphasis: (target, active) => applyEmphasis(context, target, active),
    clearEmphasis: () => clearAllEmphasis(context),
    reset: () => restoreExploreDefaults(context, overrides),
    destroy: once(() => restoreAndRemoveOwnedLayers(context, overrides))
  });
}
```

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/focus-registry.test.mjs tests/core-map-controller.test.mjs tests/capability-parity.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/map/focus-registry.js src/map/core-map-controller.js src/capabilities/core-map-v1.js tests/focus-registry.test.mjs tests/core-map-controller.test.mjs
git commit -m "feat: add semantic common map actions"
```

### Task 23: Integrate common map rendering without changing special capability ownership

**Files:**
- Modify: `src/project/bootstrap.js`
- Modify: `src/capabilities/core-map-v1.js`
- Modify: `src/capabilities/route-comparison-v1.js`
- Modify: `src/capabilities/urban-context-v1.js`
- Modify: `src/app.js`
- Create: `tests/common-map-integration.test.mjs`

**Interfaces:**
- Core map factory installs generic dataset sources/layers once at map load and registers public targets.
- Route/context factories retain route comparison, bounded Route 61-2 popups, 3D/fallback rendering, metrics, and lifecycle ownership.

- [ ] **Step 1: Write failing ownership/integration test**

```js
test('baseline renders ordinary datasets while special packs keep claimed roles', async () => {
  const runtime = await bootstrapProject(fixtureContext);
  assert.deepEqual(runtime.targets.ids.sort(), ['ordinary-area', 'ordinary-stops', 'route-changes']);
  assert.equal(owners.render.get('ordinary-stops'), 'core-map-v1');
  assert.equal(owners.render.get('route.proposed'), 'route-comparison-v1');
  assert.equal(owners.render.get('context.buildings'), 'urban-context-v1');
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test tests/common-map-integration.test.mjs`

Expected: FAIL because bootstrap does not install core map rendering/controller.

- [ ] **Step 3: Wire factories around the persistent map**

```js
const instances = await initializeCapabilities(project.capabilities.ordered, {
  map, resources: project.resources, focusTargets: project.focusTargets,
  metrics: project.metrics, reducedMotion, shellPadding
});
```

Do not add generic popups or fill extrusion. Route 61-2 adapters may keep existing internal layers and popup behavior.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/common-map-integration.test.mjs tests/route-61-2-story-actions.test.mjs`

Expected: PASS.

- [ ] **Step 5: Complete Slice 6 checks**

Run: `npm test`

Run: `$env:SAMPLE_MS='5000'; $env:REPETITIONS='1'; node scripts/performance-root-cause-v1.mjs story-shell-benchmark 1920 1080`

Run: `git diff --check`

Expected: tests PASS, sustained-low `>=30 FPS`, one map, no settled source churn.

- [ ] **Step 6: Commit and open Slice 6 PR**

```powershell
git add src/project/bootstrap.js src/capabilities/core-map-v1.js src/capabilities/route-comparison-v1.js src/capabilities/urban-context-v1.js src/app.js tests/common-map-integration.test.mjs
git commit -m "feat: integrate common map capability"
git push -u origin feat/template-v1-core-map
```

---

## Slice 7 — Core Content Expansion and Story 1.1

**Branch/PR:** `feat/template-v1-story-1-1` — fresh `main` after Slice 6 merge.

### Task 24: Descriptor-driven Story 1.0/1.1 version routing

**Files:**
- Create: `data/schemas/story-1.1.schema.json`
- Create: `src/content/content-descriptors.js`
- Modify: `src/capabilities/core-content-v1.js`
- Modify: `src/story-schema.js`
- Create: `tests/story-versioning.test.mjs`

**Interfaces:**
- Produce `CONTENT_BLOCK_DESCRIPTORS` for exactly ten block types.
- Produce `validateStoryDefinition(definition, { actionDescriptors, contentDescriptors } = {}) -> definition` for 1.0 and 1.1.
- Produce `getStorySchema(version) -> canonical schema` and preserve `STORY_SCHEMA_VERSION = '1.0'` as a compatibility export plus `STORY_SCHEMA_VERSIONS = ['1.0','1.1']`.

- [ ] **Step 1: Write failing additive-version tests**

```js
test('Story 1.0 remains six blocks while Story 1.1 accepts four additive blocks', () => {
  assert.equal(validateStoryDefinition(story10, options), story10);
  assert.equal(validateStoryDefinition(story11WithTableChartImageLegend, options), story11WithTableChartImageLegend);
  assert.throws(() => validateStoryDefinition({ ...story10, states: story11WithTable.states }, options), /unsupported content block.*table/i);
});
```

Assert four existing layouts unchanged, unknown properties rejected, content descriptor schemas equal GUI catalog schemas, canonical actions only in 1.1, and checked-in Route Story 1.0 remains byte-identical.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/story-versioning.test.mjs`

Expected: FAIL because 1.1 is unsupported.

- [ ] **Step 3: Route validation by explicit version**

```js
export function validateStoryDefinition(definition, options = {}) {
  const version = requireSupportedVersion(definition.schemaVersion);
  validateSchema(definition, getStorySchema(version));
  validateStatesWithDescriptors(definition.states, descriptorsForVersion(version, options), options.actionDescriptors);
  return definition;
}
```

Story 1.0 validation retains its exact accepted saved shapes; normalization remains in the project loader before canonical runtime dispatch.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/story-versioning.test.mjs tests/story-schema.test.mjs tests/route-61-2-action-contracts.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add data/schemas/story-1.1.schema.json src/content/content-descriptors.js src/capabilities/core-content-v1.js src/story-schema.js tests/story-versioning.test.mjs
git commit -m "feat: add additive story schema 1.1"
```

### Task 25: Semantic table, image, and legend renderers

**Files:**
- Create: `src/content/content-renderers.js`
- Create: `tests/content-renderers.test.mjs`
- Modify: `src/presentation-renderer.js`
- Modify: `src/story-shell.js`

**Interfaces:**
- Produce `createContentRendererRegistry({ tables, assets, metrics, formatter, chartRenderer }) -> { renderBlock, types }`.
- Produce named `renderTableBlock`, `renderImageBlock`, `renderLegendBlock` for focused DOM tests.
- Existing `renderPresentationContent` delegates all block types through the registry.

- [ ] **Step 1: Write failing DOM-semantic tests**

```js
test('table block emits native accessible table structure', () => {
  const node = renderTableBlock(tableBlock, context);
  assert.equal(node.querySelector('table caption').textContent, 'Changes');
  assert.equal(node.querySelector('th').getAttribute('scope'), 'col');
  assert.equal(node.querySelectorAll('tbody tr').length, 2);
});

test('image and legend use safe native semantics', () => {
  assert.equal(renderImageBlock(imageBlock, context).querySelector('img').alt, 'Bus stop');
  assert.equal(renderLegendBlock(legendBlock, context).querySelectorAll('li').length, 2);
});
```

Cover decorative image empty alt only with `decorative: true`, figure/figcaption/source, icon asset lookup, swatch/line samples, no HTML insertion, selected table columns/order/alignment/formatting, responsive wrappers, and existing six block output unchanged.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/content-renderers.test.mjs`

Expected: FAIL with missing renderers.

- [ ] **Step 3: Build elements with `createElement`/`textContent`**

```js
export function renderTableBlock(block, context) {
  const table = context.documentRef.createElement('table');
  appendCaptionHeadBody(table, block, context);
  return wrapContentBlock('table', table, context.documentRef);
}
```

Render source attribution from declared IDs; never accept authored HTML or DOM nodes.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/content-renderers.test.mjs tests/presentation-renderer.test.mjs tests/story-shell-dom.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/content/content-renderers.js src/presentation-renderer.js src/story-shell.js tests/content-renderers.test.mjs
git commit -m "feat: render semantic table image and legend blocks"
```

### Task 26: Vendor exact Chart.js 4.5.1 distribution

**Files:**
- Create: `vendor/chart.js/4.5.1/chart.umd.min.js`
- Create: `vendor/chart.js/4.5.1/LICENSE.md`
- Create: `tests/chart-vendor.test.mjs`
- Modify: `index.html`

**Interfaces:**
- Browser global `globalThis.Chart` is supplied by the official Chart.js `4.5.1` UMD distribution before `src/app.js`.
- SHA-512 package integrity authority: `sha512-GIjfiT9dbmHRiYi6Nl2yFCq7kkwdkp1W/lp2J99rX0yo9tgJGn3lKQATztIjb5tVtevcBtIdICNWqlq5+E8/Pw==`.

- [ ] **Step 1: Write failing pin/locality test**

```js
test('Chart.js is exactly 4.5.1 and loaded only from the local vendor path', async () => {
  const html = await readFile(INDEX_URL, 'utf8');
  const vendor = await readFile(CHART_URL, 'utf8');
  assert.match(html, /\.\/vendor\/chart\.js\/4\.5\.1\/chart\.umd\.min\.js/);
  assert.doesNotMatch(html, /cdn[^\s"']*chart|unpkg[^\s"']*chart/i);
  assert.match(vendor.slice(0, 500), /Chart\.js v4\.5\.1|v4\.5\.1/);
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test tests/chart-vendor.test.mjs`

Expected: FAIL because the pinned vendor files/script do not exist.

- [ ] **Step 3: Fetch the exact npm tarball and copy its official standalone build/license**

Use `npm pack chart.js@4.5.1`, verify npm-reported integrity matches the value above, extract `package/dist/chart.umd.min.js` and `package/LICENSE.md`, and place them at the locked vendor paths. The tarball/extraction directory is temporary and is not committed. Add `<script src="./vendor/chart.js/4.5.1/chart.umd.min.js"></script>` before the module application script.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/chart-vendor.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add vendor/chart.js/4.5.1 index.html tests/chart-vendor.test.mjs
git commit -m "feat: vendor chart js 4.5.1"
```

### Task 27: Narrow chart translation and accessible lifecycle

**Files:**
- Create: `src/content/chart-config.js`
- Create: `src/content/chart-renderer.js`
- Create: `tests/chart-config.test.mjs`
- Create: `tests/chart-renderer.test.mjs`
- Modify: `src/content/content-renderers.js`

**Interfaces:**
- Produce `buildChartConfig(block, { table, formatter, palette, reducedMotion }) -> plain ChartConfiguration`.
- Produce `createChartRenderer({ Chart, documentRef = document, reducedMotion, formatter }) -> { render(block, context), destroyAll() }`.
- Area translates to Chart.js type `line` plus `fill: true`; grouped/stacked bars set only controlled scale flags.

- [ ] **Step 1: Write failing translation/lifecycle tests**

```js
test('approved chart vocabulary maps to bounded Chart.js configuration', () => {
  assert.deepEqual(buildChartConfig(areaBlock, context).data.datasets[0].fill, true);
  const stacked = buildChartConfig(stackedBarBlock, context);
  assert.equal(stacked.options.scales.x.stacked, true);
  assert.equal(stacked.options.animation, false);
  assert.equal(Object.hasOwn(stacked.options, 'pluginsFromAuthor'), false);
});

test('chart renderer adds accessible canvas and fallback table and destroys instances', () => {
  const renderer = createChartRenderer({ Chart: FakeChart, documentRef, reducedMotion: true, formatter });
  const node = renderer.render(chartBlock, context);
  assert.equal(node.querySelector('canvas').getAttribute('role'), 'img');
  assert.ok(node.querySelector('table'));
  renderer.destroyAll();
  assert.equal(FakeChart.instances[0].destroyCalls, 1);
});
```

Cover bar/grouped/stacked, line, area, palette, axes labels, locale tooltip/axis callbacks owned by trusted code, required title plus description/generated summary, visible or visually hidden source table, resize, rerender destroy, reduced motion, and rejection of arbitrary options/callbacks/mixed/secondary/scatter settings during schema validation. Test the translation layer, not Chart.js internals.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/chart-config.test.mjs tests/chart-renderer.test.mjs`

Expected: FAIL with missing chart modules.

- [ ] **Step 3: Implement controlled translation and injected constructor**

```js
export function buildChartConfig(block, context) {
  const { labels, datasets } = translateBoundColumns(block.data, context.table, context.palette);
  return deepFreeze({
    type: block.chartType === 'area' ? 'line' : block.chartType,
    data: { labels, datasets },
    options: trustedChartOptions(block, context)
  });
}
```

Do not copy arbitrary Story properties into the Chart.js options object.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/chart-config.test.mjs tests/chart-renderer.test.mjs tests/content-renderers.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/content/chart-config.js src/content/chart-renderer.js src/content/content-renderers.js tests/chart-config.test.mjs tests/chart-renderer.test.mjs
git commit -m "feat: render accessible bounded charts"
```

### Task 28: Responsive content styles and production registry wiring

**Files:**
- Modify: `styles.css`
- Modify: `src/project/bootstrap.js`
- Modify: `src/capabilities/core-content-v1.js`
- Modify: `src/app.js`
- Create: `tests/story-1.1-integration.test.mjs`
- Modify: `tests/story-shell-markup.test.mjs`

**Interfaces:**
- Bootstrap injects the same `contentDescriptors` into Story validation/catalog and matching renderer registry into Story Shell/legacy presentation.
- Capability/catalog parity remains exact for all ten blocks.

- [ ] **Step 1: Write failing end-to-end content registry tests**

```js
test('Story 1.1 discovery, validation, and runtime rendering have exact type parity', async () => {
  const project = await loadFixtureProject();
  assert.deepEqual(project.catalog.content.map(({ type }) => type).sort(), project.contentRenderer.types.toSorted());
  for (const type of ['table', 'chart', 'image', 'legend']) assert.ok(renderFixtureState(type));
});
```

CSS source assertions require responsive overflow for tables/charts, minimum readable image/legend sizing, visible focus, reduced-motion chart selectors, and no user-agent targeting.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/story-1.1-integration.test.mjs tests/story-shell-markup.test.mjs`

Expected: FAIL because bootstrap/style integration is absent.

- [ ] **Step 3: Wire registries and scoped styles**

```js
const contentRenderer = createContentRendererRegistry({
  tables: project.tables, assets: project.assets, metrics: project.metrics,
  formatter: createLocaleFormatter(project.locale), chartRenderer
});
```

Keep current six block markup/classes stable. Add only `.content-table`, `.content-chart`, `.content-image`, and `.content-legend` scoped rules.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/story-1.1-integration.test.mjs tests/story-shell-markup.test.mjs tests/capability-parity.test.mjs`

Expected: PASS.

- [ ] **Step 5: Complete Slice 7 checks**

Run: `npm test`

Run: `$env:SAMPLE_MS='5000'; $env:REPETITIONS='1'; node scripts/performance-root-cause-v1.mjs story-shell-benchmark 1920 1080`

Run: `git diff --check`

Expected: PASS, no settled churn, Route Story unchanged, and no chart animation under reduced motion.

- [ ] **Step 6: Commit and open Slice 7 PR**

```powershell
git add styles.css src/project/bootstrap.js src/capabilities/core-content-v1.js src/app.js tests/story-1.1-integration.test.mjs tests/story-shell-markup.test.mjs
git commit -m "feat: integrate story 1.1 content pack"
git push -u origin feat/template-v1-story-1-1
```

### Gate C — Baseline Authoring Capability Review (mandatory STOP)

Review metrics, normalized tables, common line/point/fill rendering, focus, visibility, emphasis/reset, bounded labels, Story 1.1, and table/chart/image/legend accessibility through serializable descriptors. Verify descriptor/runtime/GUI parity and that Route 61-2 remains Story 1.0.

Record:

```text
TEMPLATE_V1_AUTHORING_CAPABILITIES_RESULT: PASS
```

If `REVISE`, do not create the certification fixture.

---

## Slice 8 — Synthetic Well-Rounded Fixture

**Branch/PR:** `test/template-v1-fixture` — fresh `main` after Gate C PASS and Slice 7 merge.

### Task 29: Complete static ordinary-project package

**Files:**
- Create: `tests/fixtures/well-rounded-template-v1/project.json`
- Create: `tests/fixtures/well-rounded-template-v1/stories/main.story.json`
- Create: `tests/fixtures/well-rounded-template-v1/data/existing-route.geojson`
- Create: `tests/fixtures/well-rounded-template-v1/data/proposed-route.geojson`
- Create: `tests/fixtures/well-rounded-template-v1/data/stops.geojson`
- Create: `tests/fixtures/well-rounded-template-v1/data/service-area.geojson`
- Create: `tests/fixtures/well-rounded-template-v1/data/demand.json`
- Create: `tests/fixtures/well-rounded-template-v1/data/metrics.json`
- Create: `tests/fixtures/well-rounded-template-v1/assets/site-photo.svg`
- Create: `tests/well-rounded-fixture.test.mjs`

**Interfaces:**
- Fixture is a self-contained static package accepted by production `loadProject`; it contains no JavaScript or HTML.
- The image asset is deterministic local SVG referenced as an image MIME asset; it contains no script/event/external-resource content.

- [ ] **Step 1: Write failing package coverage test**

```js
test('synthetic package exercises every baseline resource and action form without source files', async () => {
  const project = await loadFixtureProject(FIXTURE_URL);
  assert.deepEqual(resourceKinds(project), ['geojson:line', 'geojson:point', 'geojson:polygon', 'table-json']);
  assert.deepEqual(new Set(actionTypes(project.story)), new Set(['map.focus', 'map.set-visibility', 'map.set-emphasis', 'map.clear-emphasis']));
  assert.deepEqual(new Set(blockTypes(project.story)), new Set(['chart', 'table', 'image', 'legend', 'stat-group', 'heading', 'paragraph']));
  assert.equal([...walkFiles(FIXTURE_DIR)].some((path) => /\.(?:js|mjs|html)$/i.test(path)), false);
});
```

Assert line, labeled points, polygon, static metric, route-comparison computed metric, bar/line/area coverage across states, table/image/legend, visibility/emphasis/clear, datasets/coordinate/bounds focus, and all attribution/resource references.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/well-rounded-fixture.test.mjs`

Expected: FAIL because fixture package does not exist.

- [ ] **Step 3: Author minimal deterministic fixture data**

Use tiny coordinates around `[0,0]`, two-row tables, one point label property, one polygon ring, and literal metrics. Story 1.1 uses only canonical actions. Keep every resource small enough to inspect in review.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/well-rounded-fixture.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add tests/fixtures/well-rounded-template-v1 tests/well-rounded-fixture.test.mjs
git commit -m "test: add well rounded static project fixture"
```

### Task 30: Six ordinary acceptance stories and no-source-edit launch

**Files:**
- Modify: `tests/fixtures/well-rounded-template-v1/stories/main.story.json`
- Create: `tests/template-use-cases.test.mjs`
- Create: `scripts/serve-project-fixture.mjs`

**Interfaces:**
- Produce `resolveProjectRoot(requestUrl, { fixtureRoot })` in the test-only server so `/project.json` serves the copied fixture while application `/src`, `/styles.css`, and vendor assets serve unchanged production files.

- [ ] **Step 1: Write failing six-use-case and source-hash test**

```js
test('fixture represents all six ordinary stories with unchanged application source', async () => {
  assert.deepEqual(story.states.map(({ id }) => id), [
    'route-realignment', 'service-area-context', 'route-stop-rationalization',
    'demand-evidence', 'network-connectivity', 'image-supported-evidence'
  ]);
  assert.equal(hashTree(['src', 'index.html']), recordedProductionHash);
});
```

Do not add non-schema metadata to Story; the six exact state IDs above are the acceptance mapping. The hash is calculated before copying the fixture to a temporary served project root and compared after launch.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/template-use-cases.test.mjs`

Expected: FAIL because required state IDs/server helper are absent.

- [ ] **Step 3: Add focused states and test-only static routing**

```js
export function resolveProjectRoot(requestUrl, { fixtureRoot, applicationRoot }) {
  return requestUrl.startsWith('/project/') ? safeJoin(fixtureRoot, requestUrl.slice(9)) : safeJoin(applicationRoot, requestUrl);
}
```

The helper is certification infrastructure only; production still requests `./project.json` and has no project selector.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/template-use-cases.test.mjs tests/well-rounded-fixture.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add tests/fixtures/well-rounded-template-v1/stories/main.story.json tests/template-use-cases.test.mjs scripts/serve-project-fixture.mjs
git commit -m "test: cover six ordinary template stories"
```

### Task 31: Minimal trusted special-capability certification fixture

**Files:**
- Create: `tests/fixtures/capabilities/facility-access-test-v1.mjs`
- Create: `tests/special-capability-boundary.test.mjs`
- Modify: `tests/fixtures/well-rounded-template-v1/project.json`

**Interfaces:**
- Test-only descriptor ID `facility-access-test-v1` registers required dataset roles, one action `facility.show-access`, one logical target, one computed metric, lifecycle hooks, settings schema, and GUI metadata.
- Factory remains test code in the trusted registry; manifest contains only `{ "id": "facility-access-test-v1", "settings": { ... } }`.

- [ ] **Step 1: Write failing extension-boundary test**

```js
test('special capability registers all extension surfaces without runtime or shell edits', async () => {
  const before = hashFiles(['src/story-runtime.js', 'src/story-shell.js']);
  const project = await loadFixtureProject({ registry: registryWithFacilityTest });
  const runtime = await bootstrapFixture(project);
  assert.ok(project.catalog.actions.some(({ type }) => type === 'facility.show-access'));
  assert.equal(project.metrics.resolve('facility-access-count').value, 2);
  assert.deepEqual(runtime.targets.get('facility-access-paths').owner, 'facility-access-test-v1');
  assert.equal(hashFiles(['src/story-runtime.js', 'src/story-shell.js']), before);
});
```

Also assert data-role validation, handler/action parity, settings failure, lifecycle create/reset/destroy, GUI metadata serializability, and absence of source/module/script/plugin paths in the manifest.

- [ ] **Step 2: Prove RED**

Run: `node --test tests/special-capability-boundary.test.mjs`

Expected: FAIL because fake capability does not exist.

- [ ] **Step 3: Add the minimal test-only trusted capability**

```js
export const facilityAccessTestEntry = {
  descriptor: FACILITY_ACCESS_TEST_DESCRIPTOR,
  createCapability({ resources }) {
    return Object.freeze({
      handlers: { 'facility.show-access': ({ active }) => record(active) },
      targets: { 'facility-access-paths': resources.byRole('facility.access-paths') },
      metrics: { 'facility-access-count': () => 2 },
      reset() { record(false); }, destroy: once(() => record('destroy'))
    });
  }
};
```

This is not a real hospital/facility analysis and must not add production domain behavior.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/special-capability-boundary.test.mjs`

Expected: PASS.

- [ ] **Step 5: Complete Slice 8 checks**

Run: `npm test`

Run: `git diff --check`

Expected: PASS. Browser performance is not repeated; the fixture is ready for Slice 9 browser certification.

- [ ] **Step 6: Commit and open Slice 8 PR**

```powershell
git add tests/fixtures/capabilities/facility-access-test-v1.mjs tests/special-capability-boundary.test.mjs tests/fixtures/well-rounded-template-v1/project.json
git commit -m "test: certify special capability extension boundary"
git push -u origin test/template-v1-fixture
```

---

## Slice 9 — Template Certification

**Branch/PR:** `cert/template-v1` — fresh `main` after Slice 8 merge.

### Task 32: Contract, purity, and GUI/runtime parity audit

**Files:**
- Create: `review/well-rounded-map-story-template-v1/contract-evidence.test.mjs`
- Create: `review/well-rounded-map-story-template-v1/PURITY.json`
- Create: `review/well-rounded-map-story-template-v1/CATALOG.json`

**Interfaces:**
- Certification exports a JSON-serializable catalog snapshot derived from installed descriptors.
- Purity audit records every authored JSON/SVG resource scanned and forbidden key/value findings.

- [ ] **Step 1: Write failing audit test**

```js
test('certification catalog equals runtime acceptance surfaces', async () => {
  assert.deepEqual(catalog.contentTypes.toSorted(), runtime.contentRenderer.types.toSorted());
  assert.deepEqual(catalog.actionTypes.toSorted(), Object.keys(runtime.handlers).toSorted());
  assert.deepEqual(catalog.metricIds.toSorted(), runtime.metrics.catalog().map(({ id }) => id).toSorted());
  assert.deepEqual(catalog.capabilityIds.toSorted(), INSTALLED_CAPABILITY_REGISTRY.ids.toSorted());
  assert.deepEqual(purity.forbiddenFindings, []);
});
```

Audit content descriptor/renderer, action descriptor/handler, parameter schema/runtime validator, metric descriptor/registry, capability catalog/installed registry, and dataset-role catalog/runtime checks. Scan authored data for forbidden functions, callbacks, eval/expression fields, HTML/DOM/class instances, script/module/plugin paths, raw MapLibre expressions, and raw Chart.js options/callbacks.

- [ ] **Step 2: Prove RED**

Run: `node --test review/well-rounded-map-story-template-v1/contract-evidence.test.mjs`

Expected: FAIL because evidence snapshots do not exist.

- [ ] **Step 3: Generate evidence from production exports, then inspect the diff**

Run the evidence test in an explicit update mode implemented inside the test file: `$env:UPDATE_CERT_EVIDENCE='1'; node --test review/well-rounded-map-story-template-v1/contract-evidence.test.mjs`. The update mode writes only `PURITY.json` and `CATALOG.json` deterministically; inspect both files and unset the variable.

- [ ] **Step 4: Prove GREEN without update mode**

Run: `Remove-Item Env:UPDATE_CERT_EVIDENCE -ErrorAction SilentlyContinue; node --test review/well-rounded-map-story-template-v1/contract-evidence.test.mjs`

Expected: PASS with no snapshot rewrite.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add review/well-rounded-map-story-template-v1/contract-evidence.test.mjs review/well-rounded-map-story-template-v1/PURITY.json review/well-rounded-map-story-template-v1/CATALOG.json
git commit -m "test: audit template contract purity and parity"
```

### Task 33: Hard no-JavaScript new-project experiment

**Files:**
- Create: `review/well-rounded-map-story-template-v1/no-js-project/` as a copy of the approved synthetic manifest/story/data/assets only
- Create: `review/well-rounded-map-story-template-v1/no-js-experiment.test.mjs`
- Create: `review/well-rounded-map-story-template-v1/NO_JS_EXPERIMENT.json`

**Interfaces:**
- Experiment records before/after SHA-256 hashes for `src/**`, `index.html`, and application-owned HTML/CSS while serving the new project through the unchanged production runtime.

- [ ] **Step 1: Write failing experiment acceptance**

```js
test('ordinary copied project launches after data/assets-only edits', async () => {
  assert.equal(evidence.launch.status, 'PASS');
  assert.equal(evidence.applicationHashes.before, evidence.applicationHashes.after);
  assert.equal(evidence.projectFiles.some((path) => /\.(?:js|mjs|html)$/i.test(path)), false);
  assert.equal(evidence.statesVisited, evidence.stateCount);
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test review/well-rounded-map-story-template-v1/no-js-experiment.test.mjs`

Expected: FAIL because experiment evidence does not exist.

- [ ] **Step 3: Copy/change only project resources and launch**

Create the new project package by changing title/locale, Story copy, data values, asset, metrics, and semantic IDs only. Serve it with `scripts/serve-project-fixture.mjs`, traverse every state in a real browser, record console/load/action/render results and hashes in `NO_JS_EXPERIMENT.json`. Do not edit application JavaScript, HTML, or CSS during the experiment.

- [ ] **Step 4: Prove GREEN**

Run: `node --test review/well-rounded-map-story-template-v1/no-js-experiment.test.mjs`

Expected: PASS. This is the hard acceptance criterion for ordinary-project portability.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add review/well-rounded-map-story-template-v1/no-js-project review/well-rounded-map-story-template-v1/no-js-experiment.test.mjs review/well-rounded-map-story-template-v1/NO_JS_EXPERIMENT.json
git commit -m "test: prove data only project creation"
```

### Task 34: Browser, accessibility, lifecycle, and performance evidence

**Files:**
- Create: `review/well-rounded-map-story-template-v1/browser-evidence.test.mjs`
- Create: `review/well-rounded-map-story-template-v1/BROWSER.json`
- Create: certified screenshots under `review/well-rounded-map-story-template-v1/screenshots/`

**Interfaces:**
- Browser evidence records synthetic and Route 61-2 desktop/mobile state traversal, one map instance, Story ↔ Explore, legacy fallback, console, accessible DOM, reduced motion, and settled counters.

- [ ] **Step 1: Write failing browser evidence thresholds**

```js
test('final browser evidence satisfies lifecycle and settled performance authority', async () => {
  assert.equal(evidence.route612.mapInstances, 1);
  assert.equal(evidence.synthetic.consoleErrors.length, 0);
  assert.equal(evidence.accessibility.tableSemantics, 'PASS');
  assert.equal(evidence.reducedMotion.chartAnimation, false);
  for (const sample of evidence.performance.samples) {
    assert.ok(sample.sustainedLowFps >= 30);
    assert.equal(sample.recurringSourceMutations, 0);
    assert.equal(sample.runawayRenderLoop, false);
  }
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test review/well-rounded-map-story-template-v1/browser-evidence.test.mjs`

Expected: FAIL because browser evidence is absent.

- [ ] **Step 3: Run final certified browser matrix**

Run all Gate B commands again for Route 61-2 at `1920x1080` and `390x844`, plus lifecycle/reduced motion/regression. Run the synthetic/no-JS project at `1366x768`, `390x844`, and `320x568`, traverse all states, inspect table/chart/image/legend semantics and focus/visibility/emphasis/reset. Record actual values in `BROWSER.json` and screenshots. Confirm transition measurements are labeled separately from settled samples.

- [ ] **Step 4: Prove GREEN**

Run: `node --test review/well-rounded-map-story-template-v1/browser-evidence.test.mjs`

Expected: PASS.

- [ ] **Step 5: Regression**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add review/well-rounded-map-story-template-v1/browser-evidence.test.mjs review/well-rounded-map-story-template-v1/BROWSER.json review/well-rounded-map-story-template-v1/screenshots
git commit -m "test: certify template browser behavior"
```

### Task 35: Certification report and special-extension conclusion

**Files:**
- Create: `review/well-rounded-map-story-template-v1/REPORT.md`
- Create: `review/well-rounded-map-story-template-v1/report-evidence.test.mjs`

**Interfaces:**
- Report references exact commits/evidence files and concludes each required dimension with `PASS|FAIL` based on checked-in evidence.

- [ ] **Step 1: Write failing report completeness test**

```js
test('report records every required certification dimension', async () => {
  const report = await readFile(REPORT_URL, 'utf8');
  for (const heading of REQUIRED_HEADINGS) assert.match(report, new RegExp(`## ${escapeRegExp(heading)}`));
  assert.match(report, /New-project no-JS experiment:\s*PASS/);
  assert.match(report, /Special capability extension:\s*PASS/);
  assert.doesNotMatch(report, /BASELINE_AUTHORING_CONTRACT_V1:\s*LOCKED/);
});
```

`REQUIRED_HEADINGS` is the exact list: Contract validation, Serializability and purity, GUI catalog/runtime parity, New-project no-JS experiment, Route 61-2 regression, Desktop and mobile, Story and Explore lifecycle, Legacy fallback, One map instance, Accessibility, Reduced motion, Console, Performance, Special capability extension, Six ordinary stories, Risks and deferred scope, Certification result.

- [ ] **Step 2: Prove RED**

Run: `node --test review/well-rounded-map-story-template-v1/report-evidence.test.mjs`

Expected: FAIL because report does not exist.

- [ ] **Step 3: Write evidence-backed report**

Report actual test counts and commands, Chart.js `4.5.1`, hashes, screenshot paths, performance values, Route Story byte hash, all six use cases, no-source-edit result, and fake capability result. Do not record the contract as locked; that is gated Slice 10 work.

- [ ] **Step 4: Prove GREEN**

Run: `node --test review/well-rounded-map-story-template-v1/report-evidence.test.mjs`

Expected: PASS.

- [ ] **Step 5: Complete Slice 9 certification**

Run: `npm test`

Run: `git diff --check`

Expected: all tests/evidence PASS; browser evidence meets settled thresholds.

- [ ] **Step 6: Commit, push, and open Slice 9 PR**

```powershell
git add review/well-rounded-map-story-template-v1/REPORT.md review/well-rounded-map-story-template-v1/report-evidence.test.mjs
git commit -m "docs: certify well rounded map story template v1"
git push -u origin cert/template-v1
```

### Gate D — Template Certification (mandatory STOP)

Reviewers must independently verify the no-JavaScript experiment, evidence JSON, screenshots, full test run, security/purity audit, catalog parity, Route 61-2 regression, accessibility/reduced-motion behavior, special-capability fixture, and final settled performance values.

Record in the certification PR:

```text
TEMPLATE_V1_TEMPLATE_CERTIFICATION_RESULT: PASS
```

If `REVISE`, do not write the lock marker.

---

## Slice 10 — Baseline Contract Lock

**Branch/PR:** `docs/template-v1-lock` — fresh `main` after Gate D PASS and Slice 9 merge.

### Task 36: Record the approved baseline authoring contract

**Files:**
- Create: `docs/baseline-authoring-contract-v1.md`
- Modify: `README.md`
- Modify: `docs/story-runtime-v1.md`
- Modify: `review/well-rounded-map-story-template-v1/REPORT.md`
- Create: `tests/baseline-contract-lock.test.mjs`

**Interfaces:**
- Contract document names exact component contracts, schema/resource paths, version policy, extension boundary, certification report, and future change rule.

- [ ] **Step 1: Write the failing lock-authority test**

```js
test('baseline lock is recorded only with passing Gate D authority', async () => {
  const lock = await readFile(LOCK_URL, 'utf8');
  const report = await readFile(REPORT_URL, 'utf8');
  assert.match(report, /TEMPLATE_V1_TEMPLATE_CERTIFICATION_RESULT:\s*PASS/);
  assert.match(lock, /BASELINE_AUTHORING_CONTRACT_V1:\s*LOCKED/);
  for (const contract of ['PROJECT_MANIFEST_V1', 'CORE_CONTENT_PACK_V1', 'COMMON_MAP_ACTIONS_V1', 'DATA_METRIC_BINDING_V1', 'CAPABILITY_EXTENSION_BOUNDARY_V1']) {
    assert.match(lock, new RegExp(contract));
  }
});
```

- [ ] **Step 2: Prove RED**

Run: `node --test tests/baseline-contract-lock.test.mjs`

Expected: FAIL because the lock document does not exist.

- [ ] **Step 3: Write the lock and navigation docs**

The lock document records:

```text
BASELINE_AUTHORING_CONTRACT_V1: LOCKED
```

It links the design, this implementation plan, canonical schemas, Chart.js pin, certification report, and Gate D evidence. Add `TEMPLATE_V1_TEMPLATE_CERTIFICATION_RESULT: PASS` to the certification report only after the approving Gate D review is recorded. State that baseline changes require an explicit compatible minor or breaking major contract revision; capability-specific evolution does not mutate baseline Story semantics. README points ordinary project authors to `project.json` and Story 1.1; runtime docs retain Story 1.0 compatibility behavior.

- [ ] **Step 4: Prove GREEN**

Run: `node --test tests/baseline-contract-lock.test.mjs`

Expected: PASS.

- [ ] **Step 5: Complete Slice 10 checks**

Run: `npm test`

Run: `git diff --check`

Expected: PASS. No browser rerun is required because this slice changes documentation and its lock-authority test only.

- [ ] **Step 6: Commit and open Slice 10 PR**

```powershell
git add docs/baseline-authoring-contract-v1.md README.md docs/story-runtime-v1.md review/well-rounded-map-story-template-v1/REPORT.md tests/baseline-contract-lock.test.mjs
git commit -m "docs: lock baseline authoring contract v1"
git push -u origin docs/template-v1-lock
```

Merge only after review confirms Gate D evidence is on `main`. GUI Editor V1 design may begin only after this PR is approved and merged.

---

## Plan Coverage and Consistency Audit

Before implementing Slice 1, the plan reviewer must confirm:

1. Manifest, table, metric, Story 1.1, descriptor, and runtime validation all have canonical serializable schemas/descriptors and exact tests.
2. Core capabilities are implicit and explicit declarations fail.
3. Optional dataset roles are required only by selected capability descriptors.
4. Canonical action handlers have unique ownership; Story 1.0 normalizers do not own handlers.
5. Route 61-2 Story 1.0 stays byte-identical and legacy aliases normalize before the runtime.
6. Generic labels are bounded, non-interactive, scalar-property labels; generic popups remain excluded.
7. Story 1.1 adds table/chart/image/legend without changing Story 1.0 blocks/layouts.
8. Table data and metrics contain literals only; no runtime spreadsheet behavior is introduced.
9. Chart.js is exactly `4.5.1`, local at `vendor/chart.js/4.5.1/chart.umd.min.js`, and accessed through a narrow injected renderer.
10. Runtime validation and future GUI discovery use the same content/action/metric/role/capability descriptors.
11. Ordinary project certification changes only manifest, Story, data, and assets.
12. The fake special capability proves data requirements, actions, targets, metrics, lifecycle, and GUI metadata without runtime/shell changes.
13. Error results use stable `code`, `path`, and `message`; fatal loads stop initialization; optional failures follow reachability rules.
14. No task introduces arbitrary authored code, a new framework, a database, CMS, GUI, project selector, generic popup system, or another explicit non-goal.
15. Slices remain independently usable and each begins from freshly updated main.
16. Gates A–D are mandatory stops with exact result markers.
17. Performance work escalates: none for pure contracts, short sanity after meaningful executable changes, full certified CDP at Gate B and Slice 9.
18. Export names and file responsibilities used by later tasks exactly match the locked module table and earlier interface blocks.

## Implementation Handoff

After this plan is approved, use `superpowers:executing-plans` with one slice at a time. Stop at every PR boundary and every major gate. Do not begin Slice 1 from this design branch; fetch current `origin/main`, run the baseline test suite, and create `feat/template-v1-contracts` only after explicit plan approval.
