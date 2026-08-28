import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCapabilityRegistry } from '../src/capabilities/capability-registry.js';
import { CORE_CONTENT_V1_DESCRIPTOR, createCoreContentCapability } from '../src/capabilities/core-content-v1.js';
import { CORE_MAP_V1_DESCRIPTOR, createCoreMapCapability } from '../src/capabilities/core-map-v1.js';
import { loadProject } from '../src/project/project-loader.js';

const FIXTURE_ROOT = new URL('./fixtures/project-loader/minimal/', import.meta.url);
const MANIFEST = JSON.parse(await readFile(new URL('project.json', FIXTURE_ROOT), 'utf8'));
const STORY = JSON.parse(await readFile(new URL('stories/main.story.json', FIXTURE_ROOT), 'utf8'));
const ROUTE = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [[106.6, 11], [106.7, 11.1]] }
  }]
};

const capabilityRegistry = createCapabilityRegistry([
  { descriptor: CORE_CONTENT_V1_DESCRIPTOR, createCapability: createCoreContentCapability },
  { descriptor: CORE_MAP_V1_DESCRIPTOR, createCapability: createCoreMapCapability }
]);

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(value); } };
}

function fixtureFetch(overrides = {}) {
  const values = new Map([
    ['https://host/demo/project.json', MANIFEST],
    ['https://host/demo/stories/main.story.json', STORY],
    ['https://host/demo/data/route.geojson', ROUTE],
    ...Object.entries(overrides)
  ]);
  return async (url) => values.has(String(url)) ? jsonResponse(values.get(String(url))) : jsonResponse(null, 404);
}

test('project loader resolves a fixed manifest package into a frozen definition', async () => {
  const project = await loadProject('https://host/demo/project.json', {
    fetchImpl: fixtureFetch(),
    capabilityRegistry
  });

  assert.equal(project.story.id, 'main');
  assert.equal(project.story.schemaVersion, '1.0');
  assert.equal(project.locale, 'en-US');
  assert.equal(project.resources.get('route').url.href, 'https://host/demo/data/route.geojson');
  assert.deepEqual(project.resources.get('route').value, ROUTE);
  assert.equal(project.urls.stories.main.href, 'https://host/demo/stories/main.story.json');
  assert.equal(Object.isFrozen(project), true);
  assert.equal(Object.isFrozen(project.manifest), true);
  assert.equal(Object.isFrozen(project.story), true);
});

test('structural references fail before referenced resources are fetched', async () => {
  const invalid = structuredClone(MANIFEST);
  invalid.focusTargets.overview.datasets = ['missing'];
  const fetched = [];
  await assert.rejects(
    loadProject('https://host/demo/project.json', {
      capabilityRegistry,
      fetchImpl: async (url) => {
        fetched.push(String(url));
        return jsonResponse(invalid);
      }
    }),
    (error) => error.code === 'PROJECT_REFERENCE_INVALID'
      && error.path === '$.focusTargets.overview.datasets[0]'
  );
  assert.deepEqual(fetched, ['https://host/demo/project.json']);
});

test('resource semantics run before Story normalization', async () => {
  const invalidRoute = structuredClone(ROUTE);
  invalidRoute.features[0].geometry.type = 'Point';
  await assert.rejects(
    loadProject('https://host/demo/project.json', {
      fetchImpl: fixtureFetch({ 'https://host/demo/data/route.geojson': invalidRoute }),
      capabilityRegistry
    }),
    (error) => error.code === 'GEOJSON_RESOURCE_INVALID'
      && error.path === '$.datasets.route.features[0].geometry.type'
  );
});

test('unknown Story actions fail during loading before bootstrap is possible', async () => {
  const invalidStory = structuredClone(STORY);
  invalidStory.states[0].map.enter = [{ type: 'project.execute-code' }];
  await assert.rejects(
    loadProject('https://host/demo/project.json', {
      fetchImpl: fixtureFetch({ 'https://host/demo/stories/main.story.json': invalidStory }),
      capabilityRegistry
    }),
    (error) => error.code === 'STORY_10_ACTION_UNKNOWN'
      && error.path === '$.states.opening.map.enter[0].type'
  );
});
