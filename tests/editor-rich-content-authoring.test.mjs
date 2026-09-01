import assert from 'node:assert/strict';
import test from 'node:test';

import { createScene12 } from '../editor/core/scene-commands.js';
import * as studioShell from '../editor/ui/studio-shell.js';
import { validateStoryDefinition } from '../src/story-schema.js';

const { applyStudioStoryCommand, mountStudioShell, resetStudioAuthoringSession } = studioShell;

const catalogs = {
  metrics: [{ id: 'ridership', label: 'Daily ridership', format: { type: 'integer' } }],
  tables: [{ id: 'service-levels', columns: [
    { id: 'period', label: 'Period', type: 'text' },
    { id: 'trips', label: 'Trips', type: 'integer' }
  ] }],
  assets: [{ id: 'network-map' }]
};

function baseStory() {
  return {
    schemaVersion: '1.2', id: 'main', title: 'Main',
    states: [createScene12({ id: 'opening', camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } })]
  };
}

test('Studio rich-object commands reuse envelope composition and edit semantic production data', () => {
  let story = baseStory();
  for (const kind of ['metric', 'chart', 'table', 'image', 'legend']) {
    story = applyStudioStoryCommand(story, 'add-rich-object', { sceneIndex: 0, kind, catalogs });
  }
  assert.deepEqual(story.states[0].content.blocks.map(({ block }) => block.type), [
    'stat-group', 'chart', 'table', 'image', 'legend'
  ]);
  assert.deepEqual(story.states[0].content.blocks.map(({ frame }) => frame.z), [0, 1, 2, 3, 4]);

  story = applyStudioStoryCommand(story, 'edit-rich-block', {
    sceneIndex: 0,
    id: 'chart',
    block: {
      type: 'chart', chartType: 'line', title: 'Service by period',
      data: { dataset: 'service-levels', x: 'period', series: [{ y: 'trips', label: 'Trips' }] }
    }
  });
  assert.equal(story.states[0].content.blocks[1].block.title, 'Service by period');
  assert.equal(story.states[0].content.blocks[1].block.chartType, 'line');
  assert.equal(validateStoryDefinition(story, { actionContracts: {} }), story);
});

test('rich-object editing cannot change the semantic family or add arbitrary internals', () => {
  const story = applyStudioStoryCommand(baseStory(), 'add-rich-object', { sceneIndex: 0, kind: 'chart', catalogs });
  assert.throws(() => applyStudioStoryCommand(story, 'edit-rich-block', {
    sceneIndex: 0, id: 'chart', block: { type: 'paragraph', text: 'replacement' }
  }), /cannot change/i);
  assert.throws(() => applyStudioStoryCommand(story, 'edit-rich-block', {
    sceneIndex: 0, id: 'chart', block: { ...story.states[0].content.blocks[0].block, config: {} }
  }), /invalid story definition|unknown property/i);
});

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map(); this.attributes = new Map();
    this.dataset = {}; this.classList = { add() {}, remove() {} }; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'id') this.id = String(value); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  click() { for (const listener of this.listeners.get('click') ?? []) listener({ shiftKey: false }); }
  change() { for (const listener of this.listeners.get('change') ?? []) listener({}); }
  keydown(key) { for (const listener of this.listeners.get('keydown') ?? []) listener({ key }); }
}
const walk = (node) => [node, ...node.children.flatMap(walk)];

test('Studio Add menu exposes every rich family and selected Metric Properties edit production data', () => {
  resetStudioAuthoringSession();
  const byId = new Map();
  const documentRef = {
    createElement(tag) {
      const node = new Element(tag);
      const set = node.setAttribute.bind(node);
      node.setAttribute = (name, value) => { set(name, value); if (name === 'id') byId.set(String(value), node); };
      return node;
    },
    getElementById(id) { return byId.get(id) ?? null; }
  };
  const roots = [new Element('nav'), new Element('aside'), new Element('section'), new Element('div')];
  let story = baseStory();
  const mount = () => mountStudioShell({
    documentRef, navigation: roots[0], inspector: roots[1], scenesHost: roots[2], previewToolbar: roots[3],
    manifest: { id: 'rich-project', datasets: {}, assets: { 'network-map': { type: 'image' } } }, story, catalogs,
    onStoryCommand(name, payload) { story = applyStudioStoryCommand(story, name, payload); mount(); }
  });
  mount();
  const button = (label) => roots.flatMap(walk).find((node) => node.tagName === 'BUTTON' && node.textContent === label);
  for (const label of ['Metric', 'Chart', 'Table', 'Image', 'Legend']) assert.ok(button(label), label);
  button('Metric').click();
  assert.equal(story.states[0].content.blocks[0].block.type, 'stat-group');
  assert.ok(byId.get('studio-metric-label'), 'Metric semantic label control');
  assert.equal(byId.has('studio-frame-x'), false, 'normalized frame remains canvas-authored');
});

test('Blank Studio inserts Heading, Body text, and Legend immediately while resource-backed buttons request guided insertion', () => {
  resetStudioAuthoringSession();
  const documentRef = { createElement: (tag) => new Element(tag), getElementById: () => null };
  const roots = [new Element('nav'), new Element('aside'), new Element('section'), new Element('div')];
  let story = baseStory();
  const requests = [];
  const mount = () => mountStudioShell({
    documentRef, navigation: roots[0], inspector: roots[1], scenesHost: roots[2], previewToolbar: roots[3],
    manifest: { id: 'blank-project', datasets: {}, assets: {} }, story, catalogs: { metrics: [], tables: [], assets: [] },
    onStoryCommand(name, payload) { story = applyStudioStoryCommand(story, name, payload); mount(); },
    onRequestInsert(kind, insert) { requests.push({ kind, insert }); }
  });
  mount();
  const button = (label) => roots.flatMap(walk).find((node) => node.tagName === 'BUTTON' && node.textContent === label);

  button('Heading').click();
  button('Body text').click();
  button('Legend').click();
  assert.deepEqual(story.states[0].content.blocks.map(({ block }) => block.type), ['heading', 'paragraph', 'legend']);

  const beforeResourceRequests = structuredClone(story);
  for (const label of ['Metric', 'Chart', 'Table', 'Image']) assert.doesNotThrow(() => button(label).click());
  assert.deepEqual(requests.map(({ kind }) => kind), ['metric', 'chart', 'table', 'image']);
  assert.deepEqual(story, beforeResourceRequests, 'opening or cancelling resource guidance must not mutate Story data');
  assert.equal(requests.every(({ insert }) => typeof insert === 'function'), true);
});

test('guided rich insertion commits an explicit resource and selects the production-valid object', () => {
  resetStudioAuthoringSession();
  const byId = new Map();
  const documentRef = {
    createElement(tag) {
      const node = new Element(tag);
      const set = node.setAttribute.bind(node);
      node.setAttribute = (name, value) => { set(name, value); if (name === 'id') byId.set(String(value), node); };
      return node;
    },
    getElementById(id) { return byId.get(id) ?? null; }
  };
  const roots = [new Element('nav'), new Element('aside'), new Element('section'), new Element('div')];
  let story = baseStory();
  let pendingInsert;
  const mount = () => mountStudioShell({
    documentRef, navigation: roots[0], inspector: roots[1], scenesHost: roots[2], previewToolbar: roots[3],
    manifest: { id: 'choice-project', datasets: {}, assets: {} }, story, catalogs,
    onStoryCommand(name, payload) { story = applyStudioStoryCommand(story, name, payload); mount(); },
    onRequestInsert(_kind, insert) { pendingInsert = insert; }
  });
  mount();
  roots.flatMap(walk).find((node) => node.tagName === 'BUTTON' && node.textContent === 'Metric').click();
  pendingInsert({ metricId: 'ridership' }, catalogs);

  const inserted = story.states[0].content.blocks[0];
  assert.equal(inserted.block.items[0].metric, 'ridership');
  assert.equal(validateStoryDefinition(story, { actionContracts: {} }), story);
  assert.ok(byId.get('studio-metric-label'), 'new rich object is selected and its Properties are open');
});

test('Studio derives semantic object and Scene labels without mutating stable production IDs', () => {
  assert.equal(typeof studioShell.deriveStudioObjectLabel, 'function');
  assert.equal(typeof studioShell.deriveStudioSceneLabel, 'function');
  const story = baseStory();
  story.states[0].id = 'existing-route-context';
  story.states[0].content.blocks.push({
    id: 'internal-heading-7',
    block: { type: 'heading', text: 'Existing route context' },
    frame: { x: 4, y: 4, width: 40, height: 16, z: 0 }
  });
  const before = structuredClone(story);

  assert.equal(studioShell.deriveStudioObjectLabel(story.states[0].content.blocks[0]), 'Heading · Existing route context');
  assert.equal(studioShell.deriveStudioSceneLabel(story.states[0], 0), 'Existing route context');
  assert.deepEqual(story, before);
  assert.equal(story.states[0].id, 'existing-route-context');
  assert.equal(story.states[0].content.blocks[0].id, 'internal-heading-7');
});

test('Studio layer selection is UI-only, does not toggle Scene visibility, and reaches the existing properties adapter', () => {
  resetStudioAuthoringSession();
  const byId = new Map();
  const documentRef = {
    createElement(tag) {
      const node = new Element(tag);
      const set = node.setAttribute.bind(node);
      node.setAttribute = (name, value) => { set(name, value); if (name === 'id') byId.set(String(value), node); };
      return node;
    },
    getElementById(id) { return byId.get(id) ?? null; }
  };
  const roots = [new Element('nav'), new Element('aside'), new Element('section'), new Element('div')];
  const story = baseStory();
  story.states[0].map.layerVisibility.route = true;
  const before = structuredClone(story);
  const commands = [];
  const renderedLayerProperties = [];
  const mount = () => mountStudioShell({
    documentRef, navigation: roots[0], inspector: roots[1], scenesHost: roots[2], previewToolbar: roots[3],
    manifest: { id: 'layer-project', datasets: { route: { type: 'geojson', label: 'Existing route', render: { type: 'line', color: '#00AAFF', width: 4 } } }, assets: {} },
    story,
    onStoryCommand(name, payload) { commands.push([name, payload]); },
    onRenderLayerProperties(datasetId, inspector) {
      renderedLayerProperties.push(datasetId);
      inspector.append(new Element('section'));
    }
  });
  mount();
  const nodes = () => roots.flatMap(walk);
  const layerButton = nodes().find((node) => node.tagName === 'BUTTON' && node.textContent === 'Existing route');
  assert.ok(layerButton, 'human-labeled layer selection control');
  layerButton.click();

  assert.deepEqual(story, before, 'selection does not serialize into Story data');
  assert.deepEqual(commands, [], 'selection does not author visibility');
  assert.deepEqual(renderedLayerProperties, ['route']);
  const visibility = nodes().find((node) => node.tagName === 'INPUT' && node.attributes.get('type') === 'checkbox');
  visibility.checked = false;
  visibility.change();
  assert.equal(commands.length, 1);
  assert.equal(commands[0][0], 'replace-story');
  assert.equal(commands[0][1].story.states[0].map.layerVisibility.route, false);
  const visibilityOnly = structuredClone(commands[0][1].story);
  visibilityOnly.states[0].map.layerVisibility.route = true;
  assert.deepEqual(visibilityOnly, before);
});

test('Studio hierarchy, local canvas modes, semantic cards, and keyboard Scene movement remain accessible', () => {
  resetStudioAuthoringSession();
  const documentRef = { createElement: (tag) => new Element(tag), getElementById: () => null };
  const roots = [new Element('nav'), new Element('aside'), new Element('section'), new Element('div')];
  const story = baseStory();
  story.states[0].content.blocks.push({
    id: 'opening-heading', block: { type: 'heading', text: 'Opening context' },
    frame: { x: 4, y: 4, width: 40, height: 16, z: 0 }
  });
  story.states.push(createScene12({ id: 'future-network', camera: { center: [1, 1], zoom: 3, pitch: 0, bearing: 0 } }));
  const selectedScenes = [];
  mountStudioShell({
    documentRef, navigation: roots[0], inspector: roots[1], scenesHost: roots[2], previewToolbar: roots[3],
    manifest: { id: 'hierarchy-project', datasets: {}, assets: {} }, story,
    onSelectScene(index) { selectedScenes.push(index); }
  });
  const nodes = roots.flatMap(walk);
  assert.deepEqual(nodes.filter((node) => node.tagName === 'H2').map(({ textContent }) => textContent), [
    'Layers', 'Insert', 'Objects', 'Properties', 'Scenes'
  ]);
  assert.deepEqual(nodes.filter((node) => node.tagName === 'BUTTON' && ['Select', 'Map'].includes(node.textContent)).map(({ textContent }) => textContent), ['Select', 'Map']);
  assert.equal(nodes.some((node) => node.tagName === 'BUTTON' && ['Preview Story', 'Present'].includes(node.textContent)), false);
  assert.ok(nodes.some((node) => node.tagName === 'BUTTON' && node.textContent === 'Heading · Opening context'));
  const sceneCards = roots[2].children.flatMap(walk).filter((node) => node.tagName === 'BUTTON' && node.attributes.get('role') === 'listitem');
  assert.equal(sceneCards[0].children.some((node) => node.textContent === 'Opening context'), true);
  assert.equal(sceneCards[1].children.some((node) => node.textContent === 'Future network'), true);
  sceneCards[0].keydown('ArrowRight');
  assert.deepEqual(selectedScenes, [1]);
  for (const label of ['Move previous', 'Move next']) assert.ok(nodes.some((node) => node.tagName === 'BUTTON' && node.textContent === label), label);
});

test('Scene and Text Properties expose meaningful groups with friendly enum labels', () => {
  resetStudioAuthoringSession();
  const documentRef = { createElement: (tag) => new Element(tag), getElementById: () => null };
  const roots = [new Element('nav'), new Element('aside'), new Element('section'), new Element('div')];
  const story = baseStory();
  story.states[0].content.blocks.push({
    id: 'opening-heading', block: { type: 'heading', text: 'Opening context' },
    frame: { x: 4, y: 4, width: 40, height: 16, z: 0 }
  });
  const options = { documentRef, navigation: roots[0], inspector: roots[1], scenesHost: roots[2], previewToolbar: roots[3], manifest: { id: 'property-project', datasets: {}, assets: {} }, story };
  mountStudioShell(options);
  assert.deepEqual(walk(roots[1]).filter((node) => node.tagName === 'H3').map(({ textContent }) => textContent), ['Scene', 'Camera']);
  const sceneOptions = walk(roots[1]).filter((node) => node.tagName === 'OPTION').map(({ textContent }) => textContent);
  for (const label of ['Locked map', 'Zoom only', 'Free explore', 'Fly', 'Smooth', 'Instant']) assert.ok(sceneOptions.includes(label), label);

  mountStudioShell({ ...options, selectedOverlayId: 'opening-heading' });
  assert.deepEqual(walk(roots[1]).filter((node) => node.tagName === 'H3').map(({ textContent }) => textContent), ['Text', 'Appearance', 'Arrange']);
});
