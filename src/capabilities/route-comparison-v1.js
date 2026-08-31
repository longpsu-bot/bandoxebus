import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';
import { createLegacyActionNormalizer } from './story-1.0-normalizer.js';
import { compareRoutes, haversineMeters } from '../comparison.js';
import { buildGeoJsonLayerDefinitions } from '../map/geojson-renderer.js';
import { getRoute612RuntimeAdapter } from '../route-61-2/runtime-adapter.js';

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
    { role: 'stops.existing', types: ['geojson'], geometry: ['point'], required: false, render: true },
    { role: 'stops.proposed', types: ['geojson'], geometry: ['point'], required: false, render: true },
    { role: 'transport.poi', types: ['geojson'], geometry: ['point'], required: false, render: true }
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
  metrics: [
    { id: 'route-existing-length', label: 'Existing route length', valueType: 'number', format: { type: 'distance', decimals: 1 } },
    { id: 'route-proposed-length', label: 'Proposed route length', valueType: 'number', format: { type: 'distance', decimals: 1 } },
    { id: 'route-retained-length', label: 'Retained route length', valueType: 'number', format: { type: 'distance', decimals: 1 } },
    { id: 'route-added-length', label: 'Added route length', valueType: 'number', format: { type: 'distance', decimals: 1 } },
    { id: 'route-removed-length', label: 'Removed route length', valueType: 'number', format: { type: 'distance', decimals: 1 } },
    { id: 'route-length-delta', label: 'Route length change', valueType: 'number', format: { type: 'distance', decimals: 1 } },
    { id: 'route-stop-count', label: 'Existing stop count', valueType: 'number', format: { type: 'integer' } }
  ],
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

export function selectRouteComparisonAdapter(settings, context, loadAdapter = () => ({ getRoute612RuntimeAdapter })) {
  if (settings?.adapter !== 'route-61-2-current') return null;
  const module = loadAdapter();
  return module.getRoute612RuntimeAdapter(context);
}

function createRouteComparisonImplementation(context = {}) {
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
  const byRole = (role) => [...(context.resources ?? [])].find(([, resource]) => resource.descriptor?.role === role)?.[1]?.value;
  const routeLength = (role) => {
    const collection = byRole(role);
    return (collection?.features ?? []).reduce((total, feature) => {
      const lines = feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [feature.geometry?.coordinates ?? []];
      return total + lines.reduce((lineTotal, coordinates) => lineTotal + coordinates.slice(1).reduce((sum, coordinate, index) => sum + haversineMeters(coordinates[index], coordinate), 0), 0);
    }, 0);
  };
  const routeCoordinates = (role) => {
    const geometry = byRole(role)?.features?.[0]?.geometry;
    if (geometry?.type === 'LineString') return geometry.coordinates;
    if (geometry?.type === 'MultiLineString') return geometry.coordinates.flat();
    return [];
  };
  let comparison;
  const routeComparison = () => comparison ??= compareRoutes(
    routeCoordinates('route.existing'), routeCoordinates('route.proposed')
  );
  return Object.freeze({
    handlers: Object.freeze(handlers),
    datasetRoles: Object.freeze(Object.fromEntries(
      ROUTE_COMPARISON_V1_DESCRIPTOR.datasetRoles.map(({ role }) => [role, true])
    )),
    metricProviders: Object.freeze({
      'route-existing-length': () => routeLength('route.existing'),
      'route-proposed-length': () => routeLength('route.proposed'),
      'route-retained-length': () => routeComparison().metrics.retainedLengthMeters,
      'route-added-length': () => routeComparison().metrics.addedLengthMeters,
      'route-removed-length': () => routeComparison().metrics.removedLengthMeters,
      'route-length-delta': () => routeLength('route.proposed') - routeLength('route.existing'),
      'route-stop-count': () => byRole('stops.existing')?.features?.length ?? 0
    }),
    legacyMetricAliases: Object.freeze({
      existingLengthMeters: 'route-existing-length',
      proposedLengthMeters: 'route-proposed-length',
      retainedLengthMeters: 'route-retained-length',
      addedLengthMeters: 'route-added-length',
      removedLengthMeters: 'route-removed-length',
      existingStopCount: 'route-stop-count'
    })
  });
}

function createDeclarativeRouteLayerProvider(context) {
  if (!context.map || !context.resources) return null;
  const ownedRoles = new Set(ROUTE_COMPARISON_V1_DESCRIPTOR.datasetRoles
    .filter(({ render }) => render)
    .map(({ role }) => role));
  const datasets = new Map();
  for (const [id, resource] of context.resources) {
    const descriptor = resource.descriptor;
    if (!ownedRoles.has(descriptor?.role) || !descriptor.render) continue;
    datasets.set(id, buildGeoJsonLayerDefinitions(id, descriptor, resource.value));
  }
  let destroyed = false;
  const install = () => {
    if (destroyed) return;
    for (const [, definitions] of datasets) {
      if (!context.map.getSource?.(definitions.source.id)) {
        context.map.addSource(definitions.source.id, definitions.source.spec);
      }
      for (const layer of definitions.layers) {
        if (!context.map.getLayer?.(layer.id)) context.map.addLayer(layer);
      }
    }
  };
  if (context.map.loaded?.() === false && context.map.once) context.map.once('load', install);
  else install();

  const setVisible = (id, visible) => {
    for (const layer of datasets.get(id)?.layers ?? []) {
      if (context.map.getLayer?.(layer.id)) {
        context.map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  };
  return Object.freeze({
    sceneLayers: Object.freeze({
      ids: Object.freeze([...datasets.keys()]),
      setVisible,
      reset() { for (const id of datasets.keys()) setVisible(id, true); }
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const definitions of [...datasets.values()].toReversed()) {
        for (const layer of definitions.layers.toReversed()) {
          if (context.map.getLayer?.(layer.id)) context.map.removeLayer?.(layer.id);
        }
        if (context.map.getSource?.(definitions.source.id)) context.map.removeSource?.(definitions.source.id);
      }
    }
  });
}

export function createRouteComparisonCapability(context = {}) {
  if (context.settings?.adapter !== 'route-61-2-current' || !context.map) {
    const implementation = createRouteComparisonImplementation(context);
    const declarativeLayers = createDeclarativeRouteLayerProvider(context);
    return declarativeLayers
      ? Object.freeze({ ...implementation, ...declarativeLayers })
      : implementation;
  }
  const adapter = selectRouteComparisonAdapter(context.settings, context);
  const implementation = createRouteComparisonImplementation({
    ...context,
    setMode: adapter.setMode,
    setRouteReveal: adapter.setRouteReveal,
    setPoiEmphasis: adapter.setPoiEmphasis
  });
  return Object.freeze({ ...implementation, sceneLayers: adapter.sceneLayers, destroy: adapter.destroy });
}
