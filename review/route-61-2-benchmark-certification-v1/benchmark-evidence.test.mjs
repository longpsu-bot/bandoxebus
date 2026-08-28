import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStoryActionRunner } from '../../src/story-action-runner.js';
import { createStoryRuntime } from '../../src/story-runtime.js';
import { validateStoryDefinition } from '../../src/story-schema.js';
import {
  createStoryShell,
  renderStorySteps
} from '../../src/story-shell.js';
import { renderPresentationContent } from '../../src/presentation-renderer.js';
import { ROUTE_612_STORY_ACTION_CONTRACTS } from '../../src/route-61-2-story-actions.js';

const STORY_URL = new URL('../../data/stories/route-61-2.story.json', import.meta.url);
const APP_URL = new URL('../../src/app.js', import.meta.url);
const ROUTE_DATA_URL = new URL('../../src/route-data.js', import.meta.url);

const clone = (value) => JSON.parse(JSON.stringify(value));

async function productionStory() {
  return JSON.parse(await readFile(STORY_URL, 'utf8'));
}

class TestClassList {
  constructor(owner) { this.owner = owner; }
  toggle(token, force) {
    const names = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    const enabled = force ?? !names.has(token);
    if (enabled) names.add(token); else names.delete(token);
    this.owner.className = [...names].join(' ');
    return enabled;
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
    this.hidden = true;
    this.disabled = false;
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  scrollIntoView() {}
}

function testDocument() {
  return {
    body: new TestElement('body'),
    createElement: (tagName) => new TestElement(tagName)
  };
}

function actionRecorder(calls) {
  return createStoryActionRunner(Object.fromEntries(
    Object.keys(ROUTE_612_STORY_ACTION_CONTRACTS).map((type) => [
      type,
      (action, context) => calls.push({ action: clone(action), phase: context.phase, stateId: context.state.id })
    ])
  ));
}

function alteredStory(source) {
  const definition = clone(source);
  const byId = Object.fromEntries(definition.states.map((state) => [state.id, state]));
  const added = {
    id: 'editor-authored-interchange',
    content: {
      layout: 'metrics',
      blocks: [
        { type: 'eyebrow', step: 'X', text: 'Alternate sequence' },
        { type: 'heading', text: 'Config-only interchange case', subtitle: 'No application edit' },
        { type: 'paragraph', text: 'A newly authored state.\n\nThe second paragraph is also serialized.' },
        { type: 'stat-group', items: [{ label: 'Stops', metric: 'proposedStopCount', format: 'integer', tone: 'proposed' }] },
        { type: 'callout', items: [{ label: 'Finding', text: 'Supported blocks can be recomposed.', tone: 'changed' }] },
        { type: 'disclosure', text: 'Certification-only in-memory fixture.' }
      ]
    },
    map: {
      enter: [
        { type: 'map.focus', target: 'existing', camera: { pitch: 35, bearing: 12, maxZoom: 11.8 } },
        { type: 'map.mode', mode: 'compare' },
        { type: 'map.poi-emphasis', active: true },
        { type: 'route.reveal', active: true, delayMs: 25 },
        { type: 'map.urban-context', mode: 'off' }
      ],
      exit: [
        { type: 'route.reveal', active: false },
        { type: 'map.poi-emphasis', active: false }
      ]
    }
  };

  byId['route-changes'].content.blocks.find(({ type }) => type === 'heading').text = 'Rewritten evidence heading';
  byId['route-changes'].content.layout = 'narrative';
  byId.connections.map.enter = [
    { type: 'map.urban-context', mode: 'off' },
    { type: 'map.poi-emphasis', active: false },
    { type: 'map.mode', mode: 'existing' },
    { type: 'map.focus', target: 'connections', camera: { pitch: 30, bearing: 20, maxZoom: 11.5 } }
  ];

  definition.title = 'Alternate Route Planning Narrative';
  definition.states = [
    byId.connections,
    byId.intro,
    added,
    byId['route-changes'],
    byId['service-area'],
    byId['final-proposal']
  ];
  return definition;
}

test('config-only experiment reorders, removes, adds, rewrites content, and rewrites action composition', async () => {
  const canonical = await productionStory();
  const changed = alteredStory(canonical);
  validateStoryDefinition(changed, { actionContracts: ROUTE_612_STORY_ACTION_CONTRACTS });

  assert.deepEqual(changed.states.map(({ id }) => id), [
    'connections',
    'intro',
    'editor-authored-interchange',
    'route-changes',
    'service-area',
    'final-proposal'
  ]);
  assert.equal(changed.states.length, 6);
  assert.equal(changed.states[3].content.layout, 'narrative');
  assert.equal(changed.states[3].content.blocks.find(({ type }) => type === 'heading').text, 'Rewritten evidence heading');

  const calls = [];
  const runtime = createStoryRuntime({ definition: changed, actionRunner: actionRecorder(calls) });
  runtime.activate(2);
  assert.equal(runtime.currentState.id, 'editor-authored-interchange');
  assert.deepEqual(calls.map(({ action }) => action.type), [
    'map.focus', 'map.mode', 'map.poi-emphasis', 'route.reveal', 'map.urban-context'
  ]);
  assert.equal(calls.every(({ stateId, phase }) => stateId === 'editor-authored-interchange' && phase === 'enter'), true);

  runtime.goTo(3);
  assert.deepEqual(calls.slice(5, 7).map(({ action }) => action.type), ['route.reveal', 'map.poi-emphasis']);
  assert.equal(calls[7].stateId, 'route-changes');
  assert.equal(runtime.next().id, 'service-area');
  assert.equal(runtime.goTo(99).id, 'final-proposal');
  assert.equal(runtime.next().id, 'final-proposal');
});

test('Story Shell DOM count, progress, order, content, and boundaries follow a six-state altered definition', async () => {
  const definition = alteredStory(await productionStory());
  const documentRef = testDocument();
  const calls = [];
  const runtime = createStoryRuntime({ definition, actionRunner: actionRecorder(calls) });
  const elements = {
    root: new TestElement('section'),
    steps: new TestElement('div'),
    progressCurrent: new TestElement('span'),
    progressTotal: new TestElement('span'),
    previousButton: new TestElement('button'),
    nextButton: new TestElement('button'),
    exitButton: new TestElement('button')
  };
  const shell = createStoryShell({
    runtime,
    elements,
    metrics: { proposedStopCount: 12 },
    renderContent: renderPresentationContent,
    documentRef,
    windowRef: { innerHeight: 900, addEventListener() {}, removeEventListener() {} },
    observerFactory: () => ({ observe() {}, disconnect() {} })
  });

  shell.enter();
  assert.equal(shell.sections.length, 6);
  assert.equal(elements.progressTotal.textContent, '6');
  assert.deepEqual(shell.sections.map(({ dataset }) => dataset.storyStateId), definition.states.map(({ id }) => id));
  assert.equal(shell.sections[2].children[0].children.some(({ textContent }) => textContent === 'Config-only interchange case'), true);
  assert.equal(elements.previousButton.disabled, true);
  shell.activateStoryState(99);
  assert.equal(elements.progressCurrent.textContent, '6');
  assert.equal(elements.nextButton.disabled, true);
});

test('one altered serialized definition renders equivalently for desktop and mobile consumers', async () => {
  const definition = alteredStory(await productionStory());
  const renderAtViewport = (viewport) => {
    const documentRef = testDocument();
    const container = new TestElement('div');
    const sections = renderStorySteps({
      container,
      states: definition.states,
      metrics: { proposedStopCount: 12 },
      renderContent: renderPresentationContent,
      documentRef
    });
    return {
      viewport,
      sourceFingerprint: JSON.stringify(definition),
      ids: sections.map(({ dataset }) => dataset.storyStateId),
      headings: sections.map((section) => section.children[0].children.find(({ tagName }) => tagName === 'h2')?.textContent)
    };
  };

  const desktop = renderAtViewport({ width: 1920, height: 1080 });
  const mobile = renderAtViewport({ width: 390, height: 844 });
  assert.equal(desktop.sourceFingerprint, mobile.sourceFingerprint);
  assert.deepEqual(desktop.ids, mobile.ids);
  assert.deepEqual(desktop.headings, mobile.headings);
});

test('canonical Route 61-2 story remains unchanged after all in-memory experiments', async () => {
  const canonical = await productionStory();
  assert.deepEqual(canonical.states.map(({ id }) => id), [
    'intro', 'existing', 'adjustment-context', 'route-changes',
    'service-area', 'connections', 'final-proposal'
  ]);
  assert.equal(canonical.title, 'Tuyến 61-2');
  assert.equal(canonical.states[0].content.blocks.find(({ type }) => type === 'heading').text, 'Tuyến 61-2');
});

test('hypothetical serialized project manifest is not consumed by the current application boundary', async () => {
  const alternateProject = {
    id: 'alternate-corridor',
    title: 'Alternate Corridor',
    storyPath: './data/stories/alternate.story.json',
    datasets: {
      existingRoute: './data/alternate/existing.geojson',
      proposedRoute: './data/alternate/proposed.geojson',
      existingStops: './data/alternate/existing-stops.geojson',
      proposedStops: './data/alternate/proposed-stops.geojson',
      pois: './data/alternate/pois.geojson',
      contextPolygon: './data/alternate/context.geojson',
      overtureBuildings: './data/alternate/buildings.geojson'
    },
    focusTargets: { overview: { datasets: ['existingRoute', 'proposedRoute'] } },
    defaultView: { center: [105.8, 10.8], zoom: 9.5, pitch: 30, bearing: 0 },
    attribution: [{ label: 'Alternate authority', url: 'https://example.invalid/source' }]
  };
  assert.deepEqual(JSON.parse(JSON.stringify(alternateProject)), alternateProject);

  const [appSource, routeDataSource] = await Promise.all([
    readFile(APP_URL, 'utf8'),
    readFile(ROUTE_DATA_URL, 'utf8')
  ]);
  assert.doesNotMatch(appSource, /project-manifest|projectManifest|loadProject/i);
  assert.match(appSource, /loadStoryDefinition\(['"]\.\/data\/stories\/route-61-2\.story\.json['"]/);
  assert.match(appSource, /fetch\(['"]\.\/data\/industrial-zone-poc\.geojson['"]\)/);
  assert.match(appSource, /center:\s*\[106\.63,\s*11\.06\]/);
  assert.match(appSource, /from ['"]\.\/route-data\.js['"]/);
  assert.match(routeDataSource, /export const existingRouteLatLng/);
  assert.match(routeDataSource, /export const proposedRouteLatLng/);
  assert.match(routeDataSource, /export const landmarks/);
});
