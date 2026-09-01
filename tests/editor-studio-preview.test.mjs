import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPreviewBridge,
  PREVIEW_PROTOCOL_VERSION,
  resolvePreviewSourceForSnapshot
} from '../editor/preview/bridge.js';
import { startEditorPreviewHost } from '../editor/preview/package-resolver.js';

const encoder = new TextEncoder();

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
  bridge.command('restore-scene-camera', { index: 2 });

  const commands = posted.filter(({ message }) => message.type === 'editor-preview:command').map(({ message }) => message.payload);
  assert.deepEqual(commands, [
    { name: 'activate-scene', payload: { index: 2, animate: false } },
    { name: 'authoring-mode', payload: { mode: 'map' } },
    { name: 'restore-scene-camera', payload: { index: 2 } }
  ]);
  assert.throws(() => bridge.command('activate-scene', { index: 2, animate: false, method: 'evil' }), /invalid preview command/i);
  assert.throws(() => bridge.command('authoring-mode', { mode: 'pan-only' }), /invalid preview command/i);
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
