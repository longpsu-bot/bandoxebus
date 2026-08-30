import assert from 'node:assert/strict';
import test from 'node:test';

import { createSceneStateController } from '../src/scene/scene-state-controller.js';

function state(type = 'ease', durationMs = 900) {
  return {
    id: 'scene',
    content: { layout: 'freeform-16x9', blocks: [] },
    map: {
      camera: { center: [106.63, 11.06], zoom: 12, pitch: 35, bearing: -10 },
      interaction: 'zoom-only',
      transition: { type, durationMs },
      layerVisibility: { route: true, stops: false },
      enter: [], exit: []
    }
  };
}

function fixture({ reducedMotion = false } = {}) {
  const events = [];
  const map = {
    stop() { events.push(['stop']); },
    jumpTo(options) { events.push(['jumpTo', options]); },
    easeTo(options) { events.push(['easeTo', options]); },
    flyTo(options) { events.push(['flyTo', options]); }
  };
  const controller = createSceneStateController({
    map,
    reducedMotion,
    layerRegistry: { applySnapshot(snapshot) { events.push(['layers', structuredClone(snapshot)]); } },
    interactionPolicy: { apply(mode) { events.push(['interaction', mode]); } },
    compositor: { render(value) { events.push(['compositor', value.id]); } }
  });
  return { events, controller };
}

test('beforeEnter applies declarative baseline before starting authored camera motion', () => {
  const { events, controller } = fixture();
  controller.beforeEnter(state('ease', 1200));
  assert.deepEqual(events.map(([type]) => type), ['layers', 'interaction', 'compositor', 'easeTo']);
  assert.deepEqual(events.at(-1)[1], {
    center: [106.63, 11.06], zoom: 12, pitch: 35, bearing: -10,
    duration: 1200, essential: false
  });
});

test('fly, instant, and reduced motion use the correct MapLibre camera primitive', () => {
  const fly = fixture();
  fly.controller.beforeEnter(state('fly', 1500));
  assert.equal(fly.events.at(-1)[0], 'flyTo');
  assert.equal(fly.events.at(-1)[1].duration, 1500);

  const instant = fixture();
  instant.controller.beforeEnter(state('instant', 0));
  assert.equal(instant.events.at(-1)[0], 'jumpTo');
  assert.equal(Object.hasOwn(instant.events.at(-1)[1], 'duration'), false);

  const authored = state('ease', 900);
  const snapshot = structuredClone(authored.map.transition);
  const reduced = fixture({ reducedMotion: true });
  reduced.controller.beforeEnter(authored);
  assert.equal(reduced.events.at(-1)[0], 'jumpTo');
  assert.deepEqual(authored.map.transition, snapshot);
});

test('afterExit cancels camera motion without mutating Scene data', () => {
  const { events, controller } = fixture();
  controller.afterExit(state());
  assert.deepEqual(events, [['stop']]);
});

test('editor-style instant apply can reuse the same baseline without authored transition', () => {
  const { events, controller } = fixture();
  controller.apply(state('fly', 3000), { animate: false });
  assert.deepEqual(events.map(([type]) => type), ['layers', 'interaction', 'compositor', 'jumpTo']);
});
