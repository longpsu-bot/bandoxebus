import test from 'node:test';
import assert from 'node:assert/strict';
import * as shell from '../src/story-shell.js';

function runtimeFixture(ids = ['alpha', 'banana', 'state-999']) {
  const calls = [];
  const runtime = {
    definition: { states: ids.map((id) => ({ id, content: { layout: 'hero', blocks: [] } })) },
    active: false,
    currentIndex: 0,
    get currentState() { return this.definition.states[this.currentIndex]; },
    goTo(index) {
      this.currentIndex = index;
      this.active = true;
      calls.push(index);
      return this.currentState;
    },
    deactivate() { this.active = false; calls.push('deactivate'); }
  };
  return { calls, runtime };
}

class TestClassList {
  constructor(owner) { this.owner = owner; }
  toggle(token, force) {
    const names = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    const active = force ?? !names.has(token);
    if (active) names.add(token); else names.delete(token);
    this.owner.className = [...names].join(' ');
    return active;
  }
  add(...tokens) { tokens.forEach((token) => this.toggle(token, true)); }
  remove(...tokens) { tokens.forEach((token) => this.toggle(token, false)); }
}

class TestElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.classList = new TestClassList(this);
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.scrollCalls = [];
    this.hidden = true;
    this.disabled = false;
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  click() { this.listeners.get('click')?.({ target: this, preventDefault() {} }); }
  scrollIntoView(options) { this.scrollCalls.push(options); }
}

function createWindowRef() {
  const listeners = new Map();
  return {
    innerHeight: 1000,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    keydown(key, target = { closest: () => null }) {
      listeners.get('keydown')?.({ key, target, preventDefault() {} });
    },
    listenerCount(type) { return listeners.has(type) ? 1 : 0; }
  };
}

function observerEntry(target, intersectionRatio, top, bottom) {
  return {
    target,
    intersectionRatio,
    isIntersecting: intersectionRatio > 0,
    boundingClientRect: { top, bottom, height: bottom - top }
  };
}

function createObserverFactory(observers) {
  return (callback, options) => {
    const instance = {
      callback,
      options,
      observed: [],
      disconnectCount: 0,
      observe(target) { this.observed.push(target); },
      disconnect() { this.disconnectCount += 1; },
      emit(entries) { callback(entries, this); }
    };
    observers.push(instance);
    return instance;
  };
}

function controllerFixture(ids) {
  const { calls: runtimeCalls, runtime } = runtimeFixture(ids);
  const elements = {
    root: new TestElement('section'),
    steps: new TestElement('div'),
    progressCurrent: new TestElement('span'),
    progressTotal: new TestElement('span'),
    previousButton: new TestElement('button'),
    nextButton: new TestElement('button'),
    exitButton: new TestElement('button')
  };
  const body = new TestElement('body');
  const documentRef = { body, createElement: (tagName) => new TestElement(tagName) };
  const windowRef = createWindowRef();
  const activationCalls = [];
  const interactionCalls = [];
  const observers = [];
  const controller = shell.createStoryShell({
    runtime,
    elements,
    renderContent(content, state) { content.dataset.renderedStateId = state.id; },
    metrics: {},
    documentRef,
    windowRef,
    observerFactory: createObserverFactory(observers),
    interactionPolicy: {
      enter() { interactionCalls.push('enter'); },
      exit() { interactionCalls.push('exit'); }
    },
    onActivate(value) { activationCalls.push(value); }
  });
  return {
    activationCalls, controller, documentRef, elements, interactionCalls,
    observers, runtime, runtimeCalls, windowRef,
    get sections() { return controller.sections; }
  };
}

test('direct activation synchronizes runtime, active section, progress, and callback', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.controller.activateStoryState(2);
  assert.deepEqual(fixture.runtimeCalls, [0, 2]);
  assert.equal(fixture.runtime.currentIndex, 2);
  assert.deepEqual(fixture.sections.map((step) => step.attributes['aria-current']), ['false', 'false', 'step']);
  assert.equal(fixture.elements.progressCurrent.textContent, '3');
  assert.equal(fixture.elements.progressTotal.textContent, '3');
  assert.equal(fixture.elements.nextButton.disabled, true);
  assert.deepEqual(fixture.activationCalls.map(({ index }) => index), [0, 2]);
});

test('previous and next buttons use the same clamped activation path and scroll their section', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.elements.previousButton.click();
  fixture.elements.nextButton.click();
  fixture.elements.nextButton.click();
  fixture.elements.nextButton.click();
  assert.deepEqual(fixture.runtimeCalls, [0, 1, 2]);
  assert.equal(fixture.sections[1].scrollCalls.length, 1);
  assert.equal(fixture.sections[2].scrollCalls.length, 1);
});

test('same active index is a shell no-op instead of reactivating runtime actions', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.controller.activateStoryState(0);
  assert.deepEqual(fixture.runtimeCalls, [0]);
});

test('keyboard next previous and Escape use activation and exit lifecycle', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.windowRef.keydown('ArrowDown');
  fixture.windowRef.keydown(' ');
  fixture.windowRef.keydown('ArrowUp');
  fixture.windowRef.keydown('Escape');
  assert.deepEqual(fixture.runtimeCalls, [0, 1, 2, 1, 'deactivate']);
  assert.equal(fixture.elements.root.hidden, true);
});

test('keyboard ignores events from interactive targets', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.windowRef.keydown('ArrowRight', { closest: () => ({}) });
  assert.deepEqual(fixture.runtimeCalls, [0]);
});

test('observer selection activates the generic runtime path once per changed index', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.observers[0].emit([observerEntry(fixture.sections[2], 0.8, 320, 720)]);
  fixture.observers[0].emit([observerEntry(fixture.sections[2], 0.9, 300, 700)]);
  assert.deepEqual(fixture.runtimeCalls, [0, 2]);
});

test('observer selection retains other visible sections across callback batches', () => {
  const fixture = controllerFixture(['a', 'b', 'c']);
  fixture.controller.enter();
  fixture.observers[0].emit([
    observerEntry(fixture.sections[0], 0.45, 100, 500),
    observerEntry(fixture.sections[1], 0.80, 300, 700)
  ]);
  assert.equal(fixture.runtime.currentIndex, 1);

  fixture.observers[0].emit([
    observerEntry(fixture.sections[0], 0.55, 150, 550)
  ]);
  assert.equal(fixture.runtime.currentIndex, 1);
  assert.deepEqual(fixture.runtimeCalls, [0, 1]);

  fixture.observers[0].emit([
    observerEntry(fixture.sections[1], 0, -500, -100),
    observerEntry(fixture.sections[2], 0.70, 280, 680)
  ]);
  assert.equal(fixture.runtime.currentIndex, 2);
  assert.deepEqual(fixture.runtimeCalls, [0, 1, 2]);
});

test('rapid observer progression is latest-state-wins', () => {
  const fixture = controllerFixture(['a', 'b', 'c', 'd']);
  fixture.controller.enter();
  let previous = 0;
  for (const index of [1, 2, 3]) {
    fixture.observers[0].emit([
      observerEntry(fixture.sections[previous], 0, -400, -100),
      observerEntry(fixture.sections[index], 0.9, 250, 650)
    ]);
    previous = index;
  }
  assert.deepEqual(fixture.runtimeCalls, [0, 1, 2, 3]);
  assert.equal(fixture.runtime.currentIndex, 3);
});

test('enter exit re-entry owns one observer and one key listener at a time', () => {
  const fixture = controllerFixture();
  fixture.controller.enter();
  fixture.controller.enter();
  assert.equal(fixture.observers.length, 1);
  assert.equal(fixture.windowRef.listenerCount('keydown'), 1);
  fixture.controller.exit();
  fixture.controller.exit();
  assert.equal(fixture.observers[0].disconnectCount, 1);
  assert.equal(fixture.windowRef.listenerCount('keydown'), 0);
  fixture.controller.enter();
  fixture.controller.exit();
  fixture.controller.enter();
  fixture.controller.exit();
  assert.equal(fixture.observers.length, 3);
  assert.equal(fixture.observers.every(({ disconnectCount }) => disconnectCount === 1), true);
  assert.equal(fixture.interactionCalls.filter((value) => value === 'enter').length, 3);
  assert.equal(fixture.interactionCalls.filter((value) => value === 'exit').length, 3);
});
