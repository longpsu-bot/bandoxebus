import assert from 'node:assert/strict';
import test from 'node:test';

import { createSceneLayerRegistry } from '../src/scene/scene-layer-registry.js';

function instance(capabilityId, ids, calls) {
  return {
    entry: { descriptor: { id: capabilityId } },
    implementation: {
      sceneLayers: {
        ids,
        setVisible(id, visible) { calls.push([capabilityId, id, visible]); },
        reset() { calls.push([capabilityId, 'reset']); }
      }
    }
  };
}

test('registry applies a complete snapshot through stable project dataset IDs', () => {
  const calls = [];
  const registry = createSceneLayerRegistry([
    instance('core-map-v1', ['route', 'stops'], calls),
    instance('urban-context-v1', ['industrial-zone'], calls)
  ], ['route', 'stops', 'industrial-zone']);

  assert.deepEqual(registry.ids, ['route', 'stops', 'industrial-zone']);
  registry.applySnapshot({ route: true, stops: false, 'industrial-zone': true });
  assert.deepEqual(calls, [
    ['core-map-v1', 'route', true],
    ['core-map-v1', 'stops', false],
    ['urban-context-v1', 'industrial-zone', true]
  ]);
});

test('registry rejects duplicate ownership and expected layers without providers', () => {
  const calls = [];
  assert.throws(
    () => createSceneLayerRegistry([
      instance('a', ['route'], calls),
      instance('b', ['route'], calls)
    ], ['route']),
    /duplicate.*route|route.*duplicate/i
  );
  assert.throws(
    () => createSceneLayerRegistry([instance('a', ['route'], calls)], ['route', 'stops']),
    /stops.*provider|provider.*stops/i
  );
});

test('registry reset calls each provider once and exposes no private MapLibre IDs', () => {
  const calls = [];
  const registry = createSceneLayerRegistry([
    instance('core-map-v1', ['route', 'stops'], calls),
    instance('other', ['zones'], calls)
  ], ['route', 'stops', 'zones']);
  registry.reset();
  assert.deepEqual(calls, [['core-map-v1', 'reset'], ['other', 'reset']]);
  assert.deepEqual(Object.keys(registry).sort(), ['applySnapshot', 'ids', 'reset']);
  assert.equal(JSON.stringify(registry).includes('project-route'), false);
});
