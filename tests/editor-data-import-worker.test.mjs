import assert from 'node:assert/strict';
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
  session.dispose();
  session.dispose();
  assert.equal(worker.terminated, 1);
});
