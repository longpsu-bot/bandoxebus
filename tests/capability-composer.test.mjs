import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapabilityRegistry } from '../src/capabilities/capability-registry.js';
import { composeCapabilities } from '../src/capabilities/capability-composer.js';

function descriptor(id, overrides = {}) {
  return {
    schemaVersion: '1.0',
    id,
    label: id,
    description: `${id} fixture descriptor.`,
    requires: [],
    datasetRoles: [],
    actions: [],
    content: [],
    targets: [],
    metrics: [],
    legacyActions: [],
    lifecycle: [],
    settingsSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    },
    ...overrides
  };
}

function entry(capabilityDescriptor, onCreate = () => undefined) {
  return {
    descriptor: capabilityDescriptor,
    createCapability() {
      onCreate();
      return {
        datasetRoles: Object.fromEntries(
          capabilityDescriptor.datasetRoles.map(({ role }) => [role, true])
        )
      };
    }
  };
}

function registry(optional = []) {
  return createCapabilityRegistry([
    entry(descriptor('core-content-v1')),
    entry(descriptor('core-map-v1')),
    ...optional
  ]);
}

function action(type) {
  return {
    type,
    label: type,
    description: `${type} action.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: { type: { const: type } }
    }
  };
}

function assertCompositionIssue(options, code, path) {
  assert.throws(
    () => composeCapabilities(options),
    (error) => error.code === code && (path === undefined || error.path === path)
  );
}

test('composition installs implicit cores once and topologically sorts optional packs', () => {
  const route = entry(descriptor('route-comparison-v1', { requires: ['core-map-v1'] }));
  const analytics = entry(descriptor('route-analytics-v1', { requires: ['route-comparison-v1'] }));
  const composed = composeCapabilities({
    registry: registry([route, analytics]),
    declarations: [{ id: 'route-analytics-v1' }, { id: 'route-comparison-v1' }],
    datasets: {}
  });

  assert.deepEqual(
    composed.ordered.map(({ descriptor: value }) => value.id),
    ['core-content-v1', 'core-map-v1', 'route-comparison-v1', 'route-analytics-v1']
  );
  assert.deepEqual(composed.cleanup.map(({ descriptor: value }) => value.id), [
    'route-analytics-v1', 'route-comparison-v1', 'core-map-v1', 'core-content-v1'
  ]);
  assert.equal(Object.isFrozen(composed), true);
  assert.equal(Object.isFrozen(composed.ordered), true);
});

test('composition rejects unknown and explicitly declared implicit-core capabilities', () => {
  const trusted = registry();
  assertCompositionIssue(
    { registry: trusted, declarations: [{ id: 'unknown-v1' }], datasets: {} },
    'CAPABILITY_UNKNOWN',
    '$.capabilities[0].id'
  );
  for (const id of ['core-content-v1', 'core-map-v1']) {
    assertCompositionIssue(
      { registry: trusted, declarations: [{ id }], datasets: {} },
      'CAPABILITY_RESERVED',
      '$.capabilities[0].id'
    );
  }
});

test('composition rejects missing dependencies and dependency cycles', () => {
  const missing = entry(descriptor('analytics-v1', { requires: ['route-comparison-v1'] }));
  assertCompositionIssue(
    { registry: registry([missing]), declarations: [{ id: 'analytics-v1' }], datasets: {} },
    'CAPABILITY_DEPENDENCY_MISSING'
  );

  const first = entry(descriptor('first-v1', { requires: ['second-v1'] }));
  const second = entry(descriptor('second-v1', { requires: ['first-v1'] }));
  assertCompositionIssue(
    {
      registry: registry([first, second]),
      declarations: [{ id: 'first-v1' }, { id: 'second-v1' }],
      datasets: {}
    },
    'CAPABILITY_DEPENDENCY_CYCLE'
  );
});

test('composition rejects ownership collisions before factories run', () => {
  const collisionCases = [
    [
      'CAPABILITY_ACTION_COLLISION',
      descriptor('first-v1', { actions: [action('route.set-mode')] }),
      descriptor('second-v1', { actions: [action('route.set-mode')] })
    ],
    [
      'CAPABILITY_LEGACY_COLLISION',
      descriptor('first-v1', { legacyActions: [{ type: 'map.mode', canonicalType: 'route.set-mode' }] }),
      descriptor('second-v1', { legacyActions: [{ type: 'map.mode', canonicalType: 'route.set-mode' }] })
    ],
    [
      'CAPABILITY_RENDER_COLLISION',
      descriptor('first-v1', {
        datasetRoles: [{ role: 'route.proposed', types: ['geojson'], geometry: ['line'], required: false, render: true }]
      }),
      descriptor('second-v1', {
        datasetRoles: [{ role: 'route.proposed', types: ['geojson'], geometry: ['line'], required: false, render: true }]
      })
    ]
  ];

  for (const [code, firstDescriptor, secondDescriptor] of collisionCases) {
    let calls = 0;
    const trusted = registry([
      entry(firstDescriptor, () => { calls += 1; }),
      entry(secondDescriptor, () => { calls += 1; })
    ]);
    assertCompositionIssue({
      registry: trusted,
      declarations: [{ id: firstDescriptor.id }, { id: secondDescriptor.id }],
      datasets: {}
    }, code);
    assert.equal(calls, 0);
  }
});

test('composition validates declaration settings with the descriptor schema', () => {
  const configurable = entry(descriptor('configurable-v1', {
    settingsSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: { mode: { type: 'string', enum: ['safe'] } }
    }
  }));
  const trusted = registry([configurable]);
  assertCompositionIssue({
    registry: trusted,
    declarations: [{ id: 'configurable-v1', settings: { mode: 'unsafe' } }],
    datasets: {}
  }, 'CAPABILITY_SETTINGS_INVALID', '$.capabilities[0].settings.mode');

  const composed = composeCapabilities({
    registry: trusted,
    declarations: [{ id: 'configurable-v1', settings: { mode: 'safe' } }],
    datasets: {}
  });
  assert.deepEqual(composed.settings['configurable-v1'], { mode: 'safe' });
});

test('composition validates only dataset roles required by selected capabilities', () => {
  const requiredRole = {
    role: 'route.proposed',
    types: ['geojson'],
    geometry: ['line'],
    required: true
  };
  const route = entry(descriptor('route-comparison-v1', { datasetRoles: [requiredRole] }));
  const trusted = registry([route]);
  const declarations = [{ id: 'route-comparison-v1' }];

  assertCompositionIssue({ registry: trusted, declarations, datasets: {} }, 'CAPABILITY_ROLE_MISSING');
  assertCompositionIssue({
    registry: trusted,
    declarations,
    datasets: {
      first: { role: 'route.proposed', type: 'geojson', geometry: 'line' },
      second: { role: 'route.proposed', type: 'geojson', geometry: 'line' }
    }
  }, 'CAPABILITY_ROLE_DUPLICATE');
  assertCompositionIssue({
    registry: trusted,
    declarations,
    datasets: { route: { role: 'route.proposed', type: 'table-json' } }
  }, 'CAPABILITY_ROLE_TYPE_MISMATCH');
  assertCompositionIssue({
    registry: trusted,
    declarations,
    datasets: { route: { role: 'route.proposed', type: 'geojson', geometry: 'point' } }
  }, 'CAPABILITY_ROLE_GEOMETRY_MISMATCH');

  const optional = entry(descriptor('optional-role-v1', {
    datasetRoles: [{ ...requiredRole, required: false }]
  }));
  const optionalComposed = composeCapabilities({
    registry: registry([optional]),
    declarations: [{ id: 'optional-role-v1' }],
    datasets: {}
  });
  assert.deepEqual(optionalComposed.datasetRoles.map(({ role }) => role), ['route.proposed']);
});
