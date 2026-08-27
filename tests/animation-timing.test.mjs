import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUpdateAnimationFrame } from '../src/animation-timing.js';

test('bus animation updates immediately and then no faster than its frame interval', () => {
  assert.equal(shouldUpdateAnimationFrame(100, null, 1000 / 30), true);
  assert.equal(shouldUpdateAnimationFrame(120, 100, 1000 / 30), false);
  assert.equal(shouldUpdateAnimationFrame(134, 100, 1000 / 30), true);
});

test('bus animation recovers if the frame clock moves backwards', () => {
  assert.equal(shouldUpdateAnimationFrame(50, 100, 1000 / 30), true);
});
