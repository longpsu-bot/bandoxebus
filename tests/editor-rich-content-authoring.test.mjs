import assert from 'node:assert/strict';
import test from 'node:test';

import { createScene12 } from '../editor/core/scene-commands.js';
import { applyStudioStoryCommand, mountStudioShell, resetStudioAuthoringSession } from '../editor/ui/studio-shell.js';
import { validateStoryDefinition } from '../src/story-schema.js';

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
  for (const label of ['Add Metric', 'Add Chart', 'Add Table', 'Add Image', 'Add Legend']) assert.ok(button(label), label);
  button('Add Metric').click();
  assert.equal(story.states[0].content.blocks[0].block.type, 'stat-group');
  assert.ok(byId.get('studio-metric-label'), 'Metric semantic label control');
  assert.equal(byId.has('studio-frame-x'), false, 'normalized frame remains canvas-authored');
});
