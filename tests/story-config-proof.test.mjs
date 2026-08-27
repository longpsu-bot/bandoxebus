import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStoryActionRunner } from '../src/story-action-runner.js';
import { createStoryRuntime } from '../src/story-runtime.js';

const STORY_URL = new URL('../data/stories/route-61-2.story.json', import.meta.url);

async function productionStory() {
  return JSON.parse(await readFile(STORY_URL, 'utf8'));
}

function heading(state) {
  return state.content.blocks.find(({ type }) => type === 'heading').text;
}

test('reordering only production config moves content and map actions together', async () => {
  const reordered = await productionStory();
  [reordered.states[1], reordered.states[2]] = [reordered.states[2], reordered.states[1]];
  const actions = [];
  const handlers = Object.fromEntries(
    ['map.mode', 'map.focus', 'map.poi-emphasis', 'map.urban-context', 'route.reveal']
      .map((type) => [type, (action) => actions.push(action)])
  );
  const runtime = createStoryRuntime({
    definition: reordered,
    actionRunner: createStoryActionRunner(handlers)
  });

  runtime.activate(1);
  assert.equal(runtime.currentState.id, 'adjustment-context');
  assert.equal(heading(runtime.currentState), 'Cách đọc phương án trên bản đồ');
  assert.deepEqual(actions.map(({ type }) => type), [
    'map.mode', 'map.poi-emphasis', 'map.urban-context', 'map.focus'
  ]);
  assert.equal(actions.find(({ type }) => type === 'map.focus').target, 'overview');
});

test('changing only production content changes runtime content', async () => {
  const changed = await productionStory();
  changed.states[0].content.blocks.find(({ type }) => type === 'heading').text = 'Config-only heading';
  const runtime = createStoryRuntime({
    definition: changed,
    actionRunner: createStoryActionRunner({
      'map.mode'() {},
      'map.focus'() {},
      'map.poi-emphasis'() {},
      'map.urban-context'() {},
      'route.reveal'() {}
    })
  });
  runtime.activate();
  assert.equal(heading(runtime.currentState), 'Config-only heading');
});
