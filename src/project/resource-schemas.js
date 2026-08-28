import tableSchema from '../../data/schemas/table-data-v1.schema.json' with { type: 'json' };
import metricSchema from '../../data/schemas/metric-file-v1.schema.json' with { type: 'json' };
import { validateSchema } from '../contracts/schema-validator.js';
import { projectError, ProjectLoadError } from './project-error.js';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const GEOMETRY_TYPES = Object.freeze({
  line: new Set(['LineString', 'MultiLineString']),
  point: new Set(['Point', 'MultiPoint']),
  polygon: new Set(['Polygon', 'MultiPolygon']),
  mixed: new Set(['LineString', 'MultiLineString', 'Point', 'MultiPoint', 'Polygon', 'MultiPolygon'])
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const TABLE_DATA_V1_SCHEMA = deepFreeze(tableSchema);
export const METRIC_FILE_V1_SCHEMA = deepFreeze(metricSchema);

function assertCanonical(value, schema, code, path = '$') {
  const issues = validateSchema(value, schema, { path });
  if (issues.length) throw projectError(code, issues[0]);
}

function fail(code, path, message) {
  throw new ProjectLoadError(code, path, message);
}

function validateColumnValue(value, type, path) {
  if (value === null) return;
  if (type === 'text' && typeof value !== 'string') fail('TABLE_DATA_INVALID', path, 'Expected a text value or null.');
  if (type === 'integer' && !Number.isInteger(value)) fail('TABLE_DATA_INVALID', path, 'Expected an integer value or null.');
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    fail('TABLE_DATA_INVALID', path, 'Expected a finite number or null.');
  }
  if (type === 'boolean' && typeof value !== 'boolean') fail('TABLE_DATA_INVALID', path, 'Expected a boolean value or null.');
  if (type === 'date') {
    const issues = validateSchema(value, { type: 'string', format: 'date' }, { path });
    if (issues.length) fail('TABLE_DATA_INVALID', path, 'Expected a valid ISO date or null.');
  }
}

export function validateTableData(value, { path = '$' } = {}) {
  assertCanonical(value, TABLE_DATA_V1_SCHEMA, 'TABLE_DATA_INVALID', path);
  const columns = new Map();
  value.columns.forEach((column, index) => {
    if (columns.has(column.id)) {
      fail('TABLE_DATA_INVALID', `${path}.columns[${index}].id`, `Duplicate column ID: ${column.id}.`);
    }
    columns.set(column.id, column);
  });

  value.rows.forEach((row, rowIndex) => {
    const rowPath = `${path}.rows[${rowIndex}]`;
    for (const key of Object.keys(row)) {
      if (!columns.has(key)) fail('TABLE_DATA_INVALID', `${rowPath}.${key}`, 'Row contains an undeclared column.');
    }
    for (const [id, column] of columns) {
      if (!Object.hasOwn(row, id)) fail('TABLE_DATA_INVALID', `${rowPath}.${id}`, 'Missing values must be represented by null.');
      validateColumnValue(row[id], column.type, `${rowPath}.${id}`);
    }
  });
  return value;
}

function validateMetricFormat(format, path) {
  if (['percentage', 'distance'].includes(format.type) && format.decimals > 2) {
    fail('METRIC_FILE_INVALID', `${path}.decimals`, `${format.type} decimals must be between 0 and 2.`);
  }
  if (format.type === 'currency' && format.currency === undefined) {
    fail('METRIC_FILE_INVALID', `${path}.currency`, 'Currency format requires an ISO 4217 currency code.');
  }
}

function isMetricLiteral(value) {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

export function validateMetricFile(value, { path = '$' } = {}) {
  assertCanonical(value, METRIC_FILE_V1_SCHEMA, 'METRIC_FILE_INVALID', path);
  for (const [id, metric] of Object.entries(value.metrics)) {
    const metricPath = `${path}.metrics.${id}`;
    if (!ID_PATTERN.test(id)) fail('METRIC_FILE_INVALID', metricPath, 'Metric ID must be a stable lowercase ID.');
    if (!isMetricLiteral(metric.value)) {
      fail('METRIC_FILE_INVALID', `${metricPath}.value`, 'Metric value must be a literal scalar, finite number, or null.');
    }
    validateMetricFormat(metric.format, `${metricPath}.format`);
  }
  return value;
}

export function validateGeoJsonResource(value, descriptor, { path = '$' } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('GEOJSON_RESOURCE_INVALID', path, 'GeoJSON resource must be an object.');
  }
  if (value.type !== 'FeatureCollection') {
    fail('GEOJSON_RESOURCE_INVALID', `${path}.type`, 'GeoJSON resource must be a FeatureCollection.');
  }
  if (!Array.isArray(value.features)) {
    fail('GEOJSON_RESOURCE_INVALID', `${path}.features`, 'FeatureCollection features must be an array.');
  }
  const allowed = GEOMETRY_TYPES[descriptor?.geometry];
  if (!allowed) fail('GEOJSON_RESOURCE_INVALID', `${path}.geometry`, 'Dataset must declare a supported geometry family.');

  value.features.forEach((feature, index) => {
    const featurePath = `${path}.features[${index}]`;
    if (!feature || typeof feature !== 'object' || Array.isArray(feature) || feature.type !== 'Feature') {
      fail('GEOJSON_RESOURCE_INVALID', `${featurePath}.type`, 'GeoJSON item must be a Feature.');
    }
    const geometryType = feature.geometry?.type;
    if (!allowed.has(geometryType)) {
      fail('GEOJSON_RESOURCE_INVALID', `${featurePath}.geometry.type`, `Geometry must match declared ${descriptor.geometry} geometry.`);
    }
    if (!Array.isArray(feature.geometry.coordinates)) {
      fail('GEOJSON_RESOURCE_INVALID', `${featurePath}.geometry.coordinates`, 'Geometry coordinates must be an array.');
    }
  });
  return value;
}
