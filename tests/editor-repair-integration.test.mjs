import assert from 'node:assert/strict';
import test from 'node:test';

import { createNewProjectEntries } from '../editor/core/package-store.js';
import { addTextEnvelope } from '../editor/core/scene-commands.js';
import { createEditor } from '../editor/editor.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class TestClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }
  add(...values) { values.forEach((value) => this.values.add(value)); this.sync(); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); this.sync(); }
  toggle(value, force) {
    const active = force === undefined ? !this.values.has(value) : Boolean(force);
    if (active) this.values.add(value); else this.values.delete(value);
    this.sync();
    return active;
  }
  contains(value) { return this.values.has(value); }
  sync() { this.owner.className = [...this.values].join(' '); }
}

class TestElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.className = '';
    this.classList = new TestClassList(this);
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.required = false;
    this.checked = false;
    this.selected = false;
    this.contentWindow = { postMessage() {} };
    this.contentDocument = null;
  }
  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    this.children.forEach((child) => { child.parentNode = null; });
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatchEvent(event) {
    event.target ??= this;
    for (const listener of this.listeners.get(event.type) ?? []) listener(event);
    return true;
  }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }
  focus() {}
  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === 'id') this.id = text;
    if (name === 'class') {
      this.className = text;
      this.classList.values = new Set(text.split(/\s+/).filter(Boolean));
    }
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      this.dataset[key] = text;
    }
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const data = selector.match(/^\[data-([a-z-]+)="([^"]+)"\]$/);
    if (data) {
      const key = data[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      return this.dataset[key] === data[2];
    }
    return false;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
}

function editorHarness() {
  const posted = [];
  const ids = [
    'new-project', 'open-folder', 'import-zip', 'save-project', 'export-project-zip',
    'validate-project', 'preview-story', 'present-story', 'preview-status', 'dirty-status', 'validation-status',
    'validation-errors', 'project-locale', 'story-heading', 'production-preview',
    'preview-frame', 'preview-paused', 'preview-desktop', 'preview-mobile',
    'ordering-announcements', 'studio-scenes', 'undo-command', 'redo-command', 'project-menu'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new TestElement('div', id)]));
  const roots = {
    '.editor-inspector': new TestElement('aside'),
    '.editor-navigation': new TestElement('nav'),
    '.editor-layout': new TestElement('div'),
    '.preview-toolbar': new TestElement('div')
  };
  elements['production-preview'].dataset = {
    previewSrc: '../?editorPreview=1',
    previewSrcLegacy: '../?editorPreview=1',
    previewSrcStory12: '../src/runtime/?editorPreview=1'
  };
  elements['production-preview'].contentWindow = {
    postMessage(message, origin) { posted.push({ message, origin }); }
  };
  const allRoots = [...Object.values(roots), ...Object.values(elements)];
  const documentRef = {
    body: new TestElement('body'),
    createElement(tagName) { return new TestElement(tagName); },
    getElementById(id) {
      if (elements[id]) return elements[id];
      for (const root of allRoots) {
        if (root.id === id) return root;
        const match = root.querySelector(`#${id}`);
        if (match) return match;
      }
      return null;
    },
    querySelector(selector) { return roots[selector] ?? null; }
  };
  const listeners = new Map();
  const windowRef = {
    location: { origin: 'https://editor.example' },
    Event: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    matchMedia() { return { matches: false }; },
    confirm() { return false; }
  };
  return {
    documentRef,
    windowRef,
    posted,
    preview: elements['production-preview'],
    emitMessage(data) {
      listeners.get('message')?.({
        type: 'message',
        source: elements['production-preview'].contentWindow,
        origin: windowRef.location.origin,
        data
      });
    },
    editor: createEditor({ documentRef, windowRef })
  };
}

function entriesWithHeading() {
  return createNewProjectEntries({ id: 'shared-project', title: 'Shared project' }).map((entry) => {
    if (entry.path !== 'stories/main.story.json') return entry;
    const story = JSON.parse(decoder.decode(entry.bytes));
    return { ...entry, bytes: encoder.encode(`${JSON.stringify(addTextEnvelope(story, {
      sceneIndex: 0,
      kind: 'heading'
    }), null, 2)}\n`) };
  });
}

function walk(root) {
  return [root, ...root.children.flatMap((child) => walk(child))];
}

function findButton(documentRef, text) {
  const roots = [
    documentRef.querySelector('.editor-navigation'),
    documentRef.querySelector('.editor-inspector'),
    documentRef.querySelector('.preview-toolbar'),
    documentRef.getElementById('studio-scenes')
  ];
  return roots.flatMap((root) => walk(root)).find((node) => (
    node.tagName === 'BUTTON' && node.textContent === text
  )) ?? null;
}

function malformedEntries(path, text) {
  return createNewProjectEntries().map((entry) => (
    entry.path === path ? { ...entry, bytes: encoder.encode(text) } : entry
  ));
}

test('Studio image insertion lists only images from a mixed image and PMTiles project', async (t) => {
  const harness = editorHarness();
  t.after(() => harness.editor.dispose());
  const entries = createNewProjectEntries().map((entry) => {
    if (entry.path !== 'project.json') return entry;
    const manifest = JSON.parse(decoder.decode(entry.bytes));
    manifest.assets = {
      'overture-buildings-snapshot': {
        type: 'pmtiles', src: './assets/context/overture-buildings.pmtiles',
        mediaType: 'application/vnd.pmtiles', required: true, attribution: []
      },
      'site-photo': {
        type: 'image', src: './assets/site.svg', label: 'Site photo',
        mediaType: 'image/svg+xml', required: true, attribution: []
      },
      'route-photo': {
        type: 'image', src: './assets/route.svg',
        mediaType: 'image/svg+xml', required: true, attribution: []
      }
    };
    return { ...entry, bytes: encoder.encode(JSON.stringify(manifest)) };
  });
  entries.push(
    { path: 'assets/context/overture-buildings.pmtiles', bytes: new Uint8Array([1, 2, 3]), mediaType: 'application/vnd.pmtiles', kind: 'asset' },
    ...['site', 'route'].map((name) => ({
      path: `assets/${name}.svg`, bytes: encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      mediaType: 'image/svg+xml', kind: 'asset'
    }))
  );
  await harness.editor.openEntries(entries);
  findButton(harness.documentRef, 'Image').click();
  const chooser = harness.documentRef.getElementById('studio-insert-image-resource');
  assert.equal(chooser.tagName, 'SELECT');
  assert.deepEqual(chooser.children.map(({ value, textContent }) => [value, textContent]), [
    ['site-photo', 'Site photo'],
    ['route-photo', 'route-photo']
  ]);
});

for (const [label, path] of [
  ['project manifest', 'project.json'],
  ['primary Story', 'stories/main.story.json']
]) {
  test(`malformed ${label} opens into integrated source repair mode`, async () => {
    const invalid = `{ malformed ${label}`;
    const harness = editorHarness();

    await harness.editor.openEntries(malformedEntries(path, invalid), { label: `Broken ${label}` });

    const repair = harness.documentRef.getElementById('source-repair-text');
    assert.ok(repair, 'source repair textarea is rendered');
    assert.equal(repair.value, invalid);
    assert.match(harness.documentRef.getElementById('validation-status').textContent, /invalid/i);
    harness.editor.dispose();
  });
}

test('preview reload reapplies the Studio authoring mode shown by the toolbar', async () => {
  const harness = editorHarness();
  await harness.editor.openEntries(createNewProjectEntries(), { label: 'Map mode project' });

  harness.preview.dispatchEvent({ type: 'load' });
  const hello = harness.posted.findLast(({ message }) => message.type === 'editor-preview:hello').message;
  harness.emitMessage({ ...hello, type: 'editor-preview:ready', payload: {} });
  const start = harness.posted.findLast(({ message }) => message.type === 'editor-preview:start').message;

  findButton(harness.documentRef, 'Map').click();
  harness.emitMessage({
    protocol: 1,
    type: 'editor-preview:loaded',
    revision: start.revision,
    requestId: start.requestId,
    payload: {}
  });

  const authoringModes = harness.posted
    .filter(({ message }) => message.type === 'editor-preview:command' && message.payload.name === 'authoring-mode')
    .map(({ message }) => message.payload.payload.mode);
  assert.deepEqual(authoringModes, ['map', 'map']);
  harness.editor.dispose();
});

test('opening a replacement package clears Redo even when project and Story IDs match', async () => {
  const harness = editorHarness();
  const entries = entriesWithHeading();
  await harness.editor.openEntries(entries, { label: 'Project A' });

  findButton(harness.documentRef, 'Heading · Heading').click();
  const text = harness.documentRef.getElementById('studio-text-content');
  text.value = 'Project A only';
  text.dispatchEvent({ type: 'change' });
  harness.documentRef.getElementById('undo-command').click();
  assert.equal(harness.documentRef.getElementById('redo-command').disabled, false);

  await harness.editor.openEntries(entries, { label: 'Project B' });

  assert.equal(harness.documentRef.getElementById('redo-command').disabled, true);
  findButton(harness.documentRef, 'Heading · Heading').click();
  assert.equal(harness.documentRef.getElementById('studio-text-content').value, 'Heading');
  harness.editor.dispose();
});

test('opening a project closes the transient Project menu without serializing menu state', async () => {
  const harness = editorHarness();
  const menu = harness.documentRef.getElementById('project-menu');
  menu.open = true;

  await harness.editor.openEntries(entriesWithHeading(), { label: 'Menu fixture' });

  assert.equal(menu.open, false);
  harness.editor.dispose();
});
