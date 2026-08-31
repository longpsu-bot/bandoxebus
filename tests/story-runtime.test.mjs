import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryActionRunner, StoryActionError } from '../src/story-action-runner.js';
import { createStoryRuntime } from '../src/story-runtime.js';

function story(ids = ['alpha', 'banana', 'state-999']) {
  return {
    schemaVersion: '1.0',
    id: 'fixture',
    title: 'Fixture',
    states: ids.map((id) => ({
      id,
      content: { layout: 'hero', blocks: [{ type: 'heading', text: `Heading ${id}` }] },
      map: {
        enter: [{ type: 'record', value: `${id}.enter` }],
        exit: [{ type: 'record', value: `${id}.exit` }]
      }
    }))
  };
}

function runtimeFor(definition, events = []) {
  const actionRunner = createStoryActionRunner({
    record(action) {
      events.push(action.value);
    }
  });
  return createStoryRuntime({ definition, actionRunner });
}

test('configuration array order alone controls navigation order', () => {
  for (const ids of [['alpha', 'banana', 'state-999'], ['state-999', 'alpha', 'banana']]) {
    const runtime = runtimeFor(story(ids));
    assert.equal(runtime.activate().id, ids[0]);
    assert.equal(runtime.next().id, ids[1]);
    assert.equal(runtime.next().id, ids[2]);
  }
});

test('current content comes directly from configuration', () => {
  const definition = story(['alpha']);
  definition.states[0].content.blocks[0].text = 'Changed only in config';
  const runtime = runtimeFor(definition);
  runtime.activate();
  assert.equal(runtime.currentContent.blocks[0].text, 'Changed only in config');
});

test('arbitrary state IDs have no runtime semantics', () => {
  const runtime = runtimeFor(story());
  runtime.activate('banana');
  assert.equal(runtime.currentIndex, 1);
  assert.equal(runtime.currentState.id, 'banana');
  assert.equal(runtime.goTo('state-999').id, 'state-999');
  assert.equal(runtime.goTo(0).id, 'alpha');
});

test('action runner executes declared actions in order with transition context', () => {
  const events = [];
  const actionRunner = createStoryActionRunner({
    record(action, context) {
      events.push(`${action.value}:${context.phase}`);
    }
  });
  actionRunner.run([
    { type: 'record', value: 'A' },
    { type: 'record', value: 'B' },
    { type: 'record', value: 'C' }
  ], { phase: 'enter' });
  assert.deepEqual(events, ['A:enter', 'B:enter', 'C:enter']);
});

test('state transitions execute old exit before new enter', () => {
  const events = [];
  const runtime = runtimeFor(story(['alpha', 'banana']), events);
  runtime.activate();
  events.length = 0;
  runtime.next();
  assert.deepEqual(events, ['alpha.exit', 'banana.enter']);
});

test('optional lifecycle surrounds existing action order without changing default semantics', () => {
  const events = [];
  const definition = story(['alpha', 'banana']);
  const actionRunner = createStoryActionRunner({ record(action) { events.push(action.value); } });
  const runtime = createStoryRuntime({
    definition,
    actionRunner,
    lifecycle: {
      afterExit(state) { events.push(`${state.id}.afterExit`); },
      beforeEnter(state) { events.push(`${state.id}.beforeEnter`); }
    }
  });
  runtime.activate();
  assert.deepEqual(events, ['alpha.beforeEnter', 'alpha.enter']);
  events.length = 0;
  runtime.next();
  assert.deepEqual(events, ['alpha.exit', 'alpha.afterExit', 'banana.beforeEnter', 'banana.enter']);
  events.length = 0;
  runtime.goTo('banana');
  assert.deepEqual(events, []);
});

test('unknown action types fail with a deterministic error', () => {
  const runner = createStoryActionRunner({ record() {} });
  assert.throws(
    () => runner.run([{ type: 'not-registered' }], { phase: 'enter' }),
    (error) => error instanceof StoryActionError && /not-registered/.test(error.message)
  );
});

test('previous and next clamp to configuration boundaries', () => {
  const runtime = runtimeFor(story(['alpha', 'banana']));
  runtime.activate();
  assert.equal(runtime.previous().id, 'alpha');
  runtime.next();
  assert.equal(runtime.next().id, 'banana');
});

test('same-state activation is a no-op while re-entry runs one clean lifecycle', () => {
  const events = [];
  const runtime = runtimeFor(story(['alpha', 'banana']), events);
  runtime.activate();
  runtime.goTo('alpha');
  runtime.next();
  runtime.previous();
  runtime.next();
  assert.deepEqual(events, [
    'alpha.enter',
    'alpha.exit', 'banana.enter',
    'banana.exit', 'alpha.enter',
    'alpha.exit', 'banana.enter'
  ]);
});

test('deactivation exits once and preserves the current state for later re-entry', () => {
  const events = [];
  const runtime = runtimeFor(story(['alpha']), events);
  runtime.activate();
  assert.equal(runtime.deactivate().id, 'alpha');
  assert.equal(runtime.active, false);
  runtime.deactivate();
  runtime.activate();
  assert.deepEqual(events, ['alpha.enter', 'alpha.exit', 'alpha.enter']);
});
