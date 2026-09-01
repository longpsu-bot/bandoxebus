import { createStableId, moveArrayItem } from './draft-store.js';
import {
  STORY_12_APPEARANCE_BOUNDS,
  STORY_12_FONT_FAMILIES,
  STORY_12_ID_PATTERN,
  STORY_12_INTERACTIONS,
  STORY_12_TRANSITIONS
} from '../../src/scene/scene-contract.js';
import { createRichObjectEnvelope, validateRichBlock } from './scene-object-factories.js';

const DEFAULT_TRANSITION = Object.freeze({ type: 'ease', durationMs: 900 });
const HEX_COLOR = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;
const TEXT_KINDS = Object.freeze({
  heading: Object.freeze({ id: 'heading', text: 'Heading', type: 'heading', frame: Object.freeze({ x: 0.08, y: 0.08, width: 0.52, height: 0.18 }) }),
  body: Object.freeze({ id: 'body-text', text: 'Body text', type: 'paragraph', frame: Object.freeze({ x: 0.08, y: 0.3, width: 0.52, height: 0.24 }) })
});

function clone(value) {
  return structuredClone(value);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertStory12(story) {
  if (!story || story.schemaVersion !== '1.2' || !Array.isArray(story.states) || !story.states.length) {
    throw new TypeError('Story 1.2 with at least one Scene is required.');
  }
}

function sceneAt(story, index) {
  assertStory12(story);
  if (!Number.isInteger(index) || !story.states[index]) throw new RangeError(`Unknown Scene index: ${index}.`);
  return story.states[index];
}

function blocksAt(story, sceneIndex) {
  const scene = sceneAt(story, sceneIndex);
  if (!Array.isArray(scene.content?.blocks)) throw new TypeError('Scene composition blocks must be an array.');
  return scene.content.blocks;
}

function envelopeIndex(story, sceneIndex, id) {
  if (!STORY_12_ID_PATTERN.test(id ?? '')) throw new TypeError('Envelope ID must be a stable lowercase ID.');
  const index = blocksAt(story, sceneIndex).findIndex((envelope) => envelope.id === id);
  if (index === -1) throw new RangeError(`Unknown Scene envelope ID: ${id}.`);
  return index;
}

function normalizeLongitude(value) {
  if (!Number.isFinite(value)) throw new TypeError('Camera longitude must be finite.');
  if (value >= -180 && value < 180) return value;
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function normalizeBearing(value) {
  if (!Number.isFinite(value)) throw new TypeError('Camera bearing must be finite.');
  if (value >= -180 && value < 180) return value;
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function normalizeCamera(camera) {
  if (!camera || !Array.isArray(camera.center) || camera.center.length !== 2) {
    throw new TypeError('Camera center must contain longitude and latitude.');
  }
  for (const field of ['zoom', 'pitch', 'bearing']) {
    if (!Number.isFinite(camera[field])) throw new TypeError(`Camera ${field} must be finite.`);
  }
  const latitude = camera.center[1];
  if (!Number.isFinite(latitude)) throw new TypeError('Camera latitude must be finite.');
  return {
    center: [normalizeLongitude(camera.center[0]), clamp(latitude, -90, 90)],
    zoom: clamp(camera.zoom, 0, 24),
    pitch: clamp(camera.pitch, 0, 72),
    bearing: normalizeBearing(camera.bearing)
  };
}

function validateInteraction(interaction) {
  if (!STORY_12_INTERACTIONS.includes(interaction)) {
    throw new TypeError(`Unsupported Scene interaction: ${interaction}.`);
  }
  return interaction;
}

function normalizeTransition(transition = DEFAULT_TRANSITION) {
  if (!transition || !STORY_12_TRANSITIONS.includes(transition.type)) {
    throw new TypeError(`Unsupported Scene transition: ${transition?.type ?? ''}.`);
  }
  if (!Number.isInteger(transition.durationMs) || transition.durationMs < 0 || transition.durationMs > 10000) {
    throw new TypeError('Scene transition duration must be an integer between 0 and 10000.');
  }
  if (transition.type === 'instant' && transition.durationMs !== 0) {
    throw new TypeError('Instant Scene transition duration must be 0.');
  }
  return { type: transition.type, durationMs: transition.durationMs };
}

function validateLayerVisibility(layerVisibility = {}) {
  if (!layerVisibility || typeof layerVisibility !== 'object' || Array.isArray(layerVisibility)) {
    throw new TypeError('Scene layer visibility must be an object.');
  }
  const next = {};
  for (const [id, visible] of Object.entries(layerVisibility)) {
    if (!STORY_12_ID_PATTERN.test(id)) throw new TypeError(`Invalid Scene layer dataset ID: ${id}.`);
    if (typeof visible !== 'boolean') throw new TypeError(`Scene layer ${id} visibility must be boolean.`);
    next[id] = visible;
  }
  return next;
}

function normalizeFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new TypeError('Envelope frame must be an object.');
  for (const field of ['x', 'y', 'width', 'height', 'z']) {
    if (!Number.isFinite(frame[field])) throw new TypeError(`Envelope frame ${field} must be finite.`);
  }
  const width = clamp(frame.width, 0.01, 1);
  const height = clamp(frame.height, 0.01, 1);
  return {
    x: clamp(frame.x, 0, 1 - width),
    y: clamp(frame.y, 0, 1 - height),
    width,
    height,
    z: clamp(Math.round(frame.z), 0, 9999)
  };
}

function highestZ(blocks) {
  return blocks.reduce((highest, envelope) => Math.max(highest, Number(envelope.frame?.z) || 0), -1);
}

function assertPlainTextEnvelope(envelope) {
  if (!['heading', 'paragraph'].includes(envelope?.block?.type)) {
    throw new TypeError(`Envelope ${envelope?.id ?? ''} is not a Text object.`);
  }
}

function color(value, path) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw new TypeError(`${path} must be a 6- or 8-digit hex color.`);
  return value;
}

function boundedNumber(value, [minimum, maximum], path) {
  if (!Number.isFinite(value)) throw new TypeError(`${path} must be finite.`);
  return clamp(value, minimum, maximum);
}

function normalizeBoxAppearance(value = {}) {
  const allowed = new Set(['fill', 'opacity', 'borderColor', 'borderWidth', 'radius', 'padding']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`Unsupported box appearance property: ${key}.`);
  const result = {};
  if (value.fill !== undefined) result.fill = color(value.fill, 'Box fill');
  if (value.opacity !== undefined) result.opacity = boundedNumber(value.opacity, STORY_12_APPEARANCE_BOUNDS.opacity, 'Box opacity');
  if (value.borderColor !== undefined) result.borderColor = color(value.borderColor, 'Box border color');
  if (value.borderWidth !== undefined) result.borderWidth = boundedNumber(value.borderWidth, STORY_12_APPEARANCE_BOUNDS.borderWidth, 'Box border width');
  if (value.radius !== undefined) result.radius = boundedNumber(value.radius, STORY_12_APPEARANCE_BOUNDS.radius, 'Box radius');
  if (value.padding !== undefined) result.padding = boundedNumber(value.padding, STORY_12_APPEARANCE_BOUNDS.padding, 'Box padding');
  return result;
}

function normalizeTextAppearance(value = {}) {
  const allowed = new Set(['fontFamily', 'fontSize', 'bold', 'italic', 'color', 'align', 'lineHeight']);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`Unsupported text appearance property: ${key}.`);
  const result = {};
  if (value.fontFamily !== undefined) {
    if (!STORY_12_FONT_FAMILIES.includes(value.fontFamily)) throw new TypeError(`Unsupported font family: ${value.fontFamily}.`);
    result.fontFamily = value.fontFamily;
  }
  if (value.fontSize !== undefined) result.fontSize = boundedNumber(value.fontSize, STORY_12_APPEARANCE_BOUNDS.fontSize, 'Text font size');
  if (value.bold !== undefined) {
    if (typeof value.bold !== 'boolean') throw new TypeError('Text bold must be boolean.');
    result.bold = value.bold;
  }
  if (value.italic !== undefined) {
    if (typeof value.italic !== 'boolean') throw new TypeError('Text italic must be boolean.');
    result.italic = value.italic;
  }
  if (value.color !== undefined) result.color = color(value.color, 'Text color');
  if (value.align !== undefined) {
    if (!['left', 'center', 'right'].includes(value.align)) throw new TypeError(`Unsupported text alignment: ${value.align}.`);
    result.align = value.align;
  }
  if (value.lineHeight !== undefined) result.lineHeight = boundedNumber(value.lineHeight, STORY_12_APPEARANCE_BOUNDS.lineHeight, 'Text line height');
  return result;
}

export function createScene12({
  id,
  camera,
  interaction = 'locked',
  transition = DEFAULT_TRANSITION,
  layerVisibility = {},
  blocks = [],
  presenterNote,
  enter = [],
  exit = []
} = {}) {
  if (!STORY_12_ID_PATTERN.test(id ?? '')) throw new TypeError('Scene ID must be a stable lowercase ID.');
  if (!Array.isArray(blocks)) throw new TypeError('Scene blocks must be an array.');
  if (!Array.isArray(enter) || !Array.isArray(exit)) throw new TypeError('Scene actions must be arrays.');
  const content = { layout: 'freeform-16x9', blocks: clone(blocks) };
  if (presenterNote !== undefined) content.presenterNote = String(presenterNote);
  return {
    id,
    content,
    map: {
      camera: normalizeCamera(camera),
      interaction: validateInteraction(interaction),
      transition: normalizeTransition(transition),
      layerVisibility: validateLayerVisibility(layerVisibility),
      enter: clone(enter),
      exit: clone(exit)
    }
  };
}

export function addScene12(story, { activeSceneIndex = 0 } = {}) {
  const active = sceneAt(story, activeSceneIndex);
  const next = clone(story);
  const id = createStableId('scene', next.states.map((state) => state.id));
  next.states.push(createScene12({
    id,
    camera: active.map.camera,
    interaction: active.map.interaction,
    layerVisibility: active.map.layerVisibility
  }));
  return next;
}

export function duplicateScene12(story, sceneIndex) {
  const source = sceneAt(story, sceneIndex);
  const next = clone(story);
  const duplicate = clone(source);
  duplicate.id = createStableId(`${source.id}-copy`, next.states.map((state) => state.id));
  next.states.splice(sceneIndex + 1, 0, duplicate);
  return next;
}

export function deleteScene12(story, sceneIndex) {
  sceneAt(story, sceneIndex);
  if (story.states.length === 1) throw new TypeError('A Story must contain at least one Scene.');
  const next = clone(story);
  next.states.splice(sceneIndex, 1);
  return next;
}

export function moveScene12(story, fromIndex, toIndex) {
  sceneAt(story, fromIndex);
  sceneAt(story, toIndex);
  const next = clone(story);
  next.states = moveArrayItem(next.states, fromIndex, toIndex);
  return next;
}

export function setSceneLayerVisibility(story, { sceneIndex, datasetId, visible }) {
  if (!STORY_12_ID_PATTERN.test(datasetId ?? '')) throw new TypeError('Scene layer dataset ID must be stable lowercase.');
  if (typeof visible !== 'boolean') throw new TypeError('Scene layer visibility must be boolean.');
  sceneAt(story, sceneIndex);
  const next = clone(story);
  if (!Object.hasOwn(next.states[sceneIndex].map.layerVisibility, datasetId)) {
    throw new TypeError(`Scene layer dataset ${datasetId} is not declared in this Story snapshot.`);
  }
  next.states[sceneIndex].map.layerVisibility[datasetId] = visible;
  return next;
}

export function captureSceneCamera(story, { sceneIndex, camera }) {
  sceneAt(story, sceneIndex);
  const next = clone(story);
  next.states[sceneIndex].map.camera = normalizeCamera(camera);
  return next;
}

export function setSceneInteraction(story, { sceneIndex, interaction }) {
  sceneAt(story, sceneIndex);
  const next = clone(story);
  next.states[sceneIndex].map.interaction = validateInteraction(interaction);
  return next;
}

export function setSceneTransition(story, { sceneIndex, transition }) {
  sceneAt(story, sceneIndex);
  const next = clone(story);
  next.states[sceneIndex].map.transition = normalizeTransition(transition);
  return next;
}

export function addProjectLayerToStory12(story, datasetId, { activeSceneIndex = 0 } = {}) {
  sceneAt(story, activeSceneIndex);
  if (!STORY_12_ID_PATTERN.test(datasetId ?? '')) throw new TypeError('Project layer dataset ID must be stable lowercase.');
  if (story.states.some((state) => Object.hasOwn(state.map.layerVisibility, datasetId))) {
    throw new TypeError(`Project layer dataset ${datasetId} is already present in the Story.`);
  }
  const next = clone(story);
  next.states.forEach((state, index) => {
    state.map.layerVisibility[datasetId] = index === activeSceneIndex;
  });
  return next;
}

export function addTextEnvelope(story, { sceneIndex, kind = 'body', frame } = {}) {
  const definition = TEXT_KINDS[kind];
  if (!definition) throw new TypeError(`Unsupported Text object kind: ${kind}.`);
  const blocks = blocksAt(story, sceneIndex);
  const next = clone(story);
  const usedIds = blocks.map(({ id }) => id);
  const id = createStableId(definition.id, usedIds);
  const envelope = {
    id,
    frame: normalizeFrame({
      ...(frame ?? definition.frame),
      z: frame?.z ?? Math.min(9999, highestZ(blocks) + 1)
    }),
    block: { type: definition.type, text: definition.text }
  };
  next.states[sceneIndex].content.blocks.push(envelope);
  return next;
}

export function addRichEnvelope(story, {
  sceneIndex, kind, catalogs = {}, frame, metricId, datasetId, assetId, chartType
} = {}) {
  const blocks = blocksAt(story, sceneIndex);
  const next = clone(story);
  const envelope = createRichObjectEnvelope(kind, {
    catalogs,
    metricId,
    datasetId,
    assetId,
    chartType,
    usedIds: blocks.map(({ id }) => id),
    frame: frame ? normalizeFrame(frame) : undefined,
    z: Math.min(9999, highestZ(blocks) + 1)
  });
  envelope.frame = normalizeFrame(envelope.frame);
  next.states[sceneIndex].content.blocks.push(envelope);
  return next;
}

export function editRichEnvelope(story, { sceneIndex, id, block }) {
  const index = envelopeIndex(story, sceneIndex, id);
  const source = blocksAt(story, sceneIndex)[index];
  if (source.block.type !== block?.type) throw new TypeError('Rich object editing cannot change its semantic family.');
  const nextBlock = validateRichBlock(block);
  const next = clone(story);
  next.states[sceneIndex].content.blocks[index].block = nextBlock;
  return next;
}

export function editTextEnvelope(story, { sceneIndex, id, text }) {
  const index = envelopeIndex(story, sceneIndex, id);
  const source = blocksAt(story, sceneIndex)[index];
  assertPlainTextEnvelope(source);
  if (typeof text !== 'string') throw new TypeError('Text object content must be plain text.');
  const next = clone(story);
  next.states[sceneIndex].content.blocks[index].block.text = text;
  return next;
}

export function commitEnvelopeFrame(story, { sceneIndex, id, frame }) {
  const index = envelopeIndex(story, sceneIndex, id);
  const next = clone(story);
  next.states[sceneIndex].content.blocks[index].frame = normalizeFrame(frame);
  return next;
}

export function duplicateEnvelope(story, { sceneIndex, id }) {
  const index = envelopeIndex(story, sceneIndex, id);
  const blocks = blocksAt(story, sceneIndex);
  const next = clone(story);
  const duplicate = clone(blocks[index]);
  duplicate.id = createStableId(`${duplicate.id}-copy`, blocks.map(({ id: used }) => used));
  duplicate.frame = normalizeFrame({
    ...duplicate.frame,
    x: duplicate.frame.x + 0.02,
    y: duplicate.frame.y + 0.02,
    z: Math.min(9999, highestZ(blocks) + 1)
  });
  next.states[sceneIndex].content.blocks.push(duplicate);
  return next;
}

export function deleteEnvelope(story, { sceneIndex, id }) {
  const index = envelopeIndex(story, sceneIndex, id);
  const next = clone(story);
  next.states[sceneIndex].content.blocks.splice(index, 1);
  return next;
}

function swapZOneStep(story, { sceneIndex, id }, direction) {
  const index = envelopeIndex(story, sceneIndex, id);
  const blocks = blocksAt(story, sceneIndex);
  const ordered = blocks.map((envelope, sourceIndex) => ({ envelope, sourceIndex }))
    .sort((left, right) => left.envelope.frame.z - right.envelope.frame.z || left.sourceIndex - right.sourceIndex);
  const orderedIndex = ordered.findIndex(({ sourceIndex }) => sourceIndex === index);
  const neighborIndex = orderedIndex + direction;
  if (neighborIndex < 0 || neighborIndex >= ordered.length) return clone(story);
  const neighbor = ordered[neighborIndex];
  const next = clone(story);
  const currentZ = next.states[sceneIndex].content.blocks[index].frame.z;
  next.states[sceneIndex].content.blocks[index].frame.z = next.states[sceneIndex].content.blocks[neighbor.sourceIndex].frame.z;
  next.states[sceneIndex].content.blocks[neighbor.sourceIndex].frame.z = currentZ;
  return next;
}

export function bringEnvelopeForward(story, options) {
  return swapZOneStep(story, options, 1);
}

export function sendEnvelopeBackward(story, options) {
  return swapZOneStep(story, options, -1);
}

export function alignEnvelopes(story, { sceneIndex, ids, alignment }) {
  if (!Array.isArray(ids) || !ids.length) throw new TypeError('Alignment requires at least one envelope ID.');
  if (!['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(alignment)) {
    throw new TypeError(`Unsupported envelope alignment: ${alignment}.`);
  }
  const blocks = blocksAt(story, sceneIndex);
  const indexes = ids.map((id) => envelopeIndex(story, sceneIndex, id));
  const selected = indexes.map((index) => blocks[index]);
  const left = Math.min(...selected.map(({ frame }) => frame.x));
  const right = Math.max(...selected.map(({ frame }) => frame.x + frame.width));
  const top = Math.min(...selected.map(({ frame }) => frame.y));
  const bottom = Math.max(...selected.map(({ frame }) => frame.y + frame.height));
  const center = (left + right) / 2;
  const middle = (top + bottom) / 2;
  const next = clone(story);
  for (const index of indexes) {
    const frame = next.states[sceneIndex].content.blocks[index].frame;
    if (alignment === 'left') frame.x = left;
    else if (alignment === 'center') frame.x = center - frame.width / 2;
    else if (alignment === 'right') frame.x = right - frame.width;
    else if (alignment === 'top') frame.y = top;
    else if (alignment === 'middle') frame.y = middle - frame.height / 2;
    else frame.y = bottom - frame.height;
    next.states[sceneIndex].content.blocks[index].frame = normalizeFrame(frame);
  }
  return next;
}

export function setEnvelopeAppearance(story, { sceneIndex, id, box, text }) {
  const index = envelopeIndex(story, sceneIndex, id);
  const next = clone(story);
  const envelope = next.states[sceneIndex].content.blocks[index];
  const appearance = clone(envelope.appearance ?? {});
  if (box !== undefined) appearance.box = { ...(appearance.box ?? {}), ...normalizeBoxAppearance(box) };
  if (text !== undefined) appearance.text = { ...(appearance.text ?? {}), ...normalizeTextAppearance(text) };
  envelope.appearance = appearance;
  return next;
}
