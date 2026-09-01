import { createStableId } from './draft-store.js';
import { validateSchema } from '../../src/contracts/schema-validator.js';
import { CONTENT_BLOCK_DESCRIPTORS } from '../../src/content/content-descriptors.js';

const RICH_TYPES = Object.freeze({ metric: 'stat-group', chart: 'chart', table: 'table', image: 'image', legend: 'legend' });
const DEFAULTS = Object.freeze({
  metric: Object.freeze({ id: 'metric', frame: Object.freeze({ x: 0.08, y: 0.08, width: 0.32, height: 0.2 }) }),
  chart: Object.freeze({ id: 'chart', frame: Object.freeze({ x: 0.08, y: 0.32, width: 0.5, height: 0.42 }) }),
  table: Object.freeze({ id: 'table', frame: Object.freeze({ x: 0.44, y: 0.08, width: 0.48, height: 0.36 }) }),
  image: Object.freeze({ id: 'image', frame: Object.freeze({ x: 0.44, y: 0.48, width: 0.48, height: 0.42 }) }),
  legend: Object.freeze({ id: 'legend', frame: Object.freeze({ x: 0.68, y: 0.08, width: 0.24, height: 0.28 }) })
});

const clone = (value) => value === undefined ? undefined : structuredClone(value);
function unsupported(message) { throw Object.assign(new Error(message), { code: 'GUI_SCHEMA_UNSUPPORTED' }); }
function first(catalog, label) {
  const value = catalog?.[0];
  if (!value) unsupported(`A declared ${label} is required to create this content block.`);
  return value;
}
const catalogId = (item) => typeof item === 'string' ? item : item.id;

function selected(catalog, id, label) {
  if (id === undefined) return first(catalog, label);
  const value = catalog?.find((item) => catalogId(item) === id);
  if (!value) unsupported(`Unknown ${label}: ${id}.`);
  return value;
}

function createRichBlock(kind, catalogs, { metricId, datasetId, assetId, chartType = 'bar' } = {}) {
  if (kind === 'metric') {
    const metric = selected(catalogs.metrics, metricId, 'metric');
    return { type: 'stat-group', items: [{ label: metric.label ?? metric.id, metric: metric.id, format: clone(metric.format) }] };
  }
  if (kind === 'table') {
    const table = selected(catalogs.tables, datasetId, 'normalized table');
    const column = first(table.columns, 'table column');
    return { type: 'table', data: { dataset: table.id, columns: [{ field: column.id }] } };
  }
  if (kind === 'chart') {
    const table = selected(catalogs.tables, datasetId, 'normalized table');
    const x = table.columns?.find((column) => ['text', 'date', 'integer'].includes(column.type));
    const y = table.columns?.find((column) => ['integer', 'number'].includes(column.type));
    if (!x || !y) unsupported('A chart requires a categorical x column and a numeric series column.');
    return { type: 'chart', chartType, title: y.label ?? y.id, data: { dataset: table.id, x: x.id, series: [{ y: y.id, label: y.label ?? y.id }] } };
  }
  if (kind === 'image') {
    const asset = selected(catalogs.assets, assetId, 'image asset');
    return { type: 'image', asset: catalogId(asset), alt: '', decorative: true };
  }
  if (kind === 'legend') return { type: 'legend', items: [{ label: '', sample: 'swatch', color: '#000000' }] };
  throw new TypeError(`Unsupported rich object kind: ${kind}.`);
}

export function validateRichBlock(block) {
  if (!Object.values(RICH_TYPES).includes(block?.type)) throw new TypeError(`Unsupported rich content block: ${block?.type ?? ''}.`);
  const descriptor = CONTENT_BLOCK_DESCRIPTORS.find(({ type }) => type === block.type);
  const issues = validateSchema(block, descriptor.schema, { path: '$.block' });
  if (issues.length) throw new TypeError(`Invalid rich content block at ${issues[0].path}: ${issues[0].message}`);
  if (block.type === 'image' && block.alt === '' && block.decorative !== true) throw new TypeError('Invalid rich content block: empty image alt requires decorative true.');
  if (block.type === 'image' && block.decorative === true && block.alt !== '') throw new TypeError('Invalid rich content block: a decorative image must have empty alt text.');
  if (block.type === 'chart' && block.stacked && block.chartType !== 'bar') throw new TypeError('Invalid rich content block: stacking is supported only for bar charts.');
  return clone(block);
}

export function createRichObjectEnvelope(kind, {
  catalogs = {}, usedIds = [], frame, z = 0, metricId, datasetId, assetId, chartType
} = {}) {
  const definition = DEFAULTS[kind];
  if (!definition) throw new TypeError(`Unsupported rich object kind: ${kind}.`);
  const envelope = {
    id: createStableId(definition.id, usedIds),
    frame: { ...(frame ?? definition.frame), z: frame?.z ?? z },
    block: createRichBlock(kind, catalogs, { metricId, datasetId, assetId, chartType })
  };
  validateRichBlock(envelope.block);
  return envelope;
}

export const createMetricEnvelope = (options) => createRichObjectEnvelope('metric', options);
export const createChartEnvelope = (options) => createRichObjectEnvelope('chart', options);
export const createTableEnvelope = (options) => createRichObjectEnvelope('table', options);
export const createImageEnvelope = (options) => createRichObjectEnvelope('image', options);
export const createLegendEnvelope = (options) => createRichObjectEnvelope('legend', options);

export function createRichContentBlock(type, catalogs = {}) {
  const kind = Object.entries(RICH_TYPES).find(([, semanticType]) => semanticType === type)?.[0];
  if (!kind) throw new TypeError(`Unsupported rich content block: ${type}.`);
  return createRichBlock(kind, catalogs);
}
