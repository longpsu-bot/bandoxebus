import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresentationCameraOptions,
  buildStoryLayoutPadding,
  VIEW_MODES
} from '../src/presentation.js';

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

test('wide story layout reserves the measured left column', () => {
  assert.deepEqual(buildStoryLayoutPadding({
    mapRect: { left: 0, right: 1366, top: 0, bottom: 768 },
    storyRect: { left: 24, right: 424, top: 0, bottom: 768 },
    stacked: false
  }), { top: 48, right: 48, bottom: 64, left: 456 });
});

test('stacked story layout reserves the measured lower card region', () => {
  assert.deepEqual(buildStoryLayoutPadding({
    mapRect: { left: 0, right: 390, top: 0, bottom: 844 },
    storyRect: { left: 0, right: 390, top: 456, bottom: 844 },
    stacked: true
  }), { top: 32, right: 24, bottom: 412, left: 24 });
});

test('explicit shell padding overrides layout defaults but not configured semantic camera hints', () => {
  const options = buildPresentationCameraOptions({
    target: 'connections', presentationActive: true, compactView: true, reducedMotion: false,
    camera: { pitch: 48, maxZoom: 11.5 },
    layoutPadding: { top: 32, right: 24, bottom: 412, left: 24 }
  });
  assert.deepEqual(options.padding, { top: 32, right: 24, bottom: 412, left: 24 });
  assert.equal(options.pitch, 48);
  assert.equal(options.maxZoom, 11.5);
});
