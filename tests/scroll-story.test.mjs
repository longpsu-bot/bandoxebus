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
  const documentRef = { createElement: (tagName) => new TestElement(tagName) };
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
    root,
    documentRef,
    windowRef,
    observerFactory: createObserverFactory(observers)
  });
  return { actionEvents, controllerEvents, definition, experience, navigation, observers, root, runtime, windowRef };
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
    createElement: (tagName) => new TestElement(tagName),
    getElementById(id) { return id === 'runtime-navigation' ? f.root : null; }
  };
  const shell = bindGenericStoryExperience({
    runtime: f.runtime,
    sceneController: {},
    documentRef,
    windowRef: f.windowRef,
    map: { loaded: () => true },
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
  assert.equal(f.root.listenerCount('click'), 1);

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
  assert.equal(f.root.listenerCount('click'), 1);

  f.navigation.exit();
  f.navigation.enter();
  f.navigation.exit();
  f.navigation.enter();
  f.navigation.exit();

  assert.equal(f.observers.length, 3);
  assert.equal(f.observers.every(({ disconnectCount }) => disconnectCount === 1), true);
  assert.equal(f.root.listenerCount('click'), 0);
});
