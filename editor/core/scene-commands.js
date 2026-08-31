import { createStableId, moveArrayItem } from './draft-store.js';
import {
  STORY_12_ID_PATTERN,
  STORY_12_INTERACTIONS,
  STORY_12_TRANSITIONS
} from '../../src/scene/scene-contract.js';

const DEFAULT_TRANSITION = Object.freeze({ type: 'ease', durationMs: 900 });

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
