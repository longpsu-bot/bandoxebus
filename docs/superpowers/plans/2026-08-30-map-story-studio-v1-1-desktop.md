# Map Story Studio V1.1 Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Subagents are disabled for this project. Use test-driven development: write the focused failing test, prove RED, implement the smallest change, prove GREEN, then commit.

**Goal:** Deliver Map Story Studio V1.1 as a desktop-first visual authoring product where every Scene remains a production Story state, Story 1.2 adds bounded declarative Scene state and 16:9 composition, the GUI writes that production format directly, and the same Scene sequence drives Scroll Story and Presentation mode without a GUI-only schema or second runtime.

**Architecture:** Preserve the certified GUI Editor V1 package/draft/validation/storage spine and production `loadProject(...)` → `bootstrapProject(...)` → trusted-capability path. Add one version-gated Story 1.2 contract, one shared read-only Scene compositor, one Scene-state controller, and one semantic layer registry keyed by stable project dataset IDs. Add a thin editor-preview authoring adapter around the production compositor. Keep Story 1.0/1.1 on their existing structured path. Introduce a neutral shell in PR A, then move Route 61-2 fully onto it through trusted capability-owned compatibility code in PR C. PR D adds Scroll Story and Presentation as navigation adapters over the same runtime/controller/compositor.

**Tech Stack:** Static HTML/CSS, native browser DOM and ES modules, Node.js 24 `node:test`, MapLibre GL JS 5.24.0, vendored Chart.js 4.5.1, vendored `fflate` 0.8.3, iframe `postMessage`, existing File System Access/ZIP adapters, and existing dependency-free GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-30-map-story-studio-v1-1-desktop-design.md`, approved on `main` by merge commit `3e49c9497dfb9899b11b99c1adf89164ccfc9a52` (reviewed design head `c275a142286041d49fd7f62999f93ee29263992e`).

## Codex Execution Profile

Use this exact profile for implementation prompts unless a human explicitly overrides it:

- **Model:** Sol
- **Reasoning:** Medium
- **Agents:** 1
- **Parallel agents:** Off
- **Subagents:** Off
- **Method:** Superpowers `executing-plans` + TDD
- **Exploration:** only files named by the active task plus direct dependencies revealed by a failing focused test
- **Validation:** focused tests per task; full `npm test` once near each PR boundary; browser/performance gates only where explicitly listed

Do not spend credits rediscovering the approved architecture or repeatedly profiling the browser after small changes.

## Global Architecture Gates

- `BASELINE_AUTHORING_CONTRACT_V1: LOCKED`. Preserve `PROJECT_MANIFEST_V1`, `CORE_CONTENT_PACK_V1`, `COMMON_MAP_ACTIONS_V1`, `DATA_METRIC_BINDING_V1`, and `CAPABILITY_EXTENSION_BOUNDARY_V1`.
- Story 1.0 and 1.1 remain production versions with no silent migration, translation layer, or freeform rewrite.
- `data/stories/route-61-2.story.json` remains byte-identical throughout V1.1.
- Story 1.2 is **complete in PR A**. PR B/C may add GUI features but must not change Story 1.2 schema semantics.
- Every schema-valid Story 1.2 envelope has a deterministic read-only production rendering path by PR A.
- Normal Scene behavior is declarative: camera, interaction, transition, and complete per-Scene layer visibility. Do not author those as routine action arrays.
- Trusted actions remain for special behavior; declarative baseline is applied before `map.enter` actions.
- Map/private source/layer IDs never enter project or Story JSON. Scene visibility is keyed by project dataset ID.
- No authored JS, HTML, arbitrary CSS, MapLibre expressions, module URLs, callbacks, DOM selectors, filesystem handles, or remote plugins.
- Invalid drafts never enter production preview; keep newest-valid snapshot behavior.
- Folder/ZIP persistence semantics stay certified: declared folder reads only, safe ZIP pass-through, deterministic writes, `project.json` last.
- One MapLibre instance per active editor/runtime output; Scene switches reuse it.
- Native ESM only; no React/Vite/UI framework/state library/sortable library.
- V1.1 authoring is desktop-only. Do not add a mobile editor or Story 1.2 mobile-specific layout. Preserve the existing Story 1.0/1.1 390×844 production smoke.
- If implementation evidence requires changing a locked contract or Story 1.2 semantics after PR A, stop and return for design review.

## Merge-Gated Delivery

Do not stack implementation PRs. Each PR begins from freshly merged `main` after the preceding PR is reviewed and merged.

| PR | Branch | Required outcome |
| --- | --- | --- |
| A | `feat/map-story-studio-v1-1-scene-foundation` | Complete Story 1.2 contract/read-only rendering; neutral runtime path; declarative Scene state; explicit camera capture; per-Scene Layers; minimal desktop Studio. |
| B | `feat/map-story-studio-v1-1-text-compositor` | PowerPoint-like Text authoring: add/edit/drag/resize/style/z/snap/align/undo without Story 1.2 schema changes. |
| C | `feat/map-story-studio-v1-1-rich-templates-route` | Rich objects; immediately-valid templates; root shell neutral; Route 61-2 fully capability/project-owned. |
| D | `feat/map-story-studio-v1-1-outputs-certification` | Scroll Story + Presentation; round-trip persistence; 1920×1080/1366×768 certification; legacy 390×844 regression; final lock report. |

At each PR start:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git status --short --branch
git switch -c <branch-from-table>
```

Expected: clean tree and new branch from current `origin/main`.

At each PR boundary, after focused tests are green:

```powershell
npm test
git diff --check
git status --short
```

Run source `node --check` only for modified JS entry/core modules and run the one browser gate specified for that PR. Push, open Draft PR, fix all Critical/Important review findings, wait for CI, merge, then start the next PR.

## Locked Story 1.2 Implementation Shapes

Use these shapes consistently; do not invent alternatives during PR B/C.

### Scene

```js
{
  id: 'context',
  content: {
    layout: 'freeform-16x9',
    blocks: [],
    // presenterNote optional
  },
  map: {
    camera: { center: [lng, lat], zoom, pitch, bearing },
    interaction: 'locked', // locked | zoom-only | explore
    transition: { type: 'ease', durationMs: 900 }, // fly | ease | instant
    layerVisibility: { 'dataset-id': true },
    enter: [],
    exit: []
  }
}
```

Camera bounds: longitude `[-180,180]`, latitude `[-90,90]`, zoom `[0,24]`, pitch `[0,72]`, bearing `[-360,360]`. `instant` requires `durationMs: 0`; all durations are integer `[0,10000]`.

### Composition envelope

```js
{
  id: 'title',
  frame: { x: 0.05, y: 0.08, width: 0.40, height: 0.17, z: 20 },
  appearance: { // optional
    box: {},
    text: {}
  },
  block: { type: 'heading', text: 'Existing route context' }
}
```

Frame: `x/y [0,1]`, `width/height (0,1]`, `z integer [0,9999]`, plus `x + width <= 1`, `y + height <= 1`. Envelope IDs use the existing stable lowercase ID vocabulary and are unique within the Scene.

### Frozen Story 1.2 compositor defaults

Implement and deep-freeze this exact base token object in `src/scene/scene-contract.js`:

```js
export const STORY_12_COMPOSITOR_DEFAULTS = deepFreeze({
  box: {
    fill: '#00000000',
    opacity: 1,
    borderColor: '#00000000',
    borderWidth: 0,
    radius: 0,
    padding: 0
  },
  text: {
    fontFamily: 'sans',
    fontSize: 28,
    bold: false,
    italic: false,
    color: '#F6F8FC',
    align: 'left',
    lineHeight: 1.2
  },
  semanticText: {
    eyebrow: { fontSize: 18, bold: true },
    heading: { fontSize: 56, bold: true },
    paragraph: { fontSize: 30, bold: false },
    'stat-group': { fontSize: 28, bold: false },
    callout: { fontSize: 26, bold: false },
    disclosure: { fontSize: 18, bold: false },
    table: { fontSize: 22, bold: false },
    chart: { fontSize: 22, bold: false },
    image: { fontSize: 20, bold: false },
    legend: { fontSize: 22, bold: false }
  }
});
```

`resolveStory12Appearance(envelope)` merges base box/text → semantic text token for `envelope.block.type` → authored bounded overrides. Runtime CSS may style internal table/chart structure, but omission/typography defaults must remain pinned to this resolver rather than ambient page CSS.

### Runtime Scene-layer provider

Capability implementation only; never serialized:

```js
sceneLayers: {
  ids: ['dataset-id'],
  setVisible(id, visible),
  reset()
}
```

`createSceneLayerRegistry(instances, expectedIds)` rejects duplicate ownership or an expected Story 1.2 layer with no provider.

### Story Runtime lifecycle extension

```js
createStoryRuntime({
  definition,
  actionRunner,
  lifecycle: {
    afterExit(state, context) {},
    beforeEnter(state, context) {}
  }
})
```

Default lifecycle is no-op. Transition A → B order is exactly: A exit actions → `afterExit(A)` → `beforeEnter(B)` → B enter actions. `beforeEnter(B)` applies: complete layer snapshot → interaction policy → composition render → camera transition start. `afterExit(A)` cancels A-owned in-flight camera motion.

### Editor-preview bounded commands/events

Parent → production preview:

```text
activate-scene { index, animate: false }
authoring-mode { mode: 'select' | 'map' }
restore-scene-camera { index }
```

Production preview → parent:

```text
camera { center, zoom, pitch, bearing }
select-overlay { id }
commit-frame { id, frame }
commit-text { id, text }
```

The latter three authoring intents are added in PR B. Every message uses exact-key validation and existing source/origin/revision checks; no arbitrary method invocation.

---

# PR A — Neutral Shell + Complete Story 1.2 Scene Foundation

## Task A1: Add the complete Story 1.2 contract without weakening 1.0/1.1

**Files:**
- Create: `data/schemas/story-1.2.schema.json`
- Create: `src/scene/scene-contract.js`
- Modify: `src/story-schema.js`
- Modify: `tests/story-schema.test.mjs`
- Modify: `tests/story-versioning.test.mjs`
- Modify: `tests/editor-certification.test.mjs`

- [ ] Write failing tests for: version list `1.0/1.1/1.2`; valid empty freeform Scene; valid heading envelope; duplicate envelope ID; invalid frame sums/bounds; exact camera bounds; invalid instant duration; invalid interaction/transition; nested unknown semantic type; trusted action validation; unchanged 1.0/1.1 behavior.
- [ ] Reuse the existing canonical Route Story byte/digest guard; do not create a second hash policy.
- [ ] Run RED:

```powershell
node --test tests/story-schema.test.mjs tests/story-versioning.test.mjs tests/editor-certification.test.mjs
```

Expected: new 1.2 cases fail; legacy guards remain green.

- [ ] Implement 1.2 as a separate validator branch. Keep legacy `PRESENTATION_LAYOUTS`/block requirements unchanged. Validate nested `envelope.block` with the same descriptor catalog used by Story 1.1.
- [ ] Implement/deep-freeze the exact constants/default token object above.
- [ ] Run GREEN:

```powershell
node --test tests/story-schema.test.mjs tests/story-versioning.test.mjs tests/story-1.1-integration.test.mjs tests/story-1.0-normalizer.test.mjs tests/editor-certification.test.mjs
```

Expected: PASS.

- [ ] Commit:

```powershell
git add data/schemas/story-1.2.schema.json src/scene/scene-contract.js src/story-schema.js tests/story-schema.test.mjs tests/story-versioning.test.mjs tests/editor-certification.test.mjs
git commit -m "feat: add complete Story 1.2 contract"
```

## Task A2: Load and cross-reference Story 1.2 directly through production

**Files:**
- Modify: `src/project/project-loader.js`
- Modify: `src/project/reference-validator.js`
- Create: `tests/story-1.2-integration.test.mjs`
- Modify: `tests/project-loader.test.mjs`
- Modify: `tests/data-binding-references.test.mjs`

- [ ] Write failing in-memory package tests proving unchanged `loadProject(...)` accepts Story 1.2 and rejects: unknown `layerVisibility` ID; table ID in `layerVisibility`; missing Scene-controllable GeoJSON ID; nested bad metric/table/chart/image/legend references.
- [ ] Assert Story 1.1 reference error codes remain the same.
- [ ] Run RED:

```powershell
node --test tests/project-loader.test.mjs tests/data-binding-references.test.mjs tests/story-1.2-integration.test.mjs
```

- [ ] In `validateAndNormalizeStory(...)`, accept 1.2 through canonical action/content validation; never send 1.2 through Story 1.0 normalizers.
- [ ] In resolved-reference validation, unwrap `item.block` only for Story 1.2 before calling existing semantic block reference checks.
- [ ] Derive expected Scene-controllable IDs from rendered GeoJSON project resources and composed capability render responsibilities; require exact `layerVisibility` key coverage for every Story 1.2 Scene.
- [ ] Run GREEN:

```powershell
node --test tests/project-loader.test.mjs tests/project-references.test.mjs tests/data-binding-references.test.mjs tests/story-1.2-integration.test.mjs
```

- [ ] Commit: `feat: load and reference-check Story 1.2`.

## Task A3: Add deterministic read-only Story 1.2 compositor

**Files:**
- Create: `src/scene/scene-compositor.js`
- Modify: `src/content/content-renderers.js` only if needed to expose the existing `renderBlock` seam
- Create: `tests/scene-compositor.test.mjs`
- Modify: `tests/content-renderers.test.mjs`
- Reuse: `tests/chart-renderer.test.mjs`

**API:**

```js
createSceneCompositor({ root, renderBlock, documentRef = document }) -> {
  render(state),
  clear(),
  destroy()
}
```

- [ ] Write failing tests for wrapper identity, normalized frame geometry, z tie-breaking by Story order, exact default-token resolution, bounded authored overrides, and every existing semantic block renderer reachable through `envelope.block`.
- [ ] Assert no `innerHTML`, arbitrary style string, or duplicate semantic rendering implementation is needed.
- [ ] Run RED:

```powershell
node --test tests/scene-compositor.test.mjs tests/content-renderers.test.mjs tests/chart-renderer.test.mjs
```

- [ ] Implement wrappers with normalized geometry and safe explicit CSS variables/attributes. Call existing `renderBlock(child, envelope.block)`.
- [ ] `resolveStory12Appearance(...)` must use the exact frozen defaults above.
- [ ] Run GREEN with the same command.
- [ ] Commit: `feat: render Story 1.2 composition envelopes`.

## Task A4: Add semantic Scene layer registry using existing visibility controllers

**Files:**
- Create: `src/scene/scene-layer-registry.js`
- Modify: `src/capabilities/core-map-v1.js`
- Modify: `src/map/core-map-controller.js` only if enumeration/reset needs a narrow export
- Create: `tests/scene-layer-registry.test.mjs`
- Modify: `tests/core-map-controller.test.mjs`
- Modify: `tests/common-map-integration.test.mjs`

- [ ] Write failing tests: core-map publishes owned project dataset IDs; registry composes providers; duplicate ownership rejected; expected ID without provider rejected; complete snapshot invokes one provider per ID; no private MapLibre IDs in public API.
- [ ] Run RED:

```powershell
node --test tests/scene-layer-registry.test.mjs tests/core-map-controller.test.mjs tests/common-map-integration.test.mjs
```

- [ ] Implement a thin registry over `createCoreMapController().setVisibility(...)`; do not create a second map visibility engine.
- [ ] Run GREEN including `tests/capability-parity.test.mjs`.
- [ ] Commit: `feat: add semantic Scene layer registry`.

## Task A5: Add Scene interaction policy and deterministic runtime lifecycle

**Files:**
- Create: `src/scene/scene-interaction-policy.js`
- Create: `src/scene/scene-state-controller.js`
- Modify: `src/story-runtime.js`
- Modify: `src/project/bootstrap.js`
- Create: `tests/scene-state-controller.test.mjs`
- Modify: `tests/story-runtime.test.mjs`
- Modify: `tests/project-bootstrap.test.mjs`
- Modify: `tests/story-map-interactions.test.mjs`

- [ ] Write runtime-order test: A exit action → `afterExit(A)` → `beforeEnter(B)` → B enter action. Same-state reactivation remains no-op.
- [ ] Write controller-order test: layer snapshot → interaction → compositor → camera transition; `afterExit` calls `map.stop()`; reduced-motion converts fly/ease to jump without mutating authored transition.
- [ ] Write interaction tests for `locked`, `zoom-only`, `explore`, with cooperative-scroll behavior retained for output usage.
- [ ] Run RED:

```powershell
node --test tests/story-runtime.test.mjs tests/scene-state-controller.test.mjs tests/project-bootstrap.test.mjs tests/story-map-interactions.test.mjs
```

- [ ] Keep MapLibre logic out of `story-runtime.js`; add no-op lifecycle hooks only.
- [ ] Bootstrap Scene controller only for Story 1.2 after capability instances, metrics, and content renderer exist. Story 1.0/1.1 receive no lifecycle and keep current behavior.
- [ ] Use `jumpTo` for instant/reduced motion; `easeTo`/`flyTo` for authored transitions.
- [ ] Run GREEN including `tests/story-shell-controller.test.mjs`.
- [ ] Commit: `feat: apply declarative Scene state before actions`.

## Task A6: Introduce a neutral production shell path while legacy Route 61-2 root remains intact

**Files:**
- Create: `src/runtime/index.html`
- Create: `src/runtime/runtime.css`
- Create: `src/runtime/generic-app.js`
- Create: `src/runtime/generic-shell.js`
- Create: `tests/generic-runtime-shell.test.mjs`
- Modify: `tests/application-composition.test.mjs`
- Leave root `index.html` and Route 61-2 `src/app.js` behavior intact except a directly-required shared helper extraction

- [ ] Write failing source/DOM tests requiring only generic hosts: map, Scene compositor, navigation, capability controls, loading/error/status. Explicitly forbid `61-2`, Existing/Proposed/Difference, transport metrics, simulation, and urban/industrial controls.
- [ ] Run RED:

```powershell
node --test tests/generic-runtime-shell.test.mjs tests/application-composition.test.mjs
```

- [ ] Implement `generic-app.js` using existing `startApplication(...)`, installed capability registry, MapLibre, Chart.js, project `initialView`, and existing basemap preparation. It must not import Route 61-2 data/comparison/POI/urban/simulation modules.
- [ ] `generic-shell.js` only needs first/selected Scene activation for editor preview in PR A. Do not implement final Scroll Story/Presentation navigation until PR D.
- [ ] Run GREEN including `tests/project-bootstrap.test.mjs`.
- [ ] Commit: `feat: add neutral Story 1.2 runtime shell`.

## Task A7: Default New Project to Story 1.2 and add pure Scene/layer commands

**Files:**
- Modify: `editor/core/package-store.js`
- Create: `editor/core/scene-commands.js`
- Modify: `editor/ui/story-editor.js` only to keep explicit Story 1.1 legacy creation available where required
- Create: `tests/editor-scene-commands.test.mjs`
- Modify: `tests/editor-package-draft.test.mjs`
- Modify: `tests/editor-story-editor.test.mjs`

- [ ] Write failing tests for New Project: one Story 1.2, one empty freeform Scene, camera from manifest `initialView`, `locked`, `ease/900`, empty visibility/actions.
- [ ] Write pure command tests for add/duplicate/delete/move Scene, set visibility, capture camera normalization/bounds, set interaction, set transition.
- [ ] Add `addProjectLayerToStory12(story, datasetId, { activeSceneIndex })`: synchronously add the new layer key to every Scene (`true` active, `false` others). This is the approved new-layer rule.
- [ ] Do **not** silently remove broken references when deleting a layer; existing validation must surface stale Scene/action/capability references.
- [ ] Keep existing Story 1.0/1.1 authoring paths/version values unchanged.
- [ ] Run RED:

```powershell
node --test tests/editor-package-draft.test.mjs tests/editor-scene-commands.test.mjs tests/editor-story-editor.test.mjs
```

- [ ] Implement pure cloned production-data commands only; no DOM/MapLibre/handles.
- [ ] Route Story 1.2 GeoJSON layer creation in the Studio path through the new all-Scenes snapshot update before the synchronous editor command returns. Debounced validation must observe only the final command result.
- [ ] Run GREEN including `tests/editor-certification.test.mjs`.
- [ ] Commit: `feat: default Studio projects to Story 1.2`.

## Task A8: Add bounded camera/map preview commands and minimal desktop Studio shell

**Files:**
- Modify: `editor/preview/bridge.js`
- Modify: `editor/preview/package-resolver.js`
- Modify: `src/runtime/generic-app.js`
- Modify: `src/runtime/generic-shell.js`
- Modify: `editor/index.html`
- Modify: `editor/editor.css`
- Modify: `editor/editor.js`
- Create: `editor/ui/studio-shell.js`
- Modify: `tests/editor-shell-preview.test.mjs`
- Modify: `tests/editor-authoring-flow.test.mjs`
- Modify: `tests/editor-accessibility-security.test.mjs`

- [ ] Write failing protocol tests for exact commands `activate-scene`, `authoring-mode`, `restore-scene-camera`; reject unknown payload keys/methods/source/origin.
- [ ] Write failing Studio UI tests requiring Layers / 16:9 Canvas / Properties / Scenes, Select/Map, Camera changed, Capture, Restore, keyboard Scene selection/reorder fallback. Story 1.0/1.1 retains certified structured editor.
- [ ] Run RED:

```powershell
node --test tests/editor-shell-preview.test.mjs tests/editor-authoring-flow.test.mjs tests/editor-accessibility-security.test.mjs
```

- [ ] In Story 1.2 editor preview: Select disables map authoring movement; Map enables pan/zoom/pitch/rotate; camera telemetry updates working camera only; Capture commits exactly one `scene-commands` mutation; Restore commits zero; Scene switch discards uncaptured camera and activates saved Scene instantly.
- [ ] Layer checkbox writes only active Scene visibility and never an action. Project layer style stays global.
- [ ] Until PR C, Story 1.2 preview uses `../src/runtime/?editorPreview=1`; Story 1.0/1.1 compatibility preview continues to use root. Both still use the same production loader/bootstrap/Story runtime contracts.
- [ ] Undo/Redo buttons may be present disabled; do not fake history before PR B.
- [ ] Run GREEN including `tests/editor-validation.test.mjs` and `tests/editor-story-editor.test.mjs`.
- [ ] Commit: `feat: add minimal Map Story Studio workspace`.

## Task A9: PR A certification gate

**Files:**
- Create: `scripts/map-story-studio-browser-smoke.mjs`
- Create: `tests/fixtures/story-1.2-blank/project.json`
- Create: `tests/fixtures/story-1.2-blank/stories/main.story.json`
- Modify: `tests/editor-certification.test.mjs`

- [ ] Add `--gate=pr-a`: New Story 1.2 valid; one map; neutral blank shell; add/duplicate/reorder/delete Scene; saved camera/layer restoration; map movement creates no Story revision; Capture exactly one revision; Restore zero; legacy Route 61-2 preview works; targeted 390×844 production smoke; clean console.
- [ ] Focused gate:

```powershell
node --test tests/story-schema.test.mjs tests/story-1.2-integration.test.mjs tests/scene-compositor.test.mjs tests/scene-layer-registry.test.mjs tests/scene-state-controller.test.mjs tests/editor-scene-commands.test.mjs tests/editor-authoring-flow.test.mjs
```

Expected: PASS.

- [ ] Full suite once: `npm test`.
- [ ] Syntax/diff:

```powershell
node --check src/story-schema.js
node --check src/scene/scene-compositor.js
node --check src/scene/scene-state-controller.js
node --check src/runtime/generic-app.js
node --check editor/ui/studio-shell.js
git diff --check
git diff origin/main -- data/stories/route-61-2.story.json
```

Expected: syntax clean; diff check clean; Route Story diff empty.

- [ ] Run browser gate once:

```powershell
node scripts/map-story-studio-browser-smoke.mjs --gate=pr-a --url=http://127.0.0.1:8080/editor/
```

Expected marker: `MAP_STORY_STUDIO_PR_A_RESULT: PASS`.

- [ ] Commit gate support: `test: certify Map Story Studio PR A`.
- [ ] Open Draft PR A. Report exact base/head, focused/full counts, browser marker, Route Story diff, `STORY_12_CONTRACT_COMPLETE: PASS`, `GUI_ONLY_SCHEMA: NONE`, `ONE_MAP_PRINCIPLE: PASS`. Stop for review.

---

# PR B — Desktop PowerPoint Text Authoring

## Task B1: Add bounded history and pure Text composition commands

**Files:**
- Create: `editor/core/history.js`
- Modify: `editor/core/scene-commands.js`
- Modify: `editor/editor.js`
- Create: `tests/editor-history.test.mjs`
- Create: `tests/editor-composition-commands.test.mjs`

- [ ] Write failing history tests: execute/undo/redo, redo invalidation, limit 100, Save does not clear history, UI-only selection/mode excluded.
- [ ] Write failing command tests: add Heading/Body Text envelope; edit nested plain text; commit bounded frame; duplicate with stable new ID; delete; bring forward/send backward; align edges/centers; bounded box/text appearance.
- [ ] Run RED.
- [ ] Implement production-data history and pure commands only. One pointer interaction later maps to one `commit-frame` history command.
- [ ] Run GREEN:

```powershell
node --test tests/editor-history.test.mjs tests/editor-composition-commands.test.mjs tests/editor-scene-commands.test.mjs tests/story-schema.test.mjs
```

- [ ] Commit: `feat: add Studio history and Text composition commands`.

## Task B2: Add editor-preview-only canvas authoring adapter

**Files:**
- Create: `src/scene/scene-authoring-adapter.js`
- Modify: `src/scene/scene-compositor.js` only for safe wrapper lookup/bounds hooks
- Modify: `editor/preview/bridge.js`
- Modify: `editor/preview/package-resolver.js`
- Create: `tests/scene-authoring-adapter.test.mjs`
- Modify: `tests/editor-shell-preview.test.mjs`

- [ ] Write failing tests for exact `select-overlay`, `commit-frame`, `commit-text` events; source/origin/key validation; transient drag/resize with no mutation until pointer-up; plain-text direct editing; bounds clamping.
- [ ] Run RED.
- [ ] Mount adapter only in trusted editor-preview mode. Production output never mounts handles/contenteditable.
- [ ] Emit semantic intents only; parent applies `scene-commands.js` and history.
- [ ] Run GREEN including `tests/editor-accessibility-security.test.mjs`.
- [ ] Commit: `feat: add Scene canvas authoring adapter`.

## Task B3: Build Text Add menu, direct edit, and Properties

**Files:**
- Modify: `editor/ui/studio-shell.js`
- Modify: `editor/editor.css`
- Modify: `editor/editor.js`
- Create: `tests/editor-text-authoring.test.mjs`
- Modify: `tests/editor-authoring-flow.test.mjs`

Properties exposes approved font token, font size, bold, italic, color, alignment, line spacing, fill, opacity, border, radius, padding, and z-order. Users never type normalized frame coordinates.

- [ ] Write failing end-to-end model/DOM tests for Add Heading/Body → select → direct text edit → Properties style → valid preview revision → undo/redo.
- [ ] Run RED.
- [ ] Implement all authored changes through history + pure commands. Selection/handles/guides remain UI-only.
- [ ] Run GREEN with Text/history/authoring-flow tests.
- [ ] Commit: `feat: author Text on the live Scene canvas`.

## Task B4: Add constrained snapping/alignment/z/keyboard helpers

**Files:**
- Modify: `src/scene/scene-authoring-adapter.js`
- Modify: `editor/ui/studio-shell.js`
- Modify: `editor/editor.css`
- Modify: `tests/scene-authoring-adapter.test.mjs`
- Modify: `tests/editor-text-authoring.test.mjs`
- Modify: `tests/editor-accessibility-security.test.mjs`

- [ ] Write failing tests for snapping only to Scene edges/centers and other object edges/centers; transient guides; keyboard nudge; align commands; duplicate/delete; bring forward/send backward.
- [ ] No user guides, distribution, grouping, rotation, constraints, or arbitrary transforms.
- [ ] Implement deterministic snap tolerance in rendered pixels and convert final frame back to normalized values only at commit.
- [ ] Run GREEN.
- [ ] Commit: `feat: add constrained Scene composition helpers`.

## Task B5: PR B certification and schema-freeze gate

**Files:**
- Modify: `scripts/map-story-studio-browser-smoke.mjs`

- [ ] Add `--gate=pr-b`: Text add/direct edit/drag/resize/style/duplicate/align/z/undo/redo; Scene switch persists frames; one map; clean console.
- [ ] Focused tests green, then `npm test` once.
- [ ] Audit schema/Route immutability:

```powershell
git diff origin/main -- data/schemas/story-1.2.schema.json data/stories/route-61-2.story.json
git diff --check
```

Expected: both files unchanged in PR B.

- [ ] Run browser once:

```powershell
node scripts/map-story-studio-browser-smoke.mjs --gate=pr-b --url=http://127.0.0.1:8080/editor/
```

Expected: `MAP_STORY_STUDIO_PR_B_RESULT: PASS`.

- [ ] Commit: `test: certify Map Story Studio PR B`.
- [ ] Open Draft PR B and stop for review.

---

# PR C — Rich Content + Valid Templates + Route 61-2 Neutral-Shell Conversion

## Task C1: Add rich object factories and contextual authoring without new semantic types

**Files:**
- Create: `editor/core/scene-object-factories.js`
- Modify: `editor/core/scene-commands.js`
- Modify: `editor/ui/studio-shell.js`
- Reuse/Modify narrowly: `editor/ui/content-actions.js`, `editor/ui/inspectors.js`
- Create: `tests/editor-rich-object-factories.test.mjs`
- Create: `tests/editor-rich-content-authoring.test.mjs`
- Modify: `tests/editor-assets-metrics.test.mjs`
- Modify: `tests/editor-data-inspectors.test.mjs`

Factories wrap existing semantic blocks only:
- Metric → `stat-group`
- Chart → `chart`
- Table → `table`
- Image → `image`
- Legend → `legend`

- [ ] Write failing tests that each factory produces a valid Story 1.2 envelope whose nested block is accepted by existing descriptors.
- [ ] Assert no new content block type and no raw Chart.js config.
- [ ] Reuse existing metrics/tables/assets/attribution catalogs; Image uses declared asset + `contain`; no crop; no arbitrary table-cell/chart-internal styling.
- [ ] Run RED, implement minimal factories/Properties, run GREEN including existing content renderer tests.
- [ ] Commit: `feat: author rich Story 1.2 objects`.

## Task C2: Add immediately production-valid template factories

**Files:**
- Create: `editor/core/templates.js`
- Modify: `editor/core/package-store.js` so default New delegates to Blank template
- Create: `tests/editor-templates.test.mjs`
- Modify: `tests/template-use-cases.test.mjs`
- Modify: `tests/project-loader.test.mjs`

**Functions:**

```js
createBlankMapStoryTemplate(options)
createRouteProposalTemplate(options)
createNetworkServicePlanTemplate(options)
```

- [ ] Write failing tests that mount each returned package via existing package fetch and call unchanged `loadProject(...)` immediately. No invalid intermediate starter is allowed.
- [ ] Blank: one empty Story 1.2 Scene; no route capability/sample transport data.
- [ ] Route Proposal: approved five Scenes. Use the deterministic approach of creating two valid empty line `FeatureCollection` resources with `route.existing` and `route.proposed` roles and bounded render descriptors, then declare `route-comparison-v1`; all Scene layer snapshots contain both IDs. This satisfies current required capability roles while remaining neutral.
- [ ] Network/service plan: neutral Story 1.2 starter Scenes/layers with no unsatisfied capability roles.
- [ ] Assert no `templateId` or template metadata persists.
- [ ] Run RED, implement, run GREEN:

```powershell
node --test tests/editor-templates.test.mjs tests/template-use-cases.test.mjs tests/project-loader.test.mjs
```

- [ ] Commit: `feat: add production-valid Studio templates`.

## Task C3: Add template chooser and Import Existing using certified storage paths

**Files:**
- Modify: `editor/index.html`
- Modify: `editor/editor.js`
- Modify: `editor/ui/studio-shell.js`
- Modify: `tests/editor-authoring-flow.test.mjs`
- Modify: `tests/editor-folder-storage.test.mjs`
- Modify: `tests/editor-zip-storage.test.mjs`

- [ ] Write failing tests for Blank / Route proposal / Network-service creation and Import Existing routing to current Open Folder / Import ZIP adapters.
- [ ] Do not add template runtime behavior, a new package format, or a new storage adapter.
- [ ] Implement chooser as template factory selection or certified import path.
- [ ] Run GREEN with authoring + folder/ZIP focused tests.
- [ ] Commit: `feat: add Studio project template chooser`.

## Task C4: Extract Route 61-2 behavior into trusted compatibility adapter

**Files:**
- Create: `src/route-61-2/runtime-adapter.js`
- Create: `src/route-61-2/controls.js`
- Modify: `src/app.js`
- Modify: `src/capabilities/route-comparison-v1.js`
- Modify: `src/capabilities/urban-context-v1.js`
- Create: `tests/route-61-2-runtime-adapter.test.mjs`
- Modify: `tests/route-61-2-project.test.mjs`
- Modify: `tests/special-capability-boundary.test.mjs`

- [ ] First capture current certified route mode/reveal/POI/urban/simulation behavior in focused tests.
- [ ] Add failing source-boundary tests: generic runtime/shell modules cannot import Route 61-2 adapter/data; trusted capabilities may select the adapter only from installed trusted code for `settings.adapter === 'route-61-2-current'`.
- [ ] Run RED on new boundary assertions.
- [ ] Extract before redesigning. Prefer `project.resources` for existing/proposed route/stops/industrial geometry already present in `project.json`; do not reconstruct those ordinary datasets from hardcoded arrays.
- [ ] If ordinary POI geometry is still trapped in code and cleanly fits existing GeoJSON project resources, move it into a bounded `data/route-61-2/*.geojson` resource plus `project.json`; executable simulation/controller logic remains trusted code.
- [ ] Do not add a new capability merely for naming. Only split transport POI capability if ownership cannot remain coherent without changing generic code; preserve legacy action types/normalizers.
- [ ] Run GREEN with route/capability/Story byte tests.
- [ ] Commit: `refactor: isolate Route 61-2 runtime adapter`.

## Task C5: Move route controls into capability host and promote neutral shell to root

**Files:**
- Modify: root `index.html`
- Modify: root `styles.css` or replace generic portions with neutral runtime CSS imports
- Modify: `src/app.js`
- Modify: `src/runtime/generic-app.js`
- Modify: `src/runtime/generic-shell.js`
- Delete: temporary `src/runtime/index.html` after root promotion
- Modify: `src/route-61-2/controls.js`
- Modify: `src/project/bootstrap.js` only if a narrow trusted control-host lifecycle context is required
- Create: `tests/generic-shell-neutrality.test.mjs`
- Modify: `tests/story-shell-markup.test.mjs`
- Modify: `tests/route-61-2-project.test.mjs`
- Modify: `tests/editor-shell-preview.test.mjs`

- [ ] Write failing root neutrality test: no `61-2`, Existing/Proposed/Difference tabs, transport metrics, simulation, industrial/urban controls in static generic shell.
- [ ] Write Route 61-2 test proving trusted controls still mount from capability/adapter code when that project loads.
- [ ] Run RED.
- [ ] Promote the neutral shell to root; make `src/app.js` generic entry or thin delegator. Capability controls mount into neutral host through trusted runtime lifecycle; project JSON remains data/settings only.
- [ ] Point Story 1.0/1.1 and 1.2 editor preview at the same root shell and remove the temporary version-based preview URL split.
- [ ] Generic root modules must not import Route 61-2 adapter/data.
- [ ] Run GREEN:

```powershell
node --test tests/generic-shell-neutrality.test.mjs tests/story-shell-markup.test.mjs tests/route-61-2-project.test.mjs tests/special-capability-boundary.test.mjs tests/editor-shell-preview.test.mjs
```

- [ ] Commit: `feat: make the production shell project-neutral`.

## Task C6: PR C rich/template/Route certification gate

**Files:**
- Modify: `scripts/map-story-studio-browser-smoke.mjs`
- Modify: `tests/editor-certification.test.mjs`

- [ ] Add `--gate=pr-c`: all rich object families; all templates immediately valid; folder/ZIP reopen; blank root neutral; Route 61-2 through same root with trusted route/POI/urban/simulation behavior; one map; clean console; targeted 390×844 legacy production smoke.
- [ ] Verify neutral root path does not require Route 61-2 modules.
- [ ] Focused tests green, then `npm test` once.
- [ ] `git diff --check`; modified-source syntax; canonical Story diff empty:

```powershell
git diff 119ed58d5d57e38474fee192effe9028e6a0c2d7 -- data/stories/route-61-2.story.json
```

- [ ] Run browser once:

```powershell
node scripts/map-story-studio-browser-smoke.mjs --gate=pr-c --url=http://127.0.0.1:8080/editor/
```

Expected: `MAP_STORY_STUDIO_PR_C_RESULT: PASS`.

- [ ] Commit: `test: certify Map Story Studio PR C`.
- [ ] Open Draft PR C and stop for review.

---

# PR D — Desktop Outputs + Final Certification

## Task D1: Add Scroll Story as a navigation adapter over the shared runtime

**Files:**
- Create: `src/runtime/scroll-story.js`
- Modify: `src/runtime/generic-shell.js`
- Create: `tests/scroll-story.test.mjs`
- Modify: `tests/story-shell-controller.test.mjs`

- [ ] Write failing tests: ordered scroll steps activate `storyRuntime.activate(index)`; backward scrolling re-enters cleanly; cooperative map gestures do not trap page scroll; one map; no duplicate action execution.
- [ ] Run RED.
- [ ] Implement IntersectionObserver/navigation only. Reuse Story runtime, Scene-state controller, compositor, layer registry, and capability instances.
- [ ] Run GREEN.
- [ ] Commit: `feat: add Story 1.2 scroll storytelling output`.

## Task D2: Add Presentation mode and editor Preview Story/Present commands

**Files:**
- Create: `src/runtime/presentation-mode.js`
- Modify: `src/runtime/generic-shell.js`
- Modify: `editor/preview/bridge.js`
- Modify: `editor/editor.js`
- Modify: `editor/ui/studio-shell.js`
- Create: `tests/presentation-mode.test.mjs`
- Modify: `tests/presentation.test.mjs`
- Modify: `tests/editor-shell-preview.test.mjs`
- Modify: `tests/editor-validation.test.mjs`

- [ ] Write failing Presentation tests: exact 16:9 stage; Next/Previous; Arrow/Page keys; Escape; letterbox/pillarbox on non-16:9; same compositor geometry/controller/runtime.
- [ ] Write editor tests: valid unsaved package launches Preview Story/Present from `validation.lastValid.snapshot`; invalid current draft keeps/launches prior valid revision with explicit status.
- [ ] Run RED.
- [ ] Implement Presentation as navigation adapter only; add exact bounded output-mode preview command(s), not a second Story model/runtime.
- [ ] Run GREEN.
- [ ] Commit: `feat: add Story 1.2 presentation output`.

## Task D3: Lock Story 1.2 folder/ZIP round-trip persistence

**Files:**
- Create: `tests/story-1.2-persistence.test.mjs`
- Modify: `tests/editor-folder-storage.test.mjs`
- Modify: `tests/editor-zip-storage.test.mjs`
- Modify: `tests/editor-certification.test.mjs`

- [ ] Build a test package with two Scenes, distinct cameras/layer snapshots, Text, Metric, Chart, Table, Image, Legend.
- [ ] Save/export → reopen/import → unchanged `loadProject(...)` → deep-compare authored Story values.
- [ ] Assert no history/selection/handles/preview state in package.
- [ ] Assert existing untouched Story 1.0/1.1 byte-preservation tests remain green.
- [ ] Fix persistence only if the test exposes loss; do not revise Story 1.2 schema.
- [ ] Commit: `test: lock Story 1.2 persistence round trip`.

## Task D4: Final browser/performance certification and report

**Files:**
- Modify: `scripts/map-story-studio-browser-smoke.mjs`
- Create: `review/map-story-studio-v1-1/REPORT.md`
- Modify: `tests/editor-certification.test.mjs` only for deterministic source/package invariants

`--gate=pr-d` covers exactly:

1. neutral Blank Story 1.2, one map, no Route controls;
2. multi-Scene 16:9 composition at 1920×1080 and 1366×768;
3. Fly/Ease/Instant + reduced motion;
4. complete layer restoration forward/backward;
5. Text + Metric + Chart + Table + Image + Legend rendering/accessibility;
6. Scroll Story forward/backward activation;
7. Presentation next/previous/keyboard/Escape;
8. valid-unsaved and invalid-last-valid editor preview behavior;
9. folder/ZIP reopen;
10. Route 61-2 through same neutral shell with trusted effects;
11. Story 1.0/1.1 390×844 production regression;
12. one MapLibre canvas per active output and clean console.

- [ ] Add lightweight settled FPS sampling only at the final gate. Do not run repeated profiling loops. Capture one comparable sample per certified desktop viewport using existing Route 61-2 benchmark content.
- [ ] Do not fabricate an FPS pass if hardware/browser variance prevents direct comparison; report raw samples plus map-count/lifecycle evidence. Intended target remains smooth ~60-FPS-class settled presentation where the same environment can sustain it.
- [ ] Focused output/persistence tests green, then `npm test` once.
- [ ] Run browser once:

```powershell
node scripts/map-story-studio-browser-smoke.mjs --gate=pr-d --url=http://127.0.0.1:8080/editor/
```

Expected: `MAP_STORY_STUDIO_PR_D_RESULT: PASS`.

- [ ] Write report with exact base/head, commands/counts, viewport evidence, performance samples, Route Story digest/diff, console result, package round-trip evidence.
- [ ] Commit: `test: certify Map Story Studio V1.1 desktop`.

## Task D5: Architecture audit and V1.1 desktop lock

**Files:**
- Modify: `docs/baseline-authoring-contract-v1.md` additively to record Story 1.2 certification; do not rewrite V1 history
- Modify: `docs/story-runtime-v1.md`
- Modify: `review/map-story-studio-v1-1/REPORT.md`

- [ ] Run architecture searches:

```powershell
git grep -n "route-61-2\|Existing\|Proposed\|Difference" -- index.html src/runtime src/scene
git grep -n "map\.set-visibility" -- editor
git grep -n "innerHTML\|eval(\|new Function" -- editor src/scene src/runtime
git diff 119ed58d5d57e38474fee192effe9028e6a0c2d7 -- data/stories/route-61-2.story.json
git diff --check
```

Expected:
- neutral shell/runtime/scene modules have no Route 61-2 assumptions;
- normal Story 1.2 Layers authoring has no `map.set-visibility` creation;
- no unsafe executable/HTML sink introduced;
- canonical Route Story diff empty;
- diff check clean.

- [ ] If only docs/report changed since D4, run the targeted doc/source invariant tests; if any executable/test file changed, rerun `npm test` before claiming completion.
- [ ] Record final markers:

```text
BASELINE_AUTHORING_CONTRACT_V1: LOCKED
STORY_SCHEMA_1_2: CERTIFIED
GUI_ONLY_SCHEMA: NONE
PRODUCTION_PREVIEW_COMPOSITION: SHARED
GENERIC_SHELL_ROUTE_ASSUMPTIONS: NONE
ONE_MAP_PRINCIPLE: PASS
LEGACY_STORY_1_0_1_1: PASS
LEGACY_MOBILE_390x844: PASS
MAP_STORY_STUDIO_V1_1_DESKTOP_CERTIFICATION_RESULT: PASS
```

- [ ] Commit: `docs: lock Map Story Studio V1.1 desktop`.
- [ ] Open Draft PR D with certification evidence and stop for human review/merge.

---

# Review Gates

## Gate A — Contract/Foundation

Reject PR A unless:
- complete Story 1.2 schema including envelopes exists;
- every accepted envelope has deterministic read-only production rendering;
- `loadProject(...)` accepts 1.2 directly;
- Scene baseline/action order is deterministic;
- new layers update all 1.2 Scene visibility snapshots in one synchronous editor command;
- New Project defaults 1.2;
- map movement alone does not author camera;
- neutral blank runtime has no Route assumptions;
- Story 1.0/1.1 and canonical Route Story remain intact.

## Gate B — Text Proof

Reject PR B unless:
- Story 1.2 schema files are unchanged from merged PR A;
- Text authoring is canvas-first and production-data-backed;
- one drag/resize produces one authored command at interaction end;
- direct edit stores plain semantic text only;
- undo/redo excludes UI-only state;
- keyboard alternatives exist for primary operations.

## Gate C — Product Breadth / Neutrality

Reject PR C unless:
- rich objects reuse existing descriptors/renderers;
- every template is immediately production-valid;
- root shell is neutral;
- Route 61-2 controls/behavior are trusted capability/adapter-owned;
- blank root path does not require Route 61-2 modules;
- canonical Story 1.0 remains byte-identical.

## Gate D — Desktop Lock

Reject PR D unless:
- Scroll Story and Presentation use the same Story/runtime/controller/compositor;
- 1920×1080 and 1366×768 are certified;
- one map per output;
- Story 1.2 save/export/reopen passes;
- Story 1.0/1.1 390×844 production smoke passes;
- browser console is clean;
- final report contains reproducible commands/evidence.

## Explicitly Deferred After V1.1

Do not pull into PR A–D:
- mobile Studio/editor or Story 1.2 mobile-specific layout;
- arbitrary shapes/freehand/vector tools;
- rotation/grouping/master slides/SmartArt;
- image crop/focal point;
- collaboration/cloud CMS;
- GIS route drawing/snapping/spatial analysis;
- arbitrary CSS/JS/MapLibre expressions;
- template runtime semantics;
- general Story 1.0/1.1 migration tooling.

## Completion Rule

After PR D is reviewed/merged and the certification report is accepted, Map Story Studio V1.1 Desktop is locked. Mobile adaptation or substantial new authoring vocabulary starts with a new design/spec rather than silently extending this plan.