export const VALID_CAPABILITY_DESCRIPTOR = {
  schemaVersion: '1.0',
  id: 'fixture-capability-v1',
  label: 'Fixture capability',
  description: 'Exercises the trusted capability descriptor contract.',
  requires: ['core-map-v1'],
  datasetRoles: [
    {
      role: 'route.proposed',
      types: ['geojson'],
      geometry: ['line'],
      required: true,
      render: true
    }
  ],
  actions: [
    {
      type: 'fixture.set-mode',
      label: 'Set fixture mode',
      description: 'Select a fixture presentation mode.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'mode'],
        properties: {
          type: { const: 'fixture.set-mode' },
          mode: { type: 'string', enum: ['one', 'two'] }
        }
      },
      gui: { group: 'Fixture', control: 'select' }
    }
  ],
  content: [],
  targets: [
    { id: 'fixture-target', label: 'Fixture target', kind: 'focus' }
  ],
  metrics: [
    {
      id: 'fixture-distance',
      label: 'Fixture distance',
      valueType: 'number',
      format: { type: 'distance', decimals: 1 }
    }
  ],
  legacyActions: [
    { type: 'fixture.mode', canonicalType: 'fixture.set-mode' }
  ],
  lifecycle: ['destroy'],
  settingsSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['target'],
    properties: {
      target: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' }
    }
  },
  gui: { group: 'Fixture capabilities' }
};

export function createFixtureCapability() {
  return Object.freeze({
    handlers: Object.freeze({
      'fixture.set-mode': () => undefined
    }),
    renderers: Object.freeze({}),
    metricProviders: Object.freeze({
      'fixture-distance': () => 0
    }),
    datasetRoles: Object.freeze({
      'route.proposed': true
    }),
    destroy() {}
  });
}

export const fixtureEntry = {
  descriptor: VALID_CAPABILITY_DESCRIPTOR,
  createCapability: createFixtureCapability
};
