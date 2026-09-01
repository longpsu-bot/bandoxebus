import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectLoadError } from '../src/project/project-error.js';
import { bootstrapProject, renderProjectLoadError } from '../src/project/bootstrap.js';
import { createGenericApplicationOptions } from '../src/runtime/generic-app.js';

function story() {
  return {
    schemaVersion: '1.0',
    id: 'main',
    title: 'Main',
    states: [{
      id: 'opening',
      content: { layout: 'hero', blocks: [{ type: 'heading', text: 'Opening' }] },
      map: { enter: [{ type: 'fixture.enter' }], exit: [{ type: 'fixture.exit' }] }
    }]
  };
}

function story12(interaction = 'locked') {
  return {
    schemaVersion: '1.2', id: 'main', title: 'Main',
    states: [{
      id: 'opening',
      content: { layout: 'freeform-16x9', blocks: [] },
      map: {
        camera: { center: [106.63, 11.06], zoom: 12, pitch: 35, bearing: -10 },
        interaction,
        transition: { type: 'instant', durationMs: 0 },
        layerVisibility: {},
        enter: [], exit: []
      }
    }]
  };
}

function entry(id, events, handlers = {}) {
  return {
    descriptor: { id },
    createCapability() {
      events.push(`create:${id}`);
      return {
        handlers,
        restore() { events.push(`restore:${id}`); },
        destroy() { events.push(`destroy:${id}`); }
      };
    }
  };
}

class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.attributes = {}; this.style = {}; this.dataset = {}; this.className = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}

function sceneDocument(sceneRoot) {
  return {
    documentElement: {},
    title: '',
    body: { prepend() {} },
    createElement: (tag) => new Element(tag),
    getElementById(id) { return id === 'scene-compositor' ? sceneRoot : null; }
  };
}

test('bootstrap creates one map and destroys capabilities in deterministic reverse order', async () => {
  const events = [];
  let mapCount = 0;
  let mapRemoveCount = 0;
  const project = {
    map: { initialView: { center: [0, 0], zoom: 1, pitch: 0, bearing: 0 } },
    story: story(),
    resources: new Map(),
    capabilities: {
      ordered: [
        entry('core-map-v1', events),
        entry('fixture-v1', events, {
          'fixture.enter': () => events.push('action:enter'),
          'fixture.exit': () => events.push('action:exit')
        })
      ],
      settings: {}
    }
  };

  const app = await bootstrapProject({
    project,
    maplibregl: {},
    createMap() { mapCount += 1; return { remove() { mapRemoveCount += 1; } }; }
  });
  assert.equal(mapCount, 1);
  app.storyRuntime.activate();
  app.destroy();
  app.destroy();
  assert.equal(mapRemoveCount, 1);
  assert.deepEqual(events, [
    'create:core-map-v1', 'create:fixture-v1',
    'action:enter', 'action:exit',
    'restore:fixture-v1', 'destroy:fixture-v1',
    'restore:core-map-v1', 'destroy:core-map-v1'
  ]);
});

test('default MapLibre construction receives the output cooperative-gesture policy', async () => {
  for (const cooperativeScroll of [true, false]) {
    let mapOptions;
    class MapLibreMap {
      constructor(options) { mapOptions = options; }
      remove() {}
    }
    const project = {
      map: { initialView: { center: [0, 0], zoom: 1, pitch: 0, bearing: 0 } },
      story: { ...story(), states: [{ ...story().states[0], map: { enter: [], exit: [] } }] },
      resources: new Map(),
      capabilities: { ordered: [], settings: {} }
    };

    const app = await bootstrapProject({
      project,
      maplibregl: { Map: MapLibreMap },
      cooperativeScroll
    });

    assert.equal(mapOptions.cooperativeGestures, cooperativeScroll);
    assert.deepEqual(mapOptions.attributionControl, { compact: true });
    assert.notEqual(mapOptions.attributionControl, false);
    app.destroy();
  }
});

test('bootstrap binds the selected Story experience around the same runtime and map', async () => {
  const map = {};
  let received;
  const project = {
    map: {},
    story: { ...story(), states: [{ ...story().states[0], map: { enter: [], exit: [] } }] },
    resources: new Map(),
    capabilities: { ordered: [], settings: {} }
  };
  const app = await bootstrapProject({
    project,
    createMap: () => map,
    bindStoryExperience(context) { received = context; return { destroy() {} }; }
  });
  assert.equal(received.map, map);
  assert.equal(received.runtime, app.storyRuntime);
  assert.equal(received.project, project);
  app.destroy();
});

test('Story 1.2 bootstrap wires the shared Scene controller into the existing runtime', async () => {
  const sceneRoot = new Element('section');
  const cameraCalls = [];
  const map = {
    jumpTo(options) { cameraCalls.push(['jumpTo', options]); },
    stop() { cameraCalls.push(['stop']); },
    remove() { cameraCalls.push(['remove']); }
  };
  const project = {
    locale: 'en-US',
    map: { initialView: { center: [0, 0], zoom: 1, pitch: 0, bearing: 0 } },
    story: story12(),
    resources: new Map(), tables: new Map(), attribution: {},
    capabilities: { ordered: [], settings: {} }
  };
  const documentRef = sceneDocument(sceneRoot);
  const app = await bootstrapProject({
    project,
    documentRef,
    Chart: function Chart() {},
    createMap: () => map
  });
  assert.ok(app.sceneController);
  app.storyRuntime.activate();
  assert.equal(sceneRoot.dataset.sceneId, 'opening');
  assert.equal(cameraCalls[0][0], 'jumpTo');
  app.destroy();
  assert.deepEqual(cameraCalls.map(([type]) => type), ['jumpTo', 'stop', 'remove']);
});

test('scroll output reaches the existing Scene interaction policy before first activation', async () => {
  for (const [search, expectedMode, expectedCooperative] of [
    ['?outputMode=scroll', 'scroll', true],
    ['?outputMode=presentation', 'presentation', false],
    ['?editorPreview=1', 'explore', false]
  ]) {
    const sceneRoot = new Element('section');
    const cooperative = [];
    const map = {
      jumpTo() {}, stop() {}, remove() {},
      setCooperativeGestures(value) { cooperative.push(value); }
    };
    const project = {
      locale: 'en-US',
      map: { initialView: { center: [0, 0], zoom: 1, pitch: 0, bearing: 0 } },
      story: story12('explore'),
      resources: new Map(), tables: new Map(), attribution: {},
      capabilities: { ordered: [], settings: {} }
    };
    const documentRef = sceneDocument(sceneRoot);
    const options = createGenericApplicationOptions({
      documentRef,
      windowRef: { location: { search }, matchMedia: () => ({ matches: false }) },
      Chart: function Chart() {}
    });
    assert.equal(options.outputMode, expectedMode);
    const app = await bootstrapProject({
      ...options,
      project,
      createMap: () => map,
      bindStoryExperience: undefined
    });

    app.storyRuntime.activate();
    assert.deepEqual(cooperative, [expectedCooperative]);
    app.destroy();
  }
});

test('fatal error text is assigned as text and never parsed as HTML', () => {
  const panel = {
    hidden: true,
    children: [],
    _text: '',
    set textContent(value) { this._text = value; this.children = []; },
    get textContent() { return this._text; },
    querySelector(selector) { return selector === 'img' ? this.children.find(({ tagName }) => tagName === 'IMG') ?? null : null; }
  };
  const documentRef = {
    getElementById: () => panel,
    createElement: (tagName) => ({ tagName: tagName.toUpperCase() }),
    body: { prepend(element) { panel.children.push(element); } }
  };
  const result = renderProjectLoadError(
    new ProjectLoadError('X', '$.title', '<img src=x onerror=1>'),
    { documentRef }
  );
  assert.equal(result, panel);
  assert.equal(panel.querySelector('img'), null);
  assert.match(panel.textContent, /<img src=x/);
  assert.equal(panel.hidden, false);
});
