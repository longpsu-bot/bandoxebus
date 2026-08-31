import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSceneAuthoringAdapter,
  SNAP_TOLERANCE_PX,
  snapSceneFrame
} from '../src/scene/scene-authoring-adapter.js';

function close(actual, expected, epsilon = 1e-9) {
  assert.equal(Math.abs(actual - expected) <= epsilon, true, `${actual} != ${expected}`);
}

test('snapping uses a fixed rendered-pixel tolerance against Scene edges and centers', () => {
  assert.equal(SNAP_TOLERANCE_PX, 8);
  const result = snapSceneFrame({
    frame: { x: 0.006, y: 0.451, width: 0.2, height: 0.1, z: 1 },
    bounds: { width: 1000, height: 500 },
    otherFrames: []
  });
  assert.deepEqual(result.frame, { x: 0, y: 0.45, width: 0.2, height: 0.1, z: 1 });
  assert.deepEqual(result.guides, [
    { axis: 'x', position: 0 },
    { axis: 'y', position: 0.5 }
  ]);
});

test('snapping also targets other object edges and centers without moving those objects', () => {
  const other = { x: 0.5, y: 0.2, width: 0.2, height: 0.2, z: 2 };
  const result = snapSceneFrame({
    frame: { x: 0.293, y: 0.204, width: 0.2, height: 0.1, z: 1 },
    bounds: { width: 1000, height: 1000 },
    otherFrames: [other]
  });
  assert.deepEqual(result.frame, { x: 0.3, y: 0.2, width: 0.2, height: 0.1, z: 1 });
  assert.deepEqual(result.guides, [
    { axis: 'x', position: 0.5 },
    { axis: 'y', position: 0.2 }
  ]);
  assert.deepEqual(other, { x: 0.5, y: 0.2, width: 0.2, height: 0.2, z: 2 });
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
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  focus() {}
}

function fixture() {
  const documentRef = { createElement: (tag) => new Element(tag) };
  const root = new Element('section');
  root.rect = { left: 0, top: 0, width: 1600, height: 900 };
  const overlay = new Element('section');
  Object.assign(overlay.dataset, {
    sceneOverlayId: 'title', semanticType: 'paragraph',
    sceneFrameX: '0.1', sceneFrameY: '0.2', sceneFrameWidth: '0.4', sceneFrameHeight: '0.2', sceneFrameZ: '3'
  });
  const text = new Element('p');
  overlay.append(text);
  root.append(overlay);
  return { documentRef, root, overlay };
}

test('pointer movement shows transient snap guides and pointer-up commits only the snapped frame', () => {
  const f = fixture();
  const events = [];
  const adapter = createSceneAuthoringAdapter({
    root: f.root,
    documentRef: f.documentRef,
    emit(type, payload) { events.push({ type, payload: structuredClone(payload) }); }
  });
  adapter.setMode('select');
  f.root.dispatch('pointerdown', { target: f.overlay, clientX: 160, clientY: 180, pointerId: 1 });
  f.root.dispatch('pointermove', { target: f.overlay, clientX: 6, clientY: 180, pointerId: 1 });
  assert.equal(events.some(({ type }) => type === 'commit-frame'), false);
  assert.equal(f.root.children.some(({ dataset }) => dataset.sceneSnapGuide === 'x'), true);
  f.root.dispatch('pointerup', { target: f.overlay, clientX: 6, clientY: 180, pointerId: 1 });
  assert.equal(f.root.children.some(({ dataset }) => dataset.sceneSnapGuide), false);
  const commit = events.find(({ type }) => type === 'commit-frame');
  assert.equal(commit.payload.id, 'title');
  close(commit.payload.frame.x, 0);
  adapter.destroy();
});

test('arrow keys nudge the selected object in rendered pixels and commit one normalized frame', () => {
  const f = fixture();
  const events = [];
  const adapter = createSceneAuthoringAdapter({
    root: f.root,
    documentRef: f.documentRef,
    emit(type, payload) { events.push({ type, payload: structuredClone(payload) }); }
  });
  adapter.setMode('select');
  f.root.dispatch('pointerdown', { target: f.overlay, clientX: 160, clientY: 180, pointerId: 1 });
  f.root.dispatch('pointerup', { target: f.overlay, clientX: 160, clientY: 180, pointerId: 1 });
  events.length = 0;

  f.root.dispatch('keydown', { target: f.root, key: 'ArrowRight' });
  const right = events.find(({ type }) => type === 'commit-frame');
  close(right.payload.frame.x, 0.1 + 1 / 1600);
  events.length = 0;
  f.root.dispatch('keydown', { target: f.root, key: 'ArrowDown', shiftKey: true });
  const down = events.find(({ type }) => type === 'commit-frame');
  close(down.payload.frame.y, 0.2 + 10 / 900);
  adapter.destroy();
});
