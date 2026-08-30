export const PREVIEW_PROTOCOL_VERSION = 1;

const EVENT_TYPES = new Set([
  'editor-preview:ready',
  'editor-preview:loaded',
  'editor-preview:runtime-error',
  'editor-preview:state',
  'editor-preview:camera'
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
      ready = true;
      flush();
      onEvent(data);
      return;
    }
    if (data.revision !== currentRevision) return;
    onEvent(data);
  }

  function handleLoad() {
    ready = false;
    post(envelope('editor-preview:hello', currentRevision, `request-${++requestNumber}`));
  }

  windowRef.addEventListener('message', handleMessage);
  iframe.addEventListener?.('load', handleLoad);

  function start(lastValid) {
    currentRevision = lastValid.revision;
    queuedStart = envelope(
      'editor-preview:start',
      lastValid.revision,
      `request-${++requestNumber}`,
      structuredClone(lastValid.snapshot)
    );
    flush();
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

  return { start, command, dispose, get revision() { return currentRevision; } };
}
