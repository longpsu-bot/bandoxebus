import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewBridge, PREVIEW_PROTOCOL_VERSION } from '../editor/preview/bridge.js';

function envelope(type, revision, payload = {}, requestId = `request-${revision}`) {
  return { protocol: PREVIEW_PROTOCOL_VERSION, type: `editor-preview:${type}`, revision, requestId, payload };
}

function bridgeWindow() {
  const listeners = new Map();
  return {
    location: { origin: 'https://editor.example' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    emit(type, event) { listeners.get(type)?.(event); }
  };
}

test('parent bridge accepts only exact authoring events from current iframe origin and revision', () => {
  const windowRef = bridgeWindow();
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

  assert.deepEqual(events.map(({ type }) => type), [
    'editor-preview:select-overlay',
    'editor-preview:commit-frame',
    'editor-preview:commit-text'
  ]);
  bridge.dispose();
});

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.className = '';
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
  }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener)); }
  dispatch(type, values = {}) {
    const event = { type, target: this, preventDefault() {}, stopPropagation() {}, ...values };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'contenteditable') this.contentEditable = String(value); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'contenteditable') delete this.contentEditable; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  focus() {}
}

function authoringFixture() {
  const documentRef = { createElement: (tag) => new Element(tag) };
  const root = new Element('section');
  root.rect = { left: 0, top: 0, width: 1600, height: 900 };
  const overlay = new Element('section');
  Object.assign(overlay.dataset, {
    sceneOverlayId: 'title', semanticType: 'paragraph',
    sceneFrameX: '0.1', sceneFrameY: '0.2', sceneFrameWidth: '0.4', sceneFrameHeight: '0.2', sceneFrameZ: '3'
  });
  const text = new Element('p');
  text.textContent = 'Original';
  overlay.append(text);
  root.append(overlay);
  return { documentRef, root, overlay, text };
}

test('drag and resize stay transient until pointer-up and commit bounded normalized frames', async () => {
  const { createSceneAuthoringAdapter } = await import('../src/scene/scene-authoring-adapter.js');
  const fixture = authoringFixture();
  const events = [];
  const adapter = createSceneAuthoringAdapter({
    root: fixture.root,
    documentRef: fixture.documentRef,
    emit(type, payload) { events.push({ type, payload: structuredClone(payload) }); }
  });
  adapter.setMode('select');

  fixture.root.dispatch('pointerdown', { target: fixture.overlay, clientX: 200, clientY: 220, pointerId: 1 });
  fixture.root.dispatch('pointermove', { target: fixture.overlay, clientX: -500, clientY: 1000, pointerId: 1 });
  assert.equal(events.filter(({ type }) => type === 'commit-frame').length, 0);
  fixture.root.dispatch('pointerup', { target: fixture.overlay, clientX: -500, clientY: 1000, pointerId: 1 });
  const dragCommit = events.find(({ type }) => type === 'commit-frame');
  assert.deepEqual(dragCommit.payload, {
    id: 'title',
    frame: { x: 0, y: 0.8, width: 0.4, height: 0.2, z: 3 }
  });

  const handle = fixture.overlay.children.find(({ dataset }) => dataset.sceneResizeHandle === 'se');
  assert.ok(handle, 'selection creates one southeast resize handle');
  fixture.root.dispatch('pointerdown', { target: handle, clientX: 640, clientY: 720, pointerId: 2 });
  fixture.root.dispatch('pointermove', { target: handle, clientX: 2400, clientY: 1800, pointerId: 2 });
  const beforeUp = events.filter(({ type }) => type === 'commit-frame').length;
  fixture.root.dispatch('pointerup', { target: handle, clientX: 2400, clientY: 1800, pointerId: 2 });
  const commits = events.filter(({ type }) => type === 'commit-frame');
  assert.equal(commits.length, beforeUp + 1);
  const resized = commits.at(-1).payload.frame;
  assert.equal(resized.x >= 0 && resized.y >= 0, true);
  assert.equal(resized.width > 0 && resized.height > 0, true);
  assert.equal(resized.x + resized.width <= 1, true);
  assert.equal(resized.y + resized.height <= 1, true);
  adapter.destroy();
});

test('direct Text editing is preview-only plain text and emits one semantic commit on blur', async () => {
  const { createSceneAuthoringAdapter } = await import('../src/scene/scene-authoring-adapter.js');
  const fixture = authoringFixture();
  const events = [];
  const adapter = createSceneAuthoringAdapter({
    root: fixture.root,
    documentRef: fixture.documentRef,
    emit(type, payload) { events.push({ type, payload: structuredClone(payload) }); }
  });
  adapter.setMode('select');

  fixture.root.dispatch('dblclick', { target: fixture.overlay });
  assert.equal(fixture.text.getAttribute('contenteditable'), 'plaintext-only');
  fixture.text.textContent = '<b>Still plain text</b>';
  fixture.text.dispatch('blur');

  assert.deepEqual(events.filter(({ type }) => type === 'commit-text'), [{
    type: 'commit-text', payload: { id: 'title', text: '<b>Still plain text</b>' }
  }]);
  assert.equal(fixture.text.getAttribute('contenteditable'), null);
  adapter.destroy();
});
