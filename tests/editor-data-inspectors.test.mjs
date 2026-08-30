import assert from 'node:assert/strict';
import test from 'node:test';

import {
  importGeoJson,
  importNormalizedTable,
  renderEntityInspector
} from '../editor/ui/inspectors.js';

function featureCollection(type, coordinates, properties = {}) {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties, geometry: { type, coordinates } }] };
}

function table() {
  return {
    schemaVersion: '1.0',
    columns: [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'count', label: 'Count', type: 'integer', unit: 'passengers' },
      { id: 'ratio', label: 'Ratio', type: 'number' },
      { id: 'active', label: 'Active', type: 'boolean' },
      { id: 'date', label: 'Date', type: 'date' }
    ],
    rows: [{ name: 'A', count: 2, ratio: 1.5, active: true, date: '2026-08-30' }]
  };
}

function harness() {
  const state = {
    manifest: {
      datasets: {}, assets: {}, focusTargets: {}, attribution: {}, capabilities: [],
      map: { basemap: 'openfreemap-dark', initialView: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } }
    },
    resources: {}, writes: []
  };
  state.mutate = (updater) => updater(state.manifest);
  state.writeResource = (path, value, descriptor) => {
    state.writes.push({ path, value: structuredClone(value), descriptor });
    state.resources[descriptor.id] = structuredClone(value);
  };
  state.ui = renderEntityInspector({
    kind: 'dataset', manifest: state.manifest, resources: state.resources,
    mutate: state.mutate, writeResource: state.writeResource,
    roleCatalog: [
      { role: 'route.existing', types: ['geojson'], geometry: ['line'] },
      { role: 'demand.table', types: ['table-json'] }
    ]
  });
  return state;
}

test('GeoJSON import preserves coordinates and exposes only bounded renderer fields', () => {
  const source = featureCollection('LineString', [[106, 11], [107, 12]]);
  const result = importGeoJson(source, { geometry: 'line', path: '$.datasets.route' });
  assert.deepEqual(result.value, source);
  assert.notEqual(result.value, source);
  assert.deepEqual(result.observedFields, []);
  assert.deepEqual(result.allowedRenderKeys.sort(), ['color', 'label', 'lineStyle', 'opacity', 'type', 'width']);
});

test('GeoJSON imports support production geometry families and keep mixed rendering open', () => {
  const cases = [
    ['point', featureCollection('Point', [106, 11]), ['color', 'label', 'radius', 'strokeColor', 'strokeWidth', 'type']],
    ['polygon', featureCollection('Polygon', [[[106, 11], [107, 11], [107, 12], [106, 11]]]), ['color', 'label', 'opacity', 'outlineColor', 'outlineWidth', 'type']],
    ['mixed', featureCollection('Point', [106, 11]), []]
  ];
  for (const [geometry, source, keys] of cases) {
    assert.deepEqual(importGeoJson(source, { geometry }).allowedRenderKeys.sort(), keys.sort());
  }
});

test('dataset inspector discovers scalar labels, compatible placements, renderer fields, and descriptor roles', () => {
  const state = harness();
  const source = featureCollection('LineString', [[106, 11], [107, 12]], { name: 'Route', order: 2, active: true, nested: { no: true }, empty: null });
  state.ui.command('add-geojson', 'route', { geometry: 'line', label: 'Route', value: source });
  const route = state.ui.entity('route');

  assert.deepEqual(route.labelFields(), ['active', 'name', 'order']);
  assert.deepEqual(route.labelPlacements(), ['auto', 'line']);
  assert.deepEqual(route.roleOptions(), ['route.existing']);
  assert.equal(route.hasControl('render.width'), true);
  assert.equal(route.hasControl('render.radius'), false);
  assert.equal(route.hasControl('defaultVisibility'), false);
  for (const forbidden of ['csv', 'formula', 'join', 'pivot', 'geometry']) assert.equal(route.hasControl(forbidden), false);
});

test('GeoJSON add and replace use stable managed paths without writing coordinates', () => {
  const state = harness();
  const first = featureCollection('Point', [106, 11], { name: 'A' });
  state.ui.command('add-geojson', 'stops', { geometry: 'point', label: 'Stops', value: first });
  assert.equal(state.manifest.datasets.stops.src, './data/stops.geojson');
  assert.deepEqual(state.writes[0], {
    path: 'data/stops.geojson', value: first,
    descriptor: { id: 'stops', kind: 'dataset', mediaType: 'application/geo+json' }
  });

  const replacement = featureCollection('Point', [107, 12], { name: 'B' });
  state.ui.entity('stops').command('replace', replacement);
  assert.deepEqual(state.resources.stops, replacement);
  assert.deepEqual(replacement.features[0].geometry.coordinates, [107, 12]);
});

test('normalized table import preserves declared columns, types, units, and stable IDs', () => {
  const source = table();
  const result = importNormalizedTable(source, { path: '$.datasets.demand' });
  assert.deepEqual(result.value, source);
  assert.deepEqual(result.columns.map(({ id, type, unit }) => ({ id, type, unit })), [
    { id: 'name', type: 'text', unit: undefined },
    { id: 'count', type: 'integer', unit: 'passengers' },
    { id: 'ratio', type: 'number', unit: undefined },
    { id: 'active', type: 'boolean', unit: undefined },
    { id: 'date', type: 'date', unit: undefined }
  ]);
});

test('table grid adds, edits, and removes scalar/null rows using declared production types', () => {
  const state = harness();
  state.ui.command('add-table', 'demand', { label: 'Demand', value: table() });
  const demand = state.ui.entity('demand');
  assert.deepEqual(demand.roleOptions(), ['demand.table']);
  assert.equal(demand.column('count').control('id').readOnly, true);

  demand.command('add-row', { name: '', count: '3', ratio: '2.25', active: false, date: '' });
  assert.deepEqual(state.resources.demand.rows[1], { name: null, count: 3, ratio: 2.25, active: false, date: null });
  demand.command('edit-cell', { row: 1, column: 'active', value: true });
  assert.equal(state.resources.demand.rows[1].active, true);
  demand.command('remove-row', 0);
  assert.equal(state.resources.demand.rows.length, 1);
});

test('data imports and row edits surface production validator errors unchanged', () => {
  assert.throws(
    () => importGeoJson(featureCollection('Point', [0, 0]), { geometry: 'line', path: '$.datasets.route' }),
    (error) => error.code === 'GEOJSON_RESOURCE_INVALID' && error.path === '$.datasets.route.features[0].geometry.type'
  );
  const invalid = table();
  invalid.rows[0].count = '2';
  assert.throws(
    () => importNormalizedTable(invalid, { path: '$.datasets.demand' }),
    (error) => error.code === 'TABLE_DATA_INVALID' && error.path === '$.datasets.demand.rows[0].count'
  );

  const state = harness();
  state.ui.command('add-table', 'demand', { label: 'Demand', value: table() });
  assert.throws(
    () => state.ui.entity('demand').command('edit-cell', { row: 0, column: 'count', value: 'not-an-integer' }),
    (error) => error.code === 'TABLE_DATA_INVALID' && error.path === '$.datasets.demand.rows[0].count'
  );
});
