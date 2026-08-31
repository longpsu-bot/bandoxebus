import test from 'node:test';
import assert from 'node:assert/strict';

import { createMetricRegistry } from '../src/metrics/metric-registry.js';
import { createRouteComparisonCapability, ROUTE_COMPARISON_V1_DESCRIPTOR } from '../src/capabilities/route-comparison-v1.js';

const literal = { label: 'Demand', value: 1200, format: { type: 'integer' }, attribution: ['survey'] };

test('static and computed metrics share one immutable namespace', async () => {
  const registry = await createMetricRegistry({
    staticMetrics: { demand: literal },
    providers: [{
      descriptor: { id: 'coverage', label: 'Coverage', format: { type: 'percentage' } },
      compute: async () => 0.75
    }]
  });
  assert.deepEqual(registry.resolve('demand'), { id: 'demand', ...literal, status: 'available' });
  assert.equal(registry.resolve('coverage').value, 0.75);
  assert.equal(registry.resolve('coverage').status, 'available');
  assert.throws(() => { registry.resolve('demand').value = 0; }, TypeError);
});

test('metric collisions and unknown IDs fail with stable errors', async () => {
  await assert.rejects(createMetricRegistry({
    staticMetrics: { demand: literal },
    providers: [{ descriptor: { id: 'demand', label: 'Computed demand', format: { type: 'integer' } }, compute: () => 2 }]
  }), (error) => error.code === 'METRIC_ID_COLLISION' && error.path === '$.metrics.demand');
  const registry = await createMetricRegistry();
  assert.throws(() => registry.resolve('missing'), (error) => error.code === 'METRIC_UNKNOWN');
});

test('known provider failures remain known but unavailable', async () => {
  const registry = await createMetricRegistry({ providers: [{
    descriptor: { id: 'coverage', label: 'Coverage', format: { type: 'percentage' } },
    compute: async () => { throw new Error('offline'); }
  }] });
  assert.deepEqual(registry.resolve('coverage'), {
    id: 'coverage', label: 'Coverage', format: { type: 'percentage' }, value: null,
    status: 'unavailable', attribution: []
  });
  assert.equal(registry.diagnostics[0].code, 'METRIC_COMPUTE_FAILED');
});

test('route comparison exposes trusted computed length and stop metrics', async () => {
  const resources = new Map([
    ['existing', { descriptor: { role: 'route.existing' }, value: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0.01]] }, properties: {} }] } }],
    ['proposed', { descriptor: { role: 'route.proposed' }, value: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0.02]] }, properties: {} }] } }],
    ['stops', { descriptor: { role: 'stops.existing' }, value: { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'shared', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      { type: 'Feature', id: 'removed', geometry: { type: 'Point', coordinates: [0, 0.005] }, properties: {} }
    ] } }],
    ['proposed-stops', { descriptor: { role: 'stops.proposed' }, value: { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'shared', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
      { type: 'Feature', id: 'added', geometry: { type: 'Point', coordinates: [0, 0.015] }, properties: {} }
    ] } }]
  ]);
  const capability = createRouteComparisonCapability({ resources, setMode() {}, setRouteReveal() {}, setPoiEmphasis() {} });
  const providers = ROUTE_COMPARISON_V1_DESCRIPTOR.metrics.map((descriptor) => ({ descriptor, compute: capability.metricProviders[descriptor.id] }));
  const registry = await createMetricRegistry({ providers, aliases: capability.legacyMetricAliases });
  assert.ok(registry.resolve('route-existing-length').value > 1000);
  assert.ok(registry.resolve('route-length-delta').value > 1000);
  assert.equal(registry.resolve('route-stop-count').value, 2);
  for (const id of ['existingLengthMeters', 'proposedLengthMeters', 'retainedLengthMeters', 'addedLengthMeters', 'removedLengthMeters']) {
    assert.ok(Number.isFinite(registry.resolve(id).value), `${id} should preserve the legacy Story metric binding`);
  }
  assert.equal(registry.resolve('existingStopCount').value, 2);
});
