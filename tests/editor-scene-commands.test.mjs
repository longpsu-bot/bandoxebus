import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addProjectLayerToStory12,
  addScene12,
  captureSceneCamera,
  createScene12,
  deleteScene12,
  duplicateScene12,
  moveScene12,
  setSceneInteraction,
  setSceneLayerVisibility,
  setSceneTransition
} from '../editor/core/scene-commands.js';

function story12() {
  return {
    schemaVersion: '1.2', id: 'main', title: 'Main',
    states: [
      createScene12({
        id: 'one',
        camera: { center: [106.6, 11], zoom: 10, pitch: 20, bearing: -10 },
        interaction: 'explore',
        layerVisibility: { route: true, stops: false },
        blocks: [{ id: 'title', frame: { x: 0.1, y: 0.1, width: 0.4, height: 0.2, z: 1 }, block: { type: 'heading', text: 'One' } }]
      }),
      createScene12({
        id: 'two',
        camera: { center: [106.7, 11.1], zoom: 12, pitch: 35, bearing: 15 },
        interaction: 'locked',
        layerVisibility: { route: false, stops: true }
      })
    ]
  };
}

test('createScene12 creates bounded production Scene data with defaults', () => {
  const scene = createScene12({
    id: 'opening',
    camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 }
  });
  assert.deepEqual(scene, {
    id: 'opening',
    content: { layout: 'freeform-16x9', blocks: [] },
    map: {
      camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 },
      interaction: 'locked',
      transition: { type: 'ease', durationMs: 900 },
      layerVisibility: {},
      enter: [], exit: []
    }
  });
});

test('add Scene copies map context but starts with empty overlays and default transition', () => {
  const source = story12();
  const next = addScene12(source, { activeSceneIndex: 0 });
  assert.equal(source.states.length, 2);
  assert.equal(next.states.length, 3);
  const added = next.states[2];
  assert.equal(added.id, 'scene');
  assert.deepEqual(added.map.camera, source.states[0].map.camera);
  assert.equal(added.map.interaction, 'explore');
  assert.deepEqual(added.map.layerVisibility, { route: true, stops: false });
  assert.deepEqual(added.map.transition, { type: 'ease', durationMs: 900 });
  assert.deepEqual(added.content.blocks, []);
});

test('duplicate/delete/move Scene preserve production data and stable IDs', () => {
  const source = story12();
  const duplicated = duplicateScene12(source, 0);
  assert.equal(duplicated.states[1].id, 'one-copy');
  assert.deepEqual(duplicated.states[1].content.blocks, source.states[0].content.blocks);
  assert.notEqual(duplicated.states[1], source.states[0]);
  const moved = moveScene12(duplicated, 1, 2);
  assert.equal(moved.states[2].id, 'one-copy');
  const deleted = deleteScene12(moved, 2);
  assert.deepEqual(deleted.states.map(({ id }) => id), ['one', 'two']);
  const single = { ...source, states: [source.states[0]] };
  assert.throws(() => deleteScene12(single, 0), /at least one Scene|last Scene/i);
});

test('Scene property commands mutate clones only', () => {
  const source = story12();
  const visible = setSceneLayerVisibility(source, { sceneIndex: 0, datasetId: 'stops', visible: true });
  assert.equal(source.states[0].map.layerVisibility.stops, false);
  assert.equal(visible.states[0].map.layerVisibility.stops, true);

  const interaction = setSceneInteraction(source, { sceneIndex: 1, interaction: 'zoom-only' });
  assert.equal(interaction.states[1].map.interaction, 'zoom-only');
  assert.throws(() => setSceneInteraction(source, { sceneIndex: 0, interaction: 'pan-only' }), /interaction/i);

  const transition = setSceneTransition(source, { sceneIndex: 0, transition: { type: 'fly', durationMs: 1500 } });
  assert.deepEqual(transition.states[0].map.transition, { type: 'fly', durationMs: 1500 });
  assert.throws(() => setSceneTransition(source, { sceneIndex: 0, transition: { type: 'instant', durationMs: 1 } }), /instant|duration/i);
});

test('camera capture canonicalizes geographic and MapLibre bounds in one command', () => {
  const source = story12();
  const next = captureSceneCamera(source, {
    sceneIndex: 0,
    camera: { center: [540, 95], zoom: 30, pitch: 80, bearing: 725 }
  });
  assert.deepEqual(next.states[0].map.camera, {
    center: [-180, 90],
    zoom: 24,
    pitch: 72,
    bearing: 5
  });
  assert.deepEqual(source.states[0].map.camera, { center: [106.6, 11], zoom: 10, pitch: 20, bearing: -10 });
});

test('adding a project layer atomically completes every Story 1.2 Scene snapshot', () => {
  const source = story12();
  const next = addProjectLayerToStory12(source, 'population', { activeSceneIndex: 1 });
  assert.deepEqual(next.states.map((scene) => scene.map.layerVisibility.population), [false, true]);
  assert.equal('population' in source.states[0].map.layerVisibility, false);
  assert.throws(() => addProjectLayerToStory12(next, 'population', { activeSceneIndex: 0 }), /already.*population|population.*already/i);
});
