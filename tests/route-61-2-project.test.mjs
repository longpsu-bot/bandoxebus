import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import { loadProject } from '../src/project/project-loader.js';
import {
  existingRouteLatLng,
  proposedRouteLatLng,
  existingStopsLatLng,
  proposedStopsLatLng,
  landmarks
} from '../src/route-data.js';

const PROJECT_URL = new URL('../project.json', import.meta.url);
const STORY_URL = new URL('../data/stories/route-61-2.story.json', import.meta.url);
const DATA_ROOT = new URL('../data/route-61-2/', import.meta.url);

async function fileFetch(url, { signal } = {}) {
  signal?.throwIfAborted();
  try {
    const text = await readFile(url, 'utf8');
    signal?.throwIfAborted();
    return { ok: true, status: 200, async json() { return JSON.parse(text); } };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    return { ok: false, status: error.code === 'ENOENT' ? 404 : 500, async json() { throw error; } };
  }
}

test('Route 61-2 loads from project.json and preserves its Story 1.0 contract', async () => {
  const before = await readFile(STORY_URL, 'utf8');
  const project = await loadProject(PROJECT_URL, {
    fetchImpl: fileFetch,
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY
  });

  assert.equal(project.manifest.id, 'route-61-2');
  assert.equal(project.manifest.stories.items[0].src, './data/stories/route-61-2.story.json');
  assert.deepEqual(project.manifest.capabilities.map(({ id }) => id), [
    'route-comparison-v1', 'urban-context-v1'
  ]);
  assert.deepEqual(project.manifest.capabilities.find(({ id }) => id === 'urban-context-v1').settings, {
    adapter: 'route-61-2-current',
    buildingSource: 'local-geojson',
    overtureRelease: '2026-08-19.0'
  });
  assert.equal(project.story.schemaVersion, '1.0');
  assert.equal(project.story.states.length, 7);
  assert.equal(await readFile(STORY_URL, 'utf8'), before);
  assert.equal(project.capabilities.datasetRoles.filter(({ required }) => required).length, 2);
  assert.ok(project.capabilities.datasetRoles.some(({ role }) => role === 'stops.proposed'));
});

test('static Route 61-2 GeoJSON bridge exactly matches current JavaScript geometry', async () => {
  const fixtures = [
    ['existing-route.geojson', existingRouteLatLng, 'LineString'],
    ['proposed-route.geojson', proposedRouteLatLng, 'LineString'],
    ['existing-stops.geojson', existingStopsLatLng, 'Point'],
    ['proposed-stops.geojson', proposedStopsLatLng, 'Point']
  ];
  for (const [filename, latLng, geometryType] of fixtures) {
    const collection = JSON.parse(await readFile(new URL(filename, DATA_ROOT), 'utf8'));
    const expected = latLng.map(([latitude, longitude]) => [longitude, latitude]);
    const actual = geometryType === 'LineString'
      ? collection.features[0].geometry.coordinates
      : collection.features.map(({ geometry }) => geometry.coordinates);
    assert.equal(collection.features.length, geometryType === 'LineString' ? 1 : latLng.length, filename);
    assert.deepEqual(actual, expected, filename);
  }
});

test('Route POI geometry is ordinary project-owned GeoJSON', async () => {
  const manifest = JSON.parse(await readFile(PROJECT_URL, 'utf8'));
  assert.equal(manifest.datasets['connection-pois'].role, 'transport.poi');
  assert.equal(manifest.datasets['connection-pois'].src, './data/route-61-2/connection-pois.geojson');
  const collection = JSON.parse(await readFile(new URL('connection-pois.geojson', DATA_ROOT), 'utf8'));
  assert.deepEqual(collection.features.map(({ properties, geometry }) => ({
    name: properties.name,
    type: properties.type,
    glyph: properties.glyph,
    sourceUrl: properties.sourceUrl,
    coordinates: geometry.coordinates
  })), landmarks.map(({ name, type, glyph, sourceUrl, coordinates }) => ({ name, type, glyph, sourceUrl, coordinates })));
});
