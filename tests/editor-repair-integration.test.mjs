import assert from 'node:assert/strict';
import test from 'node:test';

import { createNewProjectEntries } from '../editor/core/package-store.js';
import { createEditor } from '../editor/editor.js';

const encoder = new TextEncoder();

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
  click() { this.dispatchEvent({ type: 'click' }); }
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
  const ids = [
    'new-project', 'open-folder', 'import-zip', 'save-project', 'export-project-zip',
    'validate-project', 'preview-status', 'dirty-status', 'validation-status',
    'validation-errors', 'project-locale', 'story-heading', 'production-preview',
    'preview-frame', 'preview-paused', 'preview-desktop', 'preview-mobile',
    'ordering-announcements', 'studio-scenes'
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
  return { documentRef, windowRef, editor: createEditor({ documentRef, windowRef }) };
}

function malformedEntries(path, text) {
  return createNewProjectEntries().map((entry) => (
    entry.path === path ? { ...entry, bytes: encoder.encode(text) } : entry
  ));
}

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
