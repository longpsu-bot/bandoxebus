import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPreviewBridge,
  PREVIEW_PROTOCOL_VERSION,
  resolvePreviewSourceForSnapshot
} from '../editor/preview/bridge.js';
import { startEditorPreviewHost } from '../editor/preview/package-resolver.js';
import {
  presentUrbanContextSetting,
  resolveUrbanContextStatusText
} from '../editor/editor.js';
import { createEditor } from '../editor/editor.js';
import { createNewProjectEntries } from '../editor/core/package-store.js';
import { unzipSync } from '../vendor/fflate/0.8.3/fflate.esm.js';
import { createStoryRuntime } from '../src/story-runtime.js';
import { createGenericStoryExperience } from '../src/runtime/generic-shell.js';
import { createSceneStateController } from '../src/scene/scene-state-controller.js';
import { createStoryActionRunner } from '../src/story-action-runner.js';
import { createCoreMapCapability } from '../src/capabilities/core-map-v1.js';

const encoder = new TextEncoder();

function freezeEditorHarness() {
  const element = () => ({ style: { width: '', height: '' }, dataset: {}, children: [], disabled: false, value: '',
    listeners: new Map(), classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, fn) { this.listeners.set(type, fn); }, removeEventListener() {},
    setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name]; },
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    remove() {}, click() { if (!this.disabled) return this.listeners.get('click')?.({ target: this }); },
    showModal() { this.open = true; }, close() { this.open = false; } });
  const ids = ['new-project', 'open-folder', 'import-zip', 'save-project', 'export-project-zip', 'validate-project',
    'preview-story', 'present-story', 'preview-status', 'dirty-status', 'validation-status', 'validation-errors',
    'project-locale', 'story-heading', 'production-preview', 'preview-frame', 'preview-paused', 'preview-desktop', 'preview-mobile',
    'prepare-freeze', 'freeze-dialog', 'freeze-required-bounds', 'freeze-min-lon', 'freeze-min-lat', 'freeze-max-lon', 'freeze-max-lat',
    'download-freeze-plan', 'cancel-freeze', 'freeze-error'];
  const nodes = Object.fromEntries(ids.map((id) => [id, element()]));
  nodes['prepare-freeze'].disabled = true;
  const posted = [], captures = [], downloads = [], revoked = [];
  const windowRef = fakeWindow();
  const documentRef = { getElementById: (id) => nodes[id] ?? null, querySelector: () => null, body: element(),
    createElement(tag) { const node = element(); if (tag === 'a') node.click = () => downloads.push({ name: node.download, url: node.href }); return node; } };
  const blobs = new Map();
  windowRef.URL = { createObjectURL(blob) { const url = `blob:${blobs.size}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { revoked.push(url); } };
  const frame = nodes['production-preview'];
  frame.dataset.previewSrc = '../?editorPreview=1';
  let source = '';
  Object.defineProperty(frame, 'src', { get: () => source, set(next) {
    const previous = source; source = next;
    if (previous && previous !== next) queueMicrotask(() => frame.listeners.get('load')?.());
  } });
  const reply = (request, type, payload) => windowRef.emit('message', { source: frame.contentWindow,
    origin: windowRef.location.origin, data: envelope(type, request.revision, payload, request.requestId) });
  let captureHandler;
  frame.contentWindow = { postMessage(request) {
    posted.push(request);
    if (request.type === 'editor-preview:hello') queueMicrotask(() => reply(request, 'ready', {}));
    if (request.type === 'editor-preview:start') queueMicrotask(() => reply(request, 'loaded', {}));
    if (request.payload.name === 'capture-scene-camera') {
      const size = { ...nodes['preview-frame'].style };
      captures.push({ index: request.payload.payload.index, size });
      if (captureHandler) { captureHandler(request, reply); return; }
      const bounds = size.width === '1920px' ? [[106.58, 11.12], [106.62, 11.15]] : [[106.59, 11.11], [106.61, 11.16]];
      queueMicrotask(() => reply(request, 'freeze-camera', { index: request.payload.payload.index,
        center: [106.6, 11.13], zoom: 13.6, pitch: 52, bearing: -10, bounds }));
    }
  } };
  const editor = createEditor({ documentRef, windowRef });
  return { editor, nodes, posted, captures, downloads, revoked, blobs,
    setCaptureHandler(fn) { captureHandler = fn; },
    ready() { frame.listeners.get('load')?.(); } };
}

function freezeEntries({ active = true, source = 'overture-pmtiles', legacy = false } = {}) {
  return createNewProjectEntries({ id: 'freeze-project' }).map((entry) => {
    const value = JSON.parse(new TextDecoder().decode(entry.bytes));
    if (entry.path === 'project.json') value.capabilities = [{ id: 'urban-context-v1', settings: {
      buildingSource: source, overtureRelease: '2026-08-19.0'
    } }];
    else {
      if (legacy) { value.schemaVersion = '1.0'; value.states = [{ id: 'opening', content: { layout: 'hero', blocks: [{ type: 'heading', text: 'Context' }] }, map: { enter: [], exit: [] } }]; }
      value.states[0].map.enter = active ? [{ type: legacy ? 'map.urban-context' : 'context.set-mode', mode: 'industrial-context' }] : [];
      const second = structuredClone(value.states[0]);
      second.id = 'persistent'; second.map.enter = []; second.map.exit = [{ type: legacy ? 'map.urban-context' : 'context.set-mode', mode: 'off' }];
      const third = structuredClone(second); third.id = 'off'; third.map.exit = [];
      value.states.push(second, third);
    }
    return { ...entry, bytes: encoder.encode(JSON.stringify(value)) };
  });
}

function freezeFolder(entries) {
  const files = new Map(entries.map(({ path, bytes }) => [path, bytes.slice()]));
  const writes = [];
  const directory = (prefix = '') => ({ name: 'Freeze authoring project',
    async getDirectoryHandle(name) { return directory(`${prefix}${name}/`); },
    async getFileHandle(name) { const path = `${prefix}${name}`; return {
      async getFile() { if (!files.has(path)) throw new DOMException('Missing', 'NotFoundError'); return new File([files.get(path)], name); },
      async createWritable() { return { async write(bytes) { writes.push(path); files.set(path, bytes.slice()); }, async close() {} }; }
    }; }
  });
  return { root: directory(), files, writes };
}

async function until(predicate) {
  for (let i = 0; i < 100; i += 1) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  assert.fail('Expected UI result did not settle.');
}

test('Prepare Freeze user flow captures exact profiles and downloads a transient union without package changes', async (t) => {
  for (const legacy of [false, true]) {
    const harness = freezeEditorHarness();
    t.after(() => harness.editor.dispose());
    const folder = freezeFolder(freezeEntries({ legacy }));
    await harness.editor.openFolder(folder.root);
    harness.ready();
    assert.match(harness.nodes['validation-status'].textContent, /valid production/i);
    assert.equal(harness.nodes['prepare-freeze'].disabled, false);
    const before = unzipSync(await harness.editor.exportZip());
    harness.editor.setViewport('mobile');
    harness.nodes['preview-frame'].style.width = '731px';
    harness.nodes['preview-frame'].style.height = '455px';
    harness.nodes['prepare-freeze'].click();
    await until(() => harness.nodes['freeze-dialog'].open);
    assert.deepEqual(harness.captures.map(({ index, size }) => [index, size.width, size.height]), [
      [0, '1920px', '1080px'], [1, '1920px', '1080px'], [0, '390px', '844px'], [1, '390px', '844px']
    ]);
    assert.equal(harness.nodes['preview-frame'].style.width, '731px');
    assert.equal(harness.nodes['preview-frame'].style.height, '455px');
    assert.equal(harness.nodes['preview-mobile']['aria-pressed'], 'true');
    assert.deepEqual(harness.posted.filter(({ payload }) => payload.name === 'activate-scene').at(-1).payload.payload, { index: 0, animate: false });
    assert.deepEqual(['freeze-min-lon', 'freeze-min-lat', 'freeze-max-lon', 'freeze-max-lat'].map((id) => Number(harness.nodes[id].value)), [106.58, 11.11, 106.62, 11.16]);
    harness.nodes['freeze-min-lon'].value = '106.59';
    harness.nodes['download-freeze-plan'].click();
    await until(() => harness.nodes['freeze-error'].textContent);
    assert.match(harness.nodes['freeze-error'].textContent, /must contain/i);
    assert.equal(harness.downloads.length, 0);
    harness.nodes['freeze-min-lon'].value = '106.5';
    harness.nodes['download-freeze-plan'].click();
    await until(() => harness.downloads.length);
    const plan = JSON.parse(await harness.blobs.get(harness.downloads[0].url).text());
    assert.equal(harness.downloads[0].name, 'freeze-project-overture-freeze-plan.json');
    assert.deepEqual(plan.requiredBounds, [106.58, 11.11, 106.62, 11.16]);
    assert.deepEqual(plan.finalBounds, [106.5, 11.11, 106.62, 11.16]);
    assert.equal(plan.projectFingerprint.length, 64);
    assert.equal(plan.overtureRelease, '2026-08-19.0');
    assert.deepEqual(harness.revoked, [harness.downloads[0].url]);
    assert.deepEqual(unzipSync(await harness.editor.exportZip()), before);
    assert.deepEqual(folder.writes, []);
    assert.equal(harness.nodes['dirty-status'].textContent, 'Saved');
  }
});

test('Prepare Freeze gating rejects unsaved non-Folder invalid and context-inactive inputs', async (t) => {
  const harness = freezeEditorHarness();
  t.after(() => harness.editor.dispose());
  await harness.editor.openEntries(freezeEntries());
  assert.equal(harness.nodes['prepare-freeze'].disabled, true);
  await harness.editor.openFolder(freezeFolder(freezeEntries({ active: false })).root);
  assert.equal(harness.nodes['prepare-freeze'].disabled, true);
  await harness.editor.openFolder(freezeFolder(freezeEntries({ source: 'local-geojson' })).root);
  assert.equal(harness.nodes['prepare-freeze'].disabled, true);
  await harness.editor.openFolder(freezeFolder(freezeEntries()).root);
  assert.equal(harness.nodes['prepare-freeze'].disabled, false);
  harness.nodes['project-locale'].value = '';
  harness.nodes['project-locale'].listeners.get('input')();
  assert.equal(harness.nodes['prepare-freeze'].disabled, true, 'dirty edits block Freeze before debounced validation');
  harness.nodes['validate-project'].click();
  await until(() => /invalid/i.test(harness.nodes['validation-status'].textContent));
  assert.equal(harness.nodes['prepare-freeze'].disabled, true);
});

test('Freeze errors and project replacement restore frame and never download a stale plan', async (t) => {
  for (const failure of ['capture', 'replace', 'dispose', 'edit-after-prepare']) {
    const harness = freezeEditorHarness();
    t.after(() => harness.editor.dispose());
    await harness.editor.openFolder(freezeFolder(freezeEntries()).root);
    harness.ready();
    harness.editor.setViewport('mobile');
    if (failure !== 'edit-after-prepare') harness.setCaptureHandler((request, reply) => {
      if (failure === 'capture') queueMicrotask(() => reply(request, 'runtime-error', { code: 'CAPTURE', path: '$', message: 'Camera failed' }));
    });
    harness.nodes['prepare-freeze'].click();
    if (failure !== 'edit-after-prepare') await until(() => harness.captures.length);
    if (failure === 'replace') await harness.editor.openEntries(freezeEntries());
    if (failure === 'dispose') harness.editor.dispose();
    if (failure === 'edit-after-prepare') {
      await until(() => harness.nodes['freeze-dialog'].open);
      harness.nodes['project-locale'].value = 'vi-VN';
      harness.nodes['project-locale'].listeners.get('input')();
      harness.nodes['download-freeze-plan'].click();
    }
    await until(() => harness.nodes['preview-frame'].style.width === '');
    assert.equal(harness.nodes['preview-frame'].style.height, '');
    assert.equal(harness.nodes['preview-mobile']['aria-pressed'], 'true');
    assert.equal(harness.downloads.length, 0);
    if (failure === 'capture') assert.match(harness.nodes['validation-status'].textContent, /camera failed/i);
  }
});

test('Freeze temporarily uses Explore and restores the prior output mode and selection after success or error', async (t) => {
  for (const failCapture of [false, true]) {
    const harness = freezeEditorHarness();
    t.after(() => harness.editor.dispose());
    await harness.editor.openFolder(freezeFolder(freezeEntries({ legacy: true })).root);
    harness.ready();
    harness.nodes['present-story'].click();
    await until(() => harness.posted.filter(({ type }) => type === 'editor-preview:start').length === 1);
    await new Promise((resolve) => setImmediate(resolve));
    if (failCapture) harness.setCaptureHandler((request, reply) => queueMicrotask(() => reply(request, 'runtime-error', { code: 'CAPTURE', path: '$', message: 'Camera failed' })));
    harness.nodes['prepare-freeze'].click();
    await until(() => harness.posted.filter(({ type }) => type === 'editor-preview:start').length === 3);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(harness.nodes['production-preview'].src, /outputMode=presentation/);
    const restoredStart = harness.posted.findLastIndex(({ type }) => type === 'editor-preview:start');
    assert.equal(harness.posted.slice(restoredStart + 1).some(({ payload }) => payload.name === 'activate-scene' && payload.payload.index === 0), true,
      'selection restoration must reach the restored runtime after it is loaded');
    assert.equal(harness.nodes['preview-frame'].style.width, '');
    assert.equal(harness.nodes['freeze-dialog'].open, !failCapture);
    if (!failCapture) {
      assert.deepEqual(harness.captures.map(({ size }) => size.width), ['1920px', '1920px', '390px', '390px']);
      harness.nodes['cancel-freeze'].click();
      assert.equal(harness.nodes['freeze-dialog'].open, false);
    }
  }
});

function jsonEntry(path, value, kind) {
  return { path, bytes: encoder.encode(`${JSON.stringify(value)}\n`), mediaType: 'application/json', kind };
}

function snapshot(version, revision = 1) {
  return {
    revision,
    entries: [
      jsonEntry('project.json', {
        schemaVersion: '1.0', id: 'p', title: 'P', locale: 'en-US',
        stories: { primary: 'main', items: [{ id: 'main', src: './stories/main.story.json' }] },
        map: { basemap: 'openfreemap-dark', initialView: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } },
        datasets: {}, assets: {}, focusTargets: {}, capabilities: [], attribution: {}
      }, 'manifest'),
      jsonEntry('stories/main.story.json', { schemaVersion: version, id: 'main', title: 'Main', states: [] }, 'story')
    ]
  };
}

function fakeWindow() {
  const listeners = new Map();
  return {
    location: { origin: 'https://editor.example' },
    parent: null,
    document: { documentElement: { dataset: {} }, getElementById: () => null },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    emit(type, event) { listeners.get(type)?.(event); }
  };
}

function envelope(type, revision, payload = {}, requestId = `request-${revision}`) {
  return { protocol: PREVIEW_PROTOCOL_VERSION, type: `editor-preview:${type}`, revision, requestId, payload };
}

test('every supported Story version selects the same neutral production root without GUI-only metadata', () => {
  const sources = { source: '../?editorPreview=1' };
  assert.equal(resolvePreviewSourceForSnapshot(snapshot('1.0'), sources), sources.source);
  assert.equal(resolvePreviewSourceForSnapshot(snapshot('1.1'), sources), sources.source);
  assert.equal(resolvePreviewSourceForSnapshot(snapshot('1.2'), sources), sources.source);
  assert.throws(() => resolvePreviewSourceForSnapshot(snapshot('2.0'), sources), /unsupported Story preview version/i);
});

test('parent bridge sends only exact bounded Scene authoring commands', () => {
  const windowRef = fakeWindow();
  const posted = [];
  const frame = { postMessage(message, origin) { posted.push({ message, origin }); } };
  const iframe = {
    contentWindow: frame,
    dataset: {
      previewSrc: '../?editorPreview=1',
      previewSrcLegacy: '../?editorPreview=1',
      previewSrcStory12: '../src/runtime/?editorPreview=1'
    },
    src: '',
    addEventListener() {}, removeEventListener() {}
  };
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('ready', 0) });
  bridge.start({ revision: 1, snapshot: snapshot('1.2', 1) });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('ready', 1) });

  bridge.command('activate-scene', { index: 2, animate: false });
  bridge.command('authoring-mode', { mode: 'map' });
  bridge.command('authoring-selection', { id: 'image' });
  bridge.command('authoring-selection', { id: null });
  bridge.command('restore-scene-camera', { index: 2 });

  const commands = posted.filter(({ message }) => message.type === 'editor-preview:command').map(({ message }) => message.payload);
  assert.deepEqual(commands, [
    { name: 'activate-scene', payload: { index: 2, animate: false } },
    { name: 'authoring-mode', payload: { mode: 'map' } },
    { name: 'authoring-selection', payload: { id: 'image' } },
    { name: 'authoring-selection', payload: { id: null } },
    { name: 'restore-scene-camera', payload: { index: 2 } }
  ]);
  assert.throws(() => bridge.command('activate-scene', { index: 2, animate: false, method: 'evil' }), /invalid preview command/i);
  assert.throws(() => bridge.command('authoring-mode', { mode: 'pan-only' }), /invalid preview command/i);
  assert.throws(() => bridge.command('authoring-selection', { id: 'Bad ID' }), /invalid preview command/i);
  bridge.dispose();
});

test('parent bridge sends only the stable project dataset ID for layer locate', () => {
  const windowRef = fakeWindow();
  const posted = [];
  const frame = { postMessage(message, origin) { posted.push({ message, origin }); } };
  const bridge = createPreviewBridge({
    iframe: { contentWindow: frame, dataset: {}, addEventListener() {}, removeEventListener() {} },
    windowRef,
    origin: windowRef.location.origin
  });

  bridge.command('locate-project-layer', { datasetId: 'existing-route' });
  assert.deepEqual(posted.at(-1).message.payload, {
    name: 'locate-project-layer', payload: { datasetId: 'existing-route' }
  });
  assert.throws(() => bridge.command('locate-project-layer', { datasetId: 'existing-route', layerId: 'private-layer' }), /invalid preview command/i);
  assert.throws(() => bridge.command('locate-project-layer', { datasetId: 'Bad ID' }), /invalid preview command/i);
  assert.throws(() => bridge.command('locate-project-layer', { datasetId: 3 }), /invalid preview command/i);
  bridge.dispose();
});

test('preview host dispatches bounded Scene commands to the active generic shell only', async () => {
  const windowRef = fakeWindow();
  const posted = [];
  const calls = [];
  windowRef.parent = { postMessage(message) { posted.push(message); } };
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver(value) {
      return {
        manifestUrl: new URL(`https://editor.example/${value.revision}/project.json`),
        fetchImpl() {}, resolveAssetUrl() {}, revoke() {}
      };
    },
    async startProductionApplication() {
      return {
        map: { loaded: () => true },
        shell: {
          activateScene(index, options) { calls.push(['activate', index, options]); },
          setAuthoringMode(mode) { calls.push(['mode', mode]); },
          restoreSceneCamera(index) { calls.push(['restore', index]); }
        },
        destroy() {}
      };
    }
  });
  await host.start({ revision: 4, entries: [] }, 'start-4');
  for (const payload of [
    { name: 'activate-scene', payload: { index: 1, animate: false } },
    { name: 'authoring-mode', payload: { mode: 'select' } },
    { name: 'restore-scene-camera', payload: { index: 1 } }
  ]) {
    windowRef.emit('message', {
      source: windowRef.parent,
      origin: windowRef.location.origin,
      data: envelope('command', 4, payload, `command-${calls.length}`)
    });
  }
  assert.deepEqual(calls, [
    ['activate', 1, { animate: false }],
    ['mode', 'select'],
    ['restore', 1]
  ]);
  assert.equal(posted.some(({ type }) => type === 'editor-preview:runtime-error'), false);
  await host.dispose();
});

test('preview host captures the active production camera after Scene activation resize and move settlement', async () => {
  const windowRef = fakeWindow();
  const posted = [];
  const calls = [];
  const listeners = new Set();
  let moving = true;
  windowRef.parent = { postMessage(message) { posted.push(message); } };
  const map = { loaded: () => true, resize: () => calls.push('resize'), isMoving: () => moving,
    getCenter: () => ({ lng: 106.6, lat: 11.13 }), getZoom: () => 13.6, getPitch: () => 52, getBearing: () => -10,
    getBounds: () => ({ getSouthWest: () => ({ lng: 106.58, lat: 11.11 }), getNorthEast: () => ({ lng: 106.62, lat: 11.15 }) }),
    on(type, listener) { if (type === 'moveend') listeners.add(listener); }, off(type, listener) { listeners.delete(listener); } };
  const host = startEditorPreviewHost({ windowRef,
    createResolver() { return { manifestUrl: new URL('https://editor.example/project.json'), fetchImpl() {}, revoke() {} }; },
    async startProductionApplication() { return { map, shell: { activateScene(index, options) { calls.push(['activate', index, options]); } }, destroy() {} }; }
  });
  await host.start({ revision: 4, entries: [] });
  windowRef.emit('message', { source: windowRef.parent, origin: windowRef.location.origin,
    data: envelope('command', 4, { name: 'capture-scene-camera', payload: { index: 4 } }, 'capture-4') });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['resize', ['activate', 4, { animate: false }], 'resize']);
  assert.equal(posted.some(({ type }) => type === 'editor-preview:freeze-camera'), false);
  moving = false;
  for (const listener of [...listeners]) listener();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(posted.find(({ type }) => type === 'editor-preview:freeze-camera'), envelope('freeze-camera', 4, {
    index: 4, center: [106.6, 11.13], zoom: 13.6, pitch: 52, bearing: -10,
    bounds: [[106.58, 11.11], [106.62, 11.15]]
  }, 'capture-4'));
  assert.equal(listeners.size, 1, 'capture move listener removed; normal camera telemetry remains');
  await host.dispose();
  assert.equal(listeners.size, 0);
});

test('capture replays real production lifecycle for already-selected panned and inherited-camera Scenes at the resized viewport', async () => {
  for (const variant of ['scene12', 'inherited', 'initial-view']) {
    const windowRef = fakeWindow();
    const posted = [];
    const calls = [];
    let camera = { center: [1, 2], zoom: 3, pitch: 0, bearing: 0 };
    let width = 700;
    let mode = 'off';
    const map = { loaded: () => true, isMoving: () => false,
      resize() { width = 1920; calls.push('resize'); },
      jumpTo(value) { camera = structuredClone(value); },
      getCenter: () => ({ lng: camera.center[0], lat: camera.center[1] }), getZoom: () => camera.zoom,
      getPitch: () => camera.pitch, getBearing: () => camera.bearing,
      getBounds: () => ({ getSouthWest: () => ({ lng: 106.58, lat: 11.11 }), getNorthEast: () => ({ lng: 106.62, lat: 11.15 }) })
    };
    const definition = { schemaVersion: variant === 'scene12' ? '1.2' : '1.0', states: [
      { id: 'opening', map: { enter: [{ type: 'context.set-mode', mode: 'industrial-context' }], exit: [],
        camera: { center: [106.6, 11.13], zoom: 13.6, pitch: 52, bearing: -10 }, transition: { type: 'instant', durationMs: 0 } } }
    ] };
    if (variant === 'inherited') {
      definition.states[0].map.enter.unshift({ type: 'map.focus' });
      definition.states.push({ id: 'persistent', map: { enter: [], exit: [] } });
    }
    const sceneController = createSceneStateController({ map, layerRegistry: { applySnapshot() {} }, interactionPolicy: { apply() {} }, compositor: { render() {} } });
    const runtime = createStoryRuntime({ definition, actionRunner: { run(actions) { for (const action of actions) {
      if (action.type === 'context.set-mode') mode = action.mode;
      if (action.type === 'map.focus') { calls.push(['focus', width]); map.jumpTo({ center: [106.6, 11.13], zoom: width === 1920 ? 13.6 : 7, pitch: 52, bearing: -10 }); }
    } } }, lifecycle: variant === 'scene12' ? { beforeEnter: sceneController.beforeEnter, afterExit: sceneController.afterExit } : {} });
    const shell = createGenericStoryExperience({ runtime, sceneController });
    shell.activateScene(0, { animate: false });
    const index = definition.states.length - 1;
    shell.activateScene(index, { animate: false });
    map.jumpTo({ center: [20, 30], zoom: 4, pitch: 0, bearing: 0 });
    calls.length = 0;
    windowRef.parent = { postMessage(message) { posted.push(message); } };
    const host = startEditorPreviewHost({ windowRef,
      createResolver() { return { manifestUrl: new URL('https://editor.example/project.json'), fetchImpl() {}, revoke() {} }; },
      async startProductionApplication() { return { map, shell, storyRuntime: runtime,
        project: { story: definition, map: { initialView: { center: [1, 2], zoom: 3, pitch: 0, bearing: 0 } } }, destroy() {} }; }
    });
    await host.start({ revision: 4, entries: [] });
    windowRef.emit('message', { source: windowRef.parent, origin: windowRef.location.origin,
      data: envelope('command', 4, { name: 'capture-scene-camera', payload: { index } }, 'capture') });
    await new Promise((resolve) => setImmediate(resolve));
    const result = posted.find(({ type }) => type === 'editor-preview:freeze-camera');
    assert.deepEqual(result?.payload.center, variant === 'initial-view' ? [1, 2] : [106.6, 11.13]);
    assert.equal(result.payload.zoom, variant === 'initial-view' ? 3 : 13.6);
    assert.equal(mode, 'industrial-context');
    if (variant === 'inherited') assert.deepEqual(calls.slice(0, 2), ['resize', ['focus', 1920]]);
    await host.dispose();
  }
});

function animatedFocusCaptureHarness({ automaticMotion = true } = {}) {
  const windowRef = fakeWindow();
  const posted = [];
  const events = new Set();
  const focuses = [];
  const initialView = { center: [0, 0], zoom: 3, pitch: 0, bearing: 0 };
  let camera = structuredClone(initialView);
  let destination = null;
  let timer = null;
  const settle = () => {
    clearTimeout(timer); timer = null;
    if (destination) camera = destination;
    destination = null;
    for (const listener of [...events]) listener();
  };
  const map = {
    loaded: () => true, resize() {}, isMoving: () => destination !== null,
    jumpTo(value) { clearTimeout(timer); timer = null; destination = null; camera = { ...camera, ...value }; },
    easeTo(value) {
      focuses.push(structuredClone(value));
      clearTimeout(timer);
      destination = { ...camera, ...value };
      if (automaticMotion) timer = setTimeout(settle, 10);
    },
    getCenter: () => ({ lng: camera.center[0], lat: camera.center[1] }), getZoom: () => camera.zoom,
    getPitch: () => camera.pitch, getBearing: () => camera.bearing,
    getBounds: () => ({ getSouthWest: () => ({ lng: 1, lat: 1 }),
      getNorthEast: () => camera.pitch === 50 && camera.bearing === 30 ? ({ lng: 3, lat: 4 }) : ({ lng: 2, lat: 2 }) }),
    on(type, listener) { if (type === 'moveend') events.add(listener); },
    off(type, listener) { events.delete(listener); }
  };
  const definition = { schemaVersion: '1.1', states: [
    { id: 'a', map: { enter: [{ type: 'map.focus', target: 'a', camera: { pitch: 50, bearing: 30 } }], exit: [] } },
    { id: 'b', map: { enter: [{ type: 'map.focus', target: 'b' }], exit: [] } }
  ] };
  const project = { story: definition, map: { initialView }, manifest: { capabilities: [] }, focusTargets: {
    a: { type: 'coordinate', center: [1, 1], zoom: 10 }, b: { type: 'coordinate', center: [2, 2], zoom: 11 }
  } };
  const capability = createCoreMapCapability({ map, project });
  const runtime = createStoryRuntime({ definition, actionRunner: createStoryActionRunner(capability.handlers) });
  const shell = createGenericStoryExperience({ runtime });
  windowRef.parent = { postMessage(message) { posted.push(message); } };
  const host = startEditorPreviewHost({ windowRef,
    createResolver() { return { manifestUrl: new URL('https://editor.example/project.json'), fetchImpl() {}, revoke() {} }; },
    async startProductionApplication() { return { map, project, shell, storyRuntime: runtime,
      destroy() { clearTimeout(timer); timer = null; destination = null; } }; }
  });
  const capture = () => windowRef.emit('message', { source: windowRef.parent, origin: windowRef.location.origin,
    data: envelope('command', 1, { name: 'capture-scene-camera', payload: { index: 1 } }, 'animated-focus-capture') });
  return { host, runtime, shell, map, posted, events, focuses, settle, capture };
}

test('Freeze replay waits for real core-map focus motion so omitted pitch and bearing inherit settled predecessors', async (t) => {
  const harness = animatedFocusCaptureHarness();
  t.after(() => harness.host.dispose());
  harness.shell.activateScene(0, { animate: false });
  await until(() => !harness.map.isMoving());
  harness.shell.activateScene(1, { animate: false });
  await until(() => !harness.map.isMoving());
  assert.equal(harness.map.getPitch(), 50);
  assert.equal(harness.map.getBearing(), 30);
  assert.equal(harness.focuses[0].duration, 900, 'the installed focus handler remains animated despite animate:false');
  await harness.host.start({ revision: 1, entries: [] });
  harness.capture();
  await until(() => harness.posted.some(({ type }) => type === 'editor-preview:freeze-camera'));
  const result = harness.posted.find(({ type }) => type === 'editor-preview:freeze-camera');
  assert.equal(result.payload.pitch, 50);
  assert.equal(result.payload.bearing, 30);
  assert.deepEqual(result.payload.bounds, [[1, 1], [3, 4]]);
  assert.equal(harness.events.size, 1, 'only normal camera telemetry remains after both settlement listeners are removed');
});

test('replacement and disposal abort predecessor settlement without replaying later Scenes', async (t) => {
  for (const replacement of [true, false]) {
    const harness = animatedFocusCaptureHarness({ automaticMotion: false });
    t.after(() => harness.host.dispose());
    await harness.host.start({ revision: 1, entries: [] });
    harness.capture();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.runtime.currentIndex, 0, 'Scene B cannot begin while Scene A is moving');
    const lateListeners = [...harness.events];
    if (replacement) await harness.host.start({ revision: 2, entries: [] });
    else await harness.host.dispose();
    for (const listener of lateListeners) listener();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(harness.focuses.map(({ center }) => center), [[1, 1]]);
    assert.equal(harness.posted.some(({ type, requestId }) => type === 'editor-preview:runtime-error' && requestId === 'animated-focus-capture'), true);
    assert.equal(harness.posted.some(({ type }) => type === 'editor-preview:freeze-camera'), false);
    assert.equal(harness.events.size, replacement ? 1 : 0);
  }
});

test('preview host cancels unsettled captures on runtime replacement and disposal', async () => {
  for (const action of ['replace', 'dispose']) {
    const windowRef = fakeWindow();
    const posted = [];
    const listeners = new Set();
    windowRef.parent = { postMessage(message) { posted.push(message); } };
    const host = startEditorPreviewHost({ windowRef,
      createResolver() { return { manifestUrl: new URL('https://editor.example/project.json'), fetchImpl() {}, revoke() {} }; },
      async startProductionApplication() { return {
        map: { loaded: () => true, resize() {}, isMoving: () => true, on(type, listener) { listeners.add(listener); }, off(type, listener) { listeners.delete(listener); } },
        shell: { activateScene() {} }, destroy() {}
      }; }
    });
    await host.start({ revision: 4, entries: [] });
    windowRef.emit('message', { source: windowRef.parent, origin: windowRef.location.origin,
      data: envelope('command', 4, { name: 'capture-scene-camera', payload: { index: 0 } }, 'capture-4') });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(listeners.size, 2);
    if (action === 'replace') await host.start({ revision: 5, entries: [] });
    else await host.dispose();
    assert.equal(posted.some(({ type, requestId }) => type === 'editor-preview:runtime-error' && requestId === 'capture-4'), true);
    assert.equal(posted.some(({ type }) => type === 'editor-preview:freeze-camera'), false);
    await host.dispose();
    assert.equal(listeners.size, 0);
  }
});

test('preview host forwards one active-revision urban context status event and removes its listener', async () => {
  const windowRef = fakeWindow();
  const documentListeners = new Map();
  windowRef.document.addEventListener = (type, listener) => documentListeners.set(type, listener);
  windowRef.document.removeEventListener = (type, listener) => {
    if (documentListeners.get(type) === listener) documentListeners.delete(type);
  };
  const posted = [];
  windowRef.parent = { postMessage(message) { posted.push(message); } };
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver() {
      return { manifestUrl: new URL('https://editor.example/project.json'), fetchImpl() {}, resolveAssetUrl() {}, revoke() {} };
    },
    async startProductionApplication() { return { map: { loaded: () => true }, destroy() {} }; }
  });

  await host.start({ revision: 7, entries: [] });
  const listener = documentListeners.get('map-story:urban-context-status');
  assert.equal(typeof listener, 'function');
  listener({ detail: {
    status: 'loading', source: 'overture-pmtiles', release: '2026-08-19.0', failureCategory: null
  } });
  assert.deepEqual(posted.filter(({ type }) => type === 'editor-preview:urban-context-status'), [{
    protocol: PREVIEW_PROTOCOL_VERSION,
    type: 'editor-preview:urban-context-status',
    revision: 7,
    requestId: null,
    payload: { status: 'loading', source: 'overture-pmtiles', release: '2026-08-19.0', failureCategory: null }
  }]);

  await host.dispose();
  assert.equal(documentListeners.has('map-story:urban-context-status'), false);
});

test('urban context inspector presentation keeps source/release editable and status transient', () => {
  assert.deepEqual(presentUrbanContextSetting('buildingSource', {
    value: 'overture-pmtiles',
    options: ['overture-pmtiles', 'project-snapshot', 'local-geojson']
  }), {
    label: 'Building source',
    options: [
      { value: 'overture-pmtiles', label: 'Overture online' },
      { value: 'project-snapshot', label: 'Project snapshot' },
      { value: 'local-geojson', label: 'Local benchmark' }
    ]
  });
  assert.deepEqual(presentUrbanContextSetting('overtureRelease', { value: '2026-08-19.0' }), {
    label: 'Overture release',
    options: undefined
  });
  assert.equal(resolveUrbanContextStatusText(null, {
    buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0'
  }), 'Not requested');
  assert.equal(resolveUrbanContextStatusText({
    status: 'local-benchmark', source: 'local-geojson', release: '2026-08-19.0', failureCategory: null
  }, {
    buildingSource: 'local-geojson', overtureRelease: '2026-08-19.0'
  }), 'Local benchmark');
  assert.equal(resolveUrbanContextStatusText({
    status: 'available', source: 'overture-pmtiles', release: '2026-08-19.0', failureCategory: null
  }, {
    buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0'
  }), 'Available');
});

test('preview host restores transient selection silently when a Story refresh recreates the adapter', async () => {
  const windowRef = fakeWindow();
  const posted = [];
  const adapters = [];
  windowRef.parent = { postMessage(message) { posted.push(message); } };
  windowRef.document.getElementById = (id) => id === 'scene-compositor' ? {} : null;
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver() { return { manifestUrl: new URL('https://editor.example/project.json'), fetchImpl() {}, resolveAssetUrl() {}, revoke() {} }; },
    createAuthoringAdapter(options) {
      const calls = [];
      const adapter = {
        calls,
        setMode(mode) { calls.push(['mode', mode]); },
        selectOverlay(id, selectionOptions) { calls.push(['select', id, selectionOptions]); },
        destroy() { calls.push(['destroy']); }
      };
      adapters.push({ adapter, emit: options.emit });
      return adapter;
    },
    async startProductionApplication() { return { map: { loaded: () => true }, project: { story: { schemaVersion: '1.2' } }, destroy() {} }; }
  });
  await host.start({ revision: 1, entries: [] });
  windowRef.emit('message', {
    source: windowRef.parent,
    origin: windowRef.location.origin,
    data: envelope('command', 1, { name: 'authoring-selection', payload: { id: 'image' } })
  });
  await host.start({ revision: 2, entries: [] });
  assert.deepEqual(adapters[0].adapter.calls, [
    ['mode', 'select'],
    ['select', 'image', { emitSelection: false, focus: false }],
    ['destroy']
  ]);
  assert.deepEqual(adapters[1].adapter.calls, [
    ['mode', 'select'],
    ['select', 'image', { emitSelection: false, focus: false }]
  ]);
  assert.equal(posted.filter(({ type }) => type === 'editor-preview:select-overlay').length, 0,
    'parent-driven selection and chrome restoration do not echo selection events');
  await host.dispose();
});

test('preview host locates validated GeoJSON without authoring Story camera or using private map IDs', async () => {
  const windowRef = fakeWindow();
  const posted = [];
  const calls = [];
  windowRef.matchMedia = () => ({ matches: true });
  windowRef.parent = { postMessage(message) { posted.push(message); } };
  const resources = new Map([
    ['route', { descriptor: { type: 'geojson' }, value: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[1, 2], [5, 8], [-2, 4]] } }
    ] } }],
    ['stop', { descriptor: { type: 'geojson' }, value: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [106.7, 10.8] } }
    ] } }],
    ['empty', { descriptor: { type: 'geojson' }, value: { type: 'FeatureCollection', features: [] } }],
    ['table', { descriptor: { type: 'table-json' }, value: { columns: [], rows: [] } }]
  ]);
  const story = { states: [{ map: { camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } } }] };
  const history = [];
  let moveend;
  const map = {
    loaded: () => true,
    fitBounds(bounds, options) { calls.push(['fitBounds', bounds, options]); },
    easeTo(options) { calls.push(['easeTo', options]); },
    getMaxZoom: () => 20,
    getCenter: () => ({ lng: 3, lat: 5 }),
    getBounds: () => ({
      getSouthWest: () => ({ lng: -2, lat: 2 }),
      getNorthEast: () => ({ lng: 5, lat: 8 })
    }),
    getZoom: () => 10,
    getPitch: () => 0,
    getBearing: () => 0,
    on(type, listener) { if (type === 'moveend') moveend = listener; },
    off() {}
  };
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver() { return { manifestUrl: new URL('https://editor.example/project.json'), fetchImpl() {}, resolveAssetUrl() {}, revoke() {} }; },
    async startProductionApplication() { return { map, project: { resources, story }, history, destroy() {} }; }
  });
  await host.start({ revision: 7, entries: [] }, 'start-7');
  const beforeStory = structuredClone(story);
  const send = (datasetId, revision = 7, extra = {}) => windowRef.emit('message', {
    source: windowRef.parent,
    origin: windowRef.location.origin,
    data: envelope('command', revision, { name: 'locate-project-layer', payload: { datasetId, ...extra } }, `locate-${datasetId}`)
  });

  send('route');
  assert.deepEqual(calls[0], ['fitBounds', [[-2, 2], [5, 8]], {
    padding: 48, maxZoom: 16, duration: 0, essential: false
  }]);
  const cameraEventsBeforeMove = posted.filter(({ type }) => type === 'editor-preview:camera').length;
  moveend();
  assert.equal(posted.filter(({ type }) => type === 'editor-preview:camera').length, cameraEventsBeforeMove + 1,
    'existing moveend telemetry reports the located working camera');
  send('stop');
  assert.deepEqual(calls[1], ['easeTo', {
    center: [106.7, 10.8], zoom: 15, duration: 0, essential: false
  }]);
  send('empty');
  assert.equal(calls.length, 2);
  assert.equal(posted.some(({ type, payload }) => type === 'editor-preview:locate-result'
    && payload.datasetId === 'empty' && payload.status === 'empty'
    && payload.message === 'Layer has no features to locate.'), true);
  send('missing');
  send('table');
  send('route', 6);
  send('route', 7, { sourceId: 'private-source' });
  assert.equal(calls.length, 2, 'unknown, non-GeoJSON, stale, and extra-key commands are rejected safely');
  assert.deepEqual(story, beforeStory, 'Locate never authors the Story camera');
  assert.deepEqual(history, [], 'Locate creates no history entry');
  await host.dispose();
});
