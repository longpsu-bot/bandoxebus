import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectLoadError } from '../src/project/project-error.js';
import { bootstrapProject, renderProjectLoadError } from '../src/project/bootstrap.js';

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
