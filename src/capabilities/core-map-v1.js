import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';

function action(type, label, description, required, properties) {
  return {
    type,
    label,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['type', ...required],
      properties: { type: { const: type }, ...properties }
    }
  };
}

const TARGET = { type: 'string', pattern: '^[a-z][a-z0-9-]*$' };
const CAMERA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    maxZoom: { type: 'number', minimum: 0, maximum: 24 },
    pitch: { type: 'number', minimum: 0, maximum: 72 },
    bearing: { type: 'number', minimum: -360, maximum: 360 },
    padding: { type: 'number', minimum: 0, maximum: 256 }
  }
};

export const CORE_MAP_V1_DESCRIPTOR = deepFreeze({
  schemaVersion: '1.0',
  id: 'core-map-v1',
  label: 'Core map',
  description: 'Baseline semantic map actions and targets.',
  requires: [],
  datasetRoles: [],
  actions: [
    action('map.focus', 'Focus target', 'Focus a declared semantic target.', ['target'], {
      target: TARGET,
      camera: CAMERA
    }),
    action('map.set-visibility', 'Set visibility', 'Show or hide a declared semantic target.', ['target', 'visible'], {
      target: TARGET,
      visible: { type: 'boolean' }
    }),
    action('map.set-emphasis', 'Set emphasis', 'Apply or remove emphasis on a declared semantic target.', ['target', 'active'], {
      target: TARGET,
      active: { type: 'boolean' }
    }),
    action('map.clear-emphasis', 'Clear emphasis', 'Clear all standard map emphasis.', [], {})
  ],
  content: [],
  targets: [],
  metrics: [],
  legacyActions: [
    { type: 'map.focus', canonicalType: 'map.focus' }
  ],
  lifecycle: [],
  settingsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  gui: { group: 'Core map' }
});

function unavailable(type) {
  return () => {
    throw new ProjectLoadError(
      'CAPABILITY_NOT_INITIALIZED',
      `$.capabilities.core-map-v1.handlers.${type}`,
      'Core map behavior is not initialized in the contract foundation.'
    );
  };
}

export function createCoreMapCapability(context = {}) {
  return Object.freeze({
    handlers: Object.freeze(Object.fromEntries(
      CORE_MAP_V1_DESCRIPTOR.actions.map(({ type }) => [type, context.handlers?.[type] ?? unavailable(type)])
    ))
  });
}
