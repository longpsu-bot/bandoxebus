const DEFAULT_PACKAGE_ORIGIN = globalThis.location?.origin ?? 'http://localhost';

export function createPackageFetch(snapshot, {
  baseUrl = new URL('/__editor_package__/', DEFAULT_PACKAGE_ORIGIN)
} = {}) {
  const packageBase = new URL(baseUrl);
  const entries = new Map(snapshot.entries.map((entry) => [entry.path, {
    ...entry,
    bytes: entry.bytes.slice()
  }]));
  const manifestUrl = new URL('project.json', packageBase);

  async function fetchImpl(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const signal = init.signal ?? request?.signal;
    signal?.throwIfAborted();
    const url = new URL(request?.url ?? input, packageBase);
    const basePath = packageBase.pathname.endsWith('/') ? packageBase.pathname : `${packageBase.pathname}/`;
    if (url.origin !== packageBase.origin || !url.pathname.startsWith(basePath)) {
      return new Response('Not found', { status: 404 });
    }
    const path = decodeURIComponent(url.pathname.slice(basePath.length));
    const entry = entries.get(path);
    if (!entry) return new Response('Not found', { status: 404 });
    return new Response(entry.bytes.slice(), {
      status: 200,
      headers: { 'content-type': entry.mediaType }
    });
  }

  return { manifestUrl, fetchImpl };
}

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp'
]);

export function createPreviewPackageResolver(snapshot, {
  baseUrl,
  urlApi = globalThis.URL
} = {}) {
  const transport = createPackageFetch(snapshot, baseUrl === undefined ? {} : { baseUrl });
  const packageBase = new URL('.', transport.manifestUrl);
  const entries = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
  const objectUrls = new Map();
  let revoked = false;

  function resolveAssetUrl(url, { id, descriptor } = {}) {
    if (revoked) throw new Error('Preview asset URL resolver has been revoked.');
    const resolved = new URL(url, transport.manifestUrl);
    if (resolved.origin !== packageBase.origin || !resolved.pathname.startsWith(packageBase.pathname)) {
      throw new TypeError(`Asset ${id ?? ''} is outside the preview package.`);
    }
    const path = decodeURIComponent(resolved.pathname.slice(packageBase.pathname.length));
    const entry = entries.get(path);
    if (!entry) throw new TypeError(`Asset ${id ?? path} is absent from the preview package.`);
    if (entry.kind !== 'asset' || descriptor?.type !== 'image'
      || !SUPPORTED_IMAGE_MEDIA_TYPES.has(entry.mediaType)) {
      throw new TypeError(`Preview asset ${id ?? path} must be a supported declared image.`);
    }
    if (descriptor.mediaType !== entry.mediaType) {
      throw new TypeError(`Preview asset ${id ?? path} media type does not match its declared media type.`);
    }
    if (objectUrls.has(path)) return objectUrls.get(path);
    if (typeof urlApi?.createObjectURL !== 'function' || typeof urlApi?.revokeObjectURL !== 'function') {
      throw new TypeError('Preview image object URL support is unavailable.');
    }
    const objectUrl = urlApi.createObjectURL(new Blob([entry.bytes.slice()], { type: entry.mediaType }));
    objectUrls.set(path, objectUrl);
    return objectUrl;
  }

  function revoke() {
    if (revoked) return;
    revoked = true;
    for (const objectUrl of objectUrls.values()) urlApi.revokeObjectURL(objectUrl);
    objectUrls.clear();
  }

  return { ...transport, resolveAssetUrl, revoke };
}

const PREVIEW_PROTOCOL_VERSION = 1;

function waitForProductionSurface(runtime) {
  const map = runtime?.map;
  if (!map || typeof map.once !== 'function' || map.loaded?.()) return Promise.resolve();
  return new Promise((resolve) => map.once('load', resolve));
}

export function startEditorPreviewHost({
  windowRef = globalThis.window,
  startProductionApplication,
  expectedOrigin = windowRef.location.origin,
  createResolver = createPreviewPackageResolver
}) {
  const owner = {};
  let activeRuntime = null;
  let activeResolver = null;
  let activeSnapshot = null;
  let disposed = false;
  let replacement = Promise.resolve();

  function post(type, revision = activeSnapshot?.revision ?? 0, payload = {}, requestId = null) {
    windowRef.parent?.postMessage({
      protocol: PREVIEW_PROTOCOL_VERSION,
      type: `editor-preview:${type}`,
      revision,
      requestId,
      payload
    }, expectedOrigin);
  }

  async function replace(snapshot, requestId = null) {
    if (disposed) return;
    await activeRuntime?.destroy?.();
    activeRuntime = null;
    activeResolver?.revoke();
    activeResolver = null;

    const resolver = createResolver(structuredClone(snapshot));
    try {
      const runtime = await startProductionApplication({
        manifestUrl: resolver.manifestUrl,
        fetchImpl: resolver.fetchImpl,
        resolveAssetUrl: resolver.resolveAssetUrl,
        owner,
        replaceExisting: true
      });
      await waitForProductionSurface(runtime);
      if (disposed) {
        await runtime?.destroy?.();
        resolver.revoke();
        return;
      }
      activeSnapshot = structuredClone(snapshot);
      activeResolver = resolver;
      activeRuntime = runtime;
      post('loaded', snapshot.revision, {}, requestId);
    } catch (error) {
      resolver.revoke();
      post('runtime-error', snapshot.revision, {
        code: error?.code ?? 'PREVIEW_START_FAILED',
        path: error?.path ?? '$',
        message: error?.message ?? String(error)
      }, requestId);
      throw error;
    }
  }

  function start(snapshot, requestId = null) {
    replacement = replacement.then(() => replace(snapshot, requestId));
    return replacement;
  }

  function handleCommand(data) {
    const { name } = data.payload ?? {};
    if (name === 'enter-story') windowRef.document.getElementById('presentation-open')?.click();
    else if (name === 'explore') windowRef.document.getElementById('story-explore')?.click();
    else if (name === 'restart' && activeSnapshot) void start(activeSnapshot, data.requestId);
    else if (name === 'viewport') post('state', activeSnapshot?.revision ?? 0, { viewport: data.payload.payload }, data.requestId);
  }

  function handleMessage(event) {
    if (event.source !== windowRef.parent || event.origin !== expectedOrigin) return;
    const data = event.data;
    if (!data || data.protocol !== PREVIEW_PROTOCOL_VERSION) return;
    if (data.type === 'editor-preview:hello') {
      post('ready', 0, {}, data.requestId);
      return;
    }
    if (data.type === 'editor-preview:start') {
      if (!data.payload || data.payload.revision !== data.revision) return;
      if (activeSnapshot && data.revision <= activeSnapshot.revision) return;
      void start(data.payload, data.requestId);
      return;
    }
    if (data.type === 'editor-preview:command' && data.revision === activeSnapshot?.revision) handleCommand(data);
  }

  windowRef.addEventListener('message', handleMessage);
  post('ready');

  function dispose() {
    disposed = true;
    windowRef.removeEventListener('message', handleMessage);
    replacement = replacement.then(async () => {
      await activeRuntime?.destroy?.();
      activeRuntime = null;
      activeResolver?.revoke();
      activeResolver = null;
    });
    return replacement;
  }

  return { start, dispose };
}
