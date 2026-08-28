import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';
import { CONTENT_BLOCK_DESCRIPTORS } from '../content/content-descriptors.js';

export const CORE_CONTENT_V1_DESCRIPTOR = deepFreeze({
  schemaVersion: '1.0',
  id: 'core-content-v1',
  label: 'Core content',
  description: 'Baseline Story 1.0 and additive Story 1.1 content catalog.',
  requires: [],
  datasetRoles: [],
  actions: [],
  content: CONTENT_BLOCK_DESCRIPTORS,
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
