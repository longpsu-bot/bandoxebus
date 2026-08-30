import { ProjectLoadError } from '../project/project-error.js';
import { createCoreMapController } from '../map/core-map-controller.js';
import { createFocusRegistry } from '../map/focus-registry.js';
import { buildGeoJsonLayerDefinitions } from '../map/geojson-renderer.js';
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
  const routeAdapterActive = context.project?.manifest?.capabilities?.some(({ id }) => id === 'route-comparison-v1');
  if ((!context.handlers || !routeAdapterActive) && context.map && context.project) {
    const datasets = new Map();
    const claimed = context.project.capabilities?.renderResponsibilities ?? {};
    for (const [id, resource] of context.resources ?? []) {
      const descriptor = resource.descriptor;
      if (descriptor?.type !== 'geojson' || !descriptor.render) continue;
      if (descriptor.role && claimed[descriptor.role] && claimed[descriptor.role] !== 'core-map-v1') continue;
      const definitions = buildGeoJsonLayerDefinitions(id, descriptor, resource.value);
      datasets.set(id, {
        sourceId: definitions.source.id,
        layers: definitions.layers,
        defaultVisible: true
      });
    }
    const install = () => {
      for (const [, record] of datasets) {
        if (!context.map.getSource?.(record.sourceId)) context.map.addSource(record.sourceId, { type: 'geojson', data: context.resources.get(record.sourceId.slice(8))?.value });
        for (const layer of record.layers) if (!context.map.getLayer?.(layer.id)) context.map.addLayer(layer);
      }
    };
    if (context.map.loaded?.() === false && context.map.once) context.map.once('load', install);
    else install();
    const focusRegistry = createFocusRegistry({
      manifestTargets: context.project.focusTargets,
      capabilityTargets: context.capabilityTargets,
      datasets: context.resources
    });
    const controller = createCoreMapController({
      map: context.map,
      datasets,
      focusRegistry,
      reducedMotion: context.reducedMotion,
      shellPadding: context.shellPadding
    });
    const sceneLayers = Object.freeze({
      ids: Object.freeze([...datasets.keys()]),
      setVisible: (id, visible) => controller.setVisibility(id, visible),
      reset: () => controller.reset()
    });
    return Object.freeze({
      handlers: Object.freeze({
        'map.focus': ({ target, camera = {} }) => controller.focus(target, camera),
        'map.set-visibility': ({ target, visible }) => controller.setVisibility(target, visible),
        'map.set-emphasis': ({ target, active }) => controller.setEmphasis(target, active),
        'map.clear-emphasis': () => controller.clearEmphasis()
      }),
      sceneLayers,
      reset: () => controller.reset(),
      destroy: () => controller.destroy(),
      targets: focusRegistry
    });
  }
  return Object.freeze({
    handlers: Object.freeze(Object.fromEntries(
      CORE_MAP_V1_DESCRIPTOR.actions.map(({ type }) => [type, context.handlers?.[type] ?? unavailable(type)])
    ))
  });
}

export function createCoreMap10Normalizers({ focusTargets } = {}) {
  const targetSchema = focusTargets
    ? { type: 'string', enum: [...focusTargets] }
    : { type: 'string', pattern: '^[a-z][a-z0-9-]*$' };
  return deepFreeze([
    createLegacyActionNormalizer({
      legacyType: 'map.focus',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'target'],
        properties: {
          type: { const: 'map.focus' },
          target: targetSchema,
          camera: {
            type: 'object',
            additionalProperties: false,
            properties: {
              pitch: { type: 'number', minimum: 0, maximum: 72 },
              bearing: { type: 'number', minimum: -360, maximum: 360 },
              maxZoom: { type: 'number', minimum: 0, maximum: 24 }
            }
          }
        }
      },
      normalize: (descriptor) => structuredClone(descriptor)
    })
  ]);
}

export const CORE_MAP_V1_NORMALIZERS = createCoreMap10Normalizers();
