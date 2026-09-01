import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function workerModule() {
  try {
    return await import('../editor/import/data-import-worker-client.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

function file(name, contents = 'value', type = 'application/octet-stream') {
  return new File([contents], name, { type });
}

function fakeWorkers() {
  const instances = [];
  class FakeWorker {
    constructor(url, options = {}) {
      this.url = url;
      this.options = options;
      this.listeners = new Map();
      this.messages = [];
      this.terminated = 0;
      instances.push(this);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((value) => value !== listener));
    }
    postMessage(message, transfer = []) { this.messages.push({ message, transfer }); }
    emit(type, value) {
      const event = type === 'message' ? { data: value } : value;
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
    terminate() { this.terminated += 1; }
  }
  return { Ctor: FakeWorker, instances };
}

test('module worker is the default and CSV is the sole evidenced classic fallback', async () => {
  const api = await workerModule();
  assert.equal(typeof api.createDataImportWorkerClient, 'function');
  assert.equal(typeof api.selectDataImportExecution, 'function');
  const workers = fakeWorkers();

  api.createDataImportWorkerClient({ files: [file('data.geojson')], WorkerCtor: workers.Ctor });
  api.createDataImportWorkerClient({ files: [file('data.csv')], WorkerCtor: workers.Ctor });

  assert.match(workers.instances[0].url.href, /data-import-worker\.js$/);
  assert.deepEqual(workers.instances[0].options, { type: 'module' });
  assert.match(workers.instances[1].url.href, /data-import-worker-classic\.js$/);
  assert.deepEqual(workers.instances[1].options, {});
  assert.equal(api.selectDataImportExecution([file('route.kml')]), 'main-thread-xml');
  assert.equal(api.selectDataImportExecution([file('route.kmz')]), 'main-thread-xml');
  assert.equal(api.selectDataImportExecution([file('route.gpx')]), 'main-thread-xml');
  for (const name of ['data.json', 'data.xlsx', 'data.zip', 'data.shp', 'data.gpkg', 'data.xyz']) {
    assert.equal(api.selectDataImportExecution([file(name)]), 'module', name);
  }
});

test('worker client transfers binary inputs and accepts only the matching result', async () => {
  const { createDataImportWorkerClient } = await workerModule();
  assert.equal(typeof createDataImportWorkerClient, 'function');
  const workers = fakeWorkers();
  const statuses = [];
  const times = [110, 145];
  const session = createDataImportWorkerClient({
    files: [file('points.geojson', '{"type":"FeatureCollection","features":[]}')],
    WorkerCtor: workers.Ctor,
    now: () => times.shift(),
    onStatus: (status) => statuses.push(status)
  });

  const reading = session.read();
  await new Promise((resolve) => setImmediate(resolve));
  const worker = workers.instances[0];
  assert.equal(worker.messages.length, 1);
  const posted = worker.messages[0];
  assert.equal(posted.message.type, 'start');
  assert.equal(posted.message.operation, 'read');
  assert.equal(posted.message.inputs[0].name, 'points.geojson');
  assert.equal(posted.message.inputs[0].bytes instanceof ArrayBuffer, true);
  assert.deepEqual(posted.transfer, [posted.message.inputs[0].bytes]);

  worker.emit('message', {
    type: 'result', sessionId: posted.message.sessionId + 1, requestId: posted.message.requestId,
    operation: 'read', format: 'geojson', sourceItems: [{ id: 'stale', label: 'Stale' }]
  });
  worker.emit('message', {
    type: 'progress', sessionId: posted.message.sessionId, requestId: posted.message.requestId,
    phase: 'Parsing', message: 'Parsing local GeoJSON'
  });
  worker.emit('message', {
    type: 'result', sessionId: posted.message.sessionId, requestId: posted.message.requestId,
    operation: 'read', format: 'geojson', sourceItems: [{ id: 'points', label: 'Points' }]
  });

  assert.deepEqual(await reading, [{ id: 'points', label: 'Points' }]);
  assert.deepEqual(statuses, ['reading', 'Parsing', 'ready']);
  assert.equal(session.state().timing.lastResultReceivedAt, 110);
  assert.equal(session.state().timing.lastResultRequestId, posted.message.requestId);
});

test('worker client preserves transient candidate controls and result receipt timing', async () => {
  const { createDataImportWorkerClient } = await workerModule();
  const workers = fakeWorkers();
  const session = createDataImportWorkerClient({ files: [file('data.csv', 'x,y\n1,2')], WorkerCtor: workers.Ctor, now: () => 250 });
  const reading = session.read();
  await new Promise((resolve) => setImmediate(resolve));
  const worker = workers.instances[0];
  const read = worker.messages[0].message;
  assert.equal(read.inputs[0].file instanceof File, true);
  assert.deepEqual(worker.messages[0].transfer, []);
  worker.emit('message', {
    type: 'result', sessionId: read.sessionId, requestId: read.requestId, operation: 'read', format: 'csv',
    sourceItems: [{ id: 'data', label: 'Data' }]
  });
  await reading;

  session.selectSourceItem('data');
  session.configure({ mode: 'table', headerRow: 0 });
  const preparing = session.prepare();
  const prepare = worker.messages.at(-1).message;
  assert.equal(prepare.operation, 'prepare');
  assert.equal(prepare.itemId, 'data');
  assert.deepEqual(prepare.config, { mode: 'table', headerRow: 0 });
  const candidate = { kind: 'table', id: 'data', label: 'Data', value: { schemaVersion: '1.0', columns: [], rows: [] } };
  worker.emit('message', {
    type: 'result', sessionId: prepare.sessionId, requestId: prepare.requestId, operation: 'prepare', candidates: [candidate]
  });
  assert.deepEqual(await preparing, [candidate]);
  assert.equal(session.candidate('data'), candidate);
  assert.equal(session.state().timing.lastResultReceivedAt, 250);
});

test('worker cancellation terminates immediately, rejects work, and ignores late messages', async () => {
  const { createDataImportWorkerClient } = await workerModule();
  const workers = fakeWorkers();
  const session = createDataImportWorkerClient({ files: [file('large.csv', 'a,b\n1,2')], WorkerCtor: workers.Ctor });
  const reading = session.read();
  await new Promise((resolve) => setImmediate(resolve));
  const worker = workers.instances[0];
  const request = worker.messages[0].message;

  session.cancel('user');
  await assert.rejects(reading, /cancelled/i);
  assert.equal(worker.messages.at(-1).message.type, 'cancel');
  assert.equal(worker.messages.at(-1).message.reason, 'user');
  assert.equal(worker.terminated, 1);
  worker.emit('message', {
    type: 'result', sessionId: request.sessionId, requestId: request.requestId,
    operation: 'read', format: 'csv', sourceItems: [{ id: 'late', label: 'Late' }]
  });
  assert.deepEqual(session.state().sourceItems, []);
  session.dispose();
  session.dispose();
  assert.equal(worker.terminated, 1);
});

test('worker errors are bounded and dispose terminates an idle worker once', async () => {
  const { createDataImportWorkerClient } = await workerModule();
  const workers = fakeWorkers();
  const session = createDataImportWorkerClient({ files: [file('data.gpkg')], WorkerCtor: workers.Ctor });
  const reading = session.read();
  await new Promise((resolve) => setImmediate(resolve));
  const worker = workers.instances[0];
  const request = worker.messages[0].message;
  worker.emit('message', {
    type: 'error', sessionId: request.sessionId, requestId: request.requestId,
    phase: 'Parsing', code: 'INVALID_SOURCE', message: 'GeoPackage cannot be opened', recoverable: true,
    stack: 'parser internals must not cross into the UI'
  });
  await assert.rejects(reading, (error) => error.message === 'GeoPackage cannot be opened' && error.code === 'INVALID_SOURCE' && !error.stack.includes('parser internals'));
  assert.equal(worker.terminated, 1, 'a failed worker realm must not be retained for retry');
  assert.equal(session.state().disposed, true);
  session.dispose();
  session.dispose();
  assert.equal(worker.terminated, 1);
});

function workerScope() {
  const listeners = new Map();
  const posted = [];
  return {
    posted,
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    postMessage(message) { posted.push(message); },
    emit(message) { for (const listener of listeners.get('message') ?? []) listener({ data: message }); }
  };
}

async function flushWorker() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('worker runtime executes bounded read and prepare operations through the existing session contract', async () => {
  const runtimeApi = await import('../editor/import/data-import-worker-runtime.js');
  assert.equal(typeof runtimeApi.createDataImportWorkerRuntime, 'function');
  const scope = workerScope();
  const events = [];
  const candidate = { kind: 'table', id: 'table', label: 'Table', value: { schemaVersion: '1.0', columns: [], rows: [] } };
  const createSession = ({ files, usedIds, replacement, onStatus }) => {
    events.push(['create', files.map(({ name }) => name), usedIds, replacement]);
    let selected;
    let config;
    return {
      async read() { onStatus('reading'); return [{ id: 'table', label: 'Table' }]; },
      selectSourceItem(id) { selected = id; },
      configure(value) { config = value; },
      async prepare() { onStatus('preparing'); events.push(['prepare', selected, config]); return [candidate]; },
      state() { return { format: 'json' }; },
      dispose() { events.push('dispose'); }
    };
  };
  runtimeApi.createDataImportWorkerRuntime({ scope, loaders: {}, createSession });
  const bytes = new TextEncoder().encode('{}').buffer;
  scope.emit({
    type: 'start', sessionId: 7, requestId: 1, operation: 'read',
    inputs: [{ name: 'table.json', size: bytes.byteLength, type: 'application/json', bytes }],
    usedIds: ['existing'], replacement: { type: 'table-json' }
  });
  await flushWorker();
  assert.deepEqual(events[0], ['create', ['table.json'], ['existing'], { type: 'table-json' }]);
  assert.equal(scope.posted[0].type, 'progress');
  assert.equal(scope.posted[0].phase, 'Reading');
  assert.deepEqual(scope.posted.at(-1), {
    type: 'result', sessionId: 7, requestId: 1, operation: 'read', format: 'json',
    sourceItems: [{ id: 'table', label: 'Table' }]
  });

  scope.emit({
    type: 'start', sessionId: 7, requestId: 2, operation: 'prepare', itemId: 'table',
    config: { headerRow: 0 }
  });
  await flushWorker();
  assert.deepEqual(events[1], ['prepare', 'table', { headerRow: 0 }]);
  assert.equal(scope.posted.some(({ type, phase }) => type === 'progress' && phase === 'Preparing preview'), true);
  assert.deepEqual(scope.posted.at(-1), {
    type: 'result', sessionId: 7, requestId: 2, operation: 'prepare', candidates: [candidate]
  });
});

test('worker runtime bounds errors and cooperatively disposes on cancellation', async () => {
  const { createDataImportWorkerRuntime } = await import('../editor/import/data-import-worker-runtime.js');
  const scope = workerScope();
  let disposed = 0;
  createDataImportWorkerRuntime({
    scope,
    loaders: {},
    createSession: () => ({
      async read() { const error = new TypeError('Invalid local source'); error.code = 'INVALID_SOURCE'; throw error; },
      state() { return {}; },
      dispose() { disposed += 1; }
    })
  });
  scope.emit({
    type: 'start', sessionId: 9, requestId: 1, operation: 'read',
    inputs: [{ name: 'bad.json', size: 1, bytes: new Uint8Array([0]).buffer }]
  });
  await flushWorker();
  assert.deepEqual(scope.posted.at(-1), {
    type: 'error', sessionId: 9, requestId: 1, phase: 'Reading', code: 'INVALID_SOURCE',
    message: 'Invalid local source', recoverable: true
  });
  assert.equal('stack' in scope.posted.at(-1), false);
  scope.emit({ type: 'cancel', sessionId: 9, requestId: 2, reason: 'user' });
  await flushWorker();
  assert.equal(disposed, 1);
  assert.deepEqual(scope.posted.at(-1), { type: 'cancel', sessionId: 9, requestId: 2, state: 'cancelled' });
});

test('worker loaders keep module-compatible parsers local and bind GeoPackage WASM', async () => {
  const { createWorkerVendorLoaders } = await import('../editor/import/vendor-loaders.js');
  assert.equal(typeof createWorkerVendorLoaders, 'function');
  const calls = [];
  const globalRef = {
    proj4: Object.assign(() => [106, 11], { version: '2.22.0' }),
    Papa: { parse() {} },
    GeoPackage: { setSqljsWasmLocateFile(locate) { calls.push(['wasm', locate('sql-wasm.wasm')]); } }
  };
  const loaders = createWorkerVendorLoaders({
    globalRef,
    resolveUrl: (value) => `local:${value}`,
    importModule: async (value) => {
      calls.push(['import', value]);
      if (value.includes('xlsx.mjs')) return { read() {}, utils: {} };
      if (value.includes('shp.esm')) return { default() {} };
      return {};
    }
  });
  assert.equal(await loaders.loadProj4(), globalRef.proj4);
  assert.equal(await loaders.loadPapaParse(), globalRef.Papa);
  assert.equal(await loaders.loadGeoPackage(), globalRef.GeoPackage);
  assert.equal(typeof (await loaders.loadSheetJs()).read, 'function');
  assert.equal(typeof (await loaders.loadShp()), 'function');
  assert.deepEqual(calls.find(([kind]) => kind === 'wasm'), ['wasm', 'local:../../vendor/data-import/geopackage/4.2.9/sql-wasm.wasm']);
  assert.equal(calls.every(([, value]) => !/^https?:/i.test(value)), true);
});

test('worker entry points share one ESM runtime and isolate the PapaParse fallback', async () => {
  const moduleEntry = await readFile(new URL('../editor/import/data-import-worker.js', import.meta.url), 'utf8');
  const classicEntry = await readFile(new URL('../editor/import/data-import-worker-classic.js', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../editor/import/data-import-worker-runtime.js', import.meta.url), 'utf8');
  assert.match(moduleEntry, /import .*data-import-worker-runtime\.js/);
  assert.doesNotMatch(moduleEntry, /importScripts|papaparse/i);
  assert.match(classicEntry, /importScripts\([^)]*papaparse\/5\.7\.0\/papaparse\.min\.js/);
  assert.match(classicEntry, /import\(['"]\.\/data-import-worker-runtime\.js['"]\)/);
  assert.ok(classicEntry.indexOf("addEventListener('message'") >= 0, 'classic bootstrap must install a buffer listener');
  assert.ok(classicEntry.indexOf("addEventListener('message'") < classicEntry.indexOf('Promise.all('), 'classic bootstrap must buffer messages before asynchronous ESM loading');
  assert.match(classicEntry, /runtime\.handleMessage\(message\)/);
  assert.doesNotMatch(classicEntry, /shpjs|sheetjs|geopackage|proj4/i);
  assert.doesNotMatch(runtime, /package-store|draft-store|scene-commands|writeValidatedResource|editor\.js/i);
});

test('responsive session routing keeps XML local and sends heavy formats to the worker client', async () => {
  const { createResponsiveDataImportSession } = await import('../editor/import/data-import.js');
  assert.equal(typeof createResponsiveDataImportSession, 'function');
  const calls = [];
  const direct = { state: () => ({ route: 'direct' }) };
  const worker = { state: () => ({ route: 'worker' }) };
  const directFactory = (options) => { calls.push(['direct', options.files[0].name]); return direct; };
  const workerFactory = (options) => { calls.push(['worker', options.files[0].name]); return worker; };
  assert.equal(createResponsiveDataImportSession({ files: [file('route.kml')], directFactory, workerFactory }), direct);
  assert.equal(createResponsiveDataImportSession({ files: [file('table.csv')], directFactory, workerFactory }), worker);
  assert.equal(createResponsiveDataImportSession({ files: [file('data.gpkg')], directFactory, workerFactory }), worker);
  assert.deepEqual(calls, [['direct', 'route.kml'], ['worker', 'table.csv'], ['worker', 'data.gpkg']]);
});
