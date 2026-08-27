import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPresentationCameraOptions, VIEW_MODES } from '../src/presentation.js';

test('presentation exposes the four existing project view modes', () => {
  assert.deepEqual(VIEW_MODES, {
    DIFFERENCE: 'difference',
    EXISTING: 'existing',
    PROPOSED: 'proposed',
    COMPARE: 'compare'
  });
});

test('camera options merge responsive target defaults with configured focus overrides', () => {
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

test('reduced motion keeps one semantic focus while removing transition duration', () => {
  const options = buildPresentationCameraOptions({
    target: 'overview',
    presentationActive: true,
    compactView: true,
    reducedMotion: true
  });
  assert.equal(options.duration, 0);
  assert.equal(options.pitch, 42);
  assert.equal(options.padding.left, 60);
});
