import { assertWgs84Coordinates } from './crs.js';
import { createImportId } from './import-identifiers.js';

const FAMILY = Object.freeze({
  Point: 'point',
  MultiPoint: 'point',
  LineString: 'line',
  MultiLineString: 'line',
  Polygon: 'polygon',
  MultiPolygon: 'polygon'
});
const FAMILY_ORDER = Object.freeze(['point', 'line', 'polygon']);
const FAMILY_LABEL = Object.freeze({ point: 'Points', line: 'Lines', polygon: 'Polygons' });

function sourceFeatures(value) {
  if (value?.type === 'Feature') return [value];
  if (value?.type === 'FeatureCollection' && Array.isArray(value.features)) return value.features;
  throw new TypeError('Spatial source must be a GeoJSON Feature or FeatureCollection.');
}

function flattenGeometry(geometry, depth = 0) {
  if (depth > 64) throw new TypeError('GeoJSON geometry nesting exceeds the safety limit.');
  if (!geometry) return [];
  if (geometry.type === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries)) throw new TypeError('GeometryCollection geometries must be an array.');
    return geometry.geometries.flatMap((child) => flattenGeometry(child, depth + 1));
  }
  if (!FAMILY[geometry.type]) throw new TypeError(`Unsupported GeoJSON geometry: ${geometry.type}.`);
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return [];
  return [structuredClone(geometry)];
}

function emittedFeature(feature, geometry) {
  const result = {
    type: 'Feature',
    properties: feature.properties && typeof feature.properties === 'object' ? structuredClone(feature.properties) : {},
    geometry
  };
  if (feature.id !== undefined) result.id = structuredClone(feature.id);
  return result;
}

function positions(geometry) {
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(positions);
  const depth = geometry.type === 'Point' ? 0
    : ['MultiPoint', 'LineString'].includes(geometry.type) ? 1
      : ['MultiLineString', 'Polygon'].includes(geometry.type) ? 2 : 3;
  function walk(value, remaining) {
    if (remaining === 0) return [value];
    return value.flatMap((child) => walk(child, remaining - 1));
  }
  return walk(geometry.coordinates, depth);
}

function collectionBounds(collection) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of collection.features) {
    for (const [longitude, latitude] of positions(feature.geometry)) {
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    }
  }
  return [west, south, east, north];
}

function scalarFields(collection) {
  const fields = new Set();
  for (const feature of collection.features) {
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) fields.add(key);
    }
  }
  return [...fields].sort();
}

export function normalizeSpatialSource(value, {
  label,
  id,
  sourceFormat,
  sourceCrs = 'EPSG:4326',
  usedIds = []
} = {}) {
  const partitions = new Map(FAMILY_ORDER.map((family) => [family, []]));
  let omitted = 0;
  for (const feature of sourceFeatures(value)) {
    if (!feature || feature.type !== 'Feature') throw new TypeError('Spatial source contains a non-Feature item.');
    const geometries = flattenGeometry(feature.geometry);
    if (!geometries.length) {
      omitted += 1;
      continue;
    }
    for (const geometry of geometries) partitions.get(FAMILY[geometry.type]).push(emittedFeature(feature, geometry));
  }
  const present = FAMILY_ORDER.filter((family) => partitions.get(family).length);
  if (!present.length) throw new TypeError('Spatial source has no usable geometry.');
  const mixed = present.length > 1;
  const warnings = omitted ? [
    `${omitted} ${omitted === 1 ? 'record had' : 'records had'} no usable geometry and will not be imported.`
  ] : [];
  const occupied = [...usedIds];
  return present.map((geometry) => {
    const candidateLabel = mixed ? `${label} · ${FAMILY_LABEL[geometry]}` : label;
    const proposed = mixed ? `${id}-${FAMILY_LABEL[geometry].toLowerCase()}` : id;
    const candidateId = createImportId(proposed, occupied);
    occupied.push(candidateId);
    const collection = assertWgs84Coordinates({ type: 'FeatureCollection', features: partitions.get(geometry) });
    return Object.freeze({
      kind: 'spatial',
      label: candidateLabel,
      id: candidateId,
      geometry,
      value: collection,
      featureCount: collection.features.length,
      bounds: collectionBounds(collection),
      fields: scalarFields(collection),
      warnings: [...warnings],
      sourceFormat,
      sourceCrs,
      outputCrs: 'EPSG:4326'
    });
  });
}
