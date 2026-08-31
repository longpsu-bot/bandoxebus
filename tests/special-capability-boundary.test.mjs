import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { createCapabilityRegistry } from '../src/capabilities/capability-registry.js';
import { composeCapabilities } from '../src/capabilities/capability-composer.js';
import { CORE_CONTENT_V1_DESCRIPTOR, createCoreContentCapability } from '../src/capabilities/core-content-v1.js';
import { CORE_MAP_V1_DESCRIPTOR, createCoreMapCapability } from '../src/capabilities/core-map-v1.js';
import { createMetricRegistry } from '../src/metrics/metric-registry.js';
import { facilityAccessTestEntry } from './fixtures/capabilities/facility-access-test-v1.mjs';

const GENERIC_MODULES = [
  '../src/runtime/generic-app.js', '../src/runtime/generic-shell.js',
  '../src/story-runtime.js', '../src/story-shell.js',
  '../src/scene/scene-compositor.js', '../src/scene/scene-state-controller.js'
];

async function runtimeHash() {
  const values = await Promise.all(['../src/story-runtime.js', '../src/story-shell.js'].map(async (path) => readFile(new URL(path, import.meta.url))));
  return createHash('sha256').update(Buffer.concat(values)).digest('hex');
}

test('special capability declares every extension surface without runtime or shell changes', async () => {
  const before = await runtimeHash(); const events = [];
  const registry = createCapabilityRegistry([
    { descriptor: CORE_CONTENT_V1_DESCRIPTOR, createCapability: createCoreContentCapability },
    { descriptor: CORE_MAP_V1_DESCRIPTOR, createCapability: createCoreMapCapability },
    facilityAccessTestEntry(events)
  ]);
  const datasets = { access: { type: 'geojson', geometry: 'line', role: 'facility.access-paths' } };
  const composed = composeCapabilities({ registry, declarations: [{ id: 'facility-access-test-v1', settings: { enabled: true } }], datasets });
  const entry = composed.ordered.find(({ descriptor }) => descriptor.id === 'facility-access-test-v1');
  const implementation = entry.createCapability({ resources: new Map([['access', { descriptor: datasets.access }]]) });
  implementation.handlers['facility.show-access']({ type: 'facility.show-access', active: true });
  const metrics = await createMetricRegistry({ providers: [{ descriptor: entry.descriptor.metrics[0], compute: implementation.metricProviders['facility-access-count'] }] });
  assert.equal(metrics.resolve('facility-access-count').value, 2);
  assert.equal(implementation.targets['facility-access-paths'].owner, 'facility-access-test-v1');
  assert.ok(composed.catalog.actions.some(({ type }) => type === 'facility.show-access'));
  assert.doesNotThrow(() => JSON.stringify(entry.descriptor.gui));
  implementation.reset(); implementation.destroy(); implementation.destroy();
  assert.deepEqual(events, [true, false, 'destroy']);
  assert.equal(await runtimeHash(), before);
  assert.equal(JSON.stringify({ id: 'facility-access-test-v1', settings: { enabled: true } }).match(/src|module|script|plugin/i), null);
});

test('special capability settings and role requirements remain deterministic', () => {
  const registry = createCapabilityRegistry([
    { descriptor: CORE_CONTENT_V1_DESCRIPTOR, createCapability: createCoreContentCapability },
    { descriptor: CORE_MAP_V1_DESCRIPTOR, createCapability: createCoreMapCapability },
    facilityAccessTestEntry([])
  ]);
  assert.throws(() => composeCapabilities({ registry, declarations: [{ id: 'facility-access-test-v1', settings: { enabled: 'yes' } }], datasets: { access: { type: 'geojson', geometry: 'line', role: 'facility.access-paths' } } }), (error) => error.code === 'CAPABILITY_SETTINGS_INVALID');
  assert.throws(() => composeCapabilities({ registry, declarations: [{ id: 'facility-access-test-v1', settings: { enabled: true } }], datasets: {} }), (error) => error.code === 'CAPABILITY_ROLE_MISSING');
});

test('generic runtime, shell, and Scene modules cannot import Route 61-2 adapter or data', async () => {
  for (const path of GENERIC_MODULES) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /route-61-2|route-data/, path);
  }
});
