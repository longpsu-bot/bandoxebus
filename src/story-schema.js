import story11Schema from '../data/schemas/story-1.1.schema.json' with { type: 'json' };
import story12Schema from '../data/schemas/story-1.2.schema.json' with { type: 'json' };
import { validateSchema } from './contracts/schema-validator.js';
import { CONTENT_BLOCK_DESCRIPTORS, STORY_10_CONTENT_TYPES, STORY_11_CONTENT_TYPES } from './content/content-descriptors.js';
import {
  STORY_12_APPEARANCE_BOUNDS,
  STORY_12_CAMERA_BOUNDS,
  STORY_12_FONT_FAMILIES,
  STORY_12_ID_PATTERN,
  STORY_12_INTERACTIONS,
  STORY_12_LAYOUT,
  STORY_12_TRANSITIONS
} from './scene/scene-contract.js';

export const STORY_SCHEMA_VERSION = '1.0';
export const STORY_SCHEMA_VERSIONS = Object.freeze(['1.0', '1.1', '1.2']);
const PRESENTATION_LAYOUTS = new Set(['hero', 'metrics', 'narrative', 'map-focus']);
const schemas = Object.freeze({
  '1.0': Object.freeze({ type: 'object', properties: { schemaVersion: { const: '1.0' } } }),
  '1.1': story11Schema,
  '1.2': story12Schema
});
const HEX_COLOR = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

export class StoryValidationError extends TypeError {
  constructor(message) { super(`Invalid story definition: ${message}`); this.name = 'StoryValidationError'; }
}
function fail(message) { throw new StoryValidationError(message); }
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireObject(value, path) { if (!object(value)) fail(`${path} must be an object.`); }
function requireString(value, path) { if (typeof value !== 'string' || !value.trim()) fail(`${path} must be a non-empty string.`); }
function rejectUnknownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key} is an unknown property.`);
}
function requireNumber(value, path, [minimum, maximum]) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail(`${path} must be finite and between ${minimum} and ${maximum}.`);
}
function requireInteger(value, path, [minimum, maximum]) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`${path} must be an integer between ${minimum} and ${maximum}.`);
}
function requireColor(value, path) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) fail(`${path} must be a 6- or 8-digit hex color.`);
}

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

function validateLegacyState(state, index, options, version) {
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

function validateAppearance(appearance, path) {
  requireObject(appearance, path);
  rejectUnknownKeys(appearance, new Set(['box', 'text']), path);
  if (appearance.box !== undefined) {
    const boxPath = `${path}.box`;
    requireObject(appearance.box, boxPath);
    rejectUnknownKeys(appearance.box, new Set(['fill', 'opacity', 'borderColor', 'borderWidth', 'radius', 'padding']), boxPath);
    if (appearance.box.fill !== undefined) requireColor(appearance.box.fill, `${boxPath}.fill`);
    if (appearance.box.opacity !== undefined) requireNumber(appearance.box.opacity, `${boxPath}.opacity`, STORY_12_APPEARANCE_BOUNDS.opacity);
    if (appearance.box.borderColor !== undefined) requireColor(appearance.box.borderColor, `${boxPath}.borderColor`);
    if (appearance.box.borderWidth !== undefined) requireNumber(appearance.box.borderWidth, `${boxPath}.borderWidth`, STORY_12_APPEARANCE_BOUNDS.borderWidth);
    if (appearance.box.radius !== undefined) requireNumber(appearance.box.radius, `${boxPath}.radius`, STORY_12_APPEARANCE_BOUNDS.radius);
    if (appearance.box.padding !== undefined) requireNumber(appearance.box.padding, `${boxPath}.padding`, STORY_12_APPEARANCE_BOUNDS.padding);
  }
  if (appearance.text !== undefined) {
    const textPath = `${path}.text`;
    requireObject(appearance.text, textPath);
    rejectUnknownKeys(appearance.text, new Set(['fontFamily', 'fontSize', 'bold', 'italic', 'color', 'align', 'lineHeight']), textPath);
    if (appearance.text.fontFamily !== undefined && !STORY_12_FONT_FAMILIES.includes(appearance.text.fontFamily)) fail(`${textPath}.fontFamily is unsupported.`);
    if (appearance.text.fontSize !== undefined) requireNumber(appearance.text.fontSize, `${textPath}.fontSize`, STORY_12_APPEARANCE_BOUNDS.fontSize);
    if (appearance.text.bold !== undefined && typeof appearance.text.bold !== 'boolean') fail(`${textPath}.bold must be boolean.`);
    if (appearance.text.italic !== undefined && typeof appearance.text.italic !== 'boolean') fail(`${textPath}.italic must be boolean.`);
    if (appearance.text.color !== undefined) requireColor(appearance.text.color, `${textPath}.color`);
    if (appearance.text.align !== undefined && !['left', 'center', 'right'].includes(appearance.text.align)) fail(`${textPath}.align is unsupported.`);
    if (appearance.text.lineHeight !== undefined) requireNumber(appearance.text.lineHeight, `${textPath}.lineHeight`, STORY_12_APPEARANCE_BOUNDS.lineHeight);
  }
}

function validateEnvelope(envelope, path, options) {
  requireObject(envelope, path);
  rejectUnknownKeys(envelope, new Set(['id', 'frame', 'appearance', 'block']), path);
  requireString(envelope.id, `${path}.id`);
  if (!STORY_12_ID_PATTERN.test(envelope.id)) fail(`${path}.id must be a stable lowercase ID.`);
  requireObject(envelope.frame, `${path}.frame`);
  rejectUnknownKeys(envelope.frame, new Set(['x', 'y', 'width', 'height', 'z']), `${path}.frame`);
  for (const field of ['x', 'y', 'width', 'height', 'z']) if (!Object.hasOwn(envelope.frame, field)) fail(`${path}.frame.${field} is required.`);
  requireNumber(envelope.frame.x, `${path}.frame.x`, [0, 1]);
  requireNumber(envelope.frame.y, `${path}.frame.y`, [0, 1]);
  if (!Number.isFinite(envelope.frame.width) || envelope.frame.width <= 0 || envelope.frame.width > 1) fail(`${path}.frame.width must be greater than 0 and at most 1.`);
  if (!Number.isFinite(envelope.frame.height) || envelope.frame.height <= 0 || envelope.frame.height > 1) fail(`${path}.frame.height must be greater than 0 and at most 1.`);
  requireInteger(envelope.frame.z, `${path}.frame.z`, [0, 9999]);
  if (envelope.frame.x + envelope.frame.width > 1) fail(`${path}.frame x + width must be at most 1.`);
  if (envelope.frame.y + envelope.frame.height > 1) fail(`${path}.frame y + height must be at most 1.`);
  if (envelope.appearance !== undefined) validateAppearance(envelope.appearance, `${path}.appearance`);
  descriptorBlock(envelope.block, `${path}.block`, options.contentDescriptors);
}

function validateStory12State(state, index, options) {
  const path = `states[${index}]`;
  requireObject(state, path); requireString(state.id, `${path}.id`);
  requireObject(state.content, `${path}.content`);
  if (state.content.layout !== STORY_12_LAYOUT) fail(`${path}.content.layout must be "${STORY_12_LAYOUT}".`);
  if (!Array.isArray(state.content.blocks)) fail(`${path}.content.blocks must be an array.`);
  if (state.content.presenterNote !== undefined) requireString(state.content.presenterNote, `${path}.content.presenterNote`);
  const envelopeIds = new Set();
  state.content.blocks.forEach((envelope, blockIndex) => {
    const envelopePath = `${path}.content.blocks[${blockIndex}]`;
    validateEnvelope(envelope, envelopePath, options);
    if (envelopeIds.has(envelope.id)) fail(`${path}.content.blocks has duplicate envelope ID "${envelope.id}".`);
    envelopeIds.add(envelope.id);
  });

  requireObject(state.map, `${path}.map`);
  const cameraPath = `${path}.map.camera`;
  requireObject(state.map.camera, cameraPath);
  if (!Array.isArray(state.map.camera.center) || state.map.camera.center.length !== 2) fail(`${cameraPath}.center must contain longitude and latitude.`);
  requireNumber(state.map.camera.center[0], `${cameraPath}.center longitude`, STORY_12_CAMERA_BOUNDS.longitude);
  requireNumber(state.map.camera.center[1], `${cameraPath}.center latitude`, STORY_12_CAMERA_BOUNDS.latitude);
  requireNumber(state.map.camera.zoom, `${cameraPath}.zoom`, STORY_12_CAMERA_BOUNDS.zoom);
  requireNumber(state.map.camera.pitch, `${cameraPath}.pitch`, STORY_12_CAMERA_BOUNDS.pitch);
  requireNumber(state.map.camera.bearing, `${cameraPath}.bearing`, STORY_12_CAMERA_BOUNDS.bearing);
  if (!STORY_12_INTERACTIONS.includes(state.map.interaction)) fail(`${path}.map.interaction is unsupported.`);
  if (!STORY_12_TRANSITIONS.includes(state.map.transition?.type)) fail(`${path}.map.transition.type is unsupported.`);
  requireInteger(state.map.transition?.durationMs, `${path}.map.transition.durationMs`, [0, 10000]);
  if (state.map.transition.type === 'instant' && state.map.transition.durationMs !== 0) fail(`${path}.map.transition instant durationMs must be 0.`);
  requireObject(state.map.layerVisibility, `${path}.map.layerVisibility`);
  for (const [id, visible] of Object.entries(state.map.layerVisibility)) {
    if (!STORY_12_ID_PATTERN.test(id)) fail(`${path}.map.layerVisibility.${id} must use a stable lowercase dataset ID.`);
    if (typeof visible !== 'boolean') fail(`${path}.map.layerVisibility.${id} must be boolean.`);
  }
  for (const phase of ['enter', 'exit']) {
    if (!Array.isArray(state.map[phase])) fail(`${path}.map.${phase} must be an array.`);
    state.map[phase].forEach((action, actionIndex) => validateAction(action, `${path}.map.${phase}[${actionIndex}]`, options.actionContracts));
  }
}

export function validateStoryDefinition(definition, options = {}) {
  requireObject(definition, 'story'); requireString(definition.schemaVersion, 'schemaVersion');
  if (!STORY_SCHEMA_VERSIONS.includes(definition.schemaVersion)) fail(`Unsupported schemaVersion "${definition.schemaVersion}".`);
  if (definition.schemaVersion === '1.1' || definition.schemaVersion === '1.2') {
    const schema = schemas[definition.schemaVersion];
    const issues = validateSchema(definition, schema, { path: '$' });
    if (issues.length) fail(`${issues[0].path}: ${issues[0].message}`);
  }
  requireString(definition.id, 'id'); requireString(definition.title, 'title');
  if (!Array.isArray(definition.states) || !definition.states.length) fail('states must be a non-empty array.');
  const ids = new Set();
  definition.states.forEach((state, index) => {
    if (definition.schemaVersion === '1.2') validateStory12State(state, index, options);
    else validateLegacyState(state, index, options, definition.schemaVersion);
    if (ids.has(state.id)) fail(`Duplicate state ID "${state.id}".`);
    ids.add(state.id);
  });
  return definition;
}

export async function loadStoryDefinition(url, { fetchImpl = fetch, actionContracts, contentDescriptors } = {}) {
  const response = await fetchImpl(url); if (!response.ok) throw new Error(`Could not load story definition "${url}" (${response.status}).`);
  return validateStoryDefinition(await response.json(), { actionContracts, contentDescriptors });
}
