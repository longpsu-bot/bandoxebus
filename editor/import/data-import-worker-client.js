let nextSessionId = 1;

function extension(name) {
  const match = /(?:^|\/)([^/]+?)(\.[^.\/]+)$/.exec(String(name ?? '').replaceAll('\\', '/'));
  return match ? match[2].toLowerCase() : '';
}

export function selectDataImportExecution(files) {
  const extensions = Array.from(files ?? [], ({ name }) => extension(name));
  if (extensions.length === 1 && extensions[0] === '.csv') return 'classic-papaparse';
  if (extensions.length === 1 && ['.kml', '.kmz', '.gpx'].includes(extensions[0])) return 'main-thread-xml';
  return 'module';
}

function cancellationError(reason) {
  const error = new Error(`Data import cancelled${reason ? `: ${reason}` : '.'}`);
  error.name = 'AbortError';
  error.code = 'IMPORT_CANCELLED';
  return error;
}

function workerError(message) {
  const error = new Error(String(message?.message || 'Data import worker failed.'));
  error.name = 'DataImportError';
  if (message?.code) error.code = String(message.code);
  error.phase = message?.phase;
  error.recoverable = Boolean(message?.recoverable);
  return error;
}

function replacementError(candidate, replacement) {
  if (!replacement) return undefined;
  const replacementKind = replacement.kind ?? (replacement.type === 'geojson' ? 'spatial'
    : replacement.type === 'table-json' ? 'table' : undefined);
  if (candidate.kind !== replacementKind) return `Replacement is incompatible; expected ${replacementKind} data.`;
  if (candidate.kind === 'spatial' && candidate.geometry !== replacement.geometry) {
    return `Replacement is incompatible; expected ${replacement.geometry} geometry.`;
  }
  return undefined;
}

async function encodeInputs(files, execution) {
  if (execution === 'classic-papaparse') {
    return { inputs: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      file
    })), transfer: [] };
  }
  const inputs = [];
  const transfer = [];
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    inputs.push({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      bytes
    });
    transfer.push(bytes);
  }
  return { inputs, transfer };
}

export function createDataImportWorkerClient({
  files: selectedFiles,
  usedIds = [],
  replacement,
  WorkerCtor = globalThis.Worker,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  onStatus = () => {}
} = {}) {
  const files = Array.from(selectedFiles ?? []);
  const execution = selectDataImportExecution(files);
  if (execution === 'main-thread-xml') throw new TypeError('KML, KMZ, and GPX use the bounded main-thread import session.');
  if (typeof WorkerCtor !== 'function') throw new TypeError('Data import workers are unavailable in this browser.');

  const moduleUrl = new URL('./data-import-worker.js', import.meta.url);
  const classicUrl = new URL('./data-import-worker-classic.js', import.meta.url);
  const worker = execution === 'classic-papaparse'
    ? new WorkerCtor(classicUrl, {})
    : new WorkerCtor(moduleUrl, { type: 'module' });
  const sessionId = nextSessionId++;
  let nextRequestId = 1;
  let pending;
  let disposed = false;
  let terminated = false;
  let status = 'idle';
  let format;
  let sourceItems = [];
  let selectedItemId;
  let config = {};
  let candidates = [];
  let lastResultReceivedAt;
  let lastResultRequestId;

  function setStatus(value) {
    status = value;
    onStatus(value);
  }

  function assertActive() {
    if (disposed) throw new TypeError('Data import session is disposed.');
  }

  function terminate() {
    if (terminated) return;
    terminated = true;
    worker.removeEventListener?.('message', onMessage);
    worker.removeEventListener?.('error', onWorkerFailure);
    worker.terminate();
  }

  function settle(kind, value) {
    const current = pending;
    if (!current) return;
    pending = undefined;
    if (kind === 'resolve') current.resolve(value);
    else current.reject(value);
  }

  function onMessage({ data: message }) {
    if (disposed || !pending || !message
      || message.sessionId !== sessionId || message.requestId !== pending.requestId) return;
    if (message.type === 'progress') {
      setStatus(message.phase || message.message || status);
      return;
    }
    if (message.type === 'error') {
      status = 'error';
      settle('reject', workerError(message));
      disposed = true;
      sourceItems = [];
      candidates = [];
      terminate();
      return;
    }
    if (message.type === 'cancel') {
      settle('reject', cancellationError(message.reason));
      return;
    }
    if (message.type !== 'result' || message.operation !== pending.operation) return;
    lastResultReceivedAt = now();
    lastResultRequestId = message.requestId;
    if (message.operation === 'read') {
      format = message.format;
      sourceItems = Array.isArray(message.sourceItems) ? message.sourceItems : [];
      setStatus('ready');
      settle('resolve', [...sourceItems]);
      return;
    }
    candidates = Array.isArray(message.candidates) ? message.candidates : [];
    setStatus('prepared');
    settle('resolve', [...candidates]);
  }

  function onWorkerFailure(event) {
    if (!pending || disposed) return;
    status = 'error';
    settle('reject', workerError({ code: 'WORKER_FAILURE', message: event?.message || 'Data import worker failed.' }));
    disposed = true;
    sourceItems = [];
    candidates = [];
    terminate();
  }

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onWorkerFailure);

  function request(operation, message, transfer = []) {
    assertActive();
    if (pending) throw new TypeError('A data import operation is already running.');
    const requestId = nextRequestId++;
    const promise = new Promise((resolve, reject) => { pending = { operation, requestId, resolve, reject }; });
    worker.postMessage({ type: 'start', sessionId, requestId, operation, ...message }, transfer);
    return promise;
  }

  return Object.freeze({
    async read() {
      assertActive();
      if (sourceItems.length) return [...sourceItems];
      setStatus('reading');
      try {
        const encoded = await encodeInputs(files, execution);
        return await request('read', { inputs: encoded.inputs, usedIds: [...usedIds], replacement }, encoded.transfer);
      } catch (error) {
        if (!disposed) status = 'error';
        throw error;
      }
    },
    selectSourceItem(itemId) {
      assertActive();
      if (!sourceItems.some(({ id }) => id === itemId)) throw new TypeError(`Unknown source item: ${itemId}.`);
      selectedItemId = itemId;
      candidates = [];
    },
    configure(patch) {
      assertActive();
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Import configuration must be an object.');
      config = { ...config, ...patch };
      candidates = [];
    },
    async prepare() {
      assertActive();
      if (!sourceItems.length) throw new TypeError('Read the selected data before preparing it.');
      if (!selectedItemId) throw new TypeError('Select a source item before preparing data.');
      setStatus('preparing');
      try {
        return await request('prepare', { itemId: selectedItemId, config: { ...config } });
      } catch (error) {
        if (!disposed) status = 'error';
        throw error;
      }
    },
    candidate(candidateId) {
      assertActive();
      const candidate = candidates.find(({ id }) => id === candidateId);
      if (!candidate) throw new TypeError(`Unknown prepared candidate: ${candidateId}.`);
      const incompatible = replacementError(candidate, replacement);
      if (incompatible) throw new TypeError(incompatible);
      return candidate;
    },
    cancel(reason = 'cancelled') {
      if (disposed) return;
      disposed = true;
      status = 'cancelled';
      if (pending) {
        worker.postMessage({ type: 'cancel', sessionId, requestId: pending.requestId, reason });
        settle('reject', cancellationError(reason));
      }
      terminate();
      sourceItems = [];
      candidates = [];
    },
    dispose(reason = 'disposed') {
      if (disposed) return;
      if (pending) {
        this.cancel(reason);
        return;
      }
      disposed = true;
      status = 'disposed';
      terminate();
      sourceItems = [];
      candidates = [];
    },
    state() {
      return Object.freeze({
        status,
        disposed,
        execution,
        format,
        sourceItems: sourceItems.map((item) => Object.freeze({ ...item })),
        selectedItemId,
        config: Object.freeze({ ...config }),
        candidates: candidates.map((candidate) => Object.freeze({ ...candidate, value: candidate.value })),
        timing: Object.freeze({ sessionId, lastResultRequestId, lastResultReceivedAt })
      });
    }
  });
}
