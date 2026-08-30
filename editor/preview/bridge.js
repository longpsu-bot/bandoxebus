export const PREVIEW_PROTOCOL_VERSION = 1;

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
    if (!data || data.protocol !== PREVIEW_PROTOCOL_VERSION || !EVENT_TYPES.has(data.type)) return;
    if (data.type === 'editor-preview:ready') {
      if (requireReadyRequest && (!readyRequestId || data.requestId !== readyRequestId)) return;
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
    requireReadyRequest = true;
    readyRequestId = `request-${++requestNumber}`;
    post(envelope('editor-preview:hello', currentRevision, readyRequestId));
  }

  windowRef.addEventListener('message', handleMessage);
  iframe.addEventListener?.('load', handleLoad);

  function start(lastValid) {
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
    currentRevision = -1;
    currentStartRequestId = null;
    readyRequestId = null;
    requireReadyRequest = true;
    ready = false;
    queuedStart = null;
    iframe.src = iframe.dataset.previewSrc;
  }

  function command(name, payload = {}) {
    if (!['enter-story', 'explore', 'restart', 'viewport'].includes(name)) {
      throw new TypeError(`Unsupported preview command: ${name}`);
    }
    post(envelope('editor-preview:command', currentRevision, `request-${++requestNumber}`, { name, payload }));
  }

  function dispose() {
    windowRef.removeEventListener('message', handleMessage);
    iframe.removeEventListener?.('load', handleLoad);
    queuedStart = null;
  }

  return { start, reset, command, dispose, get revision() { return currentRevision; } };
}
