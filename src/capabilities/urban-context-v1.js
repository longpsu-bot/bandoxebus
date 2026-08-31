import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';
import { createLegacyActionNormalizer } from './story-1.0-normalizer.js';
import { getRoute612RuntimeAdapter } from '../route-61-2/runtime-adapter.js';

const MODES = ['off', 'industrial-context'];

export const URBAN_CONTEXT_V1_DESCRIPTOR = deepFreeze({
  schemaVersion: '1.0',
  id: 'urban-context-v1',
  label: 'Urban context',
  description: 'Coordinate trusted urban-context presentation modes.',
  requires: ['core-map-v1'],
  datasetRoles: [
    { role: 'context.area', types: ['geojson'], geometry: ['polygon'], required: false, render: true }
  ],
  actions: [
    {
      type: 'context.set-mode',
      label: 'Set context mode',
      description: 'Select a trusted urban-context mode.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'mode'],
        properties: {
          type: { const: 'context.set-mode' },
          mode: { type: 'string', enum: MODES }
        }
      }
    }
  ],
  content: [],
  targets: [],
  metrics: [],
  legacyActions: [
    { type: 'map.urban-context', canonicalType: 'context.set-mode' }
  ],
  lifecycle: [],
  settingsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      adapter: { type: 'string', enum: ['route-61-2-current'] }
    }
  },
  gui: { group: 'Urban context' }
});

export const URBAN_CONTEXT_V1_NORMALIZERS = deepFreeze([
  createLegacyActionNormalizer({
    legacyType: 'map.urban-context',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'mode'],
      properties: {
        type: { const: 'map.urban-context' },
        mode: { type: 'string', enum: MODES }
      }
    },
    normalize: ({ mode }) => ({ type: 'context.set-mode', mode })
  })
]);

function unavailable() {
  throw new ProjectLoadError('CAPABILITY_NOT_INITIALIZED', '$.capabilities.urban-context-v1.handlers.context.set-mode', 'Urban context is not initialized.');
}

export function createUrbanContextCapability(context = {}) {
  if (context.settings?.adapter === 'route-61-2-current' && context.map) {
    const adapter = getRoute612RuntimeAdapter(context);
    return Object.freeze({
      handlers: Object.freeze({ 'context.set-mode': (descriptor) => adapter.setContextMode(descriptor.mode) }),
      datasetRoles: Object.freeze({ 'context.area': true })
    });
  }
  return Object.freeze({
    handlers: Object.freeze({
      'context.set-mode': context.setContextMode
        ? (descriptor) => context.setContextMode(descriptor.mode)
        : unavailable
    }),
    datasetRoles: Object.freeze({ 'context.area': true })
  });
}
