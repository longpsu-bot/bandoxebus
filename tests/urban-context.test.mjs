import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createOverturePmtilesArchiveBinding, createOverturePmtilesLayerDefinitions } from '../src/overture-pmtiles.js';
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

function createMap({ moving = false } = {}) {
  const sources = new Map();
  const layers = new Map();
  const listeners = new Map();
  const container = { dataset: {} };
  const addSourceCalls = [];
  const addLayerCalls = [];
  const addListener = (type, listener, once) => {
    const entries = listeners.get(type) ?? [];
    entries.push({ listener, once });
    listeners.set(type, entries);
  };
  return {
    sources,
    layers,
    container,
    addSourceCalls,
    addLayerCalls,
    getContainer: () => container,
    getSource: (id) => sources.get(id),
    addSource(id, source) {
      addSourceCalls.push({ id, source });
      sources.set(id, structuredClone(source));
    },
    removeSource(id) { sources.delete(id); },
    getLayer: (id) => layers.get(id),
    addLayer(layer) {
      addLayerCalls.push(layer);
      layers.set(layer.id, structuredClone(layer));
    },
    removeLayer(id) { layers.delete(id); },
    setLayoutProperty(id, property, value) {
      const layer = layers.get(id);
      layer.layout = { ...layer.layout, [property]: value };
    },
    getStyle: () => ({ layers: [...layers.values()] }),
    isSourceLoaded: (id) => sources.has(id),
    isMoving: () => moving,
    setMoving(value) { moving = value; },
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
    ensureArchive: async (maplibregl, binding) => { protocolCalls += 1; return { archiveUrl: binding.url }; },
    createPmtilesDefinitions: createOverturePmtilesLayerDefinitions,
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

test('first PMTiles activation waits for a moving camera before installing source and layers', async () => {
  const map = createMap({ moving: true });
  let resolveArchive;
  const controller = createController({
    map,
    buildingConfig: { buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0' },
    ensureArchive: () => new Promise((resolve) => { resolveArchive = resolve; })
  });
  map.addSourceCalls.length = 0;
  map.addLayerCalls.length = 0;

  const activation = controller.setMode('industrial-context');
  await Promise.resolve();
  resolveArchive({ archiveUrl: 'https://example.test/buildings.pmtiles' });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(map.addSourceCalls.length, 0);
  assert.equal(map.addLayerCalls.length, 0);

  map.setMoving(false);
  map.emit('moveend');
  await activation;
  assert.equal(map.addSourceCalls.length, 1);
  assert.equal(map.addLayerCalls.length, 2);
  assert.equal(map.addLayerCalls[0].id, 'overture-industrial-buildings-flat');
  assert.equal(map.addLayerCalls[1].id, 'overture-industrial-buildings-3d');
});

test('first PMTiles activation installs without waiting when the camera is settled', async () => {
  const map = createMap();
  const controller = createController({
    map,
    buildingConfig: { buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0' },
    ensureArchive: async () => ({ archiveUrl: 'https://example.test/buildings.pmtiles' })
  });
  map.addSourceCalls.length = 0;
  map.addLayerCalls.length = 0;

  await controller.setMode('industrial-context');

  assert.equal(map.addSourceCalls.length, 1);
  assert.equal(map.addLayerCalls.length, 2);
});

test('snapshot PMTiles context retains one runtime and layer set across visibility and camera motion', async () => {
  const map = createMap();
  let protocolInstallations = 0;
  let archiveRegistrations = 0;
  const controller = createController({
    map,
    buildingConfig: {
      buildingSource: 'project-snapshot',
      overtureRelease: '2026-08-19.0',
      archiveBinding: {
        kind: 'url', source: 'project-snapshot', release: '2026-08-19.0',
        key: 'snapshot:test', url: 'https://example.test/snapshot.pmtiles', bounds: [106.59, 11.11, 106.61, 11.14]
      }
    },
    ensureArchive: async () => {
      protocolInstallations += 1;
      archiveRegistrations += 1;
      return { archiveUrl: 'https://example.test/snapshot.pmtiles' };
    }
  });
  map.addSourceCalls.length = 0;
  map.addLayerCalls.length = 0;

  await controller.setMode('industrial-context');
  await controller.setMode('off');
  await controller.setMode('industrial-context');
  map.emit('moveend', { cameraChange: 'pan' });
  map.emit('moveend', { cameraChange: 'bearing' });
  map.emit('moveend', { cameraChange: 'pitch' });

  assert.equal(protocolInstallations, 1);
  assert.equal(archiveRegistrations, 1);
  assert.equal(map.addSourceCalls.length, 1);
  assert.equal(map.addLayerCalls.filter(({ id }) => id === 'overture-industrial-buildings-flat').length, 1);
  assert.equal(map.addLayerCalls.filter(({ id }) => id === 'overture-industrial-buildings-3d').length, 1);
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
    ensureArchive: async () => { throw new TypeError('network blocked'); },
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

test('online layer rejection remains unavailable after the source becomes idle', async () => {
  const map = createMap();
  const statuses = [];
  const addLayer = map.addLayer.bind(map);
  map.addLayer = (layer) => {
    if (layer.id === 'overture-industrial-buildings-3d') {
      map.emit('error', {
        error: new TypeError(`layers.${layer.id}.paint.fill-extrusion-base: unknown variable "height"`)
      });
      return;
    }
    addLayer(layer);
  };
  const controller = createController({
    map,
    buildingConfig: { buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0' },
    ensureArchive: async (maplibregl, binding) => ({ archiveUrl: binding.url }),
    createPmtilesDefinitions: createOverturePmtilesLayerDefinitions,
    onStatus: (status) => statuses.push(status)
  });

  await controller.setMode('industrial-context');
  map.emit('idle');

  assert.equal(statuses.at(-1).status, 'unavailable');
  assert.equal(map.layers.has('overture-industrial-buildings-3d'), false);
  assert.equal(map.layers.has('synthetic-industrial-infill'), false);
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

for (const kind of ['url', 'file']) {
  test(`${kind} snapshot uses the shared PMTiles lifecycle without touching fallback data`, async () => {
    const map = createMap();
    const statuses = [];
    const url = new URL('https://r2.example.test/projects/route-61-2/a/overture-buildings.pmtiles');
    const archiveBinding = createOverturePmtilesArchiveBinding({
      settings: {
        buildingSource: 'project-snapshot', overtureRelease: '2026-08-19.0',
        snapshot: { asset: 'snapshot', sha256: 'a'.repeat(64), bounds: [106.59, 11.11, 106.61, 11.14] }
      },
      resources: new Map([['snapshot', { id: 'snapshot', descriptor: { type: 'pmtiles', mediaType: 'application/vnd.pmtiles' }, url }]]),
      resolvePmtilesAssetFile: kind === 'file' ? () => new File(['snapshot'], 'overture-buildings.pmtiles') : undefined
    });
    let registrations = 0;
    const archiveUrl = kind === 'url' ? url.href : `overture-buildings-${'a'.repeat(64)}.pmtiles`;
    const controller = createController({
      map,
      buildingConfig: { buildingSource: 'project-snapshot', overtureRelease: '2026-08-19.0', archiveBinding },
      ensureArchive: async (maplibregl, binding) => {
        assert.equal(binding, archiveBinding);
        registrations += 1;
        return { archiveUrl };
      },
      onStatus: (status) => statuses.push(status)
    });
    assert.equal(registrations, 0);
    await controller.setMode('industrial-context');
    map.emit('sourcedata', { sourceId: 'overture-industrial-buildings' });
    assert.deepEqual(statuses.at(-1), {
      status: 'available', source: 'project-snapshot', release: '2026-08-19.0', failureCategory: null
    });
    assert.equal(map.sources.get('overture-industrial-buildings').url, `pmtiles://${archiveUrl}`);
    assert.deepEqual(map.sources.get('overture-industrial-buildings').bounds, [106.59, 11.11, 106.61, 11.14]);
    const source = map.sources.get('overture-industrial-buildings');
    await controller.setMode('off');
    assert.equal(map.layers.get('overture-industrial-buildings-3d').layout.visibility, 'none');
    await controller.setMode('industrial-context');
    map.emit('moveend');
    map.emit('zoomend');
    assert.equal(registrations, 1);
    assert.equal(map.sources.get('overture-industrial-buildings'), source);
    assert.equal(map.layers.size, 4);
    assert.equal(map.layers.get('overture-industrial-buildings-flat').layout.visibility, 'visible');
    assert.throws(() => controller.configureBuildings({
      buildingSource: 'project-snapshot', overtureRelease: '2026-08-19.0',
      archiveBinding: { ...archiveBinding, key: `snapshot:${'b'.repeat(64)}` }
    }), /after initialization/);

    map.emit('error', { sourceId: 'overture-industrial-buildings', error: new Error('Range request failed') });
    await controller.setMode('off');
    await controller.setMode('industrial-context');
    assert.deepEqual(statuses.at(-1), {
      status: 'unavailable', source: 'project-snapshot', release: '2026-08-19.0', failureCategory: 'range-request'
    });
    assert.equal(map.layers.get('overture-industrial-buildings-3d').layout.visibility, 'none');
    assert.equal(map.layers.has('synthetic-industrial-infill'), false);
    controller.destroy();
    map.emit('error', { sourceId: 'overture-industrial-buildings', error: new Error('404') });
    assert.equal(statuses.at(-1).failureCategory, 'range-request');
  });
}

test('failed snapshot archive setup leaves Story layers usable and never installs fallback', async () => {
  const map = createMap();
  map.addLayer({ id: 'story-route', type: 'line', layout: { visibility: 'visible' } });
  const controller = createController({
    map,
    buildingConfig: {
      buildingSource: 'project-snapshot', overtureRelease: '2026-08-19.0',
      archiveBinding: {
        kind: 'file', source: 'project-snapshot', release: '2026-08-19.0', key: `snapshot:${'a'.repeat(64)}`,
        file: new File(['invalid'], 'overture-buildings.pmtiles'), bounds: [106.59, 11.11, 106.61, 11.14]
      }
    },
    ensureArchive: async () => { throw new Error('malformed PMTiles tile'); }
  });
  await controller.setMode('industrial-context');
  assert.equal(controller.getDiagnostics().status, 'unavailable');
  assert.equal(controller.getDiagnostics().source, 'project-snapshot');
  assert.equal(map.layers.get('story-route').layout.visibility, 'visible');
  assert.equal(map.sources.has('overture-industrial-buildings'), false);
  assert.equal(map.layers.has('synthetic-industrial-infill'), false);
});
