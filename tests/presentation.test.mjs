import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresentationCameraOptions,
  initialPresentationState,
  presentationReducer,
  VIEW_MODES
} from '../src/presentation.js';
import { PRESENTATION_SLIDES } from '../src/presentation-content.js';

test('presentation reducer opens at the intro slide', () => {
  const next = presentationReducer(initialPresentationState, { type: 'OPEN' });
  assert.deepEqual(next, { active: true, slideIndex: 0, mode: VIEW_MODES.DIFFERENCE });
  assert.equal(PRESENTATION_SLIDES[next.slideIndex].id, 'intro');
});

test('presentation reducer clamps previous and next across all seven slides', () => {
  const opened = presentationReducer(initialPresentationState, { type: 'OPEN' });
  assert.equal(presentationReducer(opened, { type: 'PREVIOUS' }).slideIndex, 0);

  const last = presentationReducer(opened, { type: 'GOTO', index: 999 });
  assert.equal(last.slideIndex, 6);
  assert.equal(presentationReducer(last, { type: 'NEXT' }).slideIndex, 6);
  assert.equal(last.mode, VIEW_MODES.PROPOSED);
});

test('presentation reducer goes to a requested slide and uses its scene mode', () => {
  const opened = presentationReducer(initialPresentationState, { type: 'OPEN' });
  const next = presentationReducer(opened, { type: 'GOTO', index: 3 });

  assert.equal(next.slideIndex, 3);
  assert.equal(next.mode, VIEW_MODES.DIFFERENCE);
  assert.equal(PRESENTATION_SLIDES[next.slideIndex].id, 'route-changes');
});

test('presentation reducer closes back to default difference mode', () => {
  const active = { active: true, slideIndex: 5, mode: VIEW_MODES.PROPOSED };
  const closed = presentationReducer(active, { type: 'CLOSE' });
  assert.deepEqual(closed, { active: false, slideIndex: 5, mode: VIEW_MODES.DIFFERENCE });
});

test('presentation reducer does not mutate the previous state', () => {
  const state = { active: true, slideIndex: 1, mode: VIEW_MODES.EXISTING };
  const snapshot = { ...state };
  presentationReducer(state, { type: 'NEXT' });
  assert.deepEqual(state, snapshot);
});

test('camera options merge target defaults with slide scene overrides', () => {
  const options = buildPresentationCameraOptions({
    target: 'connections',
    presentationActive: true,
    compactView: false,
    reducedMotion: false,
    camera: { pitch: 48, maxZoom: 11.5 }
  });

  assert.deepEqual(options, {
    padding: { top: 58, right: 58, bottom: 170, left: 60 },
    duration: 1_050,
    maxZoom: 11.5,
    pitch: 48,
    bearing: -8,
    essential: false
  });
});
