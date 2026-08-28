import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeStory10
} from '../src/capabilities/story-1.0-normalizer.js';
import {
  ROUTE_COMPARISON_V1_DESCRIPTOR,
  ROUTE_COMPARISON_V1_NORMALIZERS,
  createRouteComparisonCapability
} from '../src/capabilities/route-comparison-v1.js';
import {
  URBAN_CONTEXT_V1_DESCRIPTOR,
  URBAN_CONTEXT_V1_NORMALIZERS,
  createUrbanContextCapability
} from '../src/capabilities/urban-context-v1.js';
import {
  CORE_MAP_V1_DESCRIPTOR,
  createCoreMap10Normalizers
} from '../src/capabilities/core-map-v1.js';

const STORY_URL = new URL('../data/stories/route-61-2.story.json', import.meta.url);
const FOCUS_TARGETS = ['overview', 'existing', 'proposed', 'changes', 'service-area', 'connections'];
const bindings = Object.freeze({
  proposedRouteTarget: 'proposed-route',
  poiTarget: 'connection-pois'
});
const normalizers = Object.freeze([
  ...createCoreMap10Normalizers({ focusTargets: FOCUS_TARGETS }),
  ...ROUTE_COMPARISON_V1_NORMALIZERS,
  ...URBAN_CONTEXT_V1_NORMALIZERS
]);
const actionDescriptors = Object.freeze(Object.fromEntries(
  [CORE_MAP_V1_DESCRIPTOR, ROUTE_COMPARISON_V1_DESCRIPTOR, URBAN_CONTEXT_V1_DESCRIPTOR]
    .flatMap(({ actions }) => actions)
    .map((descriptor) => [descriptor.type, descriptor])
));

function normalize(definition, overrides = {}) {
  return normalizeStory10(definition, {
    normalizers,
    actionDescriptors,
    bindings,
    ...overrides
  });
}

function minimalStory(action) {
  return {
    schemaVersion: '1.0',
    id: 'normalizer-fixture',
    title: 'Normalizer fixture',
    states: [{
      id: 'alpha',
      content: { layout: 'hero', blocks: [{ type: 'heading', text: 'Alpha' }] },
      map: { enter: [action], exit: [] }
    }]
  };
}

function actions(definition) {
  return definition.states.flatMap((state) => [...state.map.enter, ...state.map.exit]);
}

test('Route 61-2 Story 1.0 normalizes in order without mutating source bytes or data', async () => {
  const sourceText = await readFile(STORY_URL, 'utf8');
  const source = JSON.parse(sourceText);
  const before = structuredClone(source);
  const normalized = normalize(source);

  assert.equal(await readFile(STORY_URL, 'utf8'), sourceText);
  assert.deepEqual(source, before);
  assert.notEqual(normalized, source);
  assert.equal(Object.isFrozen(normalized), true);
  assert.deepEqual(
    normalized.states[0].map.enter.map(({ type }) => type),
    ['route.set-mode', 'transport.set-poi-emphasis', 'context.set-mode', 'map.focus']
  );

  const reveal = actions(normalized).find(({ type }) => type === 'route.reveal');
  const poi = actions(normalized).find(({ type }) => type === 'transport.set-poi-emphasis');
  assert.equal(reveal.target, 'proposed-route');
  assert.equal(poi.target, 'connection-pois');
});

test('normalization preserves every phase, action order, camera, delay, and active value', async () => {
  const source = JSON.parse(await readFile(STORY_URL, 'utf8'));
  const normalized = normalize(source);
  const typeMap = {
    'map.mode': 'route.set-mode',
    'map.focus': 'map.focus',
    'map.poi-emphasis': 'transport.set-poi-emphasis',
    'map.urban-context': 'context.set-mode',
    'route.reveal': 'route.reveal'
  };

  source.states.forEach((state, stateIndex) => {
    for (const phase of ['enter', 'exit']) {
      assert.equal(normalized.states[stateIndex].map[phase].length, state.map[phase].length);
      state.map[phase].forEach((legacy, actionIndex) => {
        const canonical = normalized.states[stateIndex].map[phase][actionIndex];
        assert.equal(canonical.type, typeMap[legacy.type]);
        for (const property of ['mode', 'camera', 'delayMs', 'active']) {
          if (Object.hasOwn(legacy, property)) assert.deepEqual(canonical[property], legacy[property]);
        }
      });
    }
  });
});

test('invalid legacy actions are rejected before normalization at their Story path', () => {
  assert.throws(
    () => normalize(minimalStory({ type: 'map.poi-emphasis', active: 'true' })),
    (error) => error.code === 'STORY_10_ACTION_INVALID'
      && error.path === '$.states.alpha.map.enter[0].active'
      && /boolean/i.test(error.message)
  );
});

test('invalid canonical output is rejected against the descriptor schema', () => {
  const badNormalizer = {
    legacyType: 'legacy.reveal',
    validate: () => null,
    normalize: () => ({ type: 'route.reveal', target: 'proposed-route', active: 'true' })
  };
  assert.throws(
    () => normalizeStory10(minimalStory({ type: 'legacy.reveal' }), {
      normalizers: [badNormalizer],
      actionDescriptors,
      bindings
    }),
    (error) => error.code === 'STORY_10_ACTION_INVALID'
      && error.path === '$.states.alpha.map.enter[0].active'
  );
});

test('legacy normalizers own no runtime handlers and duplicate ownership is rejected', () => {
  assert.equal(normalizers.every((normalizer) => !Object.hasOwn(normalizer, 'handler')), true);
  assert.throws(
    () => normalizeStory10(minimalStory({ type: 'map.focus', target: 'overview' }), {
      normalizers: [normalizers[0], normalizers[0]],
      actionDescriptors,
      bindings
    }),
    (error) => error.code === 'STORY_10_NORMALIZER_DUPLICATE'
  );
});

test('trusted route and context factories adapt canonical handlers without legacy aliases', () => {
  const calls = [];
  const route = createRouteComparisonCapability({
    setMode: (mode) => calls.push(['mode', mode]),
    setRouteReveal: (...values) => calls.push(['reveal', ...values]),
    setPoiEmphasis: (...values) => calls.push(['poi', ...values])
  });
  const context = createUrbanContextCapability({
    setContextMode: (mode) => calls.push(['context', mode])
  });

  route.handlers['route.set-mode']({ type: 'route.set-mode', mode: 'compare' });
  route.handlers['route.reveal']({ type: 'route.reveal', target: 'proposed-route', active: true, delayMs: 250 });
  route.handlers['transport.set-poi-emphasis']({
    type: 'transport.set-poi-emphasis', target: 'connection-pois', active: false
  });
  context.handlers['context.set-mode']({ type: 'context.set-mode', mode: 'industrial-context' });

  assert.deepEqual(calls, [
    ['mode', 'compare'],
    ['reveal', 'proposed-route', true, 250],
    ['poi', 'connection-pois', false],
    ['context', 'industrial-context']
  ]);
  assert.deepEqual(Object.keys(route.handlers).sort(), [
    'route.reveal', 'route.set-mode', 'transport.set-poi-emphasis'
  ]);
  assert.equal(Object.hasOwn(route.handlers, 'map.mode'), false);
  assert.equal(Object.hasOwn(context.handlers, 'map.urban-context'), false);
});
