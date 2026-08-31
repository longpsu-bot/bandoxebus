import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { createGenericStoryExperience } from '../src/runtime/generic-shell.js';
import { createGenericApplicationOptions } from '../src/runtime/generic-app.js';
import { createStoryActionRunner } from '../src/story-action-runner.js';
import { createStoryRuntime } from '../src/story-runtime.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('neutral runtime markup contains only generic map Story hosts', async () => {
  const html = await read('../index.html');
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
  assert.match(source, /cooperativeGestures:\s*cooperativeScroll/);
});

test('generic application resolves one bounded output mode before bootstrap', () => {
  const documentRef = { getElementById: () => null };
  const optionsFor = (search) => createGenericApplicationOptions({
    documentRef,
    windowRef: {
      location: { search },
      matchMedia: () => ({ matches: false })
    }
  });

  assert.deepEqual(
    ['?outputMode=scroll', '?outputMode=presentation', '?editorPreview=1', '?outputMode=unknown']
      .map((search) => {
        const options = optionsFor(search);
        return [options.outputMode, options.cooperativeScroll];
      }),
    [
      ['scroll', true],
      ['presentation', false],
      ['explore', false],
      ['explore', false]
    ]
  );
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

test('editor instant Scene activation applies its baseline once before Enter actions', () => {
  const events = [];
  const definition = {
    states: [{
      id: 'opening',
      content: { layout: 'freeform-16x9', blocks: [] },
      map: { enter: [{ type: 'record' }], exit: [] }
    }]
  };
  const sceneController = {
    beforeEnter(_state, context) { events.push(['baseline', context.animate]); },
    afterExit() {},
    apply() { events.push(['late-baseline']); }
  };
  const runtime = createStoryRuntime({
    definition,
    actionRunner: createStoryActionRunner({ record() { events.push(['enter-action']); } }),
    lifecycle: {
      beforeEnter: sceneController.beforeEnter,
      afterExit: sceneController.afterExit
    }
  });
  const experience = createGenericStoryExperience({ runtime, sceneController });

  experience.activateScene(0, { animate: false });

  assert.deepEqual(events, [
    ['baseline', false],
    ['enter-action']
  ]);
});

test('Restore Saved Camera uses the camera-only operation and preserves Map mode', () => {
  const events = [];
  const runtime = {
    active: true,
    currentIndex: 0,
    currentState: { id: 'opening' },
    definition: { states: [{ id: 'opening' }] },
    activate() {}, goTo() {}, deactivate() {}
  };
  const sceneController = {
    apply() { events.push(['full-baseline']); },
    restoreCamera(state) { events.push(['camera', state.id]); }
  };
  const authoringPolicy = {
    apply(mode) { events.push(['mode', mode]); }
  };
  const experience = createGenericStoryExperience({ runtime, sceneController, authoringPolicy });

  experience.setAuthoringMode('map');
  experience.restoreSceneCamera(0);

  assert.deepEqual(events, [
    ['mode', 'explore'],
    ['camera', 'opening']
  ]);
});
