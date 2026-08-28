import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';
import { createLegacyActionNormalizer } from './story-1.0-normalizer.js';

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
const MODES = ['existing', 'proposed', 'difference', 'compare'];

export const ROUTE_COMPARISON_V1_DESCRIPTOR = deepFreeze({
  schemaVersion: '1.0',
  id: 'route-comparison-v1',
  label: 'Route comparison',
  description: 'Compare existing and proposed route plans.',
  requires: ['core-map-v1'],
  datasetRoles: [
    { role: 'route.existing', types: ['geojson'], geometry: ['line'], required: true, render: true },
    { role: 'route.proposed', types: ['geojson'], geometry: ['line'], required: true, render: true },
    { role: 'stops.existing', types: ['geojson'], geometry: ['point'], required: false, render: true }
  ],
  actions: [
    action('route.set-mode', 'Set route mode', 'Select the visible route comparison mode.', ['mode'], {
      mode: { type: 'string', enum: MODES }
    }),
    action('route.reveal', 'Reveal route', 'Reveal or cancel a declared route target.', ['target', 'active'], {
      target: TARGET,
      active: { type: 'boolean' },
      delayMs: { type: 'integer', minimum: 0 }
    }),
    action('transport.set-poi-emphasis', 'Set POI emphasis', 'Emphasize a declared transport point target.', ['target', 'active'], {
      target: TARGET,
      active: { type: 'boolean' }
    })
  ],
  content: [],
  targets: [],
  metrics: [],
  legacyActions: [
    { type: 'map.mode', canonicalType: 'route.set-mode' },
    { type: 'map.poi-emphasis', canonicalType: 'transport.set-poi-emphasis' },
    { type: 'route.reveal', canonicalType: 'route.reveal' }
  ],
  lifecycle: [],
  settingsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      adapter: { type: 'string', enum: ['route-61-2-current'] },
      proposedRouteTarget: TARGET,
      poiTarget: TARGET
    }
  },
  gui: { group: 'Route comparison' }
});

export const ROUTE_COMPARISON_V1_NORMALIZERS = deepFreeze([
  createLegacyActionNormalizer({
    legacyType: 'map.mode',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'mode'],
      properties: {
        type: { const: 'map.mode' },
        mode: { type: 'string', enum: MODES }
      }
    },
    normalize: ({ mode }) => ({ type: 'route.set-mode', mode })
  }),
  createLegacyActionNormalizer({
    legacyType: 'map.poi-emphasis',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'active'],
      properties: {
        type: { const: 'map.poi-emphasis' },
        active: { type: 'boolean' }
      }
    },
    normalize: ({ active }, bindings) => ({
      type: 'transport.set-poi-emphasis',
      target: bindings.poiTarget,
      active
    })
  }),
  createLegacyActionNormalizer({
    legacyType: 'route.reveal',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'active'],
      properties: {
        type: { const: 'route.reveal' },
        active: { type: 'boolean' },
        delayMs: { type: 'integer', minimum: 0 }
      }
    },
    normalize: ({ active, delayMs }, bindings) => ({
      type: 'route.reveal',
      target: bindings.proposedRouteTarget,
      active,
      ...(delayMs === undefined ? {} : { delayMs })
    })
  })
]);

function unavailable(type) {
  return () => {
    throw new ProjectLoadError('CAPABILITY_NOT_INITIALIZED', `$.capabilities.route-comparison-v1.handlers.${type}`, 'Route comparison is not initialized.');
  };
}

export function createRouteComparisonCapability(context = {}) {
  const handlers = {
    'route.set-mode': context.setMode
      ? (descriptor) => context.setMode(descriptor.mode)
      : unavailable('route.set-mode'),
    'route.reveal': context.setRouteReveal
      ? (descriptor) => context.setRouteReveal(descriptor.target, descriptor.active, descriptor.delayMs ?? 0)
      : unavailable('route.reveal'),
    'transport.set-poi-emphasis': context.setPoiEmphasis
      ? (descriptor) => context.setPoiEmphasis(descriptor.target, descriptor.active)
      : unavailable('transport.set-poi-emphasis')
  };
  return Object.freeze({
    handlers: Object.freeze(handlers),
    datasetRoles: Object.freeze(Object.fromEntries(
      ROUTE_COMPARISON_V1_DESCRIPTOR.datasetRoles.map(({ role }) => [role, true])
    ))
  });
}
