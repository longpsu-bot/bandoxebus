import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createGenericStoryExperience } from '../src/runtime/generic-shell.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('neutral runtime markup contains only generic map Story hosts', async () => {
  const html = await read('../src/runtime/index.html');
  for (const id of ['map', 'scene-compositor', 'runtime-navigation', 'capability-controls', 'runtime-status', 'project-load-error']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const forbidden of ['61-2', 'Existing', 'Proposed', 'Difference', 'Hiện hữu', 'Điều chỉnh', 'Mô phỏng', 'industrial', 'transport metric']) {
    assert.equal(html.includes(forbidden), false, `neutral shell leaked ${forbidden}`);
  }
});

test('neutral generic app imports no Route 61-2 runtime modules or data', async () => {
  const source = await read('../src/runtime/generic-app.js');
  for (const forbidden of ['route-data', 'comparison.js', 'route-61-2-story-actions', 'transport-poi-beacons', 'urban-context.js', 'stop-pulses', 'animation-timing']) {
    assert.equal(source.includes(forbidden), false, `generic app imports ${forbidden}`);
  }
  assert.match(source, /startApplication/);
  assert.match(source, /INSTALLED_CAPABILITY_REGISTRY/);
  assert.match(source, /startEditorPreviewHost/);
});

test('generic Story experience activates one existing runtime and supports direct Scene selection', () => {
  const events = [];
  const runtime = {
    active: false,
    currentIndex: 0,
    definition: { states: [{ id: 'one' }, { id: 'two' }] },
    activate(index) { this.active = true; this.currentIndex = index; events.push(['activate', index]); return this.definition.states[index]; },
    goTo(index) { this.currentIndex = index; events.push(['goTo', index]); return this.definition.states[index]; },
    deactivate() { this.active = false; events.push(['deactivate']); }
  };
  const experience = createGenericStoryExperience({ runtime });
  experience.enter();
  experience.activateScene(1);
  experience.exit();
  assert.deepEqual(events, [['activate', 0], ['goTo', 1], ['deactivate']]);
});
