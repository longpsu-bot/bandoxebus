import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewBridge, validatePreviewSnapshot } from '../editor/preview/bridge.js';

function captureHarness(options = {}) {
  const listeners = new Map();
  const posted = [];
  const iframe = { dataset: { previewSrc: '../?editorPreview=1' }, contentWindow: { postMessage: (message) => posted.push(message) },
    addEventListener(type, listener) { listeners.set(`frame:${type}`, listener); }, removeEventListener() {} };
  const bridge = createPreviewBridge({ iframe, origin: 'https://editor.example', windowRef: {
    addEventListener(type, listener) { listeners.set(type, listener); }, removeEventListener() {}
  }, ...options });
  const start = (revision = 1) => bridge.start({ revision, snapshot: { revision, entries: [] } });
  const emit = (type, payload, requestId, revision = 1) => listeners.get('message')({ source: iframe.contentWindow,
    origin: 'https://editor.example', data: { protocol: 1, type: `editor-preview:${type}`, revision, requestId, payload } });
  start();
  emit('ready', {}, null);
  emit('loaded', {}, posted.find(({ type }) => type === 'editor-preview:start').requestId);
  return { bridge, posted, start, emit, listeners };
}

const camera = { index: 4, center: [106.6, 11.13], zoom: 13.6, pitch: 52, bearing: -10,
  bounds: [[106.58, 11.11], [106.62, 11.15]] };

test('camera capture resolves only the matching bounded request and current revision', async () => {
  const { bridge, posted, emit } = captureHarness();
  let resolved = false;
  const promise = bridge.captureSceneCamera(4).then((value) => { resolved = true; return value; });
  const request = posted.at(-1);
  assert.equal(request.type, 'editor-preview:command');
  assert.deepEqual(request.payload, { name: 'capture-scene-camera', payload: { index: 4 } });
  emit('freeze-camera', camera, 'wrong');
  emit('freeze-camera', camera, request.requestId, 0);
  emit('freeze-camera', { ...camera, index: 3 }, request.requestId);
  await Promise.resolve();
  assert.equal(resolved, false);
  emit('freeze-camera', camera, request.requestId);
  assert.deepEqual(await promise, camera);
  bridge.dispose();
});

test('pending camera captures reject promptly on replacement reset load disposal and command errors', async () => {
  for (const action of ['replace', 'reset', 'load', 'dispose', 'error']) {
    const harness = captureHarness();
    const promise = harness.bridge.captureSceneCamera(4);
    const rejected = assert.rejects(promise, /capture|replaced|reset|load|disposed|broken/i);
    if (action === 'replace') harness.start(2);
    if (action === 'reset') harness.bridge.reset();
    if (action === 'load') harness.listeners.get('frame:load')();
    if (action === 'dispose') harness.bridge.dispose();
    if (action === 'error') harness.emit('runtime-error', { code: 'FREEZE_CAPTURE_FAILED', path: '$', message: 'broken camera' }, harness.posted.at(-1).requestId);
    await rejected;
    harness.bridge.dispose();
  }
});

test('camera capture without a reply times out instead of leaving the Freeze UI busy', async () => {
  const { bridge } = captureHarness({ cameraCaptureTimeoutMs: 5 });
  await assert.rejects(bridge.captureSceneCamera(0), /timed out/i);
  bridge.dispose();
});

test('camera response deadline budgets bounded settlement of every predecessor plus readiness margin', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { bridge } = captureHarness();
  t.after(() => bridge.dispose());
  let status = 'pending';
  const promise = bridge.captureSceneCamera(4).then(() => { status = 'resolved'; }, (error) => { status = error.message; });
  t.mock.timers.tick(15000);
  await Promise.resolve();
  assert.equal(status, 'pending', 'four settled predecessors must not consume the old fixed response deadline');
  t.mock.timers.tick(39999);
  await Promise.resolve();
  assert.equal(status, 'pending');
  t.mock.timers.tick(1);
  await promise;
  assert.match(status, /timed out/i);
});

test('capture rejects indices whose replay deadline would overflow platform timers', async () => {
  const { bridge } = captureHarness();
  for (const index of [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER, 214749]) {
    await assert.rejects(bridge.captureSceneCamera(index), /index|deadline/i);
  }
  bridge.dispose();
});

test('camera capture waits for the requested preview runtime to load', async () => {
  const { bridge, posted, start, emit } = captureHarness();
  start(2);
  const startId = posted.at(-1).requestId;
  const promise = bridge.captureSceneCamera(4);
  assert.equal(posted.at(-1).type, 'editor-preview:start');
  emit('loaded', {}, startId, 2);
  assert.equal(posted.at(-1).payload.name, 'capture-scene-camera');
  emit('freeze-camera', camera, posted.at(-1).requestId, 2);
  assert.deepEqual(await promise, camera);
  bridge.dispose();
});

test('capture queued for an output-mode navigation survives its expected iframe load', async () => {
  const { bridge, posted, listeners, emit } = captureHarness();
  bridge.start({ revision: 1, snapshot: { revision: 1, entries: [] } }, { outputMode: 'presentation' });
  const promise = bridge.captureSceneCamera(4);
  listeners.get('frame:load')();
  emit('ready', {}, posted.at(-1).requestId);
  emit('loaded', {}, posted.at(-1).requestId);
  emit('freeze-camera', camera, posted.at(-1).requestId);
  assert.deepEqual(await promise, camera);
  bridge.dispose();
});

function pmtilesEntry(file = new File(['PMTiles'], 'overture-buildings.pmtiles')) {
  return { path: 'assets/context/overture-buildings.pmtiles', file, mediaType: 'application/vnd.pmtiles', kind: 'asset' };
}

test('preview accepts exact byte and PMTiles File entry shapes after structured clone', () => {
  const snapshot = structuredClone({ revision: 1, entries: [
    { path: 'project.json', bytes: new TextEncoder().encode('{}'), mediaType: 'application/json', kind: 'manifest' },
    pmtilesEntry()
  ] });
  assert.equal(validatePreviewSnapshot(snapshot), snapshot);
});

test('preview rejects file-backed non-assets, non-PMTiles, invalid Files, and extra entry fields', () => {
  const entry = pmtilesEntry();
  const nonfiniteFile = new File([], 'invalid.pmtiles');
  Object.defineProperty(nonfiniteFile, 'size', { value: Infinity });
  for (const invalid of [
    { ...entry, mediaType: 'application/json' },
    { ...entry, mediaType: 'image/png' },
    { ...entry, kind: 'dataset' },
    { ...entry, file: { size: 1 } },
    { ...entry, file: nonfiniteFile },
    { ...entry, bytes: new Uint8Array() },
    { ...entry, byteLength: 7 },
    { path: 'data.json', bytes: new Uint8Array(), mediaType: 'application/json', kind: 'dataset', file: undefined }
  ]) {
    assert.throws(() => validatePreviewSnapshot({ revision: 1, entries: [invalid] }), TypeError);
  }
});

test('preview counts PMTiles File sizes together with bytes against the 256 MiB ceiling', () => {
  const file = new File([new Uint8Array(1024 * 1024)], 'one-mib.pmtiles');
  const entries = Array.from({ length: 256 }, (_, index) => ({ ...pmtilesEntry(file), path: `assets/${index}.pmtiles` }));
  assert.doesNotThrow(() => validatePreviewSnapshot({ revision: 1, entries }));
  entries.push({ path: 'extra.bin', bytes: new Uint8Array(1), mediaType: 'application/octet-stream', kind: 'resource' });
  assert.throws(() => validatePreviewSnapshot({ revision: 1, entries }), /oversized/i);
});
