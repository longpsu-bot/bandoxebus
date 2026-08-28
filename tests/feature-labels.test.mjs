import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeatureLabelLayer } from '../src/map/geojson-renderer.js';

const points = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Stop', empty: null }, geometry: { type: 'Point', coordinates: [0, 0] } }] };

test('bounded feature labels use one top-level scalar property', () => {
  const layer = buildFeatureLabelLayer('stops', { field: 'name', minZoom: 12, placement: 'point' }, points, { geometry: 'point' });
  assert.equal(layer.type, 'symbol');
  assert.deepEqual(layer.layout['text-field'], ['to-string', ['get', 'name']]);
  assert.deepEqual(layer.layout['text-font'], ['Noto Sans Regular']);
  assert.equal(layer.minzoom, 12);
  assert.deepEqual(layer.filter, ['all', ['has', 'name'], ['!=', ['get', 'name'], null]]);
});

test('labels reject missing, nested, template, and incompatible placement fields', () => {
  assert.throws(() => buildFeatureLabelLayer('stops', { field: 'missing' }, points, { geometry: 'point' }), (error) => error.code === 'FEATURE_LABEL_FIELD_MISSING');
  assert.throws(() => buildFeatureLabelLayer('stops', { field: 'properties.name' }, points, { geometry: 'point' }), (error) => error.code === 'FEATURE_LABEL_INVALID');
  assert.throws(() => buildFeatureLabelLayer('stops', { field: 'name', template: '{name}' }, points, { geometry: 'point' }), (error) => error.code === 'FEATURE_LABEL_INVALID');
  assert.throws(() => buildFeatureLabelLayer('stops', { field: 'name', placement: 'line' }, points, { geometry: 'point' }), (error) => error.code === 'FEATURE_LABEL_INVALID');
});
