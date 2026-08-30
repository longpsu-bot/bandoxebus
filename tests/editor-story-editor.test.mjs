import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStory11,
  createStoryEditor,
  updateSupportedStory10
} from '../editor/ui/story-editor.js';

function routeStory10() {
  return {
    schemaVersion: '1.0', id: 'legacy', title: 'Legacy', states: [{
      id: 'overview',
      content: { layout: 'hero', blocks: [{ type: 'heading', text: 'Legacy' }] },
      map: {
        enter: [{ type: 'map.mode', mode: 'compare' }, { type: 'map.focus', target: 'overview', camera: { maxZoom: 12 } }],
        exit: [{ type: 'route.reveal', active: false }]
      }
    }]
  };
}

function harness() {
  const draft = {
    manifest: {
      stories: {
        primary: 'main',
        items: [
          { id: 'main', src: './stories/main.story.json' },
          { id: 'legacy', src: './stories/legacy.story.json' }
        ]
      }
    },
    stories: {
      main: createStory11({ id: 'main', title: 'Main Story' }),
      legacy: routeStory10()
    },
    removed: [],
    announcements: []
  };
  draft.ui = createStoryEditor({
    manifest: draft.manifest,
    stories: draft.stories,
    mutateManifest: (updater) => updater(draft.manifest),
    writeStory: (id, story) => { draft.stories[id] = structuredClone(story); },
    removeStory: (id) => { draft.removed.push(id); delete draft.stories[id]; },
    announce: (message) => draft.announcements.push(message)
  });
  return draft;
}

test('supported Story 1.0 content edit preserves version and legacy actions exactly', () => {
  const original = routeStory10();
  const actions = structuredClone(original.states.map(({ map }) => map));
  const edited = updateSupportedStory10(original, { stateIndex: 0, content: { presenterNote: 'Updated note' } });
  assert.equal(edited.schemaVersion, '1.0');
  assert.deepEqual(edited.states.map(({ map }) => map), actions);
  assert.equal(edited.states[0].content.presenterNote, 'Updated note');
});

test('new Stories are 1.1 and enable canonical actions', () => {
  const story = createStory11({ id: 'main', title: 'Main Story' });
  assert.equal(story.schemaVersion, '1.1');
  assert.deepEqual(story.states[0].map, { enter: [], exit: [] });
  assert.equal(story.states[0].content.blocks.length > 0, true);
});

test('Story collection supports add, remove, reorder, and primary selection while remaining non-empty', () => {
  const draft = harness();
  const added = draft.ui.command('add-story', { title: 'Service Plan' });
  assert.equal(added.id, 'service-plan');
  assert.equal(added.schemaVersion, '1.1');
  assert.deepEqual(draft.manifest.stories.items.map(({ id }) => id), ['main', 'legacy', 'service-plan']);

  draft.ui.command('move-story', { from: 2, to: 0 });
  assert.deepEqual(draft.manifest.stories.items.map(({ id }) => id), ['service-plan', 'main', 'legacy']);
  draft.ui.command('set-primary', 'service-plan');
  assert.equal(draft.manifest.stories.primary, 'service-plan');
  draft.ui.command('remove-story', 'main');
  draft.ui.command('remove-story', 'legacy');
  assert.throws(() => draft.ui.command('remove-story', 'service-plan'), /at least one Story/i);
});

test('state lifecycle adds, duplicates, deletes, and reorders with unique IDs and focus retention', () => {
  const draft = harness();
  const story = draft.ui.story('main');
  story.command('add-state', { title: 'Network View' });
  const first = draft.stories.main.states[0];
  first.map.enter.push({ type: 'map.focus', target: 'network' });
  const duplicate = story.command('duplicate-state', 0);
  assert.equal(duplicate.id, 'opening-copy');
  assert.deepEqual(duplicate.map.enter, [{ type: 'map.focus', target: 'network' }]);
  assert.notEqual(duplicate.map.enter, first.map.enter);

  story.command('move-state', { from: 0, to: 2 });
  assert.deepEqual(draft.stories.main.states.map(({ id }) => id), ['opening-copy', 'network-view', 'opening']);
  assert.deepEqual(draft.stories.main.states[2].map.enter, [{ type: 'map.focus', target: 'network' }]);
  assert.match(draft.announcements.at(-1), /position 3/i);
  story.command('delete-state', 0);
  story.command('delete-state', 0);
  assert.throws(() => story.command('delete-state', 0), /at least one state/i);
});

test('state content supports four layouts and presenter notes', () => {
  const draft = harness();
  const story = draft.ui.story('main');
  assert.deepEqual(story.layoutOptions(), ['hero', 'metrics', 'narrative', 'map-focus']);
  for (const layout of story.layoutOptions()) {
    story.command('set-layout', { stateIndex: 0, layout });
    assert.equal(draft.stories.main.states[0].content.layout, layout);
  }
  story.command('set-presenter-note', { stateIndex: 0, note: 'Speak slowly' });
  assert.equal(draft.stories.main.states[0].content.presenterNote, 'Speak slowly');
});

test('Story 1.0 legacy actions remain ordered, visible, serialized, and disabled', () => {
  const draft = harness();
  const legacy = draft.ui.story('legacy');
  const actions = legacy.legacyActions(0);
  assert.deepEqual(actions.map(({ phase, type }) => [phase, type]), [
    ['enter', 'map.mode'], ['enter', 'map.focus'], ['exit', 'route.reveal']
  ]);
  assert.equal(actions.every(({ readOnly, disabled }) => readOnly && disabled), true);
  assert.equal(actions[1].parameters, JSON.stringify({ target: 'overview', camera: { maxZoom: 12 } }));
  assert.equal('controls' in actions[0], false);
});

test('Story 1.0 refuses 1.1-only blocks and preserves all legacy actions during supported edits', () => {
  const draft = harness();
  const legacy = draft.ui.story('legacy');
  const before = structuredClone(draft.stories.legacy.states[0].map);
  assert.throws(
    () => legacy.command('add-block', { stateIndex: 0, block: { type: 'image', asset: 'photo', alt: 'Photo' } }),
    /Story 1\.1-only block/i
  );
  legacy.command('set-presenter-note', { stateIndex: 0, note: 'Legacy note' });
  legacy.command('edit-block', { stateIndex: 0, blockIndex: 0, path: 'text', value: 'Edited legacy heading' });
  assert.equal(draft.stories.legacy.states[0].content.blocks[0].text, 'Edited legacy heading');
  assert.deepEqual(draft.stories.legacy.states[0].map, before);
});
