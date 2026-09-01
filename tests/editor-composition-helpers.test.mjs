import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createScene12 } from '../editor/core/scene-commands.js';
import { applyStudioStoryCommand } from '../editor/ui/studio-shell.js';

function story() {
  const scene = createScene12({
    id: 'opening',
    camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 },
    blocks: [
      { id: 'left', frame: { x: 0.1, y: 0.2, width: 0.2, height: 0.2, z: 1 }, block: { type: 'paragraph', text: 'Left' } },
      { id: 'right', frame: { x: 0.6, y: 0.5, width: 0.25, height: 0.2, z: 2 }, block: { type: 'heading', text: 'Right' } }
    ]
  });
  return { schemaVersion: '1.2', id: 'main', title: 'Main', states: [scene] };
}

function byId(value, id) {
  return value.states[0].content.blocks.find((item) => item.id === id);
}

test('Studio helper commands reuse pure duplicate/delete/alignment/z-order operations', () => {
  const source = story();
  const duplicated = applyStudioStoryCommand(source, 'duplicate-object', { sceneIndex: 0, id: 'left' });
  assert.equal(duplicated.states[0].content.blocks.at(-1).id, 'left-copy');

  const aligned = applyStudioStoryCommand(source, 'align-objects', {
    sceneIndex: 0, ids: ['left', 'right'], alignment: 'left'
  });
  assert.equal(byId(aligned, 'left').frame.x, 0.1);
  assert.equal(byId(aligned, 'right').frame.x, 0.1);

  const forward = applyStudioStoryCommand(source, 'bring-forward', { sceneIndex: 0, id: 'left' });
  assert.equal(byId(forward, 'left').frame.z, 2);
  assert.equal(byId(forward, 'right').frame.z, 1);

  const backward = applyStudioStoryCommand(source, 'send-backward', { sceneIndex: 0, id: 'right' });
  assert.equal(byId(backward, 'right').frame.z, 1);

  const deleted = applyStudioStoryCommand(source, 'delete-object', { sceneIndex: 0, id: 'left' });
  assert.deepEqual(deleted.states[0].content.blocks.map(({ id }) => id), ['right']);
  assert.deepEqual(source.states[0].content.blocks.map(({ id }) => id), ['left', 'right']);
});

test('Studio UI exposes constrained object helpers and no out-of-scope transform tools', async () => {
  const source = await readFile(new URL('../editor/ui/studio-shell.js', import.meta.url), 'utf8');
  for (const label of [
    'Duplicate', 'Delete', 'Bring forward', 'Send backward',
    'Align Left', 'Align Center', 'Align Right', 'Align Top', 'Align Middle', 'Align Bottom'
  ]) assert.match(source, new RegExp(label.replaceAll(' ', '\\s+')));
  assert.match(source, /shiftKey|selectedOverlayIds/);
  for (const forbidden of ['Distribute', 'Group', 'Rotate', 'Custom guide', 'Constraint']) {
    assert.doesNotMatch(source, new RegExp(`['\"\`]${forbidden}['\"\`]`, 'i'));
  }
});
