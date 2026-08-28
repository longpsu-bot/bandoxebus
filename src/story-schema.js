import story11Schema from '../data/schemas/story-1.1.schema.json' with { type: 'json' };
import { validateSchema } from './contracts/schema-validator.js';
import { CONTENT_BLOCK_DESCRIPTORS, STORY_10_CONTENT_TYPES, STORY_11_CONTENT_TYPES } from './content/content-descriptors.js';

export const STORY_SCHEMA_VERSION = '1.0';
export const STORY_SCHEMA_VERSIONS = Object.freeze(['1.0', '1.1']);
const PRESENTATION_LAYOUTS = new Set(['hero', 'metrics', 'narrative', 'map-focus']);
const schemas = Object.freeze({ '1.0': Object.freeze({ type: 'object', properties: { schemaVersion: { const: '1.0' } } }), '1.1': story11Schema });

export class StoryValidationError extends TypeError {
  constructor(message) { super(`Invalid story definition: ${message}`); this.name = 'StoryValidationError'; }
}
function fail(message) { throw new StoryValidationError(message); }
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireObject(value, path) { if (!object(value)) fail(`${path} must be an object.`); }
function requireString(value, path) { if (typeof value !== 'string' || !value.trim()) fail(`${path} must be a non-empty string.`); }

export function getStorySchema(version) {
  if (!schemas[version]) fail(`Unsupported schemaVersion "${version}".`);
  return schemas[version];
}

function contract(actionContracts, type) {
  if (actionContracts instanceof Map) return actionContracts.get(type);
  return object(actionContracts) ? actionContracts[type] : undefined;
}
function validateAction(action, path, actionContracts) {
  requireObject(action, path); requireString(action.type, `${path} action.type`);
  const validator = contract(actionContracts, action.type);
  if (typeof validator !== 'function') fail(`${path} has unsupported action type "${action.type}".`);
  const issue = validator(action, path); if (issue) fail(issue);
}

function legacyBlock(block, path) {
  requireObject(block, path); requireString(block.type, `${path}.type`);
  if (!STORY_10_CONTENT_TYPES.includes(block.type)) fail(`${path} has unsupported content block type "${block.type}".`);
  if (['eyebrow', 'heading', 'paragraph', 'disclosure'].includes(block.type)) requireString(block.text, `${path} ${block.type}.text`);
  if (block.type === 'stat-group') {
    if (!Array.isArray(block.items) || !block.items.length) fail(`${path}.items must be a non-empty array.`);
    block.items.forEach((item, index) => { requireObject(item, `${path}.items[${index}]`); requireString(item.label, `${path}.items[${index}].label`); requireString(item.metric, `${path}.items[${index}].metric`); requireString(item.format, `${path}.items[${index}].format`); });
  }
  if (block.type === 'callout') {
    if (!Array.isArray(block.items) || !block.items.length) fail(`${path}.items must be a non-empty array.`);
    block.items.forEach((item, index) => { requireObject(item, `${path}.items[${index}]`); requireString(item.text, `${path}.items[${index}].text`); });
  }
}

function descriptorBlock(block, path, contentDescriptors) {
  requireObject(block, path); requireString(block.type, `${path}.type`);
  if (!STORY_11_CONTENT_TYPES.includes(block.type)) fail(`${path} has unsupported content block type "${block.type}".`);
  const list = contentDescriptors ?? CONTENT_BLOCK_DESCRIPTORS;
  const descriptor = Array.isArray(list) ? list.find(({ type }) => type === block.type) : list[block.type];
  if (!descriptor) fail(`${path} has unsupported content block type "${block.type}".`);
  const issues = validateSchema(block, descriptor.schema, { path });
  if (issues.length) fail(`${issues[0].path}: ${issues[0].message}`);
  if (block.type === 'image' && block.alt === '' && block.decorative !== true) fail(`${path}.alt may be empty only for a decorative image.`);
  if (block.type === 'image' && block.decorative === true && block.alt !== '') fail(`${path}.alt must be empty for a decorative image.`);
  if (block.type === 'chart' && block.stacked && block.chartType !== 'bar') fail(`${path}.stacked is supported only for bar charts.`);
  if (block.type === 'legend') block.items.forEach((item, index) => {
    if (item.sample === 'icon' && !item.asset) fail(`${path}.items[${index}].asset is required for an icon sample.`);
    if (item.sample !== 'icon' && !item.color) fail(`${path}.items[${index}].color is required for a ${item.sample} sample.`);
  });
}

function validateState(state, index, options, version) {
  const path = `states[${index}]`; requireObject(state, path); requireString(state.id, `${path}.id`);
  requireObject(state.content, `${path}.content`); requireString(state.content.layout, `${path}.content.layout`);
  if (!PRESENTATION_LAYOUTS.has(state.content.layout)) fail(`${path}.content.layout is unsupported: "${state.content.layout}".`);
  if (!Array.isArray(state.content.blocks) || !state.content.blocks.length) fail(`${path}.content.blocks must be a non-empty array.`);
  state.content.blocks.forEach((block, blockIndex) => (version === '1.0' ? legacyBlock : descriptorBlock)(block, `${path}.content.blocks[${blockIndex}]`, options.contentDescriptors));
  if (state.content.presenterNote !== undefined) requireString(state.content.presenterNote, `${path}.content.presenterNote`);
  requireObject(state.map, `${path}.map`);
  for (const phase of ['enter', 'exit']) {
    if (!Array.isArray(state.map[phase])) fail(`${path}.map.${phase} must be an array.`);
    state.map[phase].forEach((action, actionIndex) => validateAction(action, `${path}.map.${phase}[${actionIndex}]`, options.actionContracts));
  }
}

export function validateStoryDefinition(definition, options = {}) {
  requireObject(definition, 'story'); requireString(definition.schemaVersion, 'schemaVersion');
  if (!STORY_SCHEMA_VERSIONS.includes(definition.schemaVersion)) fail(`Unsupported schemaVersion "${definition.schemaVersion}".`);
  if (definition.schemaVersion === '1.1') {
    const issues = validateSchema(definition, story11Schema, { path: '$' });
    if (issues.length) fail(`${issues[0].path}: ${issues[0].message}`);
  }
  requireString(definition.id, 'id'); requireString(definition.title, 'title');
  if (!Array.isArray(definition.states) || !definition.states.length) fail('states must be a non-empty array.');
  const ids = new Set();
  definition.states.forEach((state, index) => { validateState(state, index, options, definition.schemaVersion); if (ids.has(state.id)) fail(`Duplicate state ID "${state.id}".`); ids.add(state.id); });
  return definition;
}

export async function loadStoryDefinition(url, { fetchImpl = fetch, actionContracts, contentDescriptors } = {}) {
  const response = await fetchImpl(url); if (!response.ok) throw new Error(`Could not load story definition "${url}" (${response.status}).`);
  return validateStoryDefinition(await response.json(), { actionContracts, contentDescriptors });
}
