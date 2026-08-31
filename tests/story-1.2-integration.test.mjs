import assert from 'node:assert/strict';
import test from 'node:test';

import { createCapabilityRegistry } from '../src/capabilities/capability-registry.js';
import { CORE_CONTENT_V1_DESCRIPTOR, createCoreContentCapability } from '../src/capabilities/core-content-v1.js';
import { CORE_MAP_V1_DESCRIPTOR, createCoreMapCapability } from '../src/capabilities/core-map-v1.js';
import { loadProject } from '../src/project/project-loader.js';

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

function manifest() {
  return {
    schemaVersion: '1.0',
    id: 'story-12-project',
    title: 'Story 1.2 project',
    locale: 'en-US',
    stories: { primary: 'main', items: [{ id: 'main', src: './stories/main.story.json' }] },
    map: { basemap: 'openfreemap-dark', initialView: { center: [106.63, 11.06], zoom: 10.7, pitch: 46, bearing: -18 } },
    datasets: {
      route: {
        type: 'geojson', geometry: 'line', src: './data/route.geojson', label: 'Route',
        render: { type: 'line', color: '#2BB7FF', width: 4 }
      },
      table: {
        type: 'table-json', src: './data/table.json', label: 'Table', required: false
      }
    },
    assets: {},
    focusTargets: {},
    capabilities: [],
    attribution: {}
  };
}

function story(blocks = [], layerVisibility = { route: true }) {
  return {
    schemaVersion: '1.2', id: 'main', title: 'Main',
    states: [{
      id: 'opening',
      content: { layout: 'freeform-16x9', blocks },
      map: {
        camera: { center: [106.63, 11.06], zoom: 10.7, pitch: 46, bearing: -18 },
        interaction: 'locked',
        transition: { type: 'ease', durationMs: 900 },
        layerVisibility,
        enter: [], exit: []
      }
    }]
  };
}

function envelope(block, id = 'content') {
  return { id, frame: { x: 0.05, y: 0.05, width: 0.4, height: 0.25, z: 1 }, block };
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(value); } };
}

function packageFetch({ project = manifest(), definition = story() } = {}) {
  const values = new Map([
    ['https://host/demo/project.json', project],
    ['https://host/demo/stories/main.story.json', definition],
    ['https://host/demo/data/route.geojson', ROUTE]
  ]);
  return async (url) => values.has(String(url)) ? jsonResponse(values.get(String(url))) : jsonResponse(null, 404);
}

test('unchanged production loader accepts Story 1.2 with a complete Scene layer snapshot', async () => {
  const project = await loadProject('https://host/demo/project.json', {
    fetchImpl: packageFetch(), capabilityRegistry
  });
  assert.equal(project.story.schemaVersion, '1.2');
  assert.deepEqual(project.story.states[0].map.layerVisibility, { route: true });
});

test('Story 1.2 layer snapshot rejects unknown, non-map, and missing controllable dataset IDs', async () => {
  for (const [layerVisibility, pattern] of [
    [{ route: true, missing: false }, /unknown.*missing|missing.*unknown/i],
    [{ route: true, table: false }, /table.*scene-controllable|scene-controllable.*table/i],
    [{}, /missing.*route|route.*missing/i]
  ]) {
    await assert.rejects(
      loadProject('https://host/demo/project.json', {
        fetchImpl: packageFetch({ definition: story([], layerVisibility) }), capabilityRegistry
      }),
      pattern
    );
  }
});

test('Story 1.2 envelope references reuse existing semantic reference errors', async () => {
  const badTable = story([envelope({
    type: 'table',
    data: { dataset: 'missing-table', columns: [{ field: 'name' }] }
  })]);
  await assert.rejects(
    loadProject('https://host/demo/project.json', {
      fetchImpl: packageFetch({ definition: badTable }), capabilityRegistry
    }),
    (error) => error.code === 'TABLE_DATASET_INVALID'
      && /content\.blocks\[0\].*data\.dataset/.test(error.path)
  );
});
