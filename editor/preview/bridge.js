export const PREVIEW_PROTOCOL_VERSION = 1;
export const PREVIEW_PACKAGE_MAX_BYTES = 256 * 1024 * 1024;
export const PREVIEW_OUTPUT_MODES = Object.freeze(['explore', 'scroll', 'presentation']);

const decoder = new TextDecoder();
const AUTHORING_EVENT_TYPES = new Set([
  'editor-preview:select-overlay',
  'editor-preview:commit-frame',
  'editor-preview:commit-text'
]);
const authoringListeners = new Set();
const EVENT_TYPES = new Set([
  'editor-preview:ready',
  'editor-preview:loaded',
  'editor-preview:runtime-error',
  'editor-preview:state',
  'editor-preview:camera',
  'editor-preview:freeze-camera',
  'editor-preview:locate-result',
  'editor-preview:urban-context-status',
  ...AUTHORING_EVENT_TYPES
]);
const START_RESPONSE_TYPES = new Set([
  'editor-preview:loaded',
  'editor-preview:runtime-error'
]);
const STABLE_ID = /^[a-z][a-z0-9-]*$/;

export function subscribePreviewAuthoringEvents(listener) {
  if (typeof listener !== 'function') throw new TypeError('Preview authoring subscriber must be a function.');
  authoringListeners.add(listener);
  return () => authoringListeners.delete(listener);
}

function publishAuthoringEvent(event) {
  for (const listener of authoringListeners) listener(event);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRequestId(value) {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 128);
}

function validEnvelope(data, types) {
  return hasExactKeys(data, ['protocol', 'type', 'revision', 'requestId', 'payload'])
    && data.protocol === PREVIEW_PROTOCOL_VERSION
    && types.has(data.type)
    && Number.isInteger(data.revision)
    && data.revision >= -1
    && isRequestId(data.requestId)
    && isRecord(data.payload);
}

function validRuntimeError(payload) {
  return hasExactKeys(payload, ['code', 'path', 'message'])
    && typeof payload.code === 'string' && payload.code.length <= 128
    && typeof payload.path === 'string' && payload.path.length <= 2048
    && typeof payload.message === 'string' && payload.message.length <= 4096;
}

function validOverlayId(value) {
  return typeof value === 'string' && value.length <= 128 && STABLE_ID.test(value);
}

function validFrame(frame) {
  if (!hasExactKeys(frame, ['x', 'y', 'width', 'height', 'z'])) return false;
  if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) return false;
  if (frame.x < 0 || frame.y < 0 || frame.width <= 0 || frame.height <= 0) return false;
  if (frame.x > 1 || frame.y > 1 || frame.width > 1 || frame.height > 1) return false;
  if (frame.x + frame.width > 1 || frame.y + frame.height > 1) return false;
  return Number.isInteger(frame.z) && frame.z >= 0 && frame.z <= 9999;
}

function validEventPayload(data) {
  if (data.type === 'editor-preview:ready' || data.type === 'editor-preview:loaded') {
    return hasExactKeys(data.payload, []);
  }
  if (data.type === 'editor-preview:runtime-error') return validRuntimeError(data.payload);
  if (data.type === 'editor-preview:state') return hasExactKeys(data.payload, ['viewport']);
  if (data.type === 'editor-preview:camera') {
    return hasExactKeys(data.payload, ['center', 'zoom', 'pitch', 'bearing', 'bounds']);
  }
  if (data.type === 'editor-preview:freeze-camera') {
    const value = data.payload;
    const pair = (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
    return hasExactKeys(value, ['index', 'center', 'zoom', 'pitch', 'bearing', 'bounds'])
      && Number.isInteger(value.index) && value.index >= 0 && pair(value.center)
      && [value.zoom, value.pitch, value.bearing].every(Number.isFinite)
      && Array.isArray(value.bounds) && value.bounds.length === 2 && value.bounds.every(pair);
  }
  if (data.type === 'editor-preview:locate-result') {
    return hasExactKeys(data.payload, ['datasetId', 'status', 'message'])
      && validOverlayId(data.payload.datasetId)
      && ['located', 'empty', 'error'].includes(data.payload.status)
      && typeof data.payload.message === 'string' && data.payload.message.length <= 4096;
  }
  if (data.type === 'editor-preview:urban-context-status') {
    return hasExactKeys(data.payload, ['status', 'source', 'release', 'failureCategory'])
      && ['not-requested', 'loading', 'available', 'unavailable', 'local-benchmark'].includes(data.payload.status)
      && ['overture-pmtiles', 'local-geojson'].includes(data.payload.source)
      && typeof data.payload.release === 'string'
      && /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.0$/.test(data.payload.release)
      && (data.payload.failureCategory === null
        || (typeof data.payload.failureCategory === 'string' && data.payload.failureCategory.length <= 128));
  }
  if (data.type === 'editor-preview:select-overlay') {
    return hasExactKeys(data.payload, ['id']) && validOverlayId(data.payload.id);
  }
  if (data.type === 'editor-preview:commit-frame') {
    return hasExactKeys(data.payload, ['id', 'frame'])
      && validOverlayId(data.payload.id) && validFrame(data.payload.frame);
  }
  if (data.type === 'editor-preview:commit-text') {
    return hasExactKeys(data.payload, ['id', 'text'])
      && validOverlayId(data.payload.id)
      && typeof data.payload.text === 'string' && data.payload.text.length <= 100000;
  }
  return false;
}

export function isPreviewPackageWithinLimit(entries, maxBytes = PREVIEW_PACKAGE_MAX_BYTES) {
  let total = 0;
  for (const entry of entries ?? []) {
    const length = entry?.bytes?.byteLength ?? entry?.file?.size;
    if (!Number.isSafeInteger(length) || length < 0) return false;
    total += length;
    if (total > maxBytes) return false;
  }
  return true;
}

export function validatePreviewSnapshot(snapshot) {
  if (!hasExactKeys(snapshot, ['revision', 'entries'])
    || !Number.isInteger(snapshot.revision) || snapshot.revision < 0
    || !Array.isArray(snapshot.entries)
    || !snapshot.entries.every((entry) => (
      ((hasExactKeys(entry, ['path', 'bytes', 'mediaType', 'kind']) && entry.bytes instanceof Uint8Array)
        || (hasExactKeys(entry, ['path', 'file', 'mediaType', 'kind'])
          && entry.file instanceof File && Number.isFinite(entry.file.size)
          && entry.kind === 'asset' && entry.mediaType === 'application/vnd.pmtiles'))
      && typeof entry.path === 'string'
      && typeof entry.mediaType === 'string'
      && typeof entry.kind === 'string'
    ))
    || !isPreviewPackageWithinLimit(snapshot.entries)) {
    throw new TypeError('Invalid or oversized preview snapshot.');
  }
  return snapshot;
}

function parseJsonEntry(snapshot, path) {
  const entry = snapshot.entries.find((candidate) => candidate.path === path);
  if (!entry) throw new TypeError(`Preview package is missing ${path}.`);
  try {
    return JSON.parse(decoder.decode(entry.bytes));
  } catch {
    throw new TypeError(`Preview package ${path} is not valid JSON.`);
  }
}
export function resolvePreviewSourceForSnapshot(snapshot, {
  source = '../?editorPreview=1'
} = {}) {
  validatePreviewSnapshot(snapshot);
  const manifest = parseJsonEntry(snapshot, 'project.json');
  const primary = manifest?.stories?.items?.find(({ id }) => id === manifest?.stories?.primary);
  if (!primary?.src) throw new TypeError('Preview project primary Story is not declared.');
  const storyPath = String(primary.src).replace(/^\.\//, '');
  const story = parseJsonEntry(snapshot, storyPath);
  if (['1.0', '1.1', '1.2'].includes(story.schemaVersion)) return source;
  throw new TypeError(`Unsupported Story preview version: ${story.schemaVersion ?? ''}.`);
}

function validCommandPayload(payload) {
  if (!hasExactKeys(payload, ['name', 'payload']) || !isRecord(payload.payload)) return false;
  if (['enter-story', 'explore', 'restart'].includes(payload.name)) return hasExactKeys(payload.payload, []);
  if (payload.name === 'viewport') return hasExactKeys(payload.payload, ['preset', 'reducedMotion'])
    && ['desktop', 'mobile'].includes(payload.payload.preset)
    && typeof payload.payload.reducedMotion === 'boolean';
  if (payload.name === 'activate-scene') return hasExactKeys(payload.payload, ['index', 'animate'])
    && Number.isInteger(payload.payload.index) && payload.payload.index >= 0
    && payload.payload.animate === false;
  if (payload.name === 'authoring-mode') return hasExactKeys(payload.payload, ['mode'])
    && ['select', 'map'].includes(payload.payload.mode);
  if (payload.name === 'authoring-selection') return hasExactKeys(payload.payload, ['id'])
    && (payload.payload.id === null || validOverlayId(payload.payload.id));
  if (['restore-scene-camera', 'capture-scene-camera'].includes(payload.name)) return hasExactKeys(payload.payload, ['index'])
    && Number.isInteger(payload.payload.index) && payload.payload.index >= 0;
  if (payload.name === 'locate-project-layer') return hasExactKeys(payload.payload, ['datasetId'])
    && validOverlayId(payload.payload.datasetId);
  return false;
}

function envelope(type, revision, requestId, payload = {}) {
  return { protocol: PREVIEW_PROTOCOL_VERSION, type, revision, requestId, payload };
}

function resolveStartOutputMode(options) {
  if (!hasExactKeys(options, []) && !hasExactKeys(options, ['outputMode'])) {
    throw new TypeError('Invalid output preview options.');
  }
  const outputMode = options.outputMode ?? 'explore';
  if (!PREVIEW_OUTPUT_MODES.includes(outputMode)) {
    throw new TypeError(`Invalid output preview mode: ${outputMode}.`);
  }
  return outputMode;
}

export function resolvePreviewOutputSource(source, outputMode = 'explore') {
  if (!PREVIEW_OUTPUT_MODES.includes(outputMode)) {
    throw new TypeError(`Invalid output preview mode: ${outputMode}.`);
  }
  const hashIndex = source.indexOf('#');
  const hash = hashIndex === -1 ? '' : source.slice(hashIndex);
  const beforeHash = hashIndex === -1 ? source : source.slice(0, hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const params = new URLSearchParams(queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1));
  params.delete('outputMode');
  if (outputMode !== 'explore') params.set('outputMode', outputMode);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}${hash}`;
}

export function createPreviewBridge({
  iframe,
  origin = globalThis.location?.origin,
  onEvent = () => {},
  windowRef = globalThis.window,
  cameraCaptureTimeoutMs = 15000
}) {
  let currentRevision = -1;
  let requestNumber = 0;
  let currentStartRequestId = null;
  let readyRequestId = null;
  let requireReadyRequest = false;
  let canRetryReadyHandshake = false;
  let ready = false;
  let queuedStart = null;
  let activeSource = iframe.dataset?.previewSrc ?? iframe.src ?? null;
  let currentOutputMode = 'explore';
  let loaded = false;
  let disposed = false;
  const pendingCameraCaptures = new Map();

  function cancelCameraCaptures(message) {
    for (const capture of pendingCameraCaptures.values()) capture.reject(new Error(message));
  }

  function flushCameraCaptures() {
    if (!loaded) return;
    for (const capture of pendingCameraCaptures.values()) {
      if (!capture.sent) { capture.sent = true; post(capture.message); }
    }
  }

  function post(message) {
    iframe.contentWindow?.postMessage(message, origin);
  }

  function flush() {
    if (!ready || !queuedStart) return;
    post(queuedStart);
    queuedStart = null;
  }

  function handleMessage(event) {
    if (event.source !== iframe.contentWindow || event.origin !== origin) return;
    const data = event.data;
    if (!validEnvelope(data, EVENT_TYPES) || !validEventPayload(data)) return;
    if (data.type === 'editor-preview:ready') {
      if (requireReadyRequest && (!readyRequestId || data.requestId !== readyRequestId)) {
        if (canRetryReadyHandshake && data.requestId === null) {
          canRetryReadyHandshake = false;
          post(envelope('editor-preview:hello', currentRevision, readyRequestId));
        }
        return;
      }
      canRetryReadyHandshake = false;
      ready = true;
      flush();
      onEvent(data);
      return;
    }
    if (data.revision !== currentRevision) return;
    if (data.type === 'editor-preview:freeze-camera') {
      const capture = pendingCameraCaptures.get(data.requestId);
      if (!capture || capture.index !== data.payload.index) return;
      capture.resolve(data.payload);
      return;
    }
    if (data.type === 'editor-preview:runtime-error' && pendingCameraCaptures.has(data.requestId)) {
      pendingCameraCaptures.get(data.requestId).reject(new Error(data.payload.message));
      return;
    }
    if (START_RESPONSE_TYPES.has(data.type) && data.requestId !== currentStartRequestId) return;
    if (data.type === 'editor-preview:loaded') {
      loaded = true;
      // Let editor restore normal authoring chrome before a waiting Freeze capture activates its Scene.
      onEvent(data);
      flushCameraCaptures();
      return;
    }
    if (data.type === 'editor-preview:runtime-error') cancelCameraCaptures(data.payload.message);
    if (AUTHORING_EVENT_TYPES.has(data.type)) publishAuthoringEvent(data);
    onEvent(data);
  }

  function handleLoad() {
    loaded = false;
    for (const capture of pendingCameraCaptures.values()) {
      if (capture.sent || !queuedStart) capture.reject(new Error('Preview frame loaded during camera capture.'));
    }
    ready = false;
    canRetryReadyHandshake = true;
    readyRequestId = `request-${++requestNumber}`;
    post(envelope('editor-preview:hello', currentRevision, readyRequestId));
  }

  windowRef.addEventListener('message', handleMessage);
  iframe.addEventListener?.('load', handleLoad);
  if (iframe.contentDocument?.readyState === 'complete') handleLoad();

  function clearSession() {
    loaded = false;
    cancelCameraCaptures('Preview reset during camera capture.');
    currentRevision = -1;
    currentStartRequestId = null;
    readyRequestId = null;
    requireReadyRequest = true;
    canRetryReadyHandshake = false;
    ready = false;
    queuedStart = null;
  }

  function selectSnapshotSource(outputMode) {
    const configured = iframe.dataset?.previewSrc;
    if (!configured) return;
    const source = resolvePreviewOutputSource(configured, outputMode);
    if (activeSource === source) return;
    activeSource = source;
    clearSession();
    iframe.src = source;
  }

  function start(lastValid, options = {}) {
    validatePreviewSnapshot(lastValid.snapshot);
    if (lastValid.revision !== lastValid.snapshot.revision) {
      throw new TypeError('Preview snapshot revision does not match last-valid revision.');
    }
    loaded = false;
    cancelCameraCaptures('Preview replaced during camera capture.');
    currentOutputMode = resolveStartOutputMode(options);
    selectSnapshotSource(currentOutputMode);
    currentRevision = lastValid.revision;
    currentStartRequestId = `request-${++requestNumber}`;
    queuedStart = envelope(
      'editor-preview:start',
      lastValid.revision,
      currentStartRequestId,
      structuredClone(lastValid.snapshot)
    );
    flush();
  }

  function reset() {
    clearSession();
    currentOutputMode = 'explore';
    activeSource = iframe.dataset.previewSrc;
    iframe.src = activeSource;
  }

  function command(name, payload = {}) {
    const commandPayload = { name, payload };
    if (!validCommandPayload(commandPayload)) throw new TypeError(`Invalid preview command payload: ${name}`);
    post(envelope('editor-preview:command', currentRevision, `request-${++requestNumber}`, commandPayload));
  }

  function dispose() {
    disposed = true;
    cancelCameraCaptures('Preview disposed during camera capture.');
    windowRef.removeEventListener('message', handleMessage);
    iframe.removeEventListener?.('load', handleLoad);
    queuedStart = null;
  }

  return {
    start,
    reset,
    command,
    captureSceneCamera(index) {
      if (disposed || currentRevision < 0) return Promise.reject(new Error('Camera capture requires an active preview.'));
      const payload = { name: 'capture-scene-camera', payload: { index } };
      if (!validCommandPayload(payload)) return Promise.reject(new TypeError('Invalid camera capture Scene index.'));
      const requestId = `request-${++requestNumber}`;
      return new Promise((resolve, reject) => {
        const finish = (callback, value) => {
          clearTimeout(timer);
          pendingCameraCaptures.delete(requestId);
          callback(value);
        };
        const timer = setTimeout(() => finish(reject, new Error('Preview camera capture timed out.')), cameraCaptureTimeoutMs);
        pendingCameraCaptures.set(requestId, {
          index, message: envelope('editor-preview:command', currentRevision, requestId, payload), sent: false,
          resolve: (value) => finish(resolve, value), reject: (error) => finish(reject, error)
        });
        flushCameraCaptures();
      });
    },
    dispose,
    get revision() { return currentRevision; },
    get outputMode() { return currentOutputMode; }
  };
}
