import { ProjectLoadError } from '../project/project-error.js';
import { validateGeoJsonResource } from '../project/resource-schemas.js';

const COLOR = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;
const RENDER_KEYS = Object.freeze({
  line: new Set(['type', 'color', 'width', 'opacity', 'lineStyle', 'label']),
  point: new Set(['type', 'color', 'radius', 'strokeColor', 'strokeWidth', 'label']),
  fill: new Set(['type', 'color', 'opacity', 'outlineColor', 'outlineWidth', 'label'])
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(code, path, message) {
  throw new ProjectLoadError(code, path, message);
}

function validateRender(render, geometry, path) {
  const expected = geometry === 'polygon' ? 'fill' : geometry;
  if (!RENDER_KEYS[render?.type] || render.type !== expected) fail('GEOJSON_RENDER_INVALID', `${path}.type`, `Render type must match ${geometry} geometry.`);
  for (const key of Object.keys(render)) if (!RENDER_KEYS[render.type].has(key)) fail('GEOJSON_RENDER_INVALID', `${path}.${key}`, 'Unsupported render property.');
  for (const key of ['color', 'strokeColor', 'outlineColor']) {
    if (render[key] !== undefined && (typeof render[key] !== 'string' || !COLOR.test(render[key]))) fail('GEOJSON_RENDER_INVALID', `${path}.${key}`, 'Color must be #RRGGBB or #RRGGBBAA.');
  }
  if (!COLOR.test(render.color ?? '')) fail('GEOJSON_RENDER_INVALID', `${path}.color`, 'A bounded hex color is required.');
  for (const key of ['width', 'radius', 'strokeWidth', 'outlineWidth']) {
    if (render[key] !== undefined && (!Number.isFinite(render[key]) || render[key] < 0 || render[key] > 64)) fail('GEOJSON_RENDER_INVALID', `${path}.${key}`, `${key} must be between 0 and 64.`);
  }
  if (render.opacity !== undefined && (!Number.isFinite(render.opacity) || render.opacity < 0 || render.opacity > 1)) fail('GEOJSON_RENDER_INVALID', `${path}.opacity`, 'Opacity must be between 0 and 1.');
  if (render.lineStyle !== undefined && !['solid', 'dashed'].includes(render.lineStyle)) fail('GEOJSON_RENDER_INVALID', `${path}.lineStyle`, 'Line style must be solid or dashed.');
}

function effectivePlacement(label, geometry) {
  if (!label.placement || label.placement === 'auto') return geometry === 'polygon' ? 'centroid' : geometry;
  return label.placement;
}

export function validateFeatureLabel(label, collection, { path = '$.render.label', geometry } = {}) {
  if (label === undefined) return undefined;
  if (!label || typeof label !== 'object' || Array.isArray(label)) fail('FEATURE_LABEL_INVALID', path, 'Feature label must be an object.');
  for (const key of Object.keys(label)) if (!['field', 'minZoom', 'placement'].includes(key)) fail('FEATURE_LABEL_INVALID', `${path}.${key}`, 'Unsupported feature label property.');
  if (typeof label.field !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(label.field)) fail('FEATURE_LABEL_INVALID', `${path}.field`, 'Label field must be one top-level property name.');
  if (label.minZoom !== undefined && (!Number.isFinite(label.minZoom) || label.minZoom < 0 || label.minZoom > 24)) fail('FEATURE_LABEL_INVALID', `${path}.minZoom`, 'Label minZoom must be between 0 and 24.');
  const placement = effectivePlacement(label, geometry);
  const compatible = geometry === 'point' ? placement === 'point' : geometry === 'line' ? placement === 'line' : geometry === 'polygon' ? placement === 'centroid' : label.placement === 'auto';
  if (!compatible) fail('FEATURE_LABEL_INVALID', `${path}.placement`, 'Label placement is incompatible with dataset geometry.');
  const values = collection.features.map((feature) => feature.properties?.[label.field]).filter((value) => value !== null && value !== undefined);
  if (!values.length) fail('FEATURE_LABEL_FIELD_MISSING', `${path}.field`, `Label field ${label.field} is absent from every feature.`);
  if (values.some((value) => !['string', 'number', 'boolean'].includes(typeof value))) fail('FEATURE_LABEL_INVALID', `${path}.field`, 'Feature labels support scalar values only.');
  return label;
}

export function buildFeatureLabelLayer(datasetId, label, collection, { geometry } = {}) {
  validateFeatureLabel(label, collection, { path: `$.datasets.${datasetId}.render.label`, geometry });
  const placement = effectivePlacement(label, geometry);
  return deepFreeze({
    id: `project-${datasetId}-label`,
    type: 'symbol',
    source: `project-${datasetId}`,
    minzoom: label.minZoom ?? 0,
    filter: ['all', ['has', label.field], ['!=', ['get', label.field], null]],
    layout: {
      'text-field': ['to-string', ['get', label.field]],
      'text-font': ['Noto Sans Regular'],
      'symbol-placement': placement === 'line' ? 'line' : 'point',
      'text-size': 12,
      'text-offset': placement === 'point' ? [0, 1.1] : [0, 0],
      'text-anchor': placement === 'point' ? 'top' : 'center',
      'text-allow-overlap': false
    },
    paint: { 'text-color': '#F4FAFF', 'text-halo-color': '#10202D', 'text-halo-width': 1.5 }
  });
}

function layer(datasetId, sourceId, render) {
  const id = `project-${datasetId}`;
  if (render.type === 'line') return {
    id, type: 'line', source: sourceId,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': render.color, 'line-width': render.width ?? 3, 'line-opacity': render.opacity ?? 1,
      ...(render.lineStyle === 'dashed' ? { 'line-dasharray': [2, 2] } : {})
    }
  };
  if (render.type === 'point') return {
    id, type: 'circle', source: sourceId,
    paint: {
      'circle-color': render.color, 'circle-radius': render.radius ?? 5,
      'circle-stroke-color': render.strokeColor ?? '#FFFFFF', 'circle-stroke-width': render.strokeWidth ?? 0
    }
  };
  return {
    id, type: 'fill', source: sourceId,
    paint: { 'fill-color': render.color, 'fill-opacity': render.opacity ?? 0.4, 'fill-outline-color': render.outlineColor ?? render.color }
  };
}

export function buildGeoJsonLayerDefinitions(datasetId, descriptor, collection) {
  validateGeoJsonResource(collection, descriptor, { path: `$.datasets.${datasetId}` });
  validateRender(descriptor.render, descriptor.geometry, `$.datasets.${datasetId}.render`);
  const sourceId = `project-${datasetId}`;
  const layers = [layer(datasetId, sourceId, descriptor.render)];
  if (descriptor.render.type === 'fill' && (descriptor.render.outlineWidth ?? 0) > 0) {
    layers.push({
      id: `project-${datasetId}-outline`,
      type: 'line',
      source: sourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': descriptor.render.outlineColor ?? descriptor.render.color,
        'line-width': descriptor.render.outlineWidth,
        'line-opacity': 1
      }
    });
  }
  if (descriptor.render.label) layers.push(buildFeatureLabelLayer(datasetId, descriptor.render.label, collection, descriptor));
  return deepFreeze({
    source: { id: sourceId, spec: { type: 'geojson', data: collection } },
    layers,
    publicTarget: datasetId
  });
}
