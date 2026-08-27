import test from 'node:test';
import assert from 'node:assert/strict';
import { createStopPulseTracker } from '../src/stop-pulses.js';

const stops = [
  {
    type: 'Feature',
    properties: { stopId: 7 },
    geometry: { type: 'Point', coordinates: [106.63, 11.06] }
  }
];

test('a stop pulse is emitted once per bus loop instead of on every animation update', () => {
  const tracker = createStopPulseTracker({ radiusMeters: 55 });
  const nearby = [{ key: 'proposed', loop: 0, position: [106.6301, 11.06] }];

  assert.deepEqual(tracker.collect(nearby, stops), [stops[0]]);
  assert.deepEqual(tracker.collect(nearby, stops), []);
  assert.deepEqual(tracker.collect([{ ...nearby[0], loop: 1 }], stops), [stops[0]]);
});

test('different buses can independently trigger the same stop', () => {
  const tracker = createStopPulseTracker({ radiusMeters: 55 });

  assert.equal(tracker.collect([{ key: 'existing', loop: 0, position: [106.6301, 11.06] }], stops).length, 1);
  assert.equal(tracker.collect([{ key: 'proposed', loop: 0, position: [106.6301, 11.06] }], stops).length, 1);
});

test('a bus outside the trigger radius emits no pulse', () => {
  const tracker = createStopPulseTracker({ radiusMeters: 55 });

  assert.deepEqual(tracker.collect([{ key: 'proposed', loop: 0, position: [106.64, 11.06] }], stops), []);
});
