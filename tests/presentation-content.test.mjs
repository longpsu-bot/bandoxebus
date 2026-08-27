import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESENTATION_LAYOUTS } from '../src/presentation.js';
import { PRESENTATION_SLIDES } from '../src/presentation-content.js';

const EXPECTED_IDS = [
  'intro',
  'existing',
  'adjustment-context',
  'route-changes',
  'service-area',
  'connections',
  'final-proposal'
];

test('61-2 presentation exposes the seven canonical slides in order', () => {
  assert.equal(PRESENTATION_SLIDES.length, 7);
  assert.deepEqual(PRESENTATION_SLIDES.map(({ id }) => id), EXPECTED_IDS);
});

test('61-2 presentation slide IDs are stable and unique', () => {
  assert.equal(new Set(PRESENTATION_SLIDES.map(({ id }) => id)).size, 7);
});

test('every slide separates a supported content layout from its map scene', () => {
  const supportedLayouts = new Set(Object.values(PRESENTATION_LAYOUTS));

  PRESENTATION_SLIDES.forEach((slide) => {
    assert.ok(slide.scene, `${slide.id} must define a scene`);
    assert.ok(slide.content, `${slide.id} must define content`);
    assert.ok(slide.scene.mode, `${slide.id} scene must define a mode`);
    assert.ok(slide.scene.target, `${slide.id} scene must define a target`);
    assert.ok(supportedLayouts.has(slide.content.layout), `${slide.id} must use a supported layout`);
    assert.ok(slide.content.title, `${slide.id} content must define a title`);
    assert.equal('title' in slide.scene, false, `${slide.id} scene must not contain presentation prose`);
    assert.equal('mode' in slide.content, false, `${slide.id} content must not contain map configuration`);
  });
});

test('production industrial context is active only on Slide 05 and keeps its disclosure visible', () => {
  const serviceArea = PRESENTATION_SLIDES.find(({ id }) => id === 'service-area');
  assert.equal(serviceArea.scene.urbanContext, 'industrial-context');
  assert.equal(serviceArea.scene.target, 'service-area');
  assert.match(serviceArea.content.sourceNote, /Overture/i);
  assert.match(serviceArea.content.sourceNote, /tổng quát hóa/i);
  assert.match(serviceArea.content.sourceNote, /minh họa/i);
  assert.match(serviceArea.content.sourceNote, /ranh.*không phải.*quy hoạch.*chính thức/i);
  PRESENTATION_SLIDES.filter(({ id }) => id !== 'service-area').forEach((slide) => {
    assert.equal(slide.scene.urbanContext, 'off');
  });
  assert.equal(PRESENTATION_SLIDES.some((slide) => slide.scene.urbanContext === 'future-infill'), false);
});

test('presenter notes remain authoring metadata and are available to future tooling', () => {
  const slideWithPresenterNote = PRESENTATION_SLIDES.find(({ content }) => content.presenterNote);
  assert.ok(slideWithPresenterNote);
  assert.equal(typeof slideWithPresenterNote.content.presenterNote, 'string');
});
