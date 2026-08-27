# Map Story Shell POC V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This project explicitly requires one agent, parallel agents off, and subagents off.

**Goal:** Add an opt-in, scroll-first Map Story Shell POC that consumes the existing Generic Story Runtime, story JSON, structured content renderer, Route 61-2 action adapter, and persistent MapLibre instance across projector, desktop, laptop, tablet, and phone layouts.

**Architecture:** Add a generic `src/story-shell.js` controller around native `IntersectionObserver`, plus a focused `src/story-map-interactions.js` policy for guided MapLibre gestures. The application composition root selects the POC only for `?storyShell=poc`; otherwise it binds the unchanged legacy presentation. All observer, button, keyboard, and programmatic navigation converges on `activateStoryState(index, options)`, which alone calls `storyRuntime.goTo(index)`.

**Tech Stack:** Static ES modules, Node.js 24 built-in test runner, native DOM and `IntersectionObserver`, MapLibre GL JS 5.24.0, plain HTML/CSS, local browser responsive emulation.

**Spec:** `docs/superpowers/specs/2026-08-27-map-story-shell-poc-v1-design.md`

## Global Constraints

- Continue on `feat/map-story-shell-poc-v1` and update draft PR #2; do not merge it.
- Use strict RED -> verify expected failure -> GREEN -> verify pass -> refactor -> commit for every behavior change.
- Keep `data/stories/route-61-2.story.json`, `data/stories/story.schema.json`, `src/story-schema.js`, `src/story-runtime.js`, `src/story-action-runner.js`, and `src/route-61-2-story-actions.js` unchanged.
- If one of those contracts proves insufficient, stop implementation and request an explicit architecture review; do not include an opportunistic contract change.
- Keep one story definition, one runtime instance, one action runner, one content renderer, and one persistent MapLibre instance.
- Retain the legacy presentation path when `?storyShell=poc` is absent.
- Do not add Scrollama, a bundler, a general feature-flag system, browser automation to CI, or device/user-agent-specific content or cameras.
- Never attach map mutation to raw scroll progress; add no raw `scroll` handler, continuous `setData()`, continuous `triggerRepaint()`, or per-frame story calculation.
- Respect `prefers-reduced-motion`; shell content changes and programmatic scrolling become immediate/minimal while existing camera and route-reveal behavior remains authoritative.
- Use arbitrary IDs such as `alpha`, `banana`, and `state-999` in generic shell tests.
- Keep browser transition measurements separate from settled performance measurements.

## Locked interfaces and constants

`src/story-shell.js` will export:

```js
export const STORY_ACTIVATION_LINE_RATIO = 0.45;
export const STORY_RATIO_TIE_EPSILON = 0.01;
export function isStoryShellPocEnabled(search);
export function normalizeStoryIndex(index, stateCount);
export function adjacentStoryIndex(index, direction, stateCount);
export function selectActiveStoryStep(entries, options);
export function renderStorySteps(options);
export function storyNavigationIntent(event);
export function isInteractiveStoryTarget(target);
export function createStoryShell(options);
```

`createStoryShell(options)` consumes:

```js
{
  runtime,
  elements: {
    root,
    steps,
    progressCurrent,
    progressTotal,
    previousButton,
    nextButton,
    exitButton
  },
  renderContent,
  metrics,
  documentRef = document,
  windowRef = window,
  observerFactory = (callback, options) => new IntersectionObserver(callback, options),
  interactionPolicy = { enter() {}, exit() {} },
  onActivate = () => {},
  onExit = () => {},
  reducedMotion = false
}
```

It produces this frozen controller:

```js
{
  get active(),
  get sections(),
  enter(),
  exit(),
  activateStoryState(index, { scroll = false } = {})
}
```

`src/story-map-interactions.js` will export:

```js
export const GUIDED_HANDLER_NAMES = Object.freeze([
  'scrollZoom',
  'dragPan',
  'touchZoomRotate',
  'boxZoom',
  'doubleClickZoom'
]);
export function createGuidedMapInteractionPolicy(map, handlerNames = GUIDED_HANDLER_NAMES);
```

`src/presentation.js` will additionally export:

```js
export function buildStoryLayoutPadding({ mapRect, storyRect, stacked });
```

The selection algorithm is shell-owned and fixed for V1:

1. Filter to entries with `isIntersecting === true`, `intersectionRatio > 0`, and a finite `data-story-state-index`.
2. Prefer the greatest `intersectionRatio`.
3. Treat ratios within `STORY_RATIO_TIE_EPSILON` (`0.01`) as effectively tied.
4. For tied candidates, compare each entry center with `viewportHeight * STORY_ACTIVATION_LINE_RATIO` (`45%` from the top).
5. If distances are equal, choose the lowest document/config index.
6. Return `null` when no candidate intersects.

The 45% line is slightly above viewport center so the next card becomes active after it is clearly readable without waiting for it to pass halfway down the viewport. The ratio-first policy remains stable for cards of different heights; the line and index tie-breakers make fast flings deterministic. These constants stay in shell code, not JSON or Story Schema V1.

---

### Task 1: Add generic story state-selection primitives

**Files:**
- Create: `src/story-shell.js`
- Create: `tests/story-shell-selection.test.mjs`

**Interfaces:**
- Consumes: `URLSearchParams`, `IntersectionObserverEntry`-shaped objects with `target.dataset.storyStateIndex`, `intersectionRatio`, `isIntersecting`, and `boundingClientRect`.
- Produces: `STORY_ACTIVATION_LINE_RATIO`, `STORY_RATIO_TIE_EPSILON`, `isStoryShellPocEnabled(search)`, `normalizeStoryIndex(index, stateCount)`, `adjacentStoryIndex(index, direction, stateCount)`, and `selectActiveStoryStep(entries, { viewportHeight, activationLineRatio, ratioTieEpsilon })`.

- [ ] **Step 1: Write failing selection, boundary, and query-gate tests**

Create `tests/story-shell-selection.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as shell from '../src/story-shell.js';

function entry(index, { ratio, top, bottom, intersecting = true }) {
  return {
    isIntersecting: intersecting,
    intersectionRatio: ratio,
    boundingClientRect: { top, bottom, height: bottom - top },
    target: { dataset: { storyStateIndex: String(index) } }
  };
}

test('POC query gate requires the exact storyShell=poc value', () => {
  assert.equal(shell.isStoryShellPocEnabled('?storyShell=poc'), true);
  assert.equal(shell.isStoryShellPocEnabled('?x=1&storyShell=poc'), true);
  assert.equal(shell.isStoryShellPocEnabled(''), false);
  assert.equal(shell.isStoryShellPocEnabled('?storyShell=legacy'), false);
});

test('story indices clamp without knowing state IDs', () => {
  assert.equal(shell.normalizeStoryIndex(-5, 3), 0);
  assert.equal(shell.normalizeStoryIndex(1.9, 3), 1);
  assert.equal(shell.normalizeStoryIndex(99, 3), 2);
  assert.equal(shell.adjacentStoryIndex(0, -1, 3), 0);
  assert.equal(shell.adjacentStoryIndex(2, 1, 3), 2);
  assert.equal(shell.adjacentStoryIndex(1, -1, 3), 0);
});

test('greatest visible ratio wins before activation-line distance', () => {
  const selected = shell.selectActiveStoryStep([
    entry(0, { ratio: 0.35, top: 200, bottom: 500 }),
    entry(1, { ratio: 0.72, top: 500, bottom: 800 })
  ], { viewportHeight: 1000 });
  assert.equal(selected, 1);
});

test('effectively tied ratios use center distance to the 45 percent activation line', () => {
  const selected = shell.selectActiveStoryStep([
    entry(0, { ratio: 0.605, top: 100, bottom: 500 }),
    entry(1, { ratio: 0.60, top: 300, bottom: 700 })
  ], { viewportHeight: 1000 });
  assert.equal(selected, 0);
});

test('an exact tie uses deterministic configuration order and ignores non-intersections', () => {
  const selected = shell.selectActiveStoryStep([
    entry(2, { ratio: 0.6, top: 250, bottom: 650 }),
    entry(1, { ratio: 0.6, top: 250, bottom: 650 }),
    entry(0, { ratio: 1, top: 0, bottom: 900, intersecting: false })
  ], { viewportHeight: 1000 });
  assert.equal(selected, 1);
  assert.equal(shell.selectActiveStoryStep([], { viewportHeight: 1000 }), null);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/story-shell-selection.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/story-shell.js`.

- [ ] **Step 3: Implement the minimal pure primitives**

Create `src/story-shell.js` with only these primitives first:

```js
export const STORY_ACTIVATION_LINE_RATIO = 0.45;
export const STORY_RATIO_TIE_EPSILON = 0.01;

export function isStoryShellPocEnabled(search = '') {
  return new URLSearchParams(search).get('storyShell') === 'poc';
}

export function normalizeStoryIndex(index, stateCount) {
  if (!Number.isInteger(stateCount) || stateCount < 1) {
    throw new RangeError('Story state count must be a positive integer.');
  }
  const numericIndex = Number(index);
  if (!Number.isFinite(numericIndex)) throw new TypeError('Story index must be finite.');
  return Math.max(0, Math.min(stateCount - 1, Math.trunc(numericIndex)));
}

export function adjacentStoryIndex(index, direction, stateCount) {
  return normalizeStoryIndex(normalizeStoryIndex(index, stateCount) + Math.sign(direction), stateCount);
}

export function selectActiveStoryStep(entries, {
  viewportHeight,
  activationLineRatio = STORY_ACTIVATION_LINE_RATIO,
  ratioTieEpsilon = STORY_RATIO_TIE_EPSILON
} = {}) {
  const activationLine = viewportHeight * activationLineRatio;
  const candidates = entries
    .filter(({ isIntersecting, intersectionRatio, target }) => (
      isIntersecting && intersectionRatio > 0
      && Number.isFinite(Number(target?.dataset?.storyStateIndex))
    ))
    .map((entry) => ({
      entry,
      index: Number(entry.target.dataset.storyStateIndex),
      distance: Math.abs(
        ((entry.boundingClientRect.top + entry.boundingClientRect.bottom) / 2) - activationLine
      )
    }))
    .sort((a, b) => {
      const ratioDelta = b.entry.intersectionRatio - a.entry.intersectionRatio;
      if (Math.abs(ratioDelta) > ratioTieEpsilon) return ratioDelta;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.index - b.index;
    });
  return candidates[0]?.index ?? null;
}
```

- [ ] **Step 4: Verify GREEN and source syntax**

Run:

```powershell
node --test tests/story-shell-selection.test.mjs
node --check src/story-shell.js
```

Expected: all focused tests PASS and syntax check exits 0.

- [ ] **Step 5: Run regression suite**

Run:

```powershell
npm test
```

Expected: baseline 108 tests plus the new selection tests PASS with 0 failures.

- [ ] **Step 6: Commit the primitives**

```powershell
git add src/story-shell.js tests/story-shell-selection.test.mjs
git commit -m "test: define generic story shell selection"
```

---

### Task 2: Generate semantic story-step DOM through the existing renderer

**Files:**
- Modify: `src/story-shell.js`
- Create: `tests/story-shell-dom.test.mjs`

**Interfaces:**
- Consumes: `runtime.definition.states`-shaped arrays and injected `renderContent(contentElement, state, metrics, documentRef)`; application integration will pass `renderPresentationContent` unchanged.
- Produces: `renderStorySteps({ container, states, metrics, renderContent, documentRef }) -> section[]`.

- [ ] **Step 1: Write failing config-count, order, semantic-ID, and renderer-reuse tests**

Create `tests/story-shell-dom.test.mjs` with a small fake DOM (no jsdom dependency):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as shell from '../src/story-shell.js';

class TestClassList {
  constructor(owner) { this.owner = owner; }
  add(...tokens) {
    const names = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    tokens.forEach((token) => names.add(token));
    this.owner.className = [...names].join(' ');
  }
}

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.classList = new TestClassList(this);
    this.dataset = {};
    this.attributes = {};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

const documentRef = { createElement: (tagName) => new TestElement(tagName) };
const states = (ids) => ids.map((id) => ({ id, content: { layout: 'hero', blocks: [] } }));

function render(ids) {
  const calls = [];
  const container = new TestElement('div');
  const sections = shell.renderStorySteps({
    container,
    states: states(ids),
    metrics: { example: 1 },
    documentRef,
    renderContent(content, state, metrics, receivedDocument) {
      calls.push([state.id, metrics.example, receivedDocument]);
      content.dataset.renderedStateId = state.id;
    }
  });
  return { calls, container, sections };
}

test('three-state and five-state configurations produce matching section counts', () => {
  assert.equal(render(['alpha', 'banana', 'state-999']).sections.length, 3);
  assert.equal(render(['a', 'b', 'c', 'd', 'e']).sections.length, 5);
});

test('configuration order and arbitrary IDs become semantic section metadata', () => {
  const { calls, sections } = render(['state-999', 'alpha', 'banana']);
  assert.deepEqual(sections.map(({ tagName }) => tagName), ['section', 'section', 'section']);
  assert.deepEqual(sections.map(({ dataset }) => dataset.storyStateId), ['state-999', 'alpha', 'banana']);
  assert.deepEqual(sections.map(({ dataset }) => dataset.storyStateIndex), ['0', '1', '2']);
  assert.deepEqual(calls.map(([id]) => id), ['state-999', 'alpha', 'banana']);
  assert.equal(sections.every(({ attributes }) => attributes['aria-current'] === 'false'), true);
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/story-shell-dom.test.mjs
```

Expected: FAIL because `shell.renderStorySteps` is not a function.

- [ ] **Step 3: Implement semantic section generation**

Add to `src/story-shell.js`:

```js
export function renderStorySteps({ container, states, metrics, renderContent, documentRef = document }) {
  const sections = states.map((state, index) => {
    const section = documentRef.createElement('section');
    section.className = 'story-step';
    section.dataset.storyStateId = state.id;
    section.dataset.storyStateIndex = String(index);
    section.setAttribute('aria-current', 'false');

    const content = documentRef.createElement('article');
    renderContent(content, state, metrics, documentRef);
    content.classList.add('story-step__content');
    section.append(content);
    return section;
  });
  container.replaceChildren(...sections);
  return sections;
}
```

Do not import or duplicate block renderers here. The shell receives the existing renderer as a dependency.

- [ ] **Step 4: Verify GREEN and renderer regression**

Run:

```powershell
node --test tests/story-shell-dom.test.mjs tests/presentation-renderer.test.mjs
```

Expected: both files PASS; the renderer tests still prove every existing structured block and metric binding.

- [ ] **Step 5: Run the complete suite**

```powershell
npm test
```

Expected: 0 failures.

- [ ] **Step 6: Commit DOM generation**

```powershell
git add src/story-shell.js tests/story-shell-dom.test.mjs
git commit -m "feat: generate story steps from configuration"
```

---

### Task 3: Converge direct and button navigation on one activation operation

**Files:**
- Modify: `src/story-shell.js`
- Create: `tests/story-shell-controller.test.mjs`

**Interfaces:**
- Consumes: the locked `createStoryShell(options)` contract, Generic Story Runtime methods/properties (`definition`, `active`, `currentIndex`, `currentState`, `goTo`, `deactivate`), and Task 2 `renderStorySteps`.
- Produces: controller methods `enter()`, `exit()`, and `activateStoryState(index, { scroll = false })`; buttons and later observer/keyboard handlers call only `activateStoryState`.

- [ ] **Step 1: Write failing unified-navigation and synchronization tests**

Create `tests/story-shell-controller.test.mjs`. Reuse a local fake element with `classList.toggle`, `setAttribute`, `removeAttribute`, `addEventListener`, `removeEventListener`, `click`, and `scrollIntoView`. Use this runtime recorder:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as shell from '../src/story-shell.js';

function runtimeFixture(ids = ['alpha', 'banana', 'state-999']) {
  const calls = [];
  const runtime = {
    definition: { states: ids.map((id) => ({ id, content: { layout: 'hero', blocks: [] } })) },
    active: false,
    currentIndex: 0,
    get currentState() { return this.definition.states[this.currentIndex]; },
    goTo(index) {
      this.currentIndex = index;
      this.active = true;
      calls.push(index);
      return this.currentState;
    },
    deactivate() { this.active = false; calls.push('deactivate'); }
  };
  return { calls, runtime };
}
```

Define the controller fixture in the same test file so it exercises real shell code without jsdom:

```js
class TestClassList {
  constructor(owner) { this.owner = owner; }
  toggle(token, force) {
    const names = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    const active = force ?? !names.has(token);
    if (active) names.add(token); else names.delete(token);
    this.owner.className = [...names].join(' ');
    return active;
  }
  add(...tokens) { tokens.forEach((token) => this.toggle(token, true)); }
  remove(...tokens) { tokens.forEach((token) => this.toggle(token, false)); }
}

class TestElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.classList = new TestClassList(this);
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.scrollCalls = [];
    this.hidden = true;
    this.disabled = false;
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  click() { this.listeners.get('click')?.({ target: this, preventDefault() {} }); }
  scrollIntoView(options) { this.scrollCalls.push(options); }
}

function createWindowRef() {
  const listeners = new Map();
  return {
    innerHeight: 1000,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    keydown(key, target = { closest: () => null }) {
      listeners.get('keydown')?.({ key, target, preventDefault() {} });
    },
    listenerCount(type) { return listeners.has(type) ? 1 : 0; }
  };
}

function controllerFixture(ids) {
  const { calls: runtimeCalls, runtime } = runtimeFixture(ids);
  const elements = {
    root: new TestElement('section'),
    steps: new TestElement('div'),
    progressCurrent: new TestElement('span'),
    progressTotal: new TestElement('span'),
    previousButton: new TestElement('button'),
    nextButton: new TestElement('button'),
    exitButton: new TestElement('button')
  };
  const body = new TestElement('body');
  const documentRef = { body, createElement: (tagName) => new TestElement(tagName) };
  const windowRef = createWindowRef();
  const activationCalls = [];
  const interactionCalls = [];
  const controller = shell.createStoryShell({
    runtime,
    elements,
    renderContent(content, state) { content.dataset.renderedStateId = state.id; },
    metrics: {},
    documentRef,
    windowRef,
    interactionPolicy: {
      enter() { interactionCalls.push('enter'); },
      exit() { interactionCalls.push('exit'); }
    },
    onActivate(value) { activationCalls.push(value); }
  });
  return {
    activationCalls, controller, documentRef, elements, interactionCalls,
    runtime, runtimeCalls, windowRef,
    get sections() { return controller.sections; }
  };
}
```

Add these assertions:

```js
test('direct activation synchronizes runtime, active section, progress, and callback', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.controller.activateStoryState(2);
  assert.deepEqual(fixture.runtimeCalls, [0, 2]);
  assert.equal(fixture.runtime.currentIndex, 2);
  assert.deepEqual(fixture.sections.map((step) => step.attributes['aria-current']), ['false', 'false', 'step']);
  assert.equal(fixture.elements.progressCurrent.textContent, '3');
  assert.equal(fixture.elements.progressTotal.textContent, '3');
  assert.equal(fixture.elements.nextButton.disabled, true);
  assert.deepEqual(fixture.activationCalls.map(({ index }) => index), [0, 2]);
});

test('previous and next buttons use the same clamped activation path and scroll their section', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.elements.previousButton.click();
  fixture.elements.nextButton.click();
  fixture.elements.nextButton.click();
  fixture.elements.nextButton.click();
  assert.deepEqual(fixture.runtimeCalls, [0, 1, 2]);
  assert.equal(fixture.sections[1].scrollCalls.length, 1);
  assert.equal(fixture.sections[2].scrollCalls.length, 1);
});

test('same active index is a shell no-op instead of reactivating runtime actions', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.controller.activateStoryState(0);
  assert.deepEqual(fixture.runtimeCalls, [0]);
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/story-shell-controller.test.mjs
```

Expected: FAIL because `createStoryShell` is not a function.

- [ ] **Step 3: Implement the minimal controller and button convergence**

Add `createStoryShell` to `src/story-shell.js`. Implement these exact internal operations:

```js
function updateUi(index) {
  sections.forEach((section, sectionIndex) => {
    const current = sectionIndex === index;
    section.classList.toggle('is-active', current);
    section.setAttribute('aria-current', current ? 'step' : 'false');
  });
  elements.progressCurrent.textContent = String(index + 1);
  elements.progressTotal.textContent = String(runtime.definition.states.length);
  elements.previousButton.disabled = index === 0;
  elements.nextButton.disabled = index === runtime.definition.states.length - 1;
}

function activateStoryState(index, { scroll = false } = {}) {
  const nextIndex = normalizeStoryIndex(index, runtime.definition.states.length);
  if (runtime.active && runtime.currentIndex === nextIndex) return runtime.currentState;
  const state = runtime.goTo(nextIndex);
  updateUi(nextIndex);
  if (scroll) sections[nextIndex].scrollIntoView({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'center'
  });
  onActivate({ state, index: nextIndex, total: runtime.definition.states.length });
  return state;
}
```

`enter()` must be idempotent, show the root, add `is-story-shell` to `documentRef.body`, generate sections once per entry, bind Previous/Next/Exit button listeners, invoke `interactionPolicy.enter()`, and call `activateStoryState(0)`. `exit()` initially removes button listeners, calls `runtime.deactivate()`, invokes `interactionPolicy.exit()`, removes the body class, hides the root, and calls `onExit()`; Tasks 4 and 5 add keyboard/observer cleanup without creating a second lifecycle.

- [ ] **Step 4: Verify GREEN**

```powershell
node --test tests/story-shell-controller.test.mjs tests/story-shell-dom.test.mjs
```

Expected: PASS; button calls prove convergence and same-index calls remain no-ops.

- [ ] **Step 5: Run regression suite**

```powershell
npm test
```

Expected: 0 failures, including Generic Story Runtime lifecycle tests.

- [ ] **Step 6: Commit unified navigation**

```powershell
git add src/story-shell.js tests/story-shell-controller.test.mjs
git commit -m "feat: add unified story shell navigation"
```

---

### Task 4: Add accessible keyboard navigation through the same operation

**Files:**
- Modify: `src/story-shell.js`
- Modify: `tests/story-shell-controller.test.mjs`
- Modify: `tests/story-shell-selection.test.mjs`

**Interfaces:**
- Consumes: Task 3 `activateStoryState` and `exit` closures.
- Produces: `storyNavigationIntent(event) -> 'next' | 'previous' | 'exit' | null` and `isInteractiveStoryTarget(target) -> boolean`; one window `keydown` listener exists only while active.

- [ ] **Step 1: Write failing key-map and interactive-target tests**

Append to `tests/story-shell-selection.test.mjs`:

```js
test('keyboard intent maps arrows and Space without story semantics', () => {
  for (const key of ['ArrowRight', 'ArrowDown', ' ']) {
    assert.equal(shell.storyNavigationIntent({ key }), 'next');
  }
  for (const key of ['ArrowLeft', 'ArrowUp']) {
    assert.equal(shell.storyNavigationIntent({ key }), 'previous');
  }
  assert.equal(shell.storyNavigationIntent({ key: 'Escape' }), 'exit');
  assert.equal(shell.storyNavigationIntent({ key: 'Enter' }), null);
});

test('editable and interactive targets are excluded', () => {
  for (const selector of ['input', 'textarea', 'select', 'button', 'a', '[contenteditable]']) {
    assert.equal(shell.isInteractiveStoryTarget({ closest: (value) => value.includes(selector) ? {} : null }), true);
  }
  assert.equal(shell.isInteractiveStoryTarget({ closest: () => null }), false);
});
```

Append to `tests/story-shell-controller.test.mjs`:

```js
test('keyboard next previous and Escape use activation and exit lifecycle', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.windowRef.keydown('ArrowDown');
  fixture.windowRef.keydown(' ');
  fixture.windowRef.keydown('ArrowUp');
  fixture.windowRef.keydown('Escape');
  assert.deepEqual(fixture.runtimeCalls, [0, 1, 2, 1, 'deactivate']);
  assert.equal(fixture.elements.root.hidden, true);
});

test('keyboard ignores events from interactive targets', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.windowRef.keydown('ArrowRight', { closest: () => ({}) });
  assert.deepEqual(fixture.runtimeCalls, [0]);
});
```

- [ ] **Step 2: Verify RED**

```powershell
node --test tests/story-shell-selection.test.mjs tests/story-shell-controller.test.mjs
```

Expected: FAIL because the keyboard helpers/listener do not exist.

- [ ] **Step 3: Implement key helpers and bind them to the controller**

Add:

```js
const INTERACTIVE_STORY_SELECTOR = 'input, textarea, select, button, a, [contenteditable]';

export function isInteractiveStoryTarget(target) {
  return Boolean(target?.closest?.(INTERACTIVE_STORY_SELECTOR));
}

export function storyNavigationIntent({ key }) {
  if (['ArrowRight', 'ArrowDown', ' '].includes(key)) return 'next';
  if (['ArrowLeft', 'ArrowUp'].includes(key)) return 'previous';
  if (key === 'Escape') return 'exit';
  return null;
}
```

Inside the controller, create one stable `handleKeydown` closure. If inactive or the target is interactive, return. For a recognized intent, call `event.preventDefault()`. Next/previous call `activateStoryState(adjacentStoryIndex(...), { scroll: true })`; exit calls `exit()`. Add the listener once in `enter()` and remove the identical closure in `exit()`.

- [ ] **Step 4: Verify GREEN**

```powershell
node --test tests/story-shell-selection.test.mjs tests/story-shell-controller.test.mjs
```

Expected: PASS, including Space, vertical arrows, Escape, and interactive exclusions.

- [ ] **Step 5: Run full regression**

```powershell
npm test
```

Expected: 0 failures; legacy ArrowLeft/ArrowRight tests remain unchanged.

- [ ] **Step 6: Commit keyboard behavior**

```powershell
git add src/story-shell.js tests/story-shell-selection.test.mjs tests/story-shell-controller.test.mjs
git commit -m "feat: add accessible story shell keyboard navigation"
```

---

### Task 5: Add deterministic IntersectionObserver and idempotent lifecycle

**Files:**
- Modify: `src/story-shell.js`
- Modify: `tests/story-shell-controller.test.mjs`

**Interfaces:**
- Consumes: native/injected `observerFactory(callback, { threshold })`, Task 1 `selectActiveStoryStep`, and Task 3 `activateStoryState`.
- Produces: exactly one observer during an active lifecycle; `enter()` and `exit()` are idempotent; observer callbacks update one cached entry per section and discretely activate the latest selected index.

- [ ] **Step 1: Write failing observer, fast-fling, and repeated lifecycle tests**

Extend the controller fixture with an observer factory that records instances, observed targets, `disconnectCount`, and exposes `emit(entries)`. Add:

```js
function observerEntry(target, intersectionRatio, top, bottom) {
  return {
    target,
    intersectionRatio,
    isIntersecting: intersectionRatio > 0,
    boundingClientRect: { top, bottom, height: bottom - top }
  };
}

function createObserverFactory(observers) {
  return (callback, options) => {
    const instance = {
      callback,
      options,
      observed: [],
      disconnectCount: 0,
      observe(target) { this.observed.push(target); },
      disconnect() { this.disconnectCount += 1; },
      emit(entries) { callback(entries, this); }
    };
    observers.push(instance);
    return instance;
  };
}
```

Update `controllerFixture` to create `const observers = []`, pass `observerFactory: createObserverFactory(observers)`, and return `observers`.

```js
test('observer selection activates the generic runtime path once per changed index', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.observers[0].emit([observerEntry(fixture.sections[2], 0.8, 320, 720)]);
  fixture.observers[0].emit([observerEntry(fixture.sections[2], 0.9, 300, 700)]);
  assert.deepEqual(fixture.runtimeCalls, [0, 2]);
});

test('rapid observer progression is latest-state-wins', () => {
  const fixture = controllerFixture(['a', 'b', 'c', 'd']);
  fixture.controller.enter();
  let previous = 0;
  for (const index of [1, 2, 3]) {
    fixture.observers[0].emit([
      observerEntry(fixture.sections[previous], 0, -400, -100),
      observerEntry(fixture.sections[index], 0.9, 250, 650)
    ]);
    previous = index;
  }
  assert.deepEqual(fixture.runtimeCalls, [0, 1, 2, 3]);
  assert.equal(fixture.runtime.currentIndex, 3);
});

test('enter exit re-entry owns one observer and one key listener at a time', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.controller.enter();
  assert.equal(fixture.observers.length, 1);
  assert.equal(fixture.windowRef.listenerCount('keydown'), 1);
  fixture.controller.exit();
  fixture.controller.exit();
  assert.equal(fixture.observers[0].disconnectCount, 1);
  assert.equal(fixture.windowRef.listenerCount('keydown'), 0);
  fixture.controller.enter();
  fixture.controller.exit();
  fixture.controller.enter();
  fixture.controller.exit();
  assert.equal(fixture.observers.length, 3);
  assert.equal(fixture.observers.every(({ disconnectCount }) => disconnectCount === 1), true);
  assert.equal(fixture.interactionCalls.filter((value) => value === 'enter').length, 3);
  assert.equal(fixture.interactionCalls.filter((value) => value === 'exit').length, 3);
});
```

- [ ] **Step 2: Verify RED**

```powershell
node --test --test-name-pattern="observer|rapid|re-entry" tests/story-shell-controller.test.mjs
```

Expected: FAIL because the observer factory is not invoked.

- [ ] **Step 3: Implement one observer per active entry**

In `enter()`, after rendering sections, create a `Map` named `observedEntries`. Create one observer with thresholds `[0, 0.25, 0.5, 0.75, 1]`; observe every section. Its callback must update the map for the changed targets, call `selectActiveStoryStep([...observedEntries.values()], { viewportHeight: windowRef.innerHeight })`, and call `activateStoryState(selectedIndex)` only when the result is non-null.

Do not add a `scroll` listener, timer, animation frame, or source/map call.

In `exit()`, call `observer.disconnect()` once, set the observer reference to `null`, and clear cached entries before removing listeners/deactivating runtime. Guard both lifecycle methods with one `active` boolean so duplicate calls have no effect.

- [ ] **Step 4: Verify GREEN and delayed-action regression**

```powershell
node --test tests/story-shell-controller.test.mjs tests/route-61-2-story-actions.test.mjs tests/story-runtime.test.mjs
```

Expected: PASS; fast progression ends at D and the existing delayed `route.reveal` cancellation test remains green.

- [ ] **Step 5: Run complete suite and syntax**

```powershell
npm test
node --check src/story-shell.js
```

Expected: 0 failures and syntax exit 0.

- [ ] **Step 6: Commit observer lifecycle**

```powershell
git add src/story-shell.js tests/story-shell-controller.test.mjs
git commit -m "feat: add story observer lifecycle"
```

---

### Task 6: Preserve and restore guided MapLibre interaction state

**Files:**
- Create: `src/story-map-interactions.js`
- Create: `tests/story-map-interactions.test.mjs`

**Interfaces:**
- Consumes: MapLibre-style handlers exposing `isEnabled()`, `disable()`, and `enable()` under the five names in `GUIDED_HANDLER_NAMES`.
- Produces: `createGuidedMapInteractionPolicy(map, handlerNames) -> { enter(), exit() }` with exact prior-state restoration and idempotence.

- [ ] **Step 1: Write failing state-preservation tests**

Create `tests/story-map-interactions.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as interactions from '../src/story-map-interactions.js';

function handler(initial) {
  let enabled = initial;
  const calls = [];
  return {
    calls,
    isEnabled: () => enabled,
    disable() { calls.push('disable'); enabled = false; },
    enable() { calls.push('enable'); enabled = true; }
  };
}

test('guided mode restores each available handler to its exact prior state', () => {
  const map = {
    scrollZoom: handler(true),
    dragPan: handler(false),
    touchZoomRotate: handler(true),
    boxZoom: handler(false),
    doubleClickZoom: handler(true)
  };
  const policy = interactions.createGuidedMapInteractionPolicy(map);
  policy.enter();
  assert.deepEqual(Object.values(map).map((value) => value.isEnabled()), [false, false, false, false, false]);
  policy.exit();
  assert.deepEqual(Object.values(map).map((value) => value.isEnabled()), [true, false, true, false, true]);
});

test('repeated enter and exit are idempotent and tolerate unavailable handlers', () => {
  const map = { scrollZoom: handler(true) };
  const policy = interactions.createGuidedMapInteractionPolicy(map);
  policy.enter();
  policy.enter();
  policy.exit();
  policy.exit();
  policy.enter();
  policy.exit();
  assert.deepEqual(map.scrollZoom.calls, ['disable', 'enable', 'disable', 'enable']);
});
```

- [ ] **Step 2: Verify RED**

```powershell
node --test tests/story-map-interactions.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement minimal guided interaction policy**

Create `src/story-map-interactions.js`. Keep a private `savedStates` map that is non-null only during an entered lifecycle. On enter, record `handler.isEnabled()` before disabling only enabled handlers. On exit, enable handlers recorded `true`, disable handlers recorded `false` only if their current state differs, then clear `savedStates`. Ignore missing/incomplete handlers rather than assuming all MapLibre builds expose each one.

Do not call map camera/source/render APIs.

- [ ] **Step 4: Verify GREEN**

```powershell
node --test tests/story-map-interactions.test.mjs
node --check src/story-map-interactions.js
```

Expected: PASS and syntax exit 0.

- [ ] **Step 5: Run regression suite**

```powershell
npm test
```

Expected: 0 failures.

- [ ] **Step 6: Commit interaction policy**

```powershell
git add src/story-map-interactions.js tests/story-map-interactions.test.mjs
git commit -m "feat: add guided map interaction policy"
```

---

### Task 7: Add deterministic responsive layout padding without schema changes

**Files:**
- Modify: `src/presentation.js`
- Modify: `tests/presentation.test.mjs`

**Interfaces:**
- Consumes: `{ mapRect, storyRect, stacked }`, where `storyRect` is the current configured state's generated content-card rectangle measured by the application, and optional `layoutPadding` supplied to `buildPresentationCameraOptions`.
- Produces: `buildStoryLayoutPadding(...)` and backward-compatible `buildPresentationCameraOptions({ ..., layoutPadding })`.

- [ ] **Step 1: Write failing wide, stacked, and legacy camera tests**

Append to `tests/presentation.test.mjs` and import `buildStoryLayoutPadding`:

```js
test('wide story layout reserves the measured left column', () => {
  assert.deepEqual(buildStoryLayoutPadding({
    mapRect: { left: 0, right: 1366, top: 0, bottom: 768 },
    storyRect: { left: 24, right: 424, top: 0, bottom: 768 },
    stacked: false
  }), { top: 48, right: 48, bottom: 64, left: 456 });
});

test('stacked story layout reserves the measured lower card region', () => {
  assert.deepEqual(buildStoryLayoutPadding({
    mapRect: { left: 0, right: 390, top: 0, bottom: 844 },
    storyRect: { left: 0, right: 390, top: 456, bottom: 844 },
    stacked: true
  }), { top: 32, right: 24, bottom: 412, left: 24 });
});

test('explicit shell padding overrides layout defaults but not configured semantic camera hints', () => {
  const options = buildPresentationCameraOptions({
    target: 'connections', presentationActive: true, compactView: true, reducedMotion: false,
    camera: { pitch: 48, maxZoom: 11.5 },
    layoutPadding: { top: 32, right: 24, bottom: 412, left: 24 }
  });
  assert.deepEqual(options.padding, { top: 32, right: 24, bottom: 412, left: 24 });
  assert.equal(options.pitch, 48);
  assert.equal(options.maxZoom, 11.5);
});
```

Retain the existing test that expects legacy padding `{ top: 58, right: 58, bottom: 170, left: 60 }` when `layoutPadding` is absent.

- [ ] **Step 2: Verify RED**

```powershell
node --test tests/presentation.test.mjs
```

Expected: FAIL because `buildStoryLayoutPadding` is not exported and `layoutPadding` is ignored.

- [ ] **Step 3: Implement pure measured padding and optional camera input**

Add:

```js
export function buildStoryLayoutPadding({ mapRect, storyRect, stacked }) {
  if (stacked) {
    return {
      top: 32,
      right: 24,
      bottom: Math.max(64, Math.ceil(mapRect.bottom - storyRect.top + 24)),
      left: 24
    };
  }
  return {
    top: 48,
    right: 48,
    bottom: 64,
    left: Math.max(60, Math.ceil(storyRect.right - mapRect.left + 32))
  };
}
```

Add `layoutPadding` to `buildPresentationCameraOptions` parameters and use `padding: layoutPadding ?? defaults.padding` in the return value. Do not read viewport globals in this pure module and do not modify camera/story schemas.

- [ ] **Step 4: Verify GREEN and legacy regression**

```powershell
node --test tests/presentation.test.mjs tests/story-schema.test.mjs tests/route-61-2-action-contracts.test.mjs
```

Expected: PASS; legacy padding, schema, and camera action contracts remain unchanged.

- [ ] **Step 5: Run full regression**

```powershell
npm test
```

Expected: 0 failures.

- [ ] **Step 6: Commit responsive padding policy**

```powershell
git add src/presentation.js tests/presentation.test.mjs
git commit -m "feat: add responsive story map padding"
```

---

### Task 8: Add minimal semantic POC shell markup and responsive CSS

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Create: `tests/story-shell-markup.test.mjs`

**Interfaces:**
- Consumes: IDs required by `createStoryShell` and existing `.presentation-content*` renderer classes.
- Produces: hidden `#story-shell`, empty `#story-shell-steps`, `#story-progress-current`, `#story-progress-total`, `#story-previous`, `#story-next`, and `#story-explore`; responsive `.is-story-shell` layout with no authored state content.

- [ ] **Step 1: Write failing static markup and CSS guard tests**

Create `tests/story-shell-markup.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index.html', import.meta.url);
const cssUrl = new URL('../styles.css', import.meta.url);

test('POC shell markup exposes semantic generated-content and button boundaries', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  assert.match(html, /<section id="story-shell"[^>]*hidden/);
  assert.match(html, /id="story-shell-steps"/);
  assert.match(html, /<button id="story-previous"[^>]*type="button"/);
  assert.match(html, /<button id="story-next"[^>]*type="button"/);
  assert.match(html, /<button id="story-explore"[^>]*type="button"[^>]*>\s*Khám phá bản đồ/);
  assert.match(html, /id="story-progress-current"/);
  assert.match(html, /id="story-progress-total"/);
  assert.doesNotMatch(html, /data-story-state-id=/);
});

test('POC CSS uses responsive capability queries and reduced motion without user agents', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /body\.is-story-shell/);
  assert.match(css, /@media[^\{]*(max-width|max-height|pointer)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css, /iPhone|Android|Windows Phone/i);
});
```

- [ ] **Step 2: Verify RED**

```powershell
node --test tests/story-shell-markup.test.mjs
```

Expected: FAIL because the POC elements/styles do not exist.

- [ ] **Step 3: Add the minimal shell skeleton**

Insert after the legacy `#presentation` section in `index.html`:

```html
<section id="story-shell" class="story-shell" aria-label="Câu chuyện bản đồ" hidden>
  <header class="story-shell__toolbar">
    <p class="story-shell__progress" aria-live="polite">
      <span id="story-progress-current">1</span> / <span id="story-progress-total">1</span>
    </p>
    <button id="story-explore" type="button">Khám phá bản đồ</button>
  </header>
  <div id="story-shell-steps" class="story-shell__steps" aria-label="Các trạng thái câu chuyện"></div>
  <nav class="story-shell__navigation" aria-label="Điều hướng câu chuyện">
    <button id="story-previous" type="button">← Trước</button>
    <button id="story-next" type="button">Tiếp →</button>
  </nav>
</section>
```

Do not add any state text or duplicate the renderer output in HTML.

- [ ] **Step 4: Add scoped wide, narrow/short, and reduced-motion CSS**

Add this scoped layout skeleton, then adjust only spacing/color values during browser review:

```css
body.is-story-shell { overflow-y: auto; overflow-x: hidden; }
body.is-story-shell #map { position: fixed; inset: 0; }
body.is-story-shell .panel,
body.is-story-shell #presentation { opacity: 0; pointer-events: none; }

.story-shell { position: relative; z-index: 7; min-height: 100svh; pointer-events: none; }
.story-shell__toolbar {
  position: fixed; z-index: 9; top: 18px; right: 18px; left: 18px;
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  pointer-events: none;
}
.story-shell__toolbar > *, .story-shell__navigation { pointer-events: auto; }
.story-shell__progress { margin: 0; padding: 10px 13px; border-radius: 999px; background: var(--panel); }
.story-shell button { min-height: 44px; padding: 10px 14px; border: 1px solid var(--panel-border); border-radius: 999px; background: var(--panel); }
.story-shell__steps { width: min(420px, calc(100vw - 48px)); margin-left: 24px; }
.story-step { min-height: 100svh; display: flex; align-items: center; padding: 96px 0; pointer-events: none; }
.story-step__content {
  position: relative; top: auto; left: auto; width: 100%; max-height: calc(100svh - 192px);
  opacity: .62; transform: translateY(8px); pointer-events: auto;
}
.story-step.is-active .story-step__content { opacity: 1; transform: none; }
.story-shell__navigation {
  position: fixed; z-index: 9; right: 18px; bottom: 18px;
  display: flex; gap: 8px;
}

@media (max-width: 760px), (max-height: 640px) {
  .story-shell__toolbar { top: 10px; right: 10px; left: 10px; }
  .story-shell__steps { width: 100%; margin: 0; }
  .story-step { min-height: 100svh; align-items: flex-start; padding: 52svh 12px 96px; }
  .story-step__content,
  .story-step__content.presentation-content--hero,
  .story-step__content.presentation-content--metrics,
  .story-step__content.presentation-content--narrative,
  .story-step__content.presentation-content--map-focus {
    width: calc(100vw - 24px); max-width: none; max-height: none; padding: 18px 19px;
  }
  .story-step__content .presentation-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .story-shell__navigation { right: 10px; bottom: 10px; left: 10px; justify-content: space-between; }
}

@media (pointer: coarse) {
  .story-shell button { min-height: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .story-step__content, .story-step.is-active .story-step__content { transition: none; transform: none; }
}
```

Reuse the existing `.presentation-content*`, `.presentation-metrics`, `.presentation-callouts`, and disclosure styles. Add only `.story-step__content` positioning overrides; do not copy the content design system.

- [ ] **Step 5: Verify GREEN and legacy markup regression**

```powershell
node --test tests/story-shell-markup.test.mjs tests/presentation-renderer.test.mjs
```

Expected: PASS; no hardcoded story steps appear in HTML.

- [ ] **Step 6: Run complete suite**

```powershell
npm test
```

Expected: 0 failures.

- [ ] **Step 7: Commit shell markup and layout**

```powershell
git add index.html styles.css tests/story-shell-markup.test.mjs
git commit -m "feat: add responsive POC story shell"
```

---

### Task 9: Integrate the POC at the application composition root

**Files:**
- Modify: `src/app.js`
- Modify: `tests/story-shell-selection.test.mjs`
- Create: `tests/story-shell-integration.test.mjs`

**Interfaces:**
- Consumes: `createStoryShell`, `isStoryShellPocEnabled`, `createGuidedMapInteractionPolicy`, `buildStoryLayoutPadding`, existing `renderPresentationContent`, existing `storyRuntime`, and existing Explore reset functions.
- Produces: query-gated `bindStoryExperience()` and one POC controller; no second map/runtime/action runner.

- [ ] **Step 1: Write failing composition invariants**

Create `tests/story-shell-integration.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../src/app.js', import.meta.url);

test('application query-gates POC and retains legacy binding', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.match(source, /isStoryShellPocEnabled\(window\.location\.search\)/);
  assert.match(source, /storyShellPocEnabled\s*\?\s*bindStoryShell\(\)\s*:\s*bindPresentation\(\)/);
});

test('application keeps one MapLibre map and one generic story runtime', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
  assert.equal((source.match(/createStoryRuntime\(/g) ?? []).length, 1);
  assert.match(source, /renderContent:\s*renderPresentationContent/);
  assert.doesNotMatch(source, /story-poc-content|mobile-story|scroll-story/i);
});
```

Append a query-order test to `tests/story-shell-selection.test.mjs` proving `?storyShell=poc&x=1` and `?x=1&storyShell=poc` are both true.

- [ ] **Step 2: Verify RED**

```powershell
node --test tests/story-shell-integration.test.mjs tests/story-shell-selection.test.mjs
```

Expected: integration test FAIL because `app.js` has no POC imports/binding.

- [ ] **Step 3: Import and store the POC composition dependencies**

In `src/app.js` import:

```js
import { buildPresentationCameraOptions, buildStoryLayoutPadding, VIEW_MODES } from './presentation.js';
import { createStoryShell, isStoryShellPocEnabled } from './story-shell.js';
import { createGuidedMapInteractionPolicy } from './story-map-interactions.js';
```

Add exactly one `let storyShell = null;` and one immutable `const storyShellPocEnabled = isStoryShellPocEnabled(window.location.search);`. Do not add another story runtime or map variable.

- [ ] **Step 4: Feed measured layout padding through the existing focus path**

Extend `fitTarget` to accept a fourth optional `layoutPadding` argument and pass it to `buildPresentationCameraOptions`. Add:

```js
function currentStoryLayoutPadding() {
  if (!storyShell?.active) return undefined;
  const mapRect = document.getElementById('map').getBoundingClientRect();
  const selector = `[data-story-state-index="${storyRuntime.currentIndex}"] .story-step__content`;
  const storyRect = document.querySelector(selector).getBoundingClientRect();
  const stacked = window.matchMedia('(max-width: 760px), (max-height: 640px)').matches;
  return buildStoryLayoutPadding({ mapRect, storyRect, stacked });
}
```

Change the existing `map.focus` capability to:

```js
focus: (target, camera) => fitTarget(target, true, camera, currentStoryLayoutPadding())
```

Because `currentStoryLayoutPadding()` returns `undefined` outside an active POC shell, legacy presentation keeps the exact existing padding.

- [ ] **Step 5: Compose POC enter/activate/exit against existing app functions**

Add `bindStoryShell()` beside `bindPresentation()`. It must create one controller with the required DOM elements, `renderContent: renderPresentationContent`, `metrics: presentationMetrics`, `interactionPolicy: createGuidedMapInteractionPolicy(map)`, and callbacks:

```js
onActivate({ state, index, total }) {
  const heading = findStoryContentBlock(state, 'heading');
  setStatus(`Câu chuyện ${index + 1}/${total}: ${heading?.text ?? state.id}.`);
},
onExit() {
  applyMode(VIEW_MODES.DIFFERENCE, { announce: false });
  emphasizePois(false);
  urbanContextController?.setMode('off');
  fitTarget('overview', false);
  setStatus('Sẵn sàng · Chế độ Chênh lệch.');
}
```

Bind the existing `#presentation-open` click to `storyShell.enter()` in POC mode and change its visible label to `Bắt đầu câu chuyện` only in that mode. The shell controller owns Previous/Next/Explore/Escape listeners. Do not call project map actions from the observer/buttons/keys.

Replace the single `bindPresentation()` call inside `map.on('load')` with the exact query branch:

```js
storyShellPocEnabled ? bindStoryShell() : bindPresentation();
```

Keep the legacy DOM, functions, and key handlers otherwise intact.

- [ ] **Step 6: Verify GREEN and source invariants**

```powershell
node --test tests/story-shell-integration.test.mjs tests/story-shell-selection.test.mjs tests/presentation.test.mjs tests/presentation-renderer.test.mjs tests/story-runtime.test.mjs
node --check src/app.js
```

Expected: PASS; source proof finds one map, one runtime, shared renderer, query-gated legacy/POC binding.

- [ ] **Step 7: Run complete automated certification**

```powershell
npm test
$syntaxFailures = 0; Get-ChildItem src -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailures++ } }; if ($syntaxFailures -ne 0) { exit 1 }
```

Expected: all tests PASS; all source files, now including the two new modules, pass syntax checks.

- [ ] **Step 8: Commit application integration**

```powershell
git add src/app.js tests/story-shell-integration.test.mjs tests/story-shell-selection.test.mjs
git commit -m "feat: integrate POC story shell with application"
```

---

### Task 10: Browser, performance, regression, and PR certification

**Files:**
- Create: `review/map-story-shell-poc-v1/state-04-1920x1080.png`
- Create: `review/map-story-shell-poc-v1/state-04-1366x768.png`
- Create: `review/map-story-shell-poc-v1/state-04-390x844.png`
- Create: `review/map-story-shell-poc-v1/state-04-320x568.png`
- Create: `review/map-story-shell-poc-v1/sequence-state-01-1366x768.png`
- Create: `review/map-story-shell-poc-v1/sequence-state-07-1366x768.png`
- Create: `review/map-story-shell-poc-v1/REPORT.md`

**Interfaces:**
- Consumes: completed POC URL `http://127.0.0.1:8080/?storyShell=poc`, legacy URL `http://127.0.0.1:8080/`, browser responsive emulation, DevTools/runtime instrumentation, GitHub PR #2 checks.
- Produces: the four required viewport screenshots, one multi-state sequence, exact automated/browser/performance evidence, and final `PASS`, `REVISE`, or `REJECT` report.

- [ ] **Step 1: Establish final automated evidence before browser work**

Run:

```powershell
npm test
$syntaxTotal = 0; $syntaxFailures = 0; Get-ChildItem src -Filter *.js | ForEach-Object { $syntaxTotal++; node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailures++ } }; Write-Output "syntax=$($syntaxTotal - $syntaxFailures)/$syntaxTotal"; if ($syntaxFailures -ne 0) { exit 1 }
git diff main...HEAD -- data/stories/route-61-2.story.json data/stories/story.schema.json src/story-runtime.js src/story-action-runner.js src/story-schema.js src/route-61-2-story-actions.js
```

Expected: complete suite PASS, all source syntax checks PASS, and the invariant-file diff is empty. If not, stop and repair through a failing test before browser certification.

- [ ] **Step 2: Start the static server and record the process/session**

Run in a persistent terminal:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/?storyShell=poc` in the in-app browser or Chrome responsive tools. Keep the same server/build for every screenshot and measurement.

- [ ] **Step 3: Run the functional matrix at all four viewports**

For each of `1920x1080`, `1366x768`, `390x844`, and `320x568`:

1. Reload the POC URL with console recording enabled.
2. Click `Bắt đầu câu chuyện`; assert one visible generated section is current and progress reads `1 / <configuration length>`.
3. Record `document.querySelectorAll('[data-story-state-id]').length` and compare it with the loaded JSON `states.length` fetched from `./data/stories/route-61-2.story.json`.
4. Record the identity of `document.querySelector('#map canvas')`; navigate three states and verify the same canvas node remains connected.
5. Advance with vertical page scroll/swipe; verify scroll changes discrete current state and never zooms/pans the map unintentionally.
6. Test Next, Previous, `ArrowRight`, `ArrowDown`, Space, `ArrowLeft`, and `ArrowUp`; verify progress, `aria-current="step"`, visible card, and runtime-driven map state stay aligned.
7. Rapidly scroll through states 2/3/4 and settle on state 5; wait longer than the configured delayed reveal interval and verify state 5 remains current.
8. Press Escape; verify shell hides, panel/explore controls return, comparison mode is Difference, and wheel/drag/touch map interactions work normally.
9. Enter/exit three times; verify each input produces one transition only and console contains no duplicated-handler symptoms.
10. Verify no horizontal overflow using `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
11. Verify text contrast/readability, focus outline, buttons, disclosure, and approximately 44px touch targets without relying on hover.
12. Record console errors/warnings. Expected: no shell/runtime errors; known network fallback warnings must be reported rather than silently ignored.

At desktop/laptop sizes also verify keyboard use from presentation distance, map dominance, restrained progress, readable column width, and usable existing navigation controls after Explore restoration.

At mobile sizes also verify vertical swipe wins over MapLibre, the map remains understandable above/behind the lower story region, Overture extrusions do not obscure the route excessively, text does not clip, and controls remain tappable at 320px.

- [ ] **Step 4: Verify existing map and Explore regression features**

Across the representative sequence, explicitly record PASS/FAIL for:

- stripped OpenFreeMap Dark basemap and attribution;
- Overture building context in the configured industrial state and Morphology V2 fallback behavior if Overture cannot load;
- existing/proposed/difference route layers, stops, road labels, POIs, industrial context, disclosure, and CSS stop pulses;
- bus simulation in Explore;
- all four comparison modes after exit;
- popup/POI inspection and normal map pan/zoom after exit;
- `prefers-reduced-motion` emulation: immediate/minimal content scrolling, duration-zero camera behavior, route reveal completion, and fully working navigation;
- legacy URL without the query: original presentation launcher, dots, ArrowLeft/ArrowRight, Escape, and Explore panel unchanged.

- [ ] **Step 5: Capture required comparison and sequence screenshots**

Navigate by configuration index, not hardcoded shell semantics. Use state index 3 (displayed as state 4) for all device-layout comparisons and save the exact filenames listed above. At 1366x768 also capture state 1, then rapidly navigate to state 7 and capture the settled final state to document a multi-state sequence. Do not crop out viewport edges needed to prove overflow/layout.

- [ ] **Step 6: Measure desktop/laptop settled performance separately from transitions**

At 1920x1080 and 1366x768, enter state 4 and wait until camera/route reveal/urban preparation has visibly settled. In DevTools, install temporary counters on the existing prototypes for a 10-second observation window; preserve originals and restore them after measurement:

```js
(() => {
  const probe = { renders: 0, repaints: 0, sourceMutations: 0, frameTimes: [], started: performance.now() };
  const mapProto = maplibregl.Map.prototype;
  const sourceProto = maplibregl.GeoJSONSource.prototype;
  const originalRender = mapProto._render;
  const originalRepaint = mapProto.triggerRepaint;
  const originalSetData = sourceProto.setData;
  mapProto._render = function (...args) { probe.renders += 1; return originalRender.apply(this, args); };
  mapProto.triggerRepaint = function (...args) { probe.repaints += 1; return originalRepaint.apply(this, args); };
  sourceProto.setData = function (...args) { probe.sourceMutations += 1; return originalSetData.apply(this, args); };
  function frame(now) { probe.frameTimes.push(now); if (now - probe.started < 10000) requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  window.__storyShellProbe = probe;
  window.__finishStoryShellProbe = () => {
    mapProto._render = originalRender;
    mapProto.triggerRepaint = originalRepaint;
    sourceProto.setData = originalSetData;
    const seconds = Math.max(1, (performance.now() - probe.started) / 1000);
    const typicalFps = probe.frameTimes.length / seconds;
    const buckets = new Map();
    probe.frameTimes.forEach((timestamp) => {
      const second = Math.floor((timestamp - probe.started) / 1000);
      buckets.set(second, (buckets.get(second) ?? 0) + 1);
    });
    const fullBuckets = [...buckets.entries()]
      .filter(([second]) => second >= 1 && second < Math.floor(seconds) - 1)
      .map(([, count]) => count);
    return { typicalFps, sustainedLowFps: Math.min(...fullBuckets), renders: probe.renders, repaints: probe.repaints, sourceMutations: probe.sourceMutations, seconds };
  };
})();
```

After at least 10 seconds, run `window.__finishStoryShellProbe()` and record the returned values. Expected: typical approximately 60 FPS, sustained low at least 30 FPS, zero recurring source mutations, and no runaway render/repaint counts. Report exact observed counts, even if non-zero. Measure one representative state transition separately and label it transition-only; do not average transition FPS into settled FPS.

- [ ] **Step 7: Assess mobile responsiveness without inventing an FPS gate**

At 390x844 and 320x568, record whether swipes remain smooth, state activation occurs promptly after observer selection, long-task warnings appear, and repaint/source counters continue growing after settlement. Report qualitative responsiveness and exact counter evidence where available; do not claim physical-device FPS from emulation.

- [ ] **Step 8: Write the required report from observed evidence**

Create `review/map-story-shell-poc-v1/REPORT.md` using the exact `MAP_STORY_SHELL_POC_V1` template from the task brief. Include:

- base SHA `4cc2a159a71e6464a8b80fb9a7f4a8355254507f` and PR #1 presence;
- baseline `108/108`, final test/syntax totals, screenshot links, console notes, all navigation/lifecycle/responsive/map regressions, measured performance, file lists, and GitHub Actions URL/result;
- `Schema/runtime changes: none`, `Legacy presentation retained: yes`, no separate mobile/presenter content;
- honest failures/caveats and `MAP_STORY_SHELL_POC_V1_RESULT: PASS | REVISE | REJECT`;
- if PASS, exactly `PROMOTE_STORY_SHELL`; if evidence reveals a significant UX problem, `REVISE_STORY_SHELL`.

Do not write PASS before all evidence, including CI, exists.

- [ ] **Step 9: Run final verification before the certification commit**

```powershell
npm test
$syntaxTotal = 0; $syntaxFailures = 0; Get-ChildItem src -Filter *.js | ForEach-Object { $syntaxTotal++; node --check $_.FullName; if ($LASTEXITCODE -ne 0) { $syntaxFailures++ } }; Write-Output "syntax=$($syntaxTotal - $syntaxFailures)/$syntaxTotal"; if ($syntaxFailures -ne 0) { exit 1 }
git diff --check
git status --short
```

Expected: tests and syntax PASS, no whitespace errors, and only intended report/screenshots are uncommitted.

- [ ] **Step 10: Commit and push certification artifacts**

```powershell
git add review/map-story-shell-poc-v1
git commit -m "docs: certify map story shell POC v1"
git push origin feat/map-story-shell-poc-v1
```

- [ ] **Step 11: Wait for actual PR #2 CI and finalize the report if needed**

```powershell
gh pr checks 2 --watch
gh pr view 2 --json url,statusCheckRollup
```

Expected: GitHub Actions `test` check PASS. Record the actual run URL and result in `REPORT.md`; if the report changes, commit and push `docs: record map story shell CI result`, then wait for that new head's check. If CI fails, set result to REVISE/REJECT as evidence dictates and do not claim completion.

---

## Plan self-review checklist

- [ ] Every production behavior starts with a focused failing test and an expected RED reason.
- [ ] Every task names exact files, interfaces, GREEN command, regression command, and commit boundary.
- [ ] `activateStoryState` is the sole shell navigation path and only Generic Story Runtime executes map actions.
- [ ] Selection uses ratio -> 45% activation-line distance -> index with a 0.01 ratio tie tolerance.
- [ ] Observer/keyboard/button/listener ownership is idempotent across repeated entry/exit.
- [ ] The shell contains no Route 61-2 IDs, fixed count, content, or action semantics.
- [ ] Mobile/projector behavior comes from one DOM, one story JSON, measured layout, and responsive CSS.
- [ ] Story Schema V1, Generic Story Runtime V1, action contracts, and story JSON remain unchanged.
- [ ] Browser certification includes all four viewports, persistent map identity, fast fling, lifecycle, accessibility, legacy path, map regressions, reduced motion, console, and horizontal overflow.
- [ ] Performance certification separates transitions from settled periods and records exact render/repaint/source mutation evidence.
- [ ] Final report and PR CI are evidence-backed; PR #2 is not merged automatically.
