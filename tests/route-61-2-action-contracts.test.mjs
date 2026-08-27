import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StoryValidationError, validateStoryDefinition } from '../src/story-schema.js';
import * as routeActions from '../src/route-61-2-story-actions.js';

const STORY_URL = new URL('../data/stories/route-61-2.story.json', import.meta.url);

function validationOptions() {
  return { actionContracts: routeActions.ROUTE_612_STORY_ACTION_CONTRACTS };
}

function storyWith(action) {
  return {
    schemaVersion: '1.0',
    id: 'action-contract-fixture',
    title: 'Action contract fixture',
    states: [{
      id: 'alpha',
      content: {
        layout: 'hero',
        blocks: [{ type: 'heading', text: 'Alpha' }]
      },
      map: { enter: [action], exit: [] }
    }]
  };
}

function assertInvalid(action, pattern) {
  assert.throws(
    () => validateStoryDefinition(storyWith(action), validationOptions()),
    (error) => error instanceof StoryValidationError && pattern.test(error.message)
  );
}

test('map.mode requires a mode', () => {
  assertInvalid({ type: 'map.mode' }, /map\.enter\[0\].*mode.*required/i);
});

test('map.mode rejects unsupported modes', () => {
  assertInvalid({ type: 'map.mode', mode: 'imaginary' }, /map\.enter\[0\].*mode.*unsupported/i);
});

test('map.focus requires a target', () => {
  assertInvalid({ type: 'map.focus' }, /map\.enter\[0\].*target.*required/i);
});

test('map.focus rejects misspelled target properties', () => {
  assertInvalid(
    { type: 'map.focus', target: 'overview', tarjet: 'connections' },
    /map\.enter\[0\].*unsupported property.*tarjet/i
  );
});

test('map.focus rejects malformed camera values', () => {
  assertInvalid(
    { type: 'map.focus', target: 'overview', camera: { pitch: '52' } },
    /map\.enter\[0\]\.camera\.pitch.*finite number/i
  );
});

test('map.focus rejects camera values outside current MapLibre bounds', () => {
  for (const camera of [{ pitch: 73 }, { bearing: 361 }, { maxZoom: 25 }]) {
    assertInvalid(
      { type: 'map.focus', target: 'overview', camera },
      /map\.enter\[0\]\.camera\.(pitch|bearing|maxZoom).*between/i
    );
  }
});

test('map.focus rejects unsupported camera properties', () => {
  assertInvalid(
    { type: 'map.focus', target: 'overview', camera: { zoom: 12 } },
    /map\.enter\[0\]\.camera.*unsupported property.*zoom/i
  );
});

test('map.poi-emphasis requires a boolean active value without coercion', () => {
  assertInvalid(
    { type: 'map.poi-emphasis', active: 'true' },
    /map\.enter\[0\]\.active.*boolean/i
  );
});

test('map.urban-context rejects unsupported modes', () => {
  assertInvalid(
    { type: 'map.urban-context', mode: 'residential-context' },
    /map\.enter\[0\].*mode.*unsupported/i
  );
});

test('route.reveal requires an active value', () => {
  assertInvalid({ type: 'route.reveal' }, /map\.enter\[0\].*active.*required/i);
});

test('route.reveal rejects negative delays', () => {
  assertInvalid(
    { type: 'route.reveal', active: true, delayMs: -1 },
    /map\.enter\[0\]\.delayMs.*non-negative integer/i
  );
});

test('known descriptors reject unsupported extra properties', () => {
  assertInvalid(
    { type: 'map.poi-emphasis', active: true, enabled: true },
    /map\.enter\[0\].*unsupported property.*enabled/i
  );
});

test('all seven checked-in Route 61-2 states satisfy project action contracts', async () => {
  const story = JSON.parse(await readFile(STORY_URL, 'utf8'));
  assert.equal(validateStoryDefinition(story, validationOptions()), story);
  assert.equal(story.states.length, 7);
});
