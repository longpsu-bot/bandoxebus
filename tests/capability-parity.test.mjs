import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityRegistry } from '../src/capabilities/capability-registry.js';
import {
  assertCapabilityImplementationParity,
  composeCapabilities
} from '../src/capabilities/capability-composer.js';
import {
  CORE_CONTENT_V1_DESCRIPTOR,
  createCoreContentCapability
} from '../src/capabilities/core-content-v1.js';
import {
  CORE_MAP_V1_DESCRIPTOR,
  createCoreMapCapability
} from '../src/capabilities/core-map-v1.js';
import {
  fixtureEntry,
  VALID_CAPABILITY_DESCRIPTOR
} from './fixtures/capabilities/valid-capability.mjs';

const coreEntries = [
  { descriptor: CORE_CONTENT_V1_DESCRIPTOR, createCapability: createCoreContentCapability },
  { descriptor: CORE_MAP_V1_DESCRIPTOR, createCapability: createCoreMapCapability }
];

function mismatchedEntry(descriptor, createCapability) {
  return { descriptor, createCapability };
}

test('GUI catalog and runtime implementations derive from the same core descriptors', () => {
  const registry = createCapabilityRegistry(coreEntries);
  const composed = composeCapabilities({ registry, declarations: [], datasets: {} });

  assert.deepEqual(
    Object.keys(composed.handlers).sort(),
    composed.catalog.actions.map(({ type }) => type).sort()
  );
  assert.deepEqual(
    Object.keys(composed.renderers).sort(),
    composed.catalog.content.map(({ type }) => type).sort()
  );
  assert.deepEqual(
    composed.catalog.capabilities.map(({ id }) => id),
    registry.catalog().map(({ id }) => id)
  );
  assert.equal(JSON.stringify(composed.catalog).includes('createCapability'), false);
  assert.equal(assertCapabilityImplementationParity(registry.get('core-map-v1')), true);
  assert.equal(assertCapabilityImplementationParity(registry.get('core-content-v1')), true);
});

test('core stubs expose catalog parity without changing map or content behavior', () => {
  const composed = composeCapabilities({
    registry: createCapabilityRegistry(coreEntries),
    declarations: [],
    datasets: {}
  });
  assert.throws(
    () => composed.handlers['map.clear-emphasis']({ type: 'map.clear-emphasis' }),
    (error) => error.code === 'CAPABILITY_NOT_INITIALIZED'
  );
  assert.throws(
    () => composed.renderers.heading({ type: 'heading', text: 'Fixture' }),
    (error) => error.code === 'CAPABILITY_NOT_INITIALIZED'
  );
});

test('parity rejects removed or added action handlers and content renderers', () => {
  const cases = [
    mismatchedEntry(CORE_MAP_V1_DESCRIPTOR, () => ({ handlers: {} })),
    mismatchedEntry(CORE_MAP_V1_DESCRIPTOR, () => ({
      handlers: Object.fromEntries([
        ...CORE_MAP_V1_DESCRIPTOR.actions.map(({ type }) => [type, () => undefined]),
        ['private.action', () => undefined]
      ])
    })),
    mismatchedEntry(CORE_CONTENT_V1_DESCRIPTOR, () => ({ renderers: {} })),
    mismatchedEntry(CORE_CONTENT_V1_DESCRIPTOR, () => ({
      renderers: Object.fromEntries([
        ...CORE_CONTENT_V1_DESCRIPTOR.content.map(({ type }) => [type, () => undefined]),
        ['private-block', () => undefined]
      ])
    }))
  ];

  for (const entry of cases) {
    assert.throws(
      () => assertCapabilityImplementationParity(entry),
      (error) => error.code === 'CAPABILITY_IMPLEMENTATION_MISMATCH'
    );
  }
});

test('parity rejects metric-provider and dataset-role drift', () => {
  const missingMetrics = mismatchedEntry(VALID_CAPABILITY_DESCRIPTOR, () => ({
    handlers: { 'fixture.set-mode': () => undefined },
    datasetRoles: { 'route.proposed': true },
    destroy() {}
  }));
  const missingRoles = mismatchedEntry(VALID_CAPABILITY_DESCRIPTOR, () => ({
    handlers: { 'fixture.set-mode': () => undefined },
    metricProviders: { 'fixture-distance': () => 0 },
    destroy() {}
  }));

  for (const entry of [missingMetrics, missingRoles]) {
    assert.throws(
      () => assertCapabilityImplementationParity(entry),
      (error) => error.code === 'CAPABILITY_IMPLEMENTATION_MISMATCH'
    );
  }
  assert.equal(assertCapabilityImplementationParity(fixtureEntry), true);
});

test('runtime action validation uses the canonical descriptor schema fragment', () => {
  const composed = composeCapabilities({
    registry: createCapabilityRegistry(coreEntries),
    declarations: [],
    datasets: {}
  });
  const valid = { type: 'map.set-visibility', target: 'route', visible: true };
  assert.equal(composed.validateAction(valid), valid);
  assert.throws(
    () => composed.validateAction({ ...valid, visible: 'true' }, { path: '$.action' }),
    (error) => error.code === 'CAPABILITY_ACTION_INVALID'
      && error.path === '$.action.visible'
  );
  assert.throws(
    () => composed.validateAction({ type: 'private.action' }),
    (error) => error.code === 'CAPABILITY_ACTION_UNKNOWN'
  );
});
