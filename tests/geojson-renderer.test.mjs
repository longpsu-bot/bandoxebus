import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGeoJsonLayerDefinitions } from '../src/map/geojson-renderer.js';

const line = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] };
const points = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Stop' }, geometry: { type: 'Point', coordinates: [0, 0] } }] };
const polygon = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }] };

test('safe line, point, and fill descriptors translate to owned MapLibre definitions', () => {
  const definitions = [
    buildGeoJsonLayerDefinitions('route', { geometry: 'line', render: { type: 'line', color: '#00AACC', width: 4, opacity: 0.8, lineStyle: 'dashed' } }, line),
    buildGeoJsonLayerDefinitions('stops', { geometry: 'point', render: { type: 'point', color: '#FFFFFF', radius: 5, strokeColor: '#000000', strokeWidth: 1 } }, points),
    buildGeoJsonLayerDefinitions('area', { geometry: 'polygon', render: { type: 'fill', color: '#0088FF44', opacity: 0.3, outlineColor: '#0088FF', outlineWidth: 2 } }, polygon)
  ];
  assert.deepEqual(definitions.map(({ layers }) => layers[0].type), ['line', 'circle', 'fill']);
  assert.equal(definitions[2].layers.length, 2);
  assert.equal(definitions[2].layers[1].type, 'line');
  assert.equal(definitions[2].layers[1].paint['line-width'], 2);
  assert.equal(definitions[0].source.id, 'project-route');
  assert.deepEqual(definitions[0].layers[0].paint['line-dasharray'], [2, 2]);
  assert.equal(JSON.stringify(definitions).includes('callback'), false);
});

test('raw expressions and geometry mismatches fail before translation', () => {
  assert.throws(() => buildGeoJsonLayerDefinitions('route', { geometry: 'line', render: { type: 'line', color: ['get', 'color'] } }, line), (error) => error.code === 'GEOJSON_RENDER_INVALID');
  assert.throws(() => buildGeoJsonLayerDefinitions('route', { geometry: 'point', render: { type: 'point', color: '#FFFFFF' } }, line), (error) => error.code === 'GEOJSON_RESOURCE_INVALID');
});
