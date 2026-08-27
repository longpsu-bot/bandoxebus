import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateStoryDefinition } from '../src/story-schema.js';

const STORY_URL = new URL('../data/stories/route-61-2.story.json', import.meta.url);
const ACTION_TYPES = ['map.mode', 'map.focus', 'map.poi-emphasis', 'map.urban-context', 'route.reveal'];
const EXPECTED_IDS = [
  'intro',
  'existing',
  'adjustment-context',
  'route-changes',
  'service-area',
  'connections',
  'final-proposal'
];

async function loadStory() {
  return JSON.parse(await readFile(STORY_URL, 'utf8'));
}

test('Route 61-2 JSON validates and exposes the seven canonical states in order', async () => {
  const story = await loadStory();
  assert.equal(validateStoryDefinition(story, { supportedActionTypes: ACTION_TYPES }), story);
  assert.deepEqual(story.states.map(({ id }) => id), EXPECTED_IDS);
});

test('story definition is pure serializable data with structured content blocks', async () => {
  const story = await loadStory();
  assert.deepEqual(JSON.parse(JSON.stringify(story)), story);
  story.states.forEach((state) => {
    assert.ok(state.content.blocks.some(({ type }) => type === 'heading'));
    assert.equal(state.content.blocks.some(({ type }) => type === 'html'), false);
    assert.ok(Array.isArray(state.map.enter));
    assert.ok(Array.isArray(state.map.exit));
  });
});

test('production industrial context is activated declaratively only for the service-area state', async () => {
  const story = await loadStory();
  const urbanActions = story.states.map((state) => ({
    id: state.id,
    action: state.map.enter.find(({ type }) => type === 'map.urban-context')
  }));
  assert.deepEqual(
    urbanActions.filter(({ action }) => action.mode === 'industrial-context').map(({ id }) => id),
    ['service-area']
  );
  assert.equal(urbanActions.filter(({ id }) => id !== 'service-area').every(({ action }) => action.mode === 'off'), true);

  const disclosure = story.states.find(({ id }) => id === 'service-area').content.blocks
    .find(({ type }) => type === 'disclosure').text;
  assert.match(disclosure, /Overture/i);
  assert.match(disclosure, /tổng quát hóa/i);
  assert.match(disclosure, /minh họa/i);
  assert.match(disclosure, /ranh.*không phải.*quy hoạch.*chính thức/i);
});

test('presenter notes remain non-rendered authoring metadata', async () => {
  const story = await loadStory();
  const state = story.states.find(({ content }) => content.presenterNote);
  assert.equal(typeof state.content.presenterNote, 'string');
});
