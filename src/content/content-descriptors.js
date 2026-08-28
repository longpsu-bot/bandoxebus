import { deepFreeze } from '../capabilities/descriptor-schema.js';

const FORMAT = { type: 'object', additionalProperties: false, required: ['type'], properties: {
  type: { type: 'string', enum: ['integer', 'decimal', 'percentage', 'distance', 'currency', 'text'] },
  decimals: { type: 'integer', minimum: 0, maximum: 3 }, currency: { type: 'string', pattern: '^[A-Z]{3}$' }, unit: { type: 'string' }
} };
const SOURCE = { type: 'string', pattern: '^[a-z][a-z0-9-]*$' };
const COLOR = { type: 'string', pattern: '^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$' };
function descriptor(type, label, description, required, properties) {
  return { type, label, description, schema: { type: 'object', additionalProperties: false, required: ['type', ...required], properties: { type: { const: type }, ...properties } } };
}

export const CONTENT_BLOCK_DESCRIPTORS = deepFreeze([
  descriptor('eyebrow', 'Eyebrow', 'Render an eyebrow text block.', ['text'], { text: { type: 'string' }, step: { type: 'string' } }),
  descriptor('heading', 'Heading', 'Render a heading text block.', ['text'], { text: { type: 'string' }, subtitle: { type: 'string' }, status: { type: 'string' } }),
  descriptor('paragraph', 'Paragraph', 'Render a paragraph text block.', ['text'], { text: { type: 'string' } }),
  descriptor('stat-group', 'Statistic group', 'Render metric bindings.', ['items'], { items: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['label', 'metric', 'format'], properties: { label: { type: 'string' }, metric: SOURCE, format: FORMAT, tone: { type: 'string', enum: ['neutral', 'added', 'removed', 'retained'] } } } } }),
  descriptor('callout', 'Callout', 'Render concise callout items.', ['items'], { items: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['text'], properties: { label: { type: 'string' }, text: { type: 'string' }, tone: { type: 'string', enum: ['neutral', 'added', 'removed', 'retained'] } } } } }),
  descriptor('disclosure', 'Disclosure', 'Render disclosure text.', ['text'], { text: { type: 'string' } }),
  descriptor('table', 'Table', 'Render selected normalized table columns.', ['data'], {
    title: { type: 'string' }, caption: { type: 'string' }, source: SOURCE,
    data: { type: 'object', additionalProperties: false, required: ['dataset', 'columns'], properties: { dataset: SOURCE, columns: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['field'], properties: { field: SOURCE, header: { type: 'string' }, align: { type: 'string', enum: ['start', 'center', 'end'] }, format: FORMAT } } } } }
  }),
  descriptor('chart', 'Chart', 'Render a bounded accessible chart.', ['chartType', 'title', 'data'], {
    chartType: { type: 'string', enum: ['bar', 'line', 'area'] }, title: { type: 'string' }, description: { type: 'string' }, source: SOURCE, stacked: { type: 'boolean' },
    data: { type: 'object', additionalProperties: false, required: ['dataset', 'x', 'series'], properties: { dataset: SOURCE, x: SOURCE, series: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['y', 'label'], properties: { y: SOURCE, label: { type: 'string' }, format: FORMAT, color: COLOR } } } } }
  }),
  descriptor('image', 'Image', 'Render a declared image asset.', ['asset', 'alt'], { asset: SOURCE, alt: { type: 'string' }, decorative: { type: 'boolean' }, title: { type: 'string' }, caption: { type: 'string' }, source: SOURCE }),
  descriptor('legend', 'Legend', 'Render an authored legend.', ['items'], { title: { type: 'string' }, source: SOURCE, items: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, required: ['label', 'sample'], properties: { label: { type: 'string' }, sample: { type: 'string', enum: ['swatch', 'line', 'icon'] }, color: COLOR, asset: SOURCE } } } })
]);
export const STORY_10_CONTENT_TYPES = deepFreeze(CONTENT_BLOCK_DESCRIPTORS.slice(0, 6).map(({ type }) => type));
export const STORY_11_CONTENT_TYPES = deepFreeze(CONTENT_BLOCK_DESCRIPTORS.map(({ type }) => type));
