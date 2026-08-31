import test from 'node:test';
import assert from 'node:assert/strict';
import * as interactions from '../src/story-map-interactions.js';
import { createSceneInteractionPolicy } from '../src/scene/scene-interaction-policy.js';

function handler(initial) {
  let enabled = initial;
  const calls = [];
  let rotation = true;
  return {
    calls,
    isEnabled: () => enabled,
    disable() { calls.push('disable'); enabled = false; },
    enable() { calls.push('enable'); enabled = true; },
    disableRotation() { calls.push('disableRotation'); rotation = false; },
    enableRotation() { calls.push('enableRotation'); rotation = true; },
    get rotationEnabled() { return rotation; }
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

test('Story 1.2 locked, zoom-only, and explore policies configure MapLibre handlers semantically', () => {
  const cooperative = [];
  const map = {
    scrollZoom: handler(true),
    dragPan: handler(true),
    dragRotate: handler(true),
    touchZoomRotate: handler(true),
    boxZoom: handler(true),
    doubleClickZoom: handler(true),
    keyboard: handler(true),
    setCooperativeGestures(value) { cooperative.push(value); }
  };
  const policy = createSceneInteractionPolicy(map, { cooperativeScroll: true });

  policy.apply('locked');
  assert.equal(map.scrollZoom.isEnabled(), false);
  assert.equal(map.dragPan.isEnabled(), false);
  assert.equal(map.touchZoomRotate.isEnabled(), false);

  policy.apply('zoom-only');
  assert.equal(map.scrollZoom.isEnabled(), true);
  assert.equal(map.doubleClickZoom.isEnabled(), true);
  assert.equal(map.touchZoomRotate.isEnabled(), true);
  assert.equal(map.touchZoomRotate.rotationEnabled, false);
  assert.equal(map.dragPan.isEnabled(), false);
  assert.equal(map.dragRotate.isEnabled(), false);
  assert.equal(map.keyboard.isEnabled(), false);

  policy.apply('explore');
  assert.equal(map.scrollZoom.isEnabled(), true);
  assert.equal(map.dragPan.isEnabled(), true);
  assert.equal(map.dragRotate.isEnabled(), true);
  assert.equal(map.keyboard.isEnabled(), true);
  assert.equal(map.touchZoomRotate.rotationEnabled, true);
  assert.deepEqual(cooperative, [false, true, true]);
});
