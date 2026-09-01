import test from 'node:test';
import assert from 'node:assert/strict';

import * as focusRegistry from '../src/map/focus-registry.js';

const { createFocusRegistry } = focusRegistry;

const datasets = new Map([['route', { value: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 1], [2, 3]] } }] } }]]);

test('focus registry resolves dataset, coordinate, bounds, and capability targets', () => {
  const registry = createFocusRegistry({
    datasets,
    manifestTargets: {
      overview: { type: 'datasets', datasets: ['route'] },
      center: { type: 'coordinate', center: [1, 2], zoom: 14 },
      area: { type: 'bounds', bounds: [[0, 0], [4, 4]] }
    },
    capabilityTargets: { special: { owner: 'fixture-v1', type: 'bounds', bounds: [[2, 2], [3, 3]] } }
  });
  assert.deepEqual(registry.get('overview').bounds, [[0, 1], [2, 3]]);
  assert.deepEqual(registry.get('center').center, [1, 2]);
  assert.equal(registry.get('special').owner, 'fixture-v1');
  assert.throws(() => registry.get('missing'), (error) => error.code === 'FOCUS_TARGET_UNKNOWN');
});

test('GeoJSON bounds cover polygon, multi geometry, multiple points, and empty collections', () => {
  assert.equal(typeof focusRegistry.geoJsonBounds, 'function');
  const value = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [4, 8] } },
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[-2, 3], [6, -1]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [9, 0], [9, 7], [0, 0]]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]], [[-4, 5], [2, 10]]] } }
    ]
  };
  assert.deepEqual(focusRegistry.geoJsonBounds(value), [[-4, -1], [9, 10]]);
  assert.equal(focusRegistry.geoJsonBounds({ type: 'FeatureCollection', features: [] }), null);
});
