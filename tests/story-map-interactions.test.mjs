import test from 'node:test';
import assert from 'node:assert/strict';
import * as interactions from '../src/story-map-interactions.js';

function handler(initial) {
  let enabled = initial;
  const calls = [];
  return {
    calls,
    isEnabled: () => enabled,
    disable() { calls.push('disable'); enabled = false; },
    enable() { calls.push('enable'); enabled = true; }
  };
}

test('guided mode restores each available handler to its exact prior state', () => {
  const map = {
    scrollZoom: handler(true),
    dragPan: handler(false),
    touchZoomRotate: handler(true),
    boxZoom: handler(false),
    doubleClickZoom: handler(true)
  };
  const policy = interactions.createGuidedMapInteractionPolicy(map);
  policy.enter();
  assert.deepEqual(Object.values(map).map((value) => value.isEnabled()), [false, false, false, false, false]);
  policy.exit();
  assert.deepEqual(Object.values(map).map((value) => value.isEnabled()), [true, false, true, false, true]);
});

test('repeated enter and exit are idempotent and tolerate unavailable handlers', () => {
  const map = { scrollZoom: handler(true) };
  const policy = interactions.createGuidedMapInteractionPolicy(map);
  policy.enter();
  policy.enter();
  policy.exit();
  policy.exit();
  policy.enter();
  policy.exit();
  assert.deepEqual(map.scrollZoom.calls, ['disable', 'enable', 'disable', 'enable']);
});
