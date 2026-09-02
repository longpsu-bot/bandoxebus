import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createPreviewBridge, PREVIEW_PROTOCOL_VERSION } from '../editor/preview/bridge.js';
import { createStudioOutputPreviewControls } from '../editor/ui/studio-shell.js';
import { startEditorPreviewHost } from '../editor/preview/package-resolver.js';
import { createNewProjectEntries } from '../editor/core/package-store.js';
import { validateProjectManifest } from '../src/project/project-schema.js';

function fakeWindow() {
  const listeners = new Map();
  return {
    location: { origin: 'https://editor.example' },
    parent: null,
    document: { getElementById: () => null },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    emit(type, event) { listeners.get(type)?.(event); }
  };
}

function envelope(type, revision, payload = {}, requestId = `request-${revision}`) {
  return { protocol: PREVIEW_PROTOCOL_VERSION, type: `editor-preview:${type}`, revision, requestId, payload };
}

function failingPreviewHostHarness() {
  const events = [];
  const messages = [];
  const attempts = new Map();
  const windowRef = fakeWindow();
  windowRef.parent = { postMessage(message) { messages.push(message); } };
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver(snapshot) {
      return {
        manifestUrl: new URL(`https://editor.example/${snapshot.revision}/project.json`),
        fetchImpl() {},
        resolveAssetUrl() {},
        revoke() { events.push(`revoke:${snapshot.revision}`); }
      };
    },
    async startProductionApplication({ manifestUrl }) {
      const revision = Number(manifestUrl.pathname.split('/').at(-2));
      attempts.set(revision, (attempts.get(revision) ?? 0) + 1);
      events.push(`start:${revision}`);
      if (revision === 2 && attempts.get(revision) === 1) throw new Error('revision 2 failed');
      return { destroy() { events.push(`destroy:${revision}`); } };
    }
  });
  return { host, windowRef, events, messages };
}

test('bridge accepts only the known iframe, origin, version, and newest revision', () => {
  const windowRef = fakeWindow();
  const frame = { postMessage() {} };
  const iframe = { contentWindow: frame };
  const events = [];
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin, onEvent: (event) => events.push(event) });
  bridge.start({ revision: 1, snapshot: { revision: 1, entries: [] } });

  windowRef.emit('message', { source: {}, origin: windowRef.location.origin, data: envelope('loaded', 1) });
  windowRef.emit('message', { source: frame, origin: 'https://evil.example', data: envelope('loaded', 1) });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: { ...envelope('loaded', 1), protocol: 0 } });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('loaded', 0) });
  assert.deepEqual(events, []);
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('loaded', 1) });
  assert.equal(events[0].type, 'editor-preview:loaded');
  bridge.dispose();
});

test('bridge accepts only exact bounded urban context status telemetry', () => {
  const windowRef = fakeWindow();
  const frame = { postMessage() {} };
  const iframe = { contentWindow: frame };
  const events = [];
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin, onEvent: (event) => events.push(event) });
  bridge.start({ revision: 5, snapshot: { revision: 5, entries: [] } });
  const valid = {
    status: 'available',
    source: 'overture-pmtiles',
    release: '2026-08-19.0',
    failureCategory: null
  };

  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('urban-context-status', 5, valid) });
  for (const payload of [
    { ...valid, status: 'ready' },
    { ...valid, source: 'arbitrary-url' },
    { ...valid, release: undefined },
    { ...valid, failureCategory: 500 },
    { ...valid, extra: true }
  ]) {
    windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('urban-context-status', 5, payload) });
  }

  assert.deepEqual(events.map(({ payload }) => payload), [valid]);
  bridge.dispose();
});

test('bridge queues the newest valid snapshot until the production iframe is ready', () => {
  const windowRef = fakeWindow();
  const messages = [];
  const frame = { postMessage(message, origin) { messages.push({ message, origin }); } };
  const iframe = { contentWindow: frame };
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin });
  const snapshot = { revision: 2, entries: [{ path: 'project.json', bytes: new Uint8Array([1]), mediaType: 'application/json', kind: 'manifest' }] };
  bridge.start({ revision: 2, snapshot });
  snapshot.entries[0].bytes[0] = 9;
  assert.equal(messages.length, 0);

  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('ready', 0) });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.type, 'editor-preview:start');
  assert.equal(messages[0].message.payload.entries[0].bytes[0], 1);
  assert.equal(messages[0].origin, windowRef.location.origin);
  bridge.dispose();
});

test('bridge initiates a correlated handshake when attached after the iframe loaded', () => {
  const windowRef = fakeWindow();
  const messages = [];
  const frame = { postMessage(message) { messages.push(message); } };
  const iframe = {
    contentWindow: frame,
    contentDocument: { readyState: 'complete' },
    addEventListener() {},
    removeEventListener() {}
  };

  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'editor-preview:hello');
  assert.equal(typeof messages[0].requestId, 'string');
  bridge.start({ revision: 1, snapshot: { revision: 1, entries: [] } });
  windowRef.emit('message', {
    source: frame,
    origin: windowRef.location.origin,
    data: envelope('ready', 0, {}, null)
  });
  assert.equal(messages.at(-1).type, 'editor-preview:start');
  bridge.dispose();
});

test('reset accepts a fresh revision zero session and correlates lifecycle events by start request', () => {
  const windowRef = fakeWindow();
  const messages = [];
  let loadListener;
  const frame = { postMessage(message) { messages.push(message); } };
  const iframe = {
    contentWindow: frame,
    dataset: { previewSrc: '../?editorPreview=1' },
    src: '',
    addEventListener(type, listener) { if (type === 'load') loadListener = listener; },
    removeEventListener() {}
  };
  const events = [];
  const bridge = createPreviewBridge({
    iframe,
    windowRef,
    origin: windowRef.location.origin,
    onEvent: (event) => events.push(event)
  });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('ready', 0) });
  bridge.start({ revision: 3, snapshot: { revision: 3, entries: [] } });
  const requestX = messages.at(-1).requestId;

  bridge.reset();
  loadListener();
  const hello = messages.at(-1);
  windowRef.emit('message', {
    source: frame,
    origin: windowRef.location.origin,
    data: envelope('ready', 0, {}, hello.requestId)
  });
  bridge.start({ revision: 0, snapshot: { revision: 0, entries: [] } });
  const requestY = messages.at(-1).requestId;
  assert.notEqual(requestY, requestX);
  assert.equal(iframe.src, iframe.dataset.previewSrc);

  windowRef.emit('message', {
    source: frame,
    origin: windowRef.location.origin,
    data: envelope('loaded', 0, {}, requestX)
  });
  windowRef.emit('message', {
    source: frame,
    origin: windowRef.location.origin,
    data: envelope('loaded', 0, {}, requestY)
  });

  assert.deepEqual(events.filter(({ type }) => type === 'editor-preview:loaded').map(({ requestId }) => requestId), [requestY]);
  bridge.dispose();
});

test('reset waits for the replacement iframe load handshake before flushing Start', () => {
  const windowRef = fakeWindow();
  const messages = [];
  let loadListener;
  const frame = { postMessage(message) { messages.push(message); } };
  const iframe = {
    contentWindow: frame,
    dataset: { previewSrc: '../?editorPreview=1' },
    src: '',
    addEventListener(type, listener) { if (type === 'load') loadListener = listener; },
    removeEventListener() {}
  };
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin });

  bridge.reset();
  bridge.start({ revision: 0, snapshot: { revision: 0, entries: [] } });
  windowRef.emit('message', {
    source: frame,
    origin: windowRef.location.origin,
    data: envelope('ready', 0, {}, null)
  });
  assert.equal(messages.some(({ type }) => type === 'editor-preview:start'), false);

  loadListener();
  const hello = messages.find(({ type }) => type === 'editor-preview:hello');
  windowRef.emit('message', {
    source: frame,
    origin: windowRef.location.origin,
    data: envelope('ready', 0, {}, hello.requestId)
  });

  assert.equal(messages.filter(({ type }) => type === 'editor-preview:start').length, 1);
  bridge.dispose();
});

test('replacement destroys runtime and revokes revision URLs before starting one map', async () => {
  const events = [];
  const windowRef = fakeWindow();
  windowRef.parent = { postMessage() {} };
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver(snapshot) {
      return {
        manifestUrl: new URL(`https://editor.example/__editor_package__/${snapshot.revision}/project.json`),
        fetchImpl() {},
        resolveAssetUrl() {},
        revoke() { events.push(`revoke:${snapshot.revision}`); }
      };
    },
    async startProductionApplication({ manifestUrl }) {
      const revision = Number(manifestUrl.pathname.split('/').at(-2));
      events.push(`start:${revision}`);
      return { destroy() { events.push(`destroy:${revision}`); } };
    }
  });

  await host.start({ revision: 1, entries: [] });
  await host.start({ revision: 2, entries: [] });
  assert.deepEqual(events, ['start:1', 'destroy:1', 'revoke:1', 'start:2']);
  host.dispose();
});

test('preview host reports loaded only after the production map load lifecycle', async () => {
  const messages = [];
  const windowRef = fakeWindow();
  windowRef.parent = { postMessage(message) { messages.push(message); } };
  let loadListener;
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver(snapshot) {
      return {
        manifestUrl: new URL(`https://editor.example/${snapshot.revision}/project.json`),
        fetchImpl() {},
        resolveAssetUrl() {},
        revoke() {}
      };
    },
    async startProductionApplication() {
      return {
        map: {
          loaded: () => false,
          once(type, listener) { if (type === 'load') loadListener = listener; }
        },
        destroy() {}
      };
    }
  });

  const starting = host.start({ revision: 1, entries: [] });
  for (let turn = 0; turn < 10 && !loadListener; turn += 1) await Promise.resolve();
  assert.equal(messages.some(({ type }) => type === 'editor-preview:loaded'), false);
  assert.equal(typeof loadListener, 'function');
  loadListener();
  await starting;
  assert.equal(messages.some(({ type }) => type === 'editor-preview:loaded'), true);
  await host.dispose();
});

test('a rejected replacement reports its error but does not poison a later start', async () => {
  const { host, events, messages } = failingPreviewHostHarness();
  await host.start({ revision: 1, entries: [] }, 'start-1');

  await assert.rejects(host.start({ revision: 2, entries: [] }, 'start-2'), /revision 2 failed/);
  await host.start({ revision: 3, entries: [] }, 'start-3');

  assert.equal(messages.some(({ type, revision, requestId }) => (
    type === 'editor-preview:runtime-error' && revision === 2 && requestId === 'start-2'
  )), true);
  assert.deepEqual(events, [
    'start:1', 'destroy:1', 'revoke:1', 'start:2', 'revoke:2', 'start:3'
  ]);
  await host.dispose();
});

test('restart retries the latest requested snapshot after its first start failed', async () => {
  const { host, windowRef, events } = failingPreviewHostHarness();
  await host.start({ revision: 1, entries: [] }, 'start-1');
  await assert.rejects(host.start({ revision: 2, entries: [] }, 'start-2'), /revision 2 failed/);

  windowRef.emit('message', {
    source: windowRef.parent,
    origin: windowRef.location.origin,
    data: envelope('command', 2, { name: 'restart', payload: {} }, 'restart-2')
  });
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();

  assert.deepEqual(events, [
    'start:1', 'destroy:1', 'revoke:1', 'start:2', 'revoke:2', 'start:2'
  ]);
  await host.dispose();
});

test('Story 1.2 authoring commands use exact bounded preview payloads', () => {
  const windowRef = fakeWindow();
  const messages = [];
  const frame = { postMessage(message, origin) { messages.push({ message, origin }); } };
  const bridge = createPreviewBridge({
    iframe: { contentWindow: frame, addEventListener() {}, removeEventListener() {}, dataset: {} },
    windowRef,
    origin: windowRef.location.origin
  });

  bridge.command('activate-scene', { index: 2, animate: false });
  bridge.command('authoring-mode', { mode: 'map' });
  bridge.command('restore-scene-camera', { index: 2 });

  assert.deepEqual(messages.map(({ message }) => message.payload), [
    { name: 'activate-scene', payload: { index: 2, animate: false } },
    { name: 'authoring-mode', payload: { mode: 'map' } },
    { name: 'restore-scene-camera', payload: { index: 2 } }
  ]);
  assert.equal(messages.every(({ origin }) => origin === windowRef.location.origin), true);
  assert.throws(() => bridge.command('activate-scene', { index: 2, animate: false, method: 'jumpTo' }), /payload/i);
  assert.throws(() => bridge.command('authoring-mode', { mode: 'anything' }), /payload/i);
  assert.throws(() => bridge.command('restore-scene-camera', { index: -1 }), /payload/i);
  bridge.dispose();
});

test('output preview mode selection accepts only exact known session modes', () => {
  const windowRef = fakeWindow();
  let loadListener;
  const iframe = {
    contentWindow: { postMessage() {} },
    dataset: { previewSrc: '../?editorPreview=1' },
    src: '../?editorPreview=1',
    addEventListener(type, listener) { if (type === 'load') loadListener = listener; },
    removeEventListener() {}
  };
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin });
  const lastValid = { revision: 3, snapshot: { revision: 3, entries: [] } };

  bridge.start(lastValid, { outputMode: 'scroll' });
  assert.equal(iframe.src, '../?editorPreview=1&outputMode=scroll');
  loadListener();
  bridge.start(lastValid, { outputMode: 'presentation' });
  assert.equal(iframe.src, '../?editorPreview=1&outputMode=presentation');
  assert.throws(() => bridge.start(lastValid, { outputMode: 'unknown' }), TypeError);
  assert.throws(() => bridge.start(lastValid, { outputMode: 'scroll', command: 'anything' }), /options/i);
  bridge.dispose();
});

test('Studio output controls issue only Preview Story and Present mode requests', () => {
  class Button {
    constructor() { this.listeners = new Map(); this.textContent = ''; }
    setAttribute() {}
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    click() { this.listeners.get('click')?.(); }
  }
  const calls = [];
  const controls = createStudioOutputPreviewControls({
    documentRef: { createElement: () => new Button() },
    onOutputPreview(mode) { calls.push(mode); }
  });
  controls.previewStory.click();
  controls.present.click();
  assert.deepEqual(calls, ['scroll', 'presentation']);
  assert.equal(controls.previewStory.textContent, 'Preview Story');
  assert.equal(controls.present.textContent, 'Present');
});

test('preview host routes bounded Story commands only to the active production shell', async () => {
  const calls = [];
  const windowRef = fakeWindow();
  windowRef.parent = { postMessage() {} };
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver() {
      return { manifestUrl: new URL('https://editor.example/project.json'), fetchImpl() {}, resolveAssetUrl() {}, revoke() {} };
    },
    async startProductionApplication() {
      return {
        shell: {
          activateScene(index, options) { calls.push(['activate', index, options]); },
          setAuthoringMode(mode) { calls.push(['mode', mode]); },
          restoreSceneCamera(index) { calls.push(['restore', index]); }
        },
        destroy() {}
      };
    }
  });
  await host.start({ revision: 4, entries: [] });

  const send = (name, payload, event = {}) => windowRef.emit('message', {
    source: windowRef.parent,
    origin: windowRef.location.origin,
    data: envelope('command', 4, { name, payload }, `command-${name}`),
    ...event
  });
  send('activate-scene', { index: 1, animate: false });
  send('authoring-mode', { mode: 'select' });
  send('restore-scene-camera', { index: 1 });
  windowRef.emit('message', {
    source: {}, origin: windowRef.location.origin,
    data: envelope('command', 4, { name: 'authoring-mode', payload: { mode: 'map' } }, 'wrong-source')
  });
  windowRef.emit('message', {
    source: windowRef.parent, origin: 'https://evil.example',
    data: envelope('command', 4, { name: 'authoring-mode', payload: { mode: 'map' } }, 'wrong-origin')
  });

  assert.deepEqual(calls, [
    ['activate', 1, { animate: false }],
    ['mode', 'select'],
    ['restore', 1]
  ]);
  await host.dispose();
});

test('Story 1.2 Studio source exposes Layers Canvas Properties Scenes and explicit camera controls', async () => {
  const [source, css, editorSource] = await Promise.all([
    readFile(new URL('../editor/ui/studio-shell.js', import.meta.url), 'utf8'),
    readFile(new URL('../editor/editor.css', import.meta.url), 'utf8'),
    readFile(new URL('../editor/editor.js', import.meta.url), 'utf8')
  ]);
  for (const label of ['Layers', 'Canvas', 'Properties', 'Scenes', 'Select', 'Map', 'Camera changed', 'Capture Camera', 'Restore Saved Camera']) {
    assert.match(source, new RegExp(label.replaceAll(' ', '\\s+'), 'i'), label);
  }
  assert.match(source, /addProjectLayerToStory12|setSceneLayerVisibility/);
  assert.match(source, /ArrowLeft|ArrowRight/);
  assert.match(source, /Move previous|Move next/);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(editorSource, /schemaVersion\s*===\s*['"]1\.2['"]/);
});

test('static editor shell and production preview mode expose only the PR A spine', async () => {
  const [html, editorSource, css, appSource, smokeSource] = await Promise.all([
    readFile(new URL('../editor/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../editor/editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../editor/editor.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/editor-browser-smoke.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(html, /<header[\s>]/);
  assert.match(html, /<nav[\s>]/);
  assert.match(html, /<main[\s>]/);
  assert.match(html, /<aside[\s>]/);
  assert.match(html, /Production project preview/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin"/);
  assert.doesNotMatch(html, /allow-forms|allow-popups|allow-downloads|allow-top-navigation/);
  assert.match(html, /id="project-locale"/);
  assert.doesNotMatch(html, /id="project-title"[^>]*required/);
  assert.match(html, /id="story-heading"/);
  assert.match(html, /id="preview-desktop"/);
  assert.match(html, /id="preview-mobile"/);
  assert.match(html, /id="preview-status"/);
  assert.match(html, /id="dirty-status"/);
  assert.match(css, /preview-frame--mobile/);
  assert.doesNotMatch(editorSource, /innerHTML/);
  assert.match(appSource, /runtime\/generic-app\.js/);
  assert.doesNotMatch(appSource, /route-61-2|route-data|route-comparison/);
  assert.match(smokeSource, /project-locale/);
  assert.doesNotMatch(smokeSource, /project-title/);
});

test('static Studio shell exposes one global output action pair and a collapsed Problems affordance', async () => {
  const html = await readFile(new URL('../editor/index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/>Preview Story</g) ?? []).length, 1);
  assert.equal((html.match(/>Present</g) ?? []).length, 1);
  assert.match(html, /<details[^>]+id="problems-panel"(?![^>]*\sopen)/);
  assert.match(html, /id="problems-count"/);
  assert.match(html, /id="validation-status"/);
  assert.match(html, /id="validation-errors"/);
  assert.match(html, /<details[^>]+id="project-menu"/);
  assert.doesNotMatch(html, /<h2[^>]*>Validation<\/h2>/);
});

test('empty title remains valid because the GUI uses production validation only', () => {
  const entry = createNewProjectEntries().find(({ path }) => path === 'project.json');
  const manifest = JSON.parse(new TextDecoder().decode(entry.bytes));
  manifest.title = '';
  assert.equal(validateProjectManifest(manifest), manifest);
});
