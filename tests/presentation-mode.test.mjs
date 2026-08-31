import assert from 'node:assert/strict';
import test from 'node:test';

import { createStoryActionRunner } from '../src/story-action-runner.js';
import { createStoryRuntime } from '../src/story-runtime.js';
import { bindGenericStoryExperience, createGenericStoryExperience } from '../src/runtime/generic-shell.js';
import { createPresentationMode, fitPresentationStage } from '../src/runtime/presentation-mode.js';

class TestClassList {
  constructor(owner) { this.owner = owner; }
  add(token) {
    const names = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    names.add(token);
    this.owner.className = [...names].join(' ');
  }
  remove(token) {
    this.owner.className = this.owner.className.split(/\s+/).filter((name) => name && name !== token).join(' ');
  }
  contains(token) { return this.owner.className.split(/\s+/).includes(token); }
}

class TestElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.hidden = true;
    this.disabled = false;
    this.className = '';
    this.classList = new TestClassList(this);
    this.style = {
      position: '', width: '', height: '', left: '', top: '', inset: '', margin: '', aspectRatio: ''
    };
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  click() { for (const listener of this.listeners.get('click') ?? []) listener({ target: this }); }
}

function story() {
  return {
    schemaVersion: '1.2', id: 'presentation-fixture', title: 'Presentation fixture',
    states: ['opening', 'middle', 'closing'].map((id) => ({
      id,
      content: { layout: 'freeform-16x9', blocks: [] },
      map: { enter: [{ type: 'record', value: `${id}.enter` }], exit: [{ type: 'record', value: `${id}.exit` }] }
    }))
  };
}

function createWindowRef({ width = 1600, height = 900 } = {}) {
  const listeners = new Map();
  return {
    innerWidth: width,
    innerHeight: height,
    location: { search: '' },
    addEventListener(type, listener) {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, event = {}) { for (const listener of listeners.get(type) ?? []) listener(event); },
    keydown(key, target = { tagName: 'DIV' }) {
      let prevented = false;
      this.emit('keydown', { key, target, preventDefault() { prevented = true; } });
      return prevented;
    },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; }
  };
}

function fixture(options = {}) {
  const actionEvents = [];
  const controllerEvents = [];
  const definition = story();
  const sceneController = {
    beforeEnter(state, context) { controllerEvents.push(['enter', state.id, context.animate]); },
    afterExit(state) { controllerEvents.push(['exit', state.id]); }
  };
  const runtime = createStoryRuntime({
    definition,
    actionRunner: createStoryActionRunner({ record(action) { actionEvents.push(action.value); } }),
    lifecycle: sceneController
  });
  const experience = createGenericStoryExperience({ runtime, sceneController });
  const stage = new TestElement('section');
  const existingContent = new TestElement('article');
  stage.append(existingContent);
  const mapContainer = new TestElement('main');
  const mapEvents = [];
  const map = {
    getContainer() { return mapContainer; },
    resize() { mapEvents.push('resize'); }
  };
  const navigation = new TestElement('nav');
  const documentRef = { createElement: (tagName) => new TestElement(tagName) };
  const windowRef = createWindowRef(options);
  const presentation = createPresentationMode({
    runtime, experience, map, stage, navigation, documentRef, windowRef
  });
  return {
    actionEvents, controllerEvents, definition, documentRef, existingContent, experience,
    map, mapContainer, mapEvents, navigation, presentation, runtime, stage, windowRef
  };
}

test('Presentation fits an exact 16:9 stage', () => {
  const f = fixture();
  f.presentation.enter();
  assert.equal(f.stage.style.aspectRatio, '16 / 9');
  assert.equal(Number.parseFloat(f.stage.style.width) / Number.parseFloat(f.stage.style.height), 16 / 9);
});

test('Presentation uses the existing Scene compositor geometry and content root', () => {
  const f = fixture();
  f.presentation.enter();
  assert.equal(f.presentation.stage, f.stage);
  assert.deepEqual(f.stage.children, [f.existingContent]);
});

test('Presentation reuses the existing MapLibre map and fits map and compositor identically at 1200x600', () => {
  const f = fixture({ width: 1200, height: 600 });
  f.presentation.enter();

  assert.equal(f.presentation.map, f.map);
  for (const surface of [f.mapContainer, f.stage]) {
    assert.equal(surface.style.width, '1066.6666666666665px');
    assert.equal(surface.style.height, '600px');
    assert.equal(surface.style.left, '66.66666666666674px');
    assert.equal(surface.style.top, '0px');
  }
});

test('Presentation fits the existing map and compositor identically at 600x900', () => {
  const f = fixture({ width: 600, height: 900 });
  f.presentation.enter();

  for (const surface of [f.mapContainer, f.stage]) {
    assert.equal(surface.style.width, '600px');
    assert.equal(surface.style.height, '337.5px');
    assert.equal(surface.style.left, '0px');
    assert.equal(surface.style.top, '281.25px');
  }
});

test('Presentation leaves non-stage viewport space outside the constrained map', () => {
  const wide = fixture({ width: 1200, height: 600 });
  wide.presentation.enter();
  assert.ok(Number.parseFloat(wide.mapContainer.style.width) < wide.windowRef.innerWidth);

  const tall = fixture({ width: 600, height: 900 });
  tall.presentation.enter();
  assert.ok(Number.parseFloat(tall.mapContainer.style.height) < tall.windowRef.innerHeight);
});

test('Presentation resizes MapLibre after entry and after refitting both surfaces', () => {
  const f = fixture({ width: 1200, height: 600 });
  f.presentation.enter();
  assert.deepEqual(f.mapEvents, ['resize']);

  f.windowRef.innerWidth = 600;
  f.windowRef.innerHeight = 900;
  f.windowRef.emit('resize');

  assert.deepEqual(f.mapEvents, ['resize', 'resize']);
  assert.equal(f.mapContainer.style.height, '337.5px');
  assert.equal(f.stage.style.height, '337.5px');
  assert.equal(f.mapContainer.style.top, '281.25px');
  assert.equal(f.stage.style.top, '281.25px');
});

test('Presentation exit restores map and compositor inline layout before resizing MapLibre', () => {
  const f = fixture({ width: 1200, height: 600 });
  Object.assign(f.mapContainer.style, {
    position: 'absolute', width: 'map-width', height: 'map-height', left: 'map-left', top: 'map-top'
  });
  Object.assign(f.stage.style, {
    position: 'absolute', width: 'stage-width', height: 'stage-height', left: 'stage-left', top: 'stage-top'
  });
  f.presentation.enter();
  f.presentation.exit();

  assert.deepEqual({
    position: f.mapContainer.style.position,
    width: f.mapContainer.style.width,
    height: f.mapContainer.style.height,
    left: f.mapContainer.style.left,
    top: f.mapContainer.style.top
  }, {
    position: 'absolute', width: 'map-width', height: 'map-height', left: 'map-left', top: 'map-top'
  });
  assert.deepEqual({
    position: f.stage.style.position,
    width: f.stage.style.width,
    height: f.stage.style.height,
    left: f.stage.style.left,
    top: f.stage.style.top
  }, {
    position: 'absolute', width: 'stage-width', height: 'stage-height', left: 'stage-left', top: 'stage-top'
  });
  assert.deepEqual(f.mapEvents, ['resize', 'resize']);
});

test('Next activates the next Scene through the shared runtime', () => {
  const f = fixture();
  f.presentation.enter();
  f.navigation.children[1].click();
  assert.equal(f.runtime.currentIndex, 1);
  assert.deepEqual(f.controllerEvents.slice(-2), [['exit', 'opening'], ['enter', 'middle', true]]);
});

test('Previous activates the previous Scene', () => {
  const f = fixture();
  f.presentation.enter();
  f.navigation.children[1].click();
  f.navigation.children[0].click();
  assert.equal(f.runtime.currentIndex, 0);
});

test('Presentation boundaries clamp without duplicate Scene actions', () => {
  const f = fixture();
  f.presentation.enter();
  f.navigation.children[0].click();
  f.navigation.children[1].click();
  f.navigation.children[1].click();
  f.navigation.children[1].click();
  assert.equal(f.runtime.currentIndex, 2);
  assert.deepEqual(f.actionEvents, [
    'opening.enter', 'opening.exit', 'middle.enter', 'middle.exit', 'closing.enter'
  ]);
});

test('ArrowRight and PageDown advance', () => {
  const f = fixture();
  f.presentation.enter();
  assert.equal(f.windowRef.keydown('ArrowRight'), true);
  assert.equal(f.windowRef.keydown('PageDown'), true);
  assert.equal(f.runtime.currentIndex, 2);
});

test('ArrowLeft and PageUp go backward', () => {
  const f = fixture();
  f.presentation.enter();
  f.windowRef.keydown('PageDown');
  f.windowRef.keydown('PageDown');
  f.windowRef.keydown('ArrowLeft');
  f.windowRef.keydown('PageUp');
  assert.equal(f.runtime.currentIndex, 0);
});

test('Escape exits Presentation', () => {
  const f = fixture();
  f.presentation.enter();
  assert.equal(f.windowRef.keydown('Escape'), true);
  assert.equal(f.presentation.active, false);
  assert.equal(f.runtime.active, false);
});

test('keyboard handling ignores text inputs and contenteditable controls', () => {
  const f = fixture();
  f.presentation.enter();
  assert.equal(f.windowRef.keydown('ArrowRight', { tagName: 'INPUT' }), false);
  assert.equal(f.windowRef.keydown('PageDown', { tagName: 'DIV', isContentEditable: true }), false);
  assert.equal(f.runtime.currentIndex, 0);
});

test('non-16:9 viewports use letterbox or pillarbox fitting without distortion', () => {
  const wide = fitPresentationStage({ viewportWidth: 1200, viewportHeight: 600 });
  assert.equal(wide.height, 600);
  assert.equal(wide.top, 0);
  assert.ok(Math.abs((wide.width / wide.height) - (16 / 9)) < 1e-12);
  assert.ok(Math.abs(wide.left - ((1200 - wide.width) / 2)) < 1e-12);

  const tall = fitPresentationStage({ viewportWidth: 600, viewportHeight: 900 });
  assert.equal(tall.width, 600);
  assert.equal(tall.left, 0);
  assert.ok(Math.abs((tall.width / tall.height) - (16 / 9)) < 1e-12);
  assert.equal(tall.top, 281.25);
});

test('Presentation does not construct another MapLibre map', () => {
  let constructions = 0;
  class MapLibreMap { constructor() { constructions += 1; } }
  const f = fixture();
  f.presentation.enter({ maplibregl: { Map: MapLibreMap } });
  assert.equal(constructions, 0);
});

test('Presentation reuses the supplied runtime, controller lifecycle, and compositor', () => {
  const f = fixture();
  f.presentation.enter();
  f.navigation.children[1].click();
  assert.equal(f.presentation.runtime, f.runtime);
  assert.equal(f.presentation.stage, f.stage);
  assert.equal(f.controllerEvents.some(([phase, id]) => phase === 'enter' && id === 'middle'), true);
});

test('destroy removes listeners and restores neutral shell state', () => {
  const f = fixture();
  f.stage.className = 'presentation-content';
  f.stage.style.width = 'original-width';
  f.presentation.enter();
  f.presentation.destroy();
  assert.equal(f.windowRef.listenerCount('keydown'), 0);
  assert.equal(f.windowRef.listenerCount('resize'), 0);
  assert.equal(f.navigation.hidden, true);
  assert.deepEqual(f.navigation.children, []);
  assert.equal(f.stage.className, 'presentation-content');
  assert.equal(f.stage.style.width, 'original-width');
  assert.equal(Object.hasOwn(f.stage.dataset, 'outputMode'), false);
});

test('repeated enter and exit do not multiply listeners or action execution', () => {
  const f = fixture();
  f.presentation.enter();
  f.presentation.enter();
  assert.equal(f.windowRef.listenerCount('keydown'), 1);
  f.presentation.exit();
  f.presentation.enter();
  f.presentation.exit();
  assert.equal(f.windowRef.listenerCount('keydown'), 0);
  assert.deepEqual(f.actionEvents, ['opening.enter', 'opening.exit', 'opening.enter', 'opening.exit']);
});

test('reduced-motion decisions remain with the existing Scene controller lifecycle', () => {
  const f = fixture();
  f.presentation.enter();
  f.navigation.children[1].click();
  assert.deepEqual(f.controllerEvents.filter(([phase]) => phase === 'enter'), [
    ['enter', 'opening', true], ['enter', 'middle', true]
  ]);
});

test('generic shell selects Presentation from bounded session URL state', () => {
  const f = fixture();
  f.windowRef.location.search = '?editorPreview=1&outputMode=presentation';
  const elements = new Map([
    ['scene-compositor', f.stage],
    ['runtime-navigation', f.navigation]
  ]);
  f.map.loaded = () => true;
  const shell = bindGenericStoryExperience({
    runtime: f.runtime,
    sceneController: {},
    map: f.map,
    documentRef: { ...f.documentRef, getElementById: (id) => elements.get(id) ?? null },
    windowRef: f.windowRef
  });
  assert.equal(shell.outputMode, 'presentation');
  assert.equal(f.windowRef.listenerCount('keydown'), 1);
  assert.equal(f.runtime.active, true);
  assert.deepEqual(f.mapEvents, ['resize']);
  shell.destroy();
});
