import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewBridge, PREVIEW_PROTOCOL_VERSION } from '../editor/preview/bridge.js';

function envelope(type, revision, payload = {}, requestId = `request-${revision}`) {
  return { protocol: PREVIEW_PROTOCOL_VERSION, type: `editor-preview:${type}`, revision, requestId, payload };
}

test('parent bridge accepts only exact authoring events from current iframe origin and revision', () => {
  const listeners = new Map();
  const windowRef = {
    location: { origin: 'https://editor.example' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    emit(type, event) { listeners.get(type)?.(event); }
  };
  const frame = { postMessage() {} };
  const iframe = { contentWindow: frame, addEventListener() {}, removeEventListener() {}, dataset: {} };
  const events = [];
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin, onEvent: (event) => events.push(event) });
  bridge.start({ revision: 7, snapshot: { revision: 7, entries: [] } });
  const valid = [
    envelope('select-overlay', 7, { id: 'title' }),
    envelope('commit-frame', 7, { id: 'title', frame: { x: 0.1, y: 0.2, width: 0.4, height: 0.2, z: 3 } }),
    envelope('commit-text', 7, { id: 'title', text: 'Updated title' })
  ];
  for (const data of valid) windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data });
  windowRef.emit('message', { source: {}, origin: windowRef.location.origin, data: valid[0] });
  windowRef.emit('message', { source: frame, origin: 'https://evil.example', data: valid[0] });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('select-overlay', 6, { id: 'title' }) });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('commit-text', 7, { id: 'title', text: 'x', html: '<b>x</b>' }) });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('commit-frame', 7, { id: 'title', frame: { x: -1, y: 0, width: 1, height: 1, z: 0 } }) });
  assert.deepEqual(events.map(({ type }) => type), ['editor-preview:select-overlay', 'editor-preview:commit-frame', 'editor-preview:commit-text']);
  bridge.dispose();
});

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase(); this.children = []; this.parentNode = null; this.dataset = {}; this.style = {};
    this.attributes = new Map(); this.listeners = new Map(); this.textContent = ''; this.className = '';
    this.rect = { left: 0, top: 0, width: 0, height: 0 }; this.capturedPointers = new Set();
  }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  dispatch(type, values = {}) { const event = { type, target: this, preventDefault() {}, stopPropagation() {}, ...values }; for (const listener of this.listeners.get(type) ?? []) listener(event); return event; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'contenteditable') this.contentEditable = String(value); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'contenteditable') delete this.contentEditable; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  setPointerCapture(pointerId) { this.capturedPointers.add(pointerId); }
  releasePointerCapture(pointerId) { this.capturedPointers.delete(pointerId); }
  hasPointerCapture(pointerId) { return this.capturedPointers.has(pointerId); }
  focus() {}
}

function frameData(id, semanticType, { x, y, width, height, z }) {
  return { sceneOverlayId: id, semanticType, sceneFrameX: String(x), sceneFrameY: String(y), sceneFrameWidth: String(width), sceneFrameHeight: String(height), sceneFrameZ: String(z) };
}

function fixture({ semanticType = 'paragraph' } = {}) {
  const documentRef = { createElement: (tag) => new Element(tag) };
  const root = new Element('section'); root.rect = { left: 0, top: 0, width: 1000, height: 500 };
  const overlay = new Element('section'); Object.assign(overlay.dataset, frameData('title', semanticType, { x: 0.2, y: 0.2, width: 0.4, height: 0.3, z: 3 }));
  const text = new Element('p'); text.textContent = 'Original'; overlay.append(text);
  const other = new Element('section'); Object.assign(other.dataset, frameData('other', 'chart', { x: 0.5, y: 0.6, width: 0.2, height: 0.2, z: 8 })); other.append(new Element('canvas'));
  root.append(overlay, other); return { documentRef, root, overlay, other, text };
}

const chromeOf = (root) => root.children.find(({ dataset }) => dataset.sceneSelectionChrome !== undefined);
const handleOf = (root, direction) => chromeOf(root)?.children.find(({ dataset }) => dataset.sceneResizeHandle === direction);
const currentFrame = (overlay) => ({ x: Number(overlay.dataset.sceneFrameX), y: Number(overlay.dataset.sceneFrameY), width: Number(overlay.dataset.sceneFrameWidth), height: Number(overlay.dataset.sceneFrameHeight), z: Number(overlay.dataset.sceneFrameZ) });
async function adapterFor(f, events = []) {
  const { createSceneAuthoringAdapter } = await import('../src/scene/scene-authoring-adapter.js');
  return createSceneAuthoringAdapter({ root: f.root, documentRef: f.documentRef, emit(type, payload) { events.push({ type, payload: structuredClone(payload) }); } });
}

test('directional resize geometry moves only the requested edges and preserves z', async () => {
  const { resizeSceneFrame } = await import('../src/scene/scene-authoring-adapter.js');
  const start = { x: 0.2, y: 0.2, width: 0.4, height: 0.3, z: 7 };
  const cases = [
    ['nw', 100, 100, { x: 0.3, y: 0.3, width: 0.3, height: 0.2, z: 7 }], ['n', 0, 100, { x: 0.2, y: 0.3, width: 0.4, height: 0.2, z: 7 }],
    ['ne', 100, 100, { x: 0.2, y: 0.3, width: 0.5, height: 0.2, z: 7 }], ['e', 100, 0, { x: 0.2, y: 0.2, width: 0.5, height: 0.3, z: 7 }],
    ['se', 100, 100, { x: 0.2, y: 0.2, width: 0.5, height: 0.4, z: 7 }], ['s', 0, 100, { x: 0.2, y: 0.2, width: 0.4, height: 0.4, z: 7 }],
    ['sw', 100, 100, { x: 0.3, y: 0.2, width: 0.3, height: 0.4, z: 7 }], ['w', 100, 0, { x: 0.3, y: 0.2, width: 0.3, height: 0.3, z: 7 }]
  ];
  for (const [direction, dx, dy, expected] of cases) assert.deepEqual(resizeSceneFrame({ start, direction, dx, dy, bounds: { width: 1000, height: 1000 }, minSizePx: 20 }), { frame: expected, guides: [] }, direction);
});

test('directional resize clamps bounds and minimum size without flipping', async () => {
  const { resizeSceneFrame } = await import('../src/scene/scene-authoring-adapter.js');
  const options = { start: { x: 0.2, y: 0.2, width: 0.4, height: 0.3, z: 2 }, bounds: { width: 1000, height: 500 }, minSizePx: 24 };
  assert.deepEqual(resizeSceneFrame({ ...options, direction: 'nw', dx: -500, dy: -500 }).frame, { x: 0, y: 0, width: 0.6, height: 0.5, z: 2 });
  assert.deepEqual(resizeSceneFrame({ ...options, direction: 'nw', dx: 1000, dy: 1000 }).frame, { x: 0.576, y: 0.452, width: 0.024, height: 0.048, z: 2 });
  assert.deepEqual(resizeSceneFrame({ ...options, direction: 'se', dx: 1000, dy: 1000 }).frame, { x: 0.2, y: 0.2, width: 0.8, height: 0.8, z: 2 });
});

test('Shift, Alt, and combined corner resize preserve ratio and center', async () => {
  const { resizeSceneFrame } = await import('../src/scene/scene-authoring-adapter.js');
  const base = { start: { x: 0.2, y: 0.2, width: 0.4, height: 0.2, z: 3 }, bounds: { width: 1000, height: 1000 } };
  assert.deepEqual(resizeSceneFrame({ ...base, direction: 'se', dx: 100, dy: 50, shiftKey: true }).frame, { x: 0.2, y: 0.2, width: 0.5, height: 0.25, z: 3 });
  assert.deepEqual(resizeSceneFrame({ ...base, direction: 'e', dx: 100, dy: 0, altKey: true }).frame, { x: 0.1, y: 0.2, width: 0.6, height: 0.2, z: 3 });
  assert.deepEqual(resizeSceneFrame({ ...base, direction: 'se', dx: 100, dy: 50, shiftKey: true, altKey: true }).frame, { x: 0.1, y: 0.15, width: 0.6, height: 0.3, z: 3 });
});

test('resize snapping targets only moved edges at Scene and other-object anchors', async () => {
  const { resizeSceneFrame } = await import('../src/scene/scene-authoring-adapter.js');
  const common = { bounds: { width: 1000, height: 1000 }, otherFrames: [{ x: 0.5, y: 0.6, width: 0.2, height: 0.2, z: 8 }] };
  const west = resizeSceneFrame({ ...common, start: { x: 0.506, y: 0.2, width: 0.294, height: 0.2, z: 3 }, direction: 'w', dx: -4, dy: 0 });
  assert.deepEqual(west, { frame: { x: 0.5, y: 0.2, width: 0.3, height: 0.2, z: 3 }, guides: [{ axis: 'x', position: 0.5 }] });
  const north = resizeSceneFrame({ ...common, start: { x: 0.2, y: 0.506, width: 0.2, height: 0.294, z: 3 }, direction: 'n', dx: 0, dy: -4 });
  assert.deepEqual(north.guides, [{ axis: 'y', position: 0.5 }]); assert.equal(north.frame.y + north.frame.height, 0.8);
  const east = resizeSceneFrame({ ...common, start: { x: 0.204, y: 0.2, width: 0.29, height: 0.2, z: 3 }, direction: 'e', dx: 2, dy: 0 });
  assert.equal(east.frame.x, 0.204); assert.equal(east.frame.x + east.frame.width, 0.5);
});

test('selection creates separate chrome with exactly eight accessible cursor-mapped handles', async () => {
  const f = fixture(); const adapter = await adapterFor(f); adapter.selectOverlay('title');
  const chrome = chromeOf(f.root); assert.ok(chrome); assert.equal(chrome.parentNode, f.root); assert.equal(f.overlay.children.some(({ dataset }) => dataset.sceneResizeHandle), false);
  assert.equal(chrome.getAttribute('aria-hidden'), null, 'focusable labelled handles remain exposed to assistive technology');
  const expected = [['nw', 'nwse-resize'], ['n', 'ns-resize'], ['ne', 'nesw-resize'], ['e', 'ew-resize'], ['se', 'nwse-resize'], ['s', 'ns-resize'], ['sw', 'nesw-resize'], ['w', 'ew-resize']];
  assert.deepEqual(chrome.children.filter(({ dataset }) => dataset.sceneResizeHandle).map(({ dataset }) => dataset.sceneResizeHandle), expected.map(([direction]) => direction));
  for (const [direction, cursor] of expected) { const handle = handleOf(f.root, direction); assert.equal(handle.style.cursor, cursor); assert.equal(handle.getAttribute('aria-label'), `Resize title from ${direction}`); }
  adapter.destroy();
});

test('preview host can restore selection chrome silently after a rerender', async () => {
  const f = fixture(); const events = []; const adapter = await adapterFor(f, events);
  adapter.selectOverlay('title', { emitSelection: false, focus: false });
  assert.ok(chromeOf(f.root));
  assert.deepEqual(events, []);
  adapter.destroy();
});

test('selecting an already-selected object does not echo a duplicate selection event', async () => {
  const f = fixture(); const events = []; const adapter = await adapterFor(f, events);
  adapter.selectOverlay('title');
  adapter.selectOverlay('title');
  assert.deepEqual(events.filter(({ type }) => type === 'select-overlay'), [
    { type: 'select-overlay', payload: { id: 'title' } }
  ]);
  adapter.destroy();
});

test('click and sub-threshold movement select without moving or committing', async () => {
  const f = fixture(); const events = []; const adapter = await adapterFor(f, events); const start = currentFrame(f.overlay);
  f.root.dispatch('pointerdown', { target: f.overlay, clientX: 200, clientY: 100, pointerId: 1 }); assert.equal(f.root.hasPointerCapture(1), true);
  f.root.dispatch('pointermove', { target: f.overlay, clientX: 203, clientY: 102, pointerId: 1 }); f.root.dispatch('pointerup', { target: f.overlay, clientX: 203, clientY: 102, pointerId: 1 });
  assert.deepEqual(currentFrame(f.overlay), start); assert.equal(events.filter(({ type }) => type === 'commit-frame').length, 0); assert.equal(f.root.hasPointerCapture(1), false); assert.ok(chromeOf(f.root)); adapter.destroy();
});

test('movement above threshold stays transient and pointer-up emits exactly one commit', async () => {
  const f = fixture(); const events = []; const adapter = await adapterFor(f, events);
  f.root.dispatch('pointerdown', { target: f.overlay, clientX: 200, clientY: 100, pointerId: 2 }); f.root.dispatch('pointermove', { target: f.overlay, clientX: 220, clientY: 120, pointerId: 2 });
  assert.deepEqual(currentFrame(f.overlay), { x: 0.22, y: 0.24, width: 0.4, height: 0.3, z: 3 }); assert.equal(events.filter(({ type }) => type === 'commit-frame').length, 0);
  f.root.dispatch('pointerup', { target: f.overlay, clientX: 220, clientY: 120, pointerId: 2 });
  assert.deepEqual(events.filter(({ type }) => type === 'commit-frame'), [{ type: 'commit-frame', payload: { id: 'title', frame: { x: 0.22, y: 0.24, width: 0.4, height: 0.3, z: 3 } } }]); adapter.destroy();
});

for (const [eventType, values] of [['pointercancel', { pointerId: 3 }], ['lostpointercapture', { pointerId: 3 }], ['keydown', { key: 'Escape' }]]) {
  test(`${eventType} rolls an active move back with no commit`, async () => {
    const f = fixture(); const events = []; const adapter = await adapterFor(f, events); const start = currentFrame(f.overlay);
    f.root.dispatch('pointerdown', { target: f.overlay, clientX: 200, clientY: 100, pointerId: 3 }); f.root.dispatch('pointermove', { target: f.overlay, clientX: 250, clientY: 150, pointerId: 3 }); f.root.dispatch(eventType, { target: f.root, ...values });
    assert.deepEqual(currentFrame(f.overlay), start); assert.equal(events.filter(({ type }) => type === 'commit-frame').length, 0); assert.equal(f.root.children.some(({ dataset }) => dataset.sceneSnapGuide), false); assert.equal(f.root.hasPointerCapture(3), false); adapter.destroy();
  });
}

test('all eight handles resize transiently without changing semantic content or z', async () => {
  const expected = { nw: [0.25, 0.3, 0.35, 0.2], n: [0.2, 0.3, 0.4, 0.2], ne: [0.2, 0.3, 0.45, 0.2], e: [0.2, 0.2, 0.45, 0.3], se: [0.2, 0.2, 0.45, 0.4], s: [0.2, 0.2, 0.4, 0.4], sw: [0.25, 0.2, 0.35, 0.4], w: [0.25, 0.2, 0.35, 0.3] };
  for (const direction of Object.keys(expected)) {
    const f = fixture({ semanticType: direction === 'nw' ? 'image' : 'paragraph' }); const events = []; const adapter = await adapterFor(f, events); adapter.selectOverlay('title'); const handle = handleOf(f.root, direction);
    f.root.dispatch('pointerdown', { target: handle, clientX: 200, clientY: 100, pointerId: 10 }); f.root.dispatch('pointermove', { target: handle, clientX: 250, clientY: 150, pointerId: 10 });
    const [x, y, width, height] = expected[direction]; assert.deepEqual(currentFrame(f.overlay), { x, y, width, height, z: 3 }, direction); assert.equal(events.filter(({ type }) => type === 'commit-frame').length, 0); assert.equal(f.text.textContent, 'Original');
    f.root.dispatch('pointerup', { target: handle, clientX: 250, clientY: 150, pointerId: 10 }); assert.equal(events.filter(({ type }) => type === 'commit-frame').length, 1); adapter.destroy();
  }
});

test('resize badge reports rendered pixels live and hides after completion and cancel', async () => {
  const f = fixture(); const adapter = await adapterFor(f); adapter.selectOverlay('title'); const handle = handleOf(f.root, 'se'); const badge = chromeOf(f.root).children.find(({ dataset }) => dataset.sceneResizeFeedback !== undefined);
  assert.equal(badge.getAttribute('aria-hidden'), 'true'); assert.equal(badge.getAttribute('hidden'), '');
  f.root.dispatch('pointerdown', { target: handle, clientX: 200, clientY: 100, pointerId: 20 }); f.root.dispatch('pointermove', { target: handle, clientX: 250, clientY: 150, pointerId: 20 });
  assert.equal(badge.textContent, '450 × 200'); assert.equal(badge.getAttribute('hidden'), null); f.root.dispatch('pointerup', { target: handle, clientX: 250, clientY: 150, pointerId: 20 }); assert.equal(badge.getAttribute('hidden'), '');
  f.root.dispatch('pointerdown', { target: handle, clientX: 250, clientY: 150, pointerId: 21 }); f.root.dispatch('pointermove', { target: handle, clientX: 300, clientY: 200, pointerId: 21 }); f.root.dispatch('pointercancel', { target: handle, pointerId: 21 }); assert.equal(badge.getAttribute('hidden'), ''); adapter.destroy();
});

test('mode change and destroy rollback and remove chrome, guides, capture, and listeners', async () => {
  const f = fixture(); const events = []; const adapter = await adapterFor(f, events); const start = currentFrame(f.overlay);
  f.root.dispatch('pointerdown', { target: f.overlay, clientX: 200, clientY: 100, pointerId: 30 }); f.root.dispatch('pointermove', { target: f.overlay, clientX: 250, clientY: 150, pointerId: 30 }); adapter.setMode('map');
  assert.deepEqual(currentFrame(f.overlay), start); assert.equal(chromeOf(f.root), undefined); assert.equal(events.filter(({ type }) => type === 'commit-frame').length, 0);
  adapter.setMode('select'); adapter.selectOverlay('title'); f.root.dispatch('pointerdown', { target: f.overlay, clientX: 200, clientY: 100, pointerId: 31 }); f.root.dispatch('pointermove', { target: f.overlay, clientX: 250, clientY: 150, pointerId: 31 }); adapter.destroy();
  assert.deepEqual(currentFrame(f.overlay), start); assert.equal(chromeOf(f.root), undefined); assert.equal([...f.root.listeners.values()].flat().length, 0);
});

test('direct Text editing remains plaintext-only with Escape cancellation and blur commit', async () => {
  const f = fixture(); const events = []; const adapter = await adapterFor(f, events);
  f.root.dispatch('dblclick', { target: f.overlay }); assert.equal(f.text.getAttribute('contenteditable'), 'plaintext-only'); f.text.textContent = '<b>Still plain text</b>'; f.text.dispatch('keydown', { key: 'Escape' });
  assert.equal(events.filter(({ type }) => type === 'commit-text').length, 0); assert.equal(f.text.getAttribute('contenteditable'), null);
  f.root.dispatch('dblclick', { target: f.overlay }); f.text.dispatch('blur'); assert.deepEqual(events.filter(({ type }) => type === 'commit-text'), [{ type: 'commit-text', payload: { id: 'title', text: '<b>Still plain text</b>' } }]); adapter.destroy();
});

test('Arrow and Shift Arrow retain one-pixel and ten-pixel commits', async () => {
  const f = fixture(); const events = []; const adapter = await adapterFor(f, events); adapter.selectOverlay('title'); events.length = 0;
  f.root.dispatch('keydown', { target: f.root, key: 'ArrowRight' }); f.root.dispatch('keydown', { target: f.root, key: 'ArrowDown', shiftKey: true });
  assert.deepEqual(events.filter(({ type }) => type === 'commit-frame').map(({ payload }) => payload.frame), [{ x: 0.201, y: 0.2, width: 0.4, height: 0.3, z: 3 }, { x: 0.201, y: 0.22, width: 0.4, height: 0.3, z: 3 }]); adapter.destroy();
});
