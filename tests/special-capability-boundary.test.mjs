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
  '../src/app.js',
  '../src/runtime/generic-app.js', '../src/runtime/generic-shell.js',
  '../src/story-runtime.js', '../src/story-shell.js',
  '../src/scene/scene-compositor.js', '../src/scene/scene-state-controller.js'
];
const ROUTE_ASSUMPTION = /route-61-2(?:-current)?|route-data|connection-pois|industrial-zone|\b(?:Difference|Existing|Proposed|Compare)\b|Route reveal|POI emphasis|Urban context|Simulation/;

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

test('generic runtime, shell, and Scene modules contain no concrete Route assumptions', async () => {
  for (const path of GENERIC_MODULES) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, ROUTE_ASSUMPTION, path);
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, ROUTE_ASSUMPTION, '../index.html');
});

test('installed Blank root defers the Route 61-2 adapter outside the static ESM graph', async () => {
  const installed = await readFile(new URL('../src/capabilities/installed-capabilities.js', import.meta.url), 'utf8');
  for (const path of ['route-comparison-v1.js', 'urban-context-v1.js']) assert.match(installed, new RegExp(path));
  for (const path of ['../src/capabilities/route-comparison-v1.js', '../src/capabilities/urban-context-v1.js']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s+.*route-61-2\/runtime-adapter\.js.*$/m, path);
    assert.match(source, /import\(['"]\.\.\/route-61-2\/runtime-adapter\.js['"]\)/, path);
  }
});

test('generic application lifecycle uses the explicit replaceExisting API without source obfuscation', async () => {
  const source = await readFile(new URL('../src/runtime/generic-app.js', import.meta.url), 'utf8');
  assert.match(source, /\breplaceExisting\b/);
  assert.doesNotMatch(source, /replacementKey|\[['"]replace['"],\s*['"]Exist['"],\s*['"]ing['"]\]|\.join\(['"]['"]\)/);
});
