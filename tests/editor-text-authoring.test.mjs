import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createHistory } from '../editor/core/history.js';
import { createScene12 } from '../editor/core/scene-commands.js';
import {
  applyStudioStoryCommand,
  mountStudioShell,
  resetStudioAuthoringSession
} from '../editor/ui/studio-shell.js';
import { validateStoryDefinition } from '../src/story-schema.js';

class ClassList {
  constructor(owner) { this.owner = owner; this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); this.owner.className = [...this.values].join(' '); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); this.owner.className = [...this.values].join(' '); }
  toggle(value, force) { const enabled = force ?? !this.values.has(value); if (enabled) this.add(value); else this.remove(value); return enabled; }
}

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.selected = false;
    this.disabled = false;
    this.hidden = false;
    this.className = '';
    this.classList = new ClassList(this);
  }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  dispatch(type, values = {}) { const event = { type, target: this, key: values.key, preventDefault() {}, ...values }; for (const listener of this.listeners.get(type) ?? []) listener(event); }
  click() { this.dispatch('click'); }
}

function walk(root) {
  return [root, ...root.children.flatMap((child) => walk(child))];
}

function findById(roots, id) {
  return roots.flatMap((root) => walk(root)).find((node) => node.id === id) ?? null;
}

function findButton(roots, text) {
  return roots.flatMap((root) => walk(root)).find((node) => node.tagName === 'BUTTON' && node.textContent === text) ?? null;
}

function baseStory() {
  return {
    schemaVersion: '1.2', id: 'main', title: 'Main',
    states: [createScene12({ id: 'opening', camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } })]
  };
}

function renderHarness({ selectedOverlayId = null } = {}) {
  resetStudioAuthoringSession();
  const elementsById = new Map();
  const documentRef = {
    createElement(tag) {
      const node = new Element(tag);
      const original = node.setAttribute.bind(node);
      node.setAttribute = (name, value) => {
        original(name, value);
        if (name === 'id') elementsById.set(String(value), node);
      };
      return node;
    },
    getElementById(id) { return elementsById.get(id) ?? null; }
  };
  for (const id of ['undo-command', 'redo-command']) {
    const button = documentRef.createElement('button');
    button.setAttribute('id', id);
    button.disabled = true;
  }
  const navigation = new Element('nav');
  const inspector = new Element('aside');
  const scenesHost = new Element('section');
  const previewToolbar = new Element('div');
  const roots = [navigation, inspector, scenesHost, previewToolbar];
  let current = baseStory();
  let selected = selectedOverlayId;

  function render() {
    mountStudioShell({
      documentRef,
      navigation,
      inspector,
      scenesHost,
      previewToolbar,
      manifest: { id: 'fixture-project', datasets: {} },
      story: current,
      sceneIndex: 0,
      selectedOverlayId: selected,
      onSelectOverlay(id) { selected = id; },
      onStoryCommand(name, payload) {
        current = applyStudioStoryCommand(current, name, payload);
        if (name === 'add-text') selected = current.states[0].content.blocks.at(-1).id;
        render();
      },
      onPreviewCommand() {}
    });
  }
  render();
  return {
    roots,
    documentRef,
    get story() { return current; },
    get selected() { return selected; },
    set selected(value) { selected = value; render(); },
    render
  };
}

test('Studio Add Heading/Body creates valid Text envelopes and selection is UI-only', () => {
  const h = renderHarness();
  findButton(h.roots, 'Add Heading').click();
  assert.equal(h.selected, 'heading');
  assert.deepEqual(h.story.states[0].content.blocks[0].block, { type: 'heading', text: 'Heading' });
  const afterHeading = JSON.stringify(h.story);

  h.selected = null;
  assert.equal(JSON.stringify(h.story), afterHeading, 'selection must not mutate production Story');
  findButton(h.roots, 'Add Body Text').click();
  assert.deepEqual(h.story.states[0].content.blocks.map(({ block }) => block.type), ['heading', 'paragraph']);
  assert.equal(validateStoryDefinition(h.story, { actionContracts: {} }), h.story);
});

test('Text Properties expose approved appearance controls without normalized frame inputs', () => {
  const h = renderHarness();
  findButton(h.roots, 'Add Heading').click();
  const requiredControls = [
    'studio-text-content', 'studio-text-font', 'studio-text-font-size', 'studio-text-bold',
    'studio-text-italic', 'studio-text-color', 'studio-text-align', 'studio-text-line-height',
    'studio-box-fill', 'studio-box-opacity', 'studio-box-border-color', 'studio-box-border-width',
    'studio-box-radius', 'studio-box-padding'
  ];
  for (const id of requiredControls) assert.ok(findById(h.roots, id), id);
  for (const forbidden of ['studio-frame-x', 'studio-frame-y', 'studio-frame-width', 'studio-frame-height']) {
    assert.equal(findById(h.roots, forbidden), null, forbidden);
  }

  const content = findById(h.roots, 'studio-text-content');
  content.value = 'Edited heading';
  content.dispatch('change');
  const size = findById(h.roots, 'studio-text-font-size');
  size.value = '64';
  size.dispatch('change');
  const bold = findById(h.roots, 'studio-text-bold');
  bold.checked = false;
  bold.dispatch('change');
  const fill = findById(h.roots, 'studio-box-fill');
  fill.value = '#112233AA';
  fill.dispatch('change');

  const envelope = h.story.states[0].content.blocks[0];
  assert.equal(envelope.block.text, 'Edited heading');
  assert.equal(envelope.appearance.text.fontSize, 64);
  assert.equal(envelope.appearance.text.bold, false);
  assert.equal(envelope.appearance.box.fill, '#112233AA');
});

test('preview frame/text intents and UI commands share history, then undo/redo exact Story state', () => {
  let current = baseStory();
  const history = createHistory({ read: () => current, write(next) { current = structuredClone(next); } });
  const execute = (name, payload) => history.execute((story) => applyStudioStoryCommand(story, name, payload));

  execute('add-text', { sceneIndex: 0, kind: 'body' });
  execute('edit-text', { sceneIndex: 0, id: 'body-text', text: 'Direct edit' });
  execute('commit-frame', { sceneIndex: 0, id: 'body-text', frame: { x: 0.2, y: 0.3, width: 0.4, height: 0.2, z: 4 } });
  const final = structuredClone(current);
  assert.equal(history.undoDepth, 3);
  history.undo();
  assert.notDeepEqual(current, final);
  history.redo();
  assert.deepEqual(current, final);
  assert.equal(validateStoryDefinition(current, { actionContracts: {} }), current);
});

test('Studio module integrates one bounded history with validated preview intents and topbar Undo/Redo', async () => {
  const [studioSource, bridgeSource] = await Promise.all([
    readFile(new URL('../editor/ui/studio-shell.js', import.meta.url), 'utf8'),
    readFile(new URL('../editor/preview/bridge.js', import.meta.url), 'utf8')
  ]);
  for (const required of [
    /createHistory/, /undo-command/, /redo-command/,
    /editor-preview:select-overlay/, /editor-preview:commit-frame/, /editor-preview:commit-text/,
    /history\.execute|activeHistory\.execute/
  ]) assert.match(`${studioSource}\n${bridgeSource}`, required);
  assert.doesNotMatch(studioSource, /selectedOverlayId\s*=.*onStoryCommand\(['"]replace-story/);
});
