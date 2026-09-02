import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createOverturePmtilesLayerDefinitions } from '../src/overture-pmtiles.js';
import { createUrbanContextController } from '../src/urban-context.js';

const PROJECT_ROOT = new URL('../', import.meta.url);
const zone = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[106.59, 11.11], [106.61, 11.11], [106.61, 11.14], [106.59, 11.11]]]
  }
};

function createMap() {
  const sources = new Map();
  const layers = new Map();
  const listeners = new Map();
  const container = { dataset: {} };
  const addListener = (type, listener, once) => {
    const entries = listeners.get(type) ?? [];
    entries.push({ listener, once });
    listeners.set(type, entries);
  };
  return {
    sources,
    layers,
    container,
    getContainer: () => container,
    getSource: (id) => sources.get(id),
    addSource(id, source) { sources.set(id, structuredClone(source)); },
    removeSource(id) { sources.delete(id); },
    getLayer: (id) => layers.get(id),
    addLayer(layer) { layers.set(layer.id, structuredClone(layer)); },
    removeLayer(id) { layers.delete(id); },
    setLayoutProperty(id, property, value) {
      const layer = layers.get(id);
      layer.layout = { ...layer.layout, [property]: value };
    },
    getStyle: () => ({ layers: [...layers.values()] }),
    isSourceLoaded: (id) => sources.has(id),
    querySourceFeatures: () => [],
    once(type, listener) { addListener(type, listener, true); },
    on(type, listener) { addListener(type, listener, false); },
    off(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry.listener !== listener));
    },
    emit(type, event = {}) {
      const entries = [...(listeners.get(type) ?? [])];
      listeners.set(type, entries.filter(({ once }) => !once));
      entries.forEach(({ listener }) => listener(event));
    }
  };
}

function createController(overrides = {}) {
  return createUrbanContextController({
    map: createMap(),
    maplibregl: {},
    zone,
    routeCoordinates: [],
    pois: [],
    ...overrides
  });
}

test('online context remains unrequested until activation and reuses one protocol, source, and layer set', async () => {
  const map = createMap();
  const statuses = [];
  let protocolCalls = 0;
  const controller = createController({
    map,
    buildingConfig: { buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0' },
    ensureOnlineProtocol: async () => { protocolCalls += 1; },
    createOnlineDefinitions: createOverturePmtilesLayerDefinitions,
    onStatus: (status) => statuses.push(status)
  });

  assert.equal(protocolCalls, 0);
  assert.equal(map.sources.has('overture-industrial-buildings'), false);
  assert.equal(map.layers.has('overture-industrial-buildings-flat'), false);
  assert.equal(map.layers.has('overture-industrial-buildings-3d'), false);
  assert.deepEqual(statuses.at(-1), {
    status: 'not-requested', source: 'overture-pmtiles', release: '2026-08-19.0', failureCategory: null
  });

  await controller.setMode('industrial-context');
  assert.equal(statuses.at(-1).status, 'loading');
  map.emit('idle');
  assert.equal(statuses.at(-1).status, 'available');
  assert.equal(protocolCalls, 1);
  assert.equal(map.sources.has('overture-industrial-buildings'), true);
  assert.equal(map.layers.has('overture-industrial-buildings-flat'), true);
  assert.equal(map.layers.has('overture-industrial-buildings-3d'), true);

  await controller.setMode('off');
  await controller.setMode('industrial-context');
  map.emit('idle');
  assert.equal(protocolCalls, 1);
  assert.equal([...map.sources].filter(([id]) => id === 'overture-industrial-buildings').length, 1);
  assert.equal([...map.layers].filter(([id]) => id === 'overture-industrial-buildings-flat').length, 1);
  assert.equal([...map.layers].filter(([id]) => id === 'overture-industrial-buildings-3d').length, 1);
});

test('online protocol failure is bounded and never installs local or synthetic fallback', async () => {
  const map = createMap();
  const statuses = [];
  const controller = createController({
    map,
    overtureBuildings: {
      type: 'FeatureCollection',
      metadata: {
        provider: 'Overture Maps Foundation', overtureRelease: '2026-08-19.0',
        aoiFeatureId: 'osm-industrial-759187612', statistics: { featureCount: 1, aoiCoverageRatio: 0.1 }
      },
      features: [{ type: 'Feature', properties: { render_height_m: 8.5 }, geometry: zone.geometry }]
    },
    buildingConfig: { buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0' },
    ensureOnlineProtocol: async () => { throw new TypeError('network blocked'); },
    onStatus: (status) => statuses.push(status)
  });

  await controller.setMode('industrial-context');
  assert.deepEqual(statuses.at(-1), {
    status: 'unavailable', source: 'overture-pmtiles', release: '2026-08-19.0', failureCategory: 'network'
  });
  assert.equal(map.sources.has('overture-industrial-buildings'), false);
  assert.equal(map.layers.has('synthetic-industrial-infill'), false);
  await controller.setMode('off');
  assert.equal(controller.getDiagnostics().status, 'unavailable');
});

test('local benchmark installs the checked-in 1,299-building collection explicitly', async () => {
  const map = createMap();
  const statuses = [];
  const overtureBuildings = JSON.parse(await readFile(
    new URL('data/context/my-phuoc-1-buildings.geojson', PROJECT_ROOT),
    'utf8'
  ));
  createController({
    map,
    overtureBuildings,
    buildingConfig: { buildingSource: 'local-geojson', overtureRelease: '2026-08-19.0' },
    onStatus: (status) => statuses.push(status)
  });

  assert.equal(map.sources.get('overture-industrial-buildings').data.features.length, 1299);
  assert.equal(map.layers.has('overture-industrial-buildings-3d'), true);
  assert.deepEqual(statuses.at(-1), {
    status: 'local-benchmark', source: 'local-geojson', release: '2026-08-19.0', failureCategory: null
  });
});
