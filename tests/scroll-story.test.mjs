import assert from 'node:assert/strict';
import test from 'node:test';

import { createStoryActionRunner } from '../src/story-action-runner.js';
import { createStoryRuntime } from '../src/story-runtime.js';
import { bindGenericStoryExperience, createGenericStoryExperience } from '../src/runtime/generic-shell.js';
import { createScrollStoryNavigation } from '../src/runtime/scroll-story.js';

class TestElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.hidden = true;
    this.className = '';
    this.style = {
      position: '', inset: '', display: '', overflowY: '', width: '', height: '',
      left: '', top: '', margin: '', pointerEvents: '', minHeight: '', scrollSnapAlign: ''
    };
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
}

function createObserverFactory(instances) {
  return (callback, options) => {
    const observer = {
      callback,
      options,
      targets: [],
      disconnectCount: 0,
      observe(target) { this.targets.push(target); },
      disconnect() { this.disconnectCount += 1; },
      emit(entries) { callback(entries, this); }
    };
    instances.push(observer);
    return observer;
  };
}

function entry(target, ratio, top = 200, bottom = 700) {
  return {
    target,
    isIntersecting: ratio > 0,
    intersectionRatio: ratio,
    boundingClientRect: { top, bottom, height: bottom - top }
  };
}

function story(ids = ['opening', 'network', 'closing']) {
  return {
    schemaVersion: '1.2',
    id: 'scroll-fixture',
    title: 'Scroll fixture',
    states: ids.map((id) => ({
      id,
      content: { layout: 'freeform-16x9', blocks: [] },
      map: { enter: [{ type: 'record', value: `${id}.enter` }], exit: [{ type: 'record', value: `${id}.exit` }] }
    }))
  };
}

function fixture(ids) {
  const actionEvents = [];
  const controllerEvents = [];
  const definition = story(ids);
  const sceneController = {
    beforeEnter(state) { controllerEvents.push(`enter:${state.id}`); },
    afterExit(state) { controllerEvents.push(`exit:${state.id}`); }
  };
  const runtime = createStoryRuntime({
    definition,
    actionRunner: createStoryActionRunner({ record(action) { actionEvents.push(action.value); } }),
    lifecycle: sceneController
  });
  const experience = createGenericStoryExperience({ runtime, sceneController });
  const root = new TestElement('main');
  const mapContainer = new TestElement('main');
  const map = { getContainer: () => mapContainer };
  const stage = new TestElement('section');
  const documentElement = new TestElement('html');
  const body = new TestElement('body');
  const documentRef = {
    body,
    documentElement,
    createElement: (tagName) => new TestElement(tagName)
  };
  const observers = [];
  const windowListeners = new Map();
  const windowRef = {
    innerHeight: 900,
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
    listenerCount(type) { return windowListeners.has(type) ? 1 : 0; }
  };
  const navigation = createScrollStoryNavigation({
    runtime,
    experience,
    map,
    stage,
    root,
    documentRef,
    windowRef,
    observerFactory: createObserverFactory(observers)
  });
  return {
    actionEvents, body, controllerEvents, definition, documentElement, experience,
    map, mapContainer, navigation, observers, root, runtime, stage, windowRef
  };
}

test('ordered scroll sections map directly to Story Scene order', () => {
  const f = fixture(['third-looking-id', 'alpha', 'scene-200']);
  f.navigation.enter();

  assert.deepEqual(f.navigation.sections.map(({ dataset }) => dataset.sceneId), [
    'third-looking-id', 'alpha', 'scene-200'
  ]);
  assert.deepEqual(f.navigation.sections.map(({ dataset }) => dataset.sceneIndex), ['0', '1', '2']);
});

test('entering forward and backward steps activates the matching shared runtime index', () => {
  const f = fixture();
  f.navigation.enter();
  f.observers[0].emit([entry(f.navigation.sections[1], 0.8)]);
  f.observers[0].emit([entry(f.navigation.sections[0], 0.9)]);

  assert.equal(f.runtime.currentIndex, 0);
  assert.deepEqual(f.controllerEvents, [
    'enter:opening', 'exit:opening', 'enter:network', 'exit:network', 'enter:opening'
  ]);
});

test('the same active Scene does not duplicate action execution', () => {
  const f = fixture();
  f.navigation.enter();
  f.observers[0].emit([entry(f.navigation.sections[1], 0.8)]);
  f.observers[0].emit([entry(f.navigation.sections[1], 0.9)]);

  assert.deepEqual(f.actionEvents, ['opening.enter', 'opening.exit', 'network.enter']);
});

test('rapid observer updates resolve deterministically to the intended active Scene', () => {
  const f = fixture();
  f.navigation.enter();
  f.observers[0].emit([
    entry(f.navigation.sections[1], 0.6, 250, 650),
    entry(f.navigation.sections[2], 0.9, 300, 700)
  ]);

  assert.equal(f.runtime.currentIndex, 2);
});

test('observer batches retain still-visible steps when selecting the active Scene', () => {
  const f = fixture();
  f.navigation.enter();
  f.observers[0].emit([
    entry(f.navigation.sections[0], 0.45),
    entry(f.navigation.sections[1], 0.8)
  ]);
  f.observers[0].emit([entry(f.navigation.sections[0], 0.55)]);

  assert.equal(f.runtime.currentIndex, 1);
});

test('cooperative map gestures do not trap normal page scrolling', () => {
  const f = fixture();
  f.navigation.enter();

  assert.equal(f.root.listenerCount('wheel'), 0);
  assert.equal(f.root.listenerCount('touchmove'), 0);
  assert.equal(f.windowRef.listenerCount('wheel'), 0);
  assert.equal(f.windowRef.listenerCount('touchmove'), 0);
});

test('Scroll Story uses native document height without covering the map with an interactive scroll box', () => {
  const f = fixture();
  f.root.style.position = 'fixed';
  f.root.style.inset = 'auto 16px 16px auto';
  f.navigation.enter();

  assert.equal(f.documentElement.style.overflowY, 'auto');
  assert.equal(f.body.style.overflowY, 'auto');
  assert.equal(f.root.style.position, 'relative');
  assert.equal(f.root.style.inset, 'auto');
  assert.equal(f.root.style.overflowY, 'visible');
  assert.equal(f.root.style.height, 'auto');
  assert.equal(f.root.style.pointerEvents, 'none');
  assert.equal(f.navigation.sections.every(({ style }) => style.minHeight === '100vh'), true);
  assert.equal(f.navigation.sections.every(({ style }) => style.pointerEvents === 'none'), true);

  f.navigation.exit();
  assert.equal(f.root.style.position, 'fixed');
  assert.equal(f.root.style.inset, 'auto 16px 16px auto');
  assert.equal(f.root.style.overflowY, '');
  assert.equal(f.documentElement.style.overflowY, '');
  assert.equal(f.body.style.overflowY, '');
  assert.deepEqual(f.root.children, []);
});

test('Scroll Story keeps the existing map full-bleed and compositor fixed to its safe geometry', () => {
  const f = fixture();
  f.mapContainer.style.position = 'absolute';
  f.mapContainer.style.inset = '0';
  f.stage.style.position = 'absolute';
  f.stage.style.width = 'safe-width';
  f.stage.style.height = 'safe-height';
  f.navigation.enter();

  assert.deepEqual({
    position: f.mapContainer.style.position,
    inset: f.mapContainer.style.inset,
    width: f.mapContainer.style.width,
    height: f.mapContainer.style.height
  }, { position: 'fixed', inset: '0', width: '100%', height: '100%' });
  assert.equal(f.stage.style.position, 'fixed');
  assert.equal(f.stage.style.width, 'safe-width');
  assert.equal(f.stage.style.height, 'safe-height');
});

test('Scroll Story activation surface leaves map and overlay pointer interaction available', () => {
  const f = fixture();
  f.navigation.enter();

  assert.equal(f.root.style.pointerEvents, 'none');
  assert.equal(f.navigation.sections.every(({ style }) => style.pointerEvents === 'none'), true);
  assert.equal(f.root.listenerCount('click'), 0);
  assert.equal(f.root.listenerCount('wheel'), 0);
  assert.equal(f.root.listenerCount('touchmove'), 0);
});

test('Scroll Story exit and re-entry restore document map compositor and activation layout exactly', () => {
  const f = fixture();
  Object.assign(f.documentElement.style, { overflowY: 'hidden', height: 'html-height' });
  Object.assign(f.body.style, { overflowY: 'hidden', height: 'body-height' });
  Object.assign(f.root.style, { position: 'fixed', inset: 'root-inset', pointerEvents: 'auto' });
  Object.assign(f.mapContainer.style, { position: 'absolute', inset: 'map-inset', width: 'map-width', height: 'map-height' });
  Object.assign(f.stage.style, { position: 'absolute', inset: 'stage-inset', width: 'stage-width', height: 'stage-height' });

  for (let cycle = 0; cycle < 2; cycle += 1) {
    f.navigation.enter();
    f.navigation.exit();
    assert.deepEqual({
      htmlOverflow: f.documentElement.style.overflowY,
      htmlHeight: f.documentElement.style.height,
      bodyOverflow: f.body.style.overflowY,
      bodyHeight: f.body.style.height,
      rootPosition: f.root.style.position,
      rootInset: f.root.style.inset,
      rootPointers: f.root.style.pointerEvents,
      mapPosition: f.mapContainer.style.position,
      mapInset: f.mapContainer.style.inset,
      mapWidth: f.mapContainer.style.width,
      mapHeight: f.mapContainer.style.height,
      stagePosition: f.stage.style.position,
      stageInset: f.stage.style.inset,
      stageWidth: f.stage.style.width,
      stageHeight: f.stage.style.height
    }, {
      htmlOverflow: 'hidden', htmlHeight: 'html-height',
      bodyOverflow: 'hidden', bodyHeight: 'body-height',
      rootPosition: 'fixed', rootInset: 'root-inset', rootPointers: 'auto',
      mapPosition: 'absolute', mapInset: 'map-inset', mapWidth: 'map-width', mapHeight: 'map-height',
      stagePosition: 'absolute', stageInset: 'stage-inset', stageWidth: 'stage-width', stageHeight: 'stage-height'
    });
  }
});

test('adapter creation does not construct a MapLibre map', () => {
  let mapConstructions = 0;
  class MapLibreMap { constructor() { mapConstructions += 1; } }
  const f = fixture();
  f.navigation.enter({ maplibregl: { Map: MapLibreMap } });

  assert.equal(mapConstructions, 0);
});

test('the supplied runtime and Scene controller lifecycle are reused', () => {
  const f = fixture();
  f.navigation.enter();
  f.observers[0].emit([entry(f.navigation.sections[1], 0.9)]);

  assert.equal(f.navigation.runtime, f.runtime);
  assert.deepEqual(f.controllerEvents, ['enter:opening', 'exit:opening', 'enter:network']);
});

test('generic shell binds Scroll Story over the supplied production runtime', () => {
  const f = fixture();
  const documentRef = {
    body: f.body,
    documentElement: f.documentElement,
    createElement: (tagName) => new TestElement(tagName),
    getElementById(id) {
      if (id === 'runtime-navigation') return f.root;
      if (id === 'scene-compositor') return f.stage;
      return null;
    }
  };
  f.map.loaded = () => true;
  const shell = bindGenericStoryExperience({
    runtime: f.runtime,
    sceneController: {},
    documentRef,
    windowRef: f.windowRef,
    map: f.map,
    outputMode: 'scroll',
    observerFactory: createObserverFactory(f.observers)
  });

  assert.equal(shell.outputMode, 'scroll');
  assert.equal(f.runtime.active, true);
  assert.equal(f.observers.length, 1);
  assert.deepEqual(f.root.children.map(({ dataset }) => dataset.sceneId), f.definition.states.map(({ id }) => id));
  shell.destroy();
});

test('exit disconnects observer ownership and removes navigation listeners', () => {
  const f = fixture();
  f.navigation.enter();
  assert.equal(f.root.listenerCount('click'), 0);

  f.navigation.exit();

  assert.equal(f.observers[0].disconnectCount, 1);
  assert.equal(f.root.listenerCount('click'), 0);
  assert.equal(f.root.hidden, true);
  assert.equal(f.runtime.active, false);
});

test('re-entry never accumulates observers or listener state', () => {
  const f = fixture();
  f.navigation.enter();
  f.navigation.enter();
  assert.equal(f.observers.length, 1);
  assert.equal(f.root.listenerCount('click'), 0);

  f.navigation.exit();
  f.navigation.enter();
  f.navigation.exit();
  f.navigation.enter();
  f.navigation.exit();

  assert.equal(f.observers.length, 3);
  assert.equal(f.observers.every(({ disconnectCount }) => disconnectCount === 1), true);
  assert.equal(f.root.listenerCount('click'), 0);
});
