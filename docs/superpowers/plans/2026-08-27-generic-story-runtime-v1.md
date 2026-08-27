# Generic Story Runtime V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move Route 61-2 ordering, content, and state map behavior into validated JSON consumed by a generic story runtime while preserving the certified presentation.

**Architecture:** A small validator, action runner, and state runtime consume a versioned serializable definition. The presentation renderer consumes structured blocks, while a Route 61-2 adapter maps explicit action types onto existing application capabilities.

**Tech Stack:** Browser ES modules, MapLibre GL JS 5.24.0, JSON Schema Draft 2020-12, Node.js built-in test runner

**Spec:** `docs/story-runtime-v1.md`

## Global Constraints

- Preserve the seven-state story wording, visual shell, MapLibre/Overture behavior, bus simulation, comparison modes, reduced motion, and cached re-entry.
- Story configuration contains data only and uses `schemaVersion: "1.0"`.
- Runtime modules contain no Route 61-2-specific names or state semantics.
- No GUI, scroll storytelling shell, new visualization library, or broad map subsystem refactor.
- Every production behavior change follows red-green-refactor.

---

### Task 1: Story schema and validation

**Files:**
- Create: `data/stories/story.schema.json`
- Create: `src/story-schema.js`
- Create: `tests/story-schema.test.mjs`

**Interfaces:**
- Produces: `validateStoryDefinition(definition, { supportedActionTypes? } = {})` returning the validated definition or throwing `StoryValidationError`.

- [x] **Step 1: Write failing validation tests** for a minimal valid story and rejection of missing/unsupported schema versions, empty states, duplicate IDs, malformed blocks, malformed actions, and unsupported action types.
- [x] **Step 2: Run `node --test tests/story-schema.test.mjs`** and confirm failure because `src/story-schema.js` does not exist.
- [x] **Step 3: Add the JSON Schema and minimal runtime validator** with precise path-oriented errors and the six V1 block types.
- [x] **Step 4: Re-run `node --test tests/story-schema.test.mjs`** and confirm all validation cases pass.
- [x] **Step 5: Commit** with `test: define story schema validation`.

### Task 2: Generic action runner and state runtime

**Files:**
- Create: `src/story-action-runner.js`
- Create: `src/story-runtime.js`
- Create: `tests/story-runtime.test.mjs`

**Interfaces:**
- Consumes: validated story objects from `validateStoryDefinition`.
- Produces: `createStoryActionRunner(handlers)` with `run(actions, context)` and `StoryActionError`; `createStoryRuntime({ definition, actionRunner })` with `activate`, `deactivate`, `next`, `previous`, `goTo`, `currentState`, `currentContent`, `currentIndex`, and `active`.

- [x] **Step 1: Write failing runtime tests** proving config order (A/B/C and C/A/B), config-controlled content, arbitrary IDs, action declaration order, exit-before-enter, direct ID/index navigation, clear unknown-action failure, boundary clamping, same-state no-op, and clean A/B/A/B re-entry counts.
- [x] **Step 2: Run `node --test tests/story-runtime.test.mjs`** and confirm the missing-module failure.
- [x] **Step 3: Implement the minimal registry dispatcher and lifecycle runtime** without importing project files or interpreting IDs.
- [x] **Step 4: Re-run `node --test tests/story-runtime.test.mjs`** and confirm all runtime cases pass.
- [x] **Step 5: Commit** with `feat: add generic story lifecycle runtime`.

### Task 3: Structured content renderer and Route 61-2 JSON

**Files:**
- Create: `data/stories/route-61-2.story.json`
- Modify: `src/presentation-renderer.js`
- Modify: `tests/presentation-renderer.test.mjs`
- Modify: `tests/presentation-content.test.mjs`
- Remove: `src/presentation-content.js`

**Interfaces:**
- Consumes: `state.content.blocks` plus the existing presentation metrics object.
- Produces: `renderPresentationContent(container, state, metrics, documentRef)` preserving existing CSS classes and safe `textContent` rendering.

- [x] **Step 1: Rewrite renderer/content tests first** to load JSON and prove heading/paragraph changes render from the fixture, all seven canonical states retain wording/order, all V1 blocks render, and presenter notes remain hidden.
- [x] **Step 2: Run the two focused test files** and confirm failure because the old object-shaped content renderer cannot consume blocks.
- [x] **Step 3: Add the seven-state JSON and block renderer** using only structured data; remove the JavaScript story constant.
- [x] **Step 4: Re-run focused tests** and confirm green with unchanged rendered semantics.
- [x] **Step 5: Commit** with `feat: migrate Route 61-2 content to story JSON`.

### Task 4: Route 61-2 action adapter and shell integration

**Files:**
- Create: `src/route-61-2-story-actions.js`
- Create: `tests/route-61-2-story-actions.test.mjs`
- Modify: `src/app.js`
- Modify: `src/presentation.js`
- Modify: `tests/presentation.test.mjs`

**Interfaces:**
- Consumes: dependency functions `setMode`, `focus`, `setPoiEmphasis`, `setUrbanContext`, and `setRouteReveal`.
- Produces: `createRoute612StoryActionHandlers(capabilities)` keyed by the five documented action types.

- [x] **Step 1: Write failing adapter tests** proving each explicit descriptor maps to the correct project capability and `route.reveal` supports start/cancel without accumulated work.
- [x] **Step 2: Run the adapter test** and confirm the missing-module failure.
- [x] **Step 3: Implement the thin adapter**, keeping generic dispatch free of project semantics.
- [x] **Step 4: Update app integration** to fetch/validate JSON, construct the runner/runtime, build dots from runtime states, navigate through runtime methods, execute lifecycle actions, and retain close/Escape/manual mode behavior.
- [x] **Step 5: Replace reducer tests with shell-independent camera tests and run all focused presentation/runtime tests** until green.
- [x] **Step 6: Commit** with `feat: drive presentation shell from story runtime`.

### Task 5: Documentation, config-only proof, and certification

**Files:**
- Modify: `README.md`
- Modify: `docs/story-runtime-v1.md`
- Create: `review/generic-story-runtime-v1/REPORT.md`

**Interfaces:**
- Produces: certification evidence and operator documentation; no new runtime interface.

- [x] **Step 1: Run `npm test`** and record the exact total and failures.
- [x] **Step 2: Perform the config-only reorder experiment** by swapping two states in JSON, exercise order/navigation without JS changes, then restore the canonical order.
- [x] **Step 3: Perform the config-only content experiment** by changing one heading in JSON, confirm renderer output changes without JS changes, then restore certified text.
- [x] **Step 4: Run the browser smoke/performance harness** at 1920×1080 and 1366×768, covering all states, forward/back/Escape, cached re-entry, POIs, Overture, buses, comparisons, reduced motion, console, FPS, and settled source mutations.
- [x] **Step 5: Run a runtime purity scan** for Route 61-2 names and semantic slide assumptions in generic modules.
- [x] **Step 6: Update README and write the review-gate report** with exact evidence and limitations.
- [x] **Step 7: Run fresh `npm test`, inspect `git diff --check`, and commit** with `docs: certify generic story runtime v1`.
