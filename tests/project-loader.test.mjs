import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCapabilityRegistry } from '../src/capabilities/capability-registry.js';
import { CORE_CONTENT_V1_DESCRIPTOR, createCoreContentCapability } from '../src/capabilities/core-content-v1.js';
import { CORE_MAP_V1_DESCRIPTOR, createCoreMapCapability } from '../src/capabilities/core-map-v1.js';
import { loadProject } from '../src/project/project-loader.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import { selectUrbanContextAdapter } from '../src/capabilities/urban-context-v1.js';

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

test('asset URL hook receives validated URLs and changes only asset resource records', async () => {
  const manifest = structuredClone(MANIFEST);
  manifest.assets.photo = {
    type: 'image',
    src: './assets/photo.png',
    mediaType: 'image/png'
  };
  const calls = [];
  const project = await loadProject('https://host/demo/project.json', {
    fetchImpl: fixtureFetch({ 'https://host/demo/project.json': manifest }),
    capabilityRegistry,
    resolveAssetUrl(url, context) {
      calls.push({ url: url.href, context });
      return 'blob:preview/photo';
    }
  });

  assert.deepEqual(calls, [{
    url: 'https://host/demo/assets/photo.png',
    context: { id: 'photo', descriptor: manifest.assets.photo }
  }]);
  assert.equal(project.resources.get('photo').url, 'blob:preview/photo');
  assert.equal(project.resources.get('route').url.href, 'https://host/demo/data/route.geojson');
});

test('omitting the asset URL hook preserves the existing production URL exactly', async () => {
  const manifest = structuredClone(MANIFEST);
  manifest.assets.photo = {
    type: 'image',
    src: './assets/photo.png',
    mediaType: 'image/png'
  };
  const project = await loadProject('https://host/demo/project.json', {
    fetchImpl: fixtureFetch({ 'https://host/demo/project.json': manifest }),
    capabilityRegistry
  });

  assert.equal(project.resources.get('photo').url.href, 'https://host/demo/assets/photo.png');
});

test('loaded frozen PMTiles resources bind to the runtime without fetching the archive', async () => {
  const manifest = structuredClone(MANIFEST);
  manifest.assets['overture-buildings-snapshot'] = {
    type: 'pmtiles', src: './assets/overture-buildings.pmtiles', mediaType: 'application/vnd.pmtiles'
  };
  manifest.capabilities.push({
    id: 'urban-context-v1', settings: {
      adapter: 'route-61-2-current', buildingSource: 'project-snapshot', overtureRelease: '2026-08-19.0',
      snapshot: {
        asset: 'overture-buildings-snapshot', theme: 'buildings', bounds: [106.59, 11.11, 106.61, 11.14],
        sha256: 'a'.repeat(64), byteLength: 128, generator: 'go-pmtiles', generatorVersion: '1.31.2',
        generatedAt: '2026-09-03T00:00:00Z', sourceContentLength: 1024
      }
    }
  });
  const fetched = [];
  const fetchFixture = fixtureFetch({ 'https://host/demo/project.json': manifest });
  const project = await loadProject('https://host/demo/project.json', {
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY,
    fetchImpl: (url) => { fetched.push(String(url)); return fetchFixture(url); }
  });
  const settings = project.capabilities.settings['urban-context-v1'];
  const adapter = await selectUrbanContextAdapter(settings, {
    map: { loaded: () => false, once() {}, getLayer() { return false; } },
    resources: project.resources, settings
  });
  assert.equal(adapter.state.urbanContextConfig.archiveBinding.url, 'https://host/demo/assets/overture-buildings.pmtiles');
  assert.deepEqual(adapter.state.urbanContextConfig.archiveBinding.bounds, [106.59, 11.11, 106.61, 11.14]);
  assert.equal(fetched.some((url) => url.endsWith('.pmtiles')), false);
  assert.equal(Object.isFrozen(project.resources.get('overture-buildings-snapshot')), true);
  assert.equal(project.story.id, 'main');
});
