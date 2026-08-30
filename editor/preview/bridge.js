export const PREVIEW_PROTOCOL_VERSION = 1;
export const PREVIEW_PACKAGE_MAX_BYTES = 256 * 1024 * 1024;

const decoder = new TextDecoder();
const EVENT_TYPES = new Set([
  'editor-preview:ready',
  'editor-preview:loaded',
  'editor-preview:runtime-error',
  'editor-preview:state',
  'editor-preview:camera'
]);
const START_RESPONSE_TYPES = new Set([
  'editor-preview:loaded',
  'editor-preview:runtime-error'
]);

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

function validEventPayload(data) {
  if (data.type === 'editor-preview:ready' || data.type === 'editor-preview:loaded') {
    return hasExactKeys(data.payload, []);
  }
  if (data.type === 'editor-preview:runtime-error') return validRuntimeError(data.payload);
  if (data.type === 'editor-preview:state') return hasExactKeys(data.payload, ['viewport']);
  if (data.type === 'editor-preview:camera') {
    return hasExactKeys(data.payload, ['center', 'zoom', 'pitch', 'bearing', 'bounds']);
  }
  return false;
}

export function isPreviewPackageWithinLimit(entries, maxBytes = PREVIEW_PACKAGE_MAX_BYTES) {
  let total = 0;
  for (const entry of entries ?? []) {
    const length = entry?.bytes?.byteLength;
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
      hasExactKeys(entry, ['path', 'bytes', 'mediaType', 'kind'])
      && typeof entry.path === 'string'
      && entry.bytes instanceof Uint8Array
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
  legacy = '../?editorPreview=1',
  story12 = '../src/runtime/?editorPreview=1'
} = {}) {
  validatePreviewSnapshot(snapshot);
  const manifest = parseJsonEntry(snapshot, 'project.json');
  const primary = manifest?.stories?.items?.find(({ id }) => id === manifest?.stories?.primary);
  if (!primary?.src) throw new TypeError('Preview project primary Story is not declared.');
  const storyPath = String(primary.src).replace(/^\.\//, '');
  const story = parseJsonEntry(snapshot, storyPath);
  if (story.schemaVersion === '1.2') return story12;
  if (story.schemaVersion === '1.0' || story.schemaVersion === '1.1') return legacy;
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
  if (payload.name === 'restore-scene-camera') return hasExactKeys(payload.payload, ['index'])
    && Number.isInteger(payload.payload.index) && payload.payload.index >= 0;
  return false;
}

function envelope(type, revision, requestId, payload = {}) {
  return { protocol: PREVIEW_PROTOCOL_VERSION, type, revision, requestId, payload };
}

export function createPreviewBridge({
  iframe,
  origin = globalThis.location?.origin,
  onEvent = () => {},
  windowRef = globalThis.window
}) {
  let currentRevision = -1;
  let requestNumber = 0;
  let currentStartRequestId = null;
  let readyRequestId = null;
  let requireReadyRequest = false;
  let canRetryReadyHandshake = false;
  let ready = false;
  let queuedStart = null;

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
    if (START_RESPONSE_TYPES.has(data.type) && data.requestId !== currentStartRequestId) return;
    onEvent(data);
  }

  function handleLoad() {
    ready = false;
    canRetryReadyHandshake = true;
    readyRequestId = `request-${++requestNumber}`;
    post(envelope('editor-preview:hello', currentRevision, readyRequestId));
  }

  windowRef.addEventListener('message', handleMessage);
  iframe.addEventListener?.('load', handleLoad);
  if (iframe.contentDocument?.readyState === 'complete') handleLoad();

  function clearSession() {
    currentRevision = -1;
    currentStartRequestId = null;
    readyRequestId = null;
    requireReadyRequest = true;
    canRetryReadyHandshake = false;
    ready = false;
    queuedStart = null;
  }

  function selectSnapshotSource(snapshot) {
    const legacy = iframe.dataset?.previewSrcLegacy;
    const story12 = iframe.dataset?.previewSrcStory12;
    if (!legacy || !story12) return;
    const source = resolvePreviewSourceForSnapshot(snapshot, { legacy, story12 });
    if (iframe.dataset.previewSrc === source) return;
    iframe.dataset.previewSrc = source;
    clearSession();
    iframe.src = source;
  }

  function start(lastValid) {
    validatePreviewSnapshot(lastValid.snapshot);
    if (lastValid.revision !== lastValid.snapshot.revision) {
      throw new TypeError('Preview snapshot revision does not match last-valid revision.');
    }
    selectSnapshotSource(lastValid.snapshot);
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
    iframe.src = iframe.dataset.previewSrc;
  }

  function command(name, payload = {}) {
    const commandPayload = { name, payload };
    if (!validCommandPayload(commandPayload)) throw new TypeError(`Invalid preview command payload: ${name}`);
    post(envelope('editor-preview:command', currentRevision, `request-${++requestNumber}`, commandPayload));
  }

  function dispose() {
    windowRef.removeEventListener('message', handleMessage);
    iframe.removeEventListener?.('load', handleLoad);
    queuedStart = null;
  }

  return { start, reset, command, dispose, get revision() { return currentRevision; } };
}
