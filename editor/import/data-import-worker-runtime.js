import { createDataImportSession } from './data-import.js';

const STATUS_PHASES = Object.freeze({
  reading: 'Reading',
  parsing: 'Parsing',
  inferring: 'Inferring',
  reprojecting: 'Reprojecting',
  preparing: 'Preparing preview'
});

function phaseFor(status, fallback = 'Parsing') {
  return STATUS_PHASES[String(status ?? '').toLowerCase()] ?? fallback;
}

function inputFile(input) {
  if (input?.file) return input.file;
  if (!input?.name || !(input.bytes instanceof ArrayBuffer)) {
    throw new TypeError('Worker received an invalid local file input.');
  }
  const bytes = input.bytes;
  return Object.freeze({
    name: String(input.name),
    size: Number(input.size ?? bytes.byteLength),
    type: String(input.type ?? ''),
    lastModified: Number(input.lastModified ?? 0),
    async arrayBuffer() { return bytes; }
  });
}

function boundedError(error, phase) {
  return {
    phase,
    code: String(error?.code || 'IMPORT_FAILED').slice(0, 80),
    message: String(error?.message || 'Data import failed.').slice(0, 1000),
    recoverable: true
  };
}

export function createDataImportWorkerRuntime({
  scope = globalThis,
  loaders,
  createSession = createDataImportSession
} = {}) {
  if (!scope?.addEventListener || !scope?.postMessage) throw new TypeError('Data import worker requires a worker scope.');
  let session;
  let busy = false;
  let currentPhase = 'Reading';

  function post(message) {
    scope.postMessage(message);
  }

  function disposeSession() {
    session?.dispose?.();
    session = undefined;
  }

  function progress(base, status) {
    currentPhase = phaseFor(status, currentPhase);
    if (['ready', 'prepared', 'disposed'].includes(String(status).toLowerCase())) return;
    post({ type: 'progress', sessionId: base.sessionId, requestId: base.requestId, phase: currentPhase });
  }

  async function read(message) {
    disposeSession();
    const files = Array.from(message.inputs ?? [], inputFile);
    session = createSession({
      files,
      loaders,
      usedIds: Array.from(message.usedIds ?? []),
      replacement: message.replacement,
      onStatus: (status) => progress(message, status)
    });
    const sourceItems = await session.read();
    post({
      type: 'result', sessionId: message.sessionId, requestId: message.requestId,
      operation: 'read', format: session.state().format, sourceItems
    });
  }

  async function prepare(message) {
    if (!session) throw new TypeError('Read the selected data before preparing it.');
    session.selectSourceItem(message.itemId);
    session.configure(message.config ?? {});
    const candidates = await session.prepare();
    post({
      type: 'result', sessionId: message.sessionId, requestId: message.requestId,
      operation: 'prepare', candidates
    });
  }

  async function start(message) {
    if (busy) {
      post({
        type: 'error', sessionId: message.sessionId, requestId: message.requestId,
        phase: currentPhase, code: 'IMPORT_BUSY', message: 'A data import operation is already running.', recoverable: true
      });
      return;
    }
    busy = true;
    currentPhase = message.operation === 'prepare' ? 'Preparing preview' : 'Reading';
    try {
      if (message.operation === 'read') await read(message);
      else if (message.operation === 'prepare') await prepare(message);
      else throw Object.assign(new TypeError(`Unsupported worker operation: ${message.operation}.`), { code: 'INVALID_OPERATION' });
    } catch (error) {
      const bounded = boundedError(error, currentPhase);
      if (message.operation === 'read') disposeSession();
      post({ type: 'error', sessionId: message.sessionId, requestId: message.requestId, ...bounded });
    } finally {
      busy = false;
    }
  }

  function handleMessage(message) {
    if (!message || !Number.isInteger(message.sessionId) || !Number.isInteger(message.requestId)) return;
    if (message.type === 'cancel') {
      disposeSession();
      post({ type: 'cancel', sessionId: message.sessionId, requestId: message.requestId, state: 'cancelled' });
      return;
    }
    if (message.type === 'start') void start(message);
  }

  function onMessage({ data }) {
    handleMessage(data);
  }

  scope.addEventListener('message', onMessage);
  return Object.freeze({ dispose: disposeSession, handleMessage });
}
