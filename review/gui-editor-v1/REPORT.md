# GUI Editor V1 — PR C Certification

## Revision and environment

- Required base/main SHA: `cd1091dfb301ccbade5b7433a690ef1605b5391f`
- Branch: `feat/gui-editor-v1-persistence`
- Head at fresh evidence capture, before this report commit: `308a28882a3e3525d12f670421477ca329a1e8e0`
- Draft PR head: recorded by GitHub after the Task 17 documentation commit.
- CI: [branch workflow runs](https://github.com/longpsu-bot/bandoxebus/actions?query=branch%3Afeat%2Fgui-editor-v1-persistence); final rerun follows the cross-platform checkout-line-ending certification fix.

## Task evidence

### Task 13 — bounded folder persistence

- Focused tests: 26/26 PASS.
- Folder Open reads `project.json` first and walks only declared paths by explicit segments.
- Recursive enumeration calls: 0.
- Unknown sentinel read: no.
- Deterministic Save: changed resources in lexical order, then `project.json` last.
- Partial failure: PASS; a resource failure skips `project.json` and only successful writes are marked clean.
- Browser Route fixture access: reads were `project.json`, `data/stories/route-61-2.story.json`, the four declared route/stop GeoJSON files, and `data/industrial-zone-poc.geojson`; writes were only `project.json`; enumeration count was 0.

### Task 14 — safe ZIP persistence

- Focused tests: 24/24 PASS.
- Runtime dependency: official `fflate` 0.8.3 browser ESM, vendored with its MIT license.
- npm integrity: `sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA==` — verified.
- Traversal/absolute/backslash/drive/executable paths: REJECTED.
- Exact and normalized duplicate names: REJECTED before path-map collapse.
- Import limits: 2,048 entries, 64 MiB per decompressed entry, 256 MiB total.
- Unknown safe payload: PRESERVED; browser pass-through SHA-256 `42b40d262f94710cbdd1c65ab4e4118216c3ef56491b9b54fc0b4b5e796c913a`.
- Export contains project content only; no editor/runtime files or private state.

### Task 15 — accessibility and security

- Focused tests: 22/22 PASS.
- Keyboard ordering, focus restoration, and live position announcements: PASS.
- Persistent labels/help/error associations and narrow-layout operability: PASS.
- Diagnostic-to-control navigation and invalid-known-JSON source repair: PASS.
- Authored rendering uses bounded native semantics and text-only assignments: PASS.
- Preview protocol enforces exact origin/source, exact envelopes, request correlation, monotonic revisions, bounded packages, and bounded runtime errors: PASS.
- Reduced-motion viewport context: PASS.
- Already-loaded/reset iframe handshake regression: PASS.
- Prohibited executable/unsafe sink scans: CLEAN.

### Task 16 — production-package and Route 61-2 regressions

- Focused tests: 25/25 PASS.
- Route Story SHA-256: `29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a`.
- The fixed digest is calculated over canonical CRLF certification bytes so Linux and Windows checkouts prove the same required artifact; before/after working-tree bytes are also asserted exactly equal.
- Unrelated Save byte preservation: PASS.
- Supported Story 1.0 edit retains `schemaVersion: "1.0"` and exact legacy actions: PASS.
- Exported package accepted by unchanged `loadProject`: PASS.
- Exported package mounted at normal production `/` without editor translation/bootstrap: PASS.

## Task 17 — seven-scenario browser certification

Command: `node scripts/editor-browser-smoke.mjs --gate=pr-c --url=http://127.0.0.1:8080/editor/`

Result marker: `GUI_EDITOR_V1_BROWSER_RESULT: PASS`

1. Ordinary GUI-authored project: PASS — line, point, polygon, normalized table, static metric, image, focus/actions, table/chart/image/legend, desktop/mobile, and one map.
2. Capability policy: PASS — existing installed declaration is editable; Route-specific non-addable packs are absent from generic Add.
3. Route 61-2: PASS — 32 Story 1.0 legacy controls remain read-only; unrelated Save preserves the Story hash; Story/Explore/re-entry, explicit legacy alias, three transport POI beacons, and one map pass.
4. Valid/invalid/repair: PASS — last-valid preview is retained; first-ever invalid has zero maps and a neutral paused state; repair advances to one-map revision 1.
5. Folder boundary: PASS — declared reads only, unknown sentinel untouched, `project.json` only write, zero enumeration.
6. ZIP safety/pass-through: PASS — traversal and duplicate fixtures rejected; unknown safe bytes preserved with the SHA above.
7. Exported package: PASS — unchanged production `/` mounts at desktop 1920×1080 and mobile 390×844 with accessible table/chart/image/legend, Story/Explore re-entry, query-alias compatibility, one MapLibre canvas, and a clean console.

MapLibre preview/runtime instances: 1 in every certified scenario.

Browser console: CLEAN (zero unexpected errors).

## Final regression and architecture audit

- New managed folder resource focused tests: 28/28 PASS.
- Newly authored resource is dirty before Save and remains in the change set until its write succeeds.
- Missing nested folder segments and the resource file are explicitly created; existing files continue to open without create permission.
- New resource bytes are written before `project.json`; recursive enumeration calls: 0.
- Failed new-resource creation skips `project.json` and retains both dirty entries and their bytes.
- Reopen through the Folder adapter resolves the created resource with the unchanged production loader.
- Full `npm test`: 364/364 PASS, zero failures.
- Established source syntax: 24/24 PASS.
- `git diff --check`: PASS.
- Route Story diff from the required base: empty.
- Story 1.0 silent migration: NO.
- Raw MapLibre authoring: NO.
- Raw Chart.js configuration: NO.
- Arbitrary executable configuration: NO.
- Folder recursive enumeration: NO.
- ZIP traversal and normalized duplicates: REJECTED.
- Unknown ZIP safe pass-through: PRESERVED.

NEW_MANAGED_FOLDER_RESOURCE_SAVE: PASS

BASELINE_AUTHORING_CONTRACT_V1: LOCKED

GUI_ONLY_SCHEMA: NONE

PRODUCTION_PREVIEW_COMPOSITION: SHARED

NEW_RUNTIME_DEPENDENCY: fflate 0.8.3 vendored ESM

GUI_EDITOR_V1_CERTIFICATION_RESULT: PASS
