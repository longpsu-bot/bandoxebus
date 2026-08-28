import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';

function textBlock(type, label) {
  return {
    type,
    label,
    description: `Render a ${label.toLowerCase()} text block.`,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'text'],
      properties: {
        type: { const: type },
        text: { type: 'string' }
      }
    }
  };
}

const CONTENT = [
  {
    ...textBlock('eyebrow', 'Eyebrow'),
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'text'],
      properties: {
        type: { const: 'eyebrow' },
        text: { type: 'string' },
        step: { type: 'string' }
      }
    }
  },
  textBlock('heading', 'Heading'),
  textBlock('paragraph', 'Paragraph'),
  {
    type: 'stat-group',
    label: 'Statistic group',
    description: 'Render labeled metric bindings.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'items'],
      properties: {
        type: { const: 'stat-group' },
        items: { type: 'array', minItems: 1, items: { type: 'object' } }
      }
    }
  },
  {
    type: 'callout',
    label: 'Callout',
    description: 'Render a list of concise callout items.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'items'],
      properties: {
        type: { const: 'callout' },
        items: { type: 'array', minItems: 1, items: { type: 'object' } }
      }
    }
  },
  textBlock('disclosure', 'Disclosure')
];

export const CORE_CONTENT_V1_DESCRIPTOR = deepFreeze({
  schemaVersion: '1.0',
  id: 'core-content-v1',
  label: 'Core content',
  description: 'Baseline Story 1.0 content block catalog.',
  requires: [],
  datasetRoles: [],
  actions: [],
  content: CONTENT,
  targets: [],
  metrics: [],
  legacyActions: [],
  lifecycle: [],
  settingsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {}
  },
  gui: { group: 'Core content' }
});

function unavailable(type) {
  return () => {
    throw new ProjectLoadError(
      'CAPABILITY_NOT_INITIALIZED',
      `$.capabilities.core-content-v1.renderers.${type}`,
      'Core content rendering is not initialized in the contract foundation.'
    );
  };
}

export function createCoreContentCapability(context = {}) {
  return Object.freeze({
    renderers: Object.freeze(Object.fromEntries(
      CORE_CONTENT_V1_DESCRIPTOR.content.map(({ type }) => [type, context.renderers?.[type] ?? unavailable(type)])
    ))
  });
}
