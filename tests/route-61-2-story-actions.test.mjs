import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRouteRevealController,
  createRoute612StoryActionHandlers,
  ROUTE_612_STORY_ACTION_TYPES
} from '../src/route-61-2-story-actions.js';

test('cancelling a delayed reveal prevents its stale callback from starting', () => {
  const events = [];
  const scheduled = new Map();
  let nextTimerId = 1;
  const controller = createRouteRevealController({
    start: () => events.push('start'),
    cancel: () => events.push('cancel'),
    schedule(callback, delayMs) {
      const id = nextTimerId++;
      scheduled.set(id, { callback, delayMs });
      return id;
    },
    clear(timerId) {
      scheduled.delete(timerId);
    },
    reducedMotion: false
  });

  controller.setActive(true, 280);
  assert.equal([...scheduled.values()][0].delayMs, 280);
  controller.setActive(false);
  assert.equal(scheduled.size, 0);
  assert.deepEqual(events, ['cancel']);
});

function createRecorder() {
  const calls = [];
  return {
    calls,
    capabilities: {
      setMode(mode) { calls.push(['mode', mode]); },
      focus(target, camera) { calls.push(['focus', target, camera]); },
      setPoiEmphasis(active) { calls.push(['poi', active]); },
      setUrbanContext(mode) { calls.push(['urban', mode]); },
      setRouteReveal(active, delayMs) { calls.push(['reveal', active, delayMs]); }
    }
  };
}

test('Route 61-2 adapter exposes only the documented explicit action types', () => {
  assert.deepEqual(ROUTE_612_STORY_ACTION_TYPES, [
    'map.mode',
    'map.focus',
    'map.poi-emphasis',
    'map.urban-context',
    'route.reveal'
  ]);
});

test('map action descriptors call the matching project capabilities', () => {
  const recorder = createRecorder();
  const handlers = createRoute612StoryActionHandlers(recorder.capabilities);
  handlers['map.mode']({ type: 'map.mode', mode: 'proposed' });
  handlers['map.focus']({ type: 'map.focus', target: 'features', camera: { pitch: 40 } });
  handlers['map.poi-emphasis']({ type: 'map.poi-emphasis', active: true });
  handlers['map.urban-context']({ type: 'map.urban-context', mode: 'industrial-context' });
  assert.deepEqual(recorder.calls, [
    ['mode', 'proposed'],
    ['focus', 'features', { pitch: 40 }],
    ['poi', true],
    ['urban', 'industrial-context']
  ]);
});

test('route reveal descriptors provide explicit start and cancellation lifecycles', () => {
  const recorder = createRecorder();
  const handler = createRoute612StoryActionHandlers(recorder.capabilities)['route.reveal'];
  handler({ type: 'route.reveal', active: true, delayMs: 280 });
  handler({ type: 'route.reveal', active: false });
  handler({ type: 'route.reveal', active: true, delayMs: 0 });
  assert.deepEqual(recorder.calls, [
    ['reveal', true, 280],
    ['reveal', false, 0],
    ['reveal', true, 0]
  ]);
});
