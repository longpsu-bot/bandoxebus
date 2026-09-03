import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';
import { createLegacyActionNormalizer } from './story-1.0-normalizer.js';

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
      adapter: { type: 'string', enum: ['route-61-2-current'] },
      buildingSource: { type: 'string', enum: ['overture-pmtiles', 'project-snapshot', 'local-geojson'] },
      overtureRelease: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.0$' },
      snapshot: {
        type: 'object',
        additionalProperties: false,
        properties: {
          asset: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
          theme: { type: 'string', const: 'buildings' },
          bounds: { type: 'array', items: { type: 'number' } },
          sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          byteLength: { type: 'integer', minimum: 1, maximum: 67108864 },
          generator: { type: 'string', const: 'go-pmtiles' },
          generatorVersion: { type: 'string', const: '1.31.2' },
          generatedAt: { type: 'string' },
          sourceContentLength: { type: 'integer', minimum: 0 },
          sourceEtag: { type: 'string' }
        }
      }
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

export async function selectUrbanContextAdapter(
  settings,
  context,
  loadAdapter = () => import('../route-61-2/runtime-adapter.js')
) {
  if (settings?.adapter !== 'route-61-2-current') return null;
  const module = await loadAdapter();
  const adapter = module.getRoute612RuntimeAdapter(context);
  adapter.configureUrbanContext({
    buildingSource: settings.buildingSource ?? 'local-geojson',
    overtureRelease: settings.overtureRelease ?? '2026-08-19.0'
  });
  return adapter;
}

export function createUrbanContextCapability(context = {}) {
  if (context.settings?.adapter === 'route-61-2-current' && context.map) {
    return selectUrbanContextAdapter(context.settings, context).then((adapter) => Object.freeze({
      handlers: Object.freeze({ 'context.set-mode': (descriptor) => adapter.setContextMode(descriptor.mode) }),
      datasetRoles: Object.freeze({ 'context.area': true })
    }));
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
