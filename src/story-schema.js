export const STORY_SCHEMA_VERSION = '1.0';

const CONTENT_BLOCK_TYPES = new Set([
  'eyebrow',
  'heading',
  'paragraph',
  'stat-group',
  'callout',
  'disclosure'
]);

const PRESENTATION_LAYOUTS = new Set(['hero', 'metrics', 'narrative', 'map-focus']);

export class StoryValidationError extends TypeError {
  constructor(message) {
    super(`Invalid story definition: ${message}`);
    this.name = 'StoryValidationError';
  }
}

function fail(message) {
  throw new StoryValidationError(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, path) {
  if (!isObject(value)) fail(`${path} must be an object.`);
}

function requireString(value, path) {
  if (typeof value !== 'string' || !value.trim()) fail(`${path} must be a non-empty string.`);
}

function validateItems(items, path, validateItem) {
  if (!Array.isArray(items) || items.length === 0) fail(`${path} must be a non-empty array.`);
  items.forEach((item, index) => validateItem(item, `${path}[${index}]`));
}

function validateBlock(block, path) {
  requireObject(block, path);
  requireString(block.type, `${path}.type`);
  if (!CONTENT_BLOCK_TYPES.has(block.type)) fail(`${path} has unsupported content block type "${block.type}".`);

  if (['eyebrow', 'heading', 'paragraph', 'disclosure'].includes(block.type)) {
    requireString(block.text, `${path} ${block.type}.text`);
  }

  if (block.type === 'stat-group') {
    validateItems(block.items, `${path}.items`, (item, itemPath) => {
      requireObject(item, itemPath);
      requireString(item.label, `${itemPath}.label`);
      requireString(item.metric, `${itemPath}.metric`);
      requireString(item.format, `${itemPath}.format`);
    });
  }

  if (block.type === 'callout') {
    validateItems(block.items, `${path}.items`, (item, itemPath) => {
      requireObject(item, itemPath);
      requireString(item.text, `${itemPath}.text`);
    });
  }
}

function validateAction(action, path, supportedActionTypes) {
  requireObject(action, path);
  requireString(action.type, `${path} action.type`);
  if (supportedActionTypes && !supportedActionTypes.has(action.type)) {
    fail(`${path} has unsupported action type "${action.type}".`);
  }
}

function validateState(state, index, supportedActionTypes) {
  const path = `states[${index}]`;
  requireObject(state, path);
  requireString(state.id, `${path}.id`);
  requireObject(state.content, `${path}.content`);
  requireString(state.content.layout, `${path}.content.layout`);
  if (!PRESENTATION_LAYOUTS.has(state.content.layout)) {
    fail(`${path}.content.layout is unsupported: "${state.content.layout}".`);
  }
  validateItems(state.content.blocks, `${path}.content.blocks`, validateBlock);
  if (state.content.presenterNote !== undefined) {
    requireString(state.content.presenterNote, `${path}.content.presenterNote`);
  }

  requireObject(state.map, `${path}.map`);
  for (const phase of ['enter', 'exit']) {
    if (!Array.isArray(state.map[phase])) fail(`${path}.map.${phase} must be an array.`);
    state.map[phase].forEach((action, actionIndex) => (
      validateAction(action, `${path}.map.${phase}[${actionIndex}]`, supportedActionTypes)
    ));
  }
}

export function validateStoryDefinition(definition, { supportedActionTypes } = {}) {
  requireObject(definition, 'story');
  requireString(definition.schemaVersion, 'schemaVersion');
  if (definition.schemaVersion !== STORY_SCHEMA_VERSION) {
    fail(`Unsupported schemaVersion "${definition.schemaVersion}"; expected "${STORY_SCHEMA_VERSION}".`);
  }
  requireString(definition.id, 'id');
  requireString(definition.title, 'title');
  if (!Array.isArray(definition.states) || definition.states.length === 0) {
    fail('states must be a non-empty array.');
  }

  const actionTypes = supportedActionTypes ? new Set(supportedActionTypes) : null;
  const ids = new Set();
  definition.states.forEach((state, index) => {
    validateState(state, index, actionTypes);
    if (ids.has(state.id)) fail(`Duplicate state ID "${state.id}".`);
    ids.add(state.id);
  });

  return definition;
}

export async function loadStoryDefinition(url, {
  fetchImpl = fetch,
  supportedActionTypes
} = {}) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Could not load story definition "${url}" (${response.status}).`);
  }
  const definition = await response.json();
  return validateStoryDefinition(definition, { supportedActionTypes });
}
