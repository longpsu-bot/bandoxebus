import { PREVIEW_PROTOCOL_VERSION, PREVIEW_CAMERA_SETTLEMENT_TIMEOUT_MS, validatePreviewSnapshot } from './bridge.js';
import { createSceneAuthoringAdapter } from '../../src/scene/scene-authoring-adapter.js';
import { geoJsonBounds } from '../../src/map/focus-registry.js';

const DEFAULT_PACKAGE_ORIGIN = globalThis.location?.origin ?? 'http://localhost';

export function createPackageFetch(snapshot, {
  baseUrl = new URL('/__editor_package__/', DEFAULT_PACKAGE_ORIGIN)
} = {}) {
  validatePreviewSnapshot(snapshot);
  const packageBase = new URL(baseUrl);
  const entries = new Map(snapshot.entries.map((entry) => [entry.path, {
    ...entry,
    bytes: entry.bytes?.slice()
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
    return new Response(entry.bytes?.slice() ?? entry.file, {
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
  const entries = new Map(snapshot.entries.map((entry) => [entry.path, { ...entry, bytes: entry.bytes?.slice() }]));
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

  function resolvePmtilesAssetFile(url, { id, descriptor } = {}) {
    if (revoked) throw new Error('Preview PMTiles File resolver has been revoked.');
    const resolved = new URL(url, transport.manifestUrl);
    if (resolved.origin !== packageBase.origin || !resolved.pathname.startsWith(packageBase.pathname)) {
      throw new TypeError(`Asset ${id ?? ''} is outside the preview package.`);
    }
    const path = decodeURIComponent(resolved.pathname.slice(packageBase.pathname.length));
    const entry = entries.get(path);
    if (!entry) throw new TypeError(`Asset ${id ?? path} is absent from the preview package.`);
    if (entry.kind !== 'asset' || descriptor?.type !== 'pmtiles'
      || entry.mediaType !== 'application/vnd.pmtiles') {
      throw new TypeError(`Preview asset ${id ?? path} must be a declared PMTiles asset.`);
    }
    if (descriptor.mediaType !== entry.mediaType) {
      throw new TypeError(`Preview asset ${id ?? path} media type does not match its declared media type.`);
    }
    return entry.file ?? new File([entry.bytes], path.split('/').at(-1), { type: entry.mediaType });
  }

  function revoke() {
    if (revoked) return;
    revoked = true;
    for (const objectUrl of objectUrls.values()) urlApi.revokeObjectURL(objectUrl);
    objectUrls.clear();
  }

  return { ...transport, resolveAssetUrl, resolvePmtilesAssetFile, revoke };
}

function boundedText(value, fallback, maxLength) {
  return String(value ?? fallback).slice(0, maxLength);
}

export function toRuntimeErrorPayload(error) {
  return {
    code: boundedText(error?.code, 'PREVIEW_START_FAILED', 128),
    path: boundedText(error?.path, '$', 2048),
    message: boundedText(error?.message, error, 4096)
  };
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIncomingEnvelope(data, type) {
  return exactKeys(data, ['protocol', 'type', 'revision', 'requestId', 'payload'])
    && data.protocol === PREVIEW_PROTOCOL_VERSION
    && data.type === type
    && Number.isInteger(data.revision)
    && data.revision >= -1
    && typeof data.requestId === 'string'
    && data.requestId.length > 0
    && data.requestId.length <= 128
    && data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload);
}

function validCommand(data) {
  if (!validIncomingEnvelope(data, 'editor-preview:command')
    || !exactKeys(data.payload, ['name', 'payload'])) return false;
  const { name, payload } = data.payload;
  if (['enter-story', 'explore', 'restart'].includes(name)) return exactKeys(payload, []);
  if (name === 'viewport') return exactKeys(payload, ['preset', 'reducedMotion'])
    && ['desktop', 'mobile'].includes(payload.preset)
    && typeof payload.reducedMotion === 'boolean';
  if (name === 'activate-scene') return exactKeys(payload, ['index', 'animate'])
    && Number.isInteger(payload.index) && payload.index >= 0 && payload.animate === false;
  if (name === 'authoring-mode') return exactKeys(payload, ['mode']) && ['select', 'map'].includes(payload.mode);
  if (name === 'authoring-selection') return exactKeys(payload, ['id'])
    && (payload.id === null || (typeof payload.id === 'string' && /^[a-z][a-z0-9-]*$/.test(payload.id)));
  if (['restore-scene-camera', 'capture-scene-camera'].includes(name)) return exactKeys(payload, ['index'])
    && Number.isInteger(payload.index) && payload.index >= 0;
  if (name === 'locate-project-layer') return exactKeys(payload, ['datasetId'])
    && typeof payload.datasetId === 'string' && /^[a-z][a-z0-9-]*$/.test(payload.datasetId);
  return false;
}

function waitForProductionSurface(runtime) {
  const map = runtime?.map;
  if (!map || typeof map.once !== 'function' || map.loaded?.()) return Promise.resolve();
  return new Promise((resolve) => map.once('load', resolve));
}

export function startEditorPreviewHost({
  windowRef = globalThis.window,
  startProductionApplication,
  expectedOrigin = windowRef.location.origin,
  createResolver = createPreviewPackageResolver,
  createAuthoringAdapter = createSceneAuthoringAdapter
}) {
  const owner = {};
  let activeRuntime = null;
  let activeResolver = null;
  let activeSnapshot = null;
  let latestRequestedSnapshot = null;
  let disposed = false;
  let replacement = Promise.resolve();
  let removeCameraListener = null;
  let removeUrbanContextListener = null;
  let activeAuthoringAdapter = null;
  let selectedOverlayId = null;
  let authoringMode = 'select';
  const cameraCaptures = new Set();

  function cancelCameraCaptures() {
    for (const controller of cameraCaptures) controller.abort(new Error('Preview replaced or disposed during camera capture.'));
  }

  async function settleCamera(map, signal) {
    await Promise.resolve();
    signal.throwIfAborted();
    if (map.isMoving?.()) {
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          map.off('moveend', moved);
          signal.removeEventListener('abort', aborted);
          if (error) reject(error); else resolve();
        };
        const moved = () => finish();
        const aborted = () => finish(signal.reason);
        const timer = setTimeout(() => finish(new Error('Production camera settlement timed out.')), PREVIEW_CAMERA_SETTLEMENT_TIMEOUT_MS);
        map.on('moveend', moved);
        signal.addEventListener('abort', aborted, { once: true });
      });
    }
    signal.throwIfAborted();
  }

  async function captureSceneCamera(data) {
    const controller = new AbortController();
    cameraCaptures.add(controller);
    const { signal } = controller;
    const runtime = activeRuntime;
    const map = runtime?.map;
    try {
      if (disposed || activeSnapshot?.revision !== data.revision || !runtime?.shell?.activateScene || !map) {
        throw new Error('Production preview is not ready for camera capture.');
      }
      // Fit/focus actions must see the exact parent-selected viewport, not the old map size.
      map.resize();
      if (runtime.storyRuntime) {
        const index = data.payload.payload.index;
        if (!runtime.storyRuntime.definition.states[index]) throw new RangeError(`Unknown Scene index: ${index}.`);
        // goTo is intentionally a no-op for the current Scene. Replay the production lifecycle
        // from its authored initial camera so working pans and inherited actions cannot leak in.
        runtime.storyRuntime.deactivate();
        if (runtime.project?.map?.initialView) map.jumpTo(runtime.project.map.initialView);
        for (let step = 0; step <= index; step += 1) {
          signal.throwIfAborted();
          runtime.shell.activateScene(step, { animate: false });
          if (step === index) map.resize();
          // Legacy map.focus can still animate and inherit omitted fields from its predecessor.
          await settleCamera(map, signal);
        }
      } else {
        runtime.shell.activateScene(data.payload.payload.index, { animate: false });
        map.resize();
        await settleCamera(map, signal);
      }
      signal.throwIfAborted();
      const center = map.getCenter();
      const bounds = map.getBounds();
      post('freeze-camera', data.revision, {
        index: data.payload.payload.index, center: [center.lng, center.lat],
        zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
        bounds: [[bounds.getSouthWest().lng, bounds.getSouthWest().lat], [bounds.getNorthEast().lng, bounds.getNorthEast().lat]]
      }, data.requestId);
    } catch (error) {
      post('runtime-error', data.revision, toRuntimeErrorPayload(error), data.requestId);
    } finally {
      cameraCaptures.delete(controller);
    }
  }

  function post(type, revision = activeSnapshot?.revision ?? 0, payload = {}, requestId = null) {
    windowRef.parent?.postMessage({
      protocol: PREVIEW_PROTOCOL_VERSION,
      type: `editor-preview:${type}`,
      revision,
      requestId,
      payload
    }, expectedOrigin);
  }

  function destroyAuthoringAdapter() {
    activeAuthoringAdapter?.destroy?.();
    activeAuthoringAdapter = null;
  }

  async function replace(snapshot, requestId = null) {
    if (disposed) return;
    destroyAuthoringAdapter();
    removeCameraListener?.();
    removeCameraListener = null;
    removeUrbanContextListener?.();
    removeUrbanContextListener = null;
    await activeRuntime?.destroy?.();
    activeRuntime = null;
    activeResolver?.revoke();
    activeResolver = null;
    activeSnapshot = null;

    validatePreviewSnapshot(snapshot);
    const resolver = createResolver(structuredClone(snapshot));
    try {
      if (typeof windowRef.document?.addEventListener === 'function') {
        const handleUrbanContextStatus = (event) => {
          post('urban-context-status', snapshot.revision, structuredClone(event.detail));
        };
        windowRef.document.addEventListener('map-story:urban-context-status', handleUrbanContextStatus);
        removeUrbanContextListener = () => windowRef.document.removeEventListener(
          'map-story:urban-context-status',
          handleUrbanContextStatus
        );
      }
      const runtime = await startProductionApplication({
        manifestUrl: resolver.manifestUrl,
        fetchImpl: resolver.fetchImpl,
        resolveAssetUrl(url, context) {
          // Keep archive URLs package-relative; runtime reads them through the File seam.
          if (context?.descriptor?.type === 'pmtiles'
            && context.descriptor.mediaType === 'application/vnd.pmtiles') return url;
          return resolver.resolveAssetUrl(url, context);
        },
        resolvePmtilesAssetFile: resolver.resolvePmtilesAssetFile,
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
      if (runtime?.project?.story?.schemaVersion === '1.2') {
        const root = windowRef.document?.getElementById?.('scene-compositor');
        if (root) {
          activeAuthoringAdapter = createAuthoringAdapter({
            root,
            documentRef: windowRef.document,
            emit(type, payload) {
              if (type === 'select-overlay') selectedOverlayId = payload.id;
              post(type, snapshot.revision, payload);
            }
          });
          activeAuthoringAdapter.setMode(authoringMode);
          if (authoringMode === 'select' && selectedOverlayId) {
            activeAuthoringAdapter.selectOverlay(selectedOverlayId, { emitSelection: false, focus: false });
          }
        }
      }
      post('loaded', snapshot.revision, {}, requestId);
      const map = runtime?.map;
      const postCamera = () => {
        const center = map?.getCenter?.();
        const bounds = map?.getBounds?.();
        if (!center || !bounds) return;
        post('camera', snapshot.revision, {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
          bounds: [
            [bounds.getSouthWest().lng, bounds.getSouthWest().lat],
            [bounds.getNorthEast().lng, bounds.getNorthEast().lat]
          ]
        });
      };
      postCamera();
      if (typeof map?.on === 'function' && typeof map?.off === 'function') {
        map.on('moveend', postCamera);
        removeCameraListener = () => map.off('moveend', postCamera);
      }
    } catch (error) {
      destroyAuthoringAdapter();
      removeUrbanContextListener?.();
      removeUrbanContextListener = null;
      resolver.revoke();
      post('runtime-error', snapshot.revision, toRuntimeErrorPayload(error), requestId);
      throw error;
    }
  }

  function start(snapshot, requestId = null) {
    cancelCameraCaptures();
    const requestedSnapshot = structuredClone(snapshot);
    latestRequestedSnapshot = requestedSnapshot;
    const operation = replacement.then(() => replace(requestedSnapshot, requestId));
    replacement = operation.catch(() => {});
    return operation;
  }

  function handleCommand(data) {
    const { name, payload } = data.payload ?? {};
    if (name === 'enter-story') windowRef.document.getElementById('presentation-open')?.click();
    else if (name === 'explore') windowRef.document.getElementById('story-explore')?.click();
    else if (name === 'restart' && latestRequestedSnapshot) {
      void start(latestRequestedSnapshot, data.requestId).catch(() => {});
    }
    else if (name === 'viewport') {
      const viewport = payload;
      const root = windowRef.document?.documentElement;
      if (root?.dataset) root.dataset.reducedMotion = String(viewport.reducedMotion);
      post('state', activeSnapshot?.revision ?? 0, { viewport }, data.requestId);
    }
    else if (name === 'activate-scene') {
      selectedOverlayId = null;
      activeRuntime?.shell?.activateScene?.(payload.index, { animate: payload.animate });
      activeAuthoringAdapter?.clearSelection?.();
    }
    else if (name === 'authoring-mode') {
      authoringMode = payload.mode;
      if (authoringMode !== 'select') selectedOverlayId = null;
      activeRuntime?.shell?.setAuthoringMode?.(payload.mode);
      activeAuthoringAdapter?.setMode?.(payload.mode);
    }
    else if (name === 'authoring-selection') {
      selectedOverlayId = payload.id;
      if (authoringMode === 'select' && selectedOverlayId) {
        activeAuthoringAdapter?.selectOverlay?.(selectedOverlayId, { emitSelection: false, focus: false });
      } else {
        activeAuthoringAdapter?.clearSelection?.();
      }
    }
    else if (name === 'restore-scene-camera') activeRuntime?.shell?.restoreSceneCamera?.(payload.index);
    else if (name === 'capture-scene-camera') void captureSceneCamera(data);
    else if (name === 'locate-project-layer') {
      const resource = activeRuntime?.project?.resources?.get?.(payload.datasetId);
      if (!resource || resource.descriptor?.type !== 'geojson') {
        post('locate-result', activeSnapshot?.revision ?? 0, {
          datasetId: payload.datasetId,
          status: 'error',
          message: resource ? 'Only project GeoJSON layers can be located.' : 'Layer data is unavailable.'
        }, data.requestId);
        return;
      }
      const bounds = geoJsonBounds(resource.value);
      if (!bounds) {
        post('locate-result', activeSnapshot?.revision ?? 0, {
          datasetId: payload.datasetId,
          status: 'empty',
          message: 'Layer has no features to locate.'
        }, data.requestId);
        return;
      }
      const map = activeRuntime?.map;
      const duration = windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
      if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) {
        map?.easeTo?.({
          center: [...bounds[0]],
          zoom: Math.min(15, map?.getMaxZoom?.() ?? 15),
          duration,
          essential: false
        });
      } else {
        map?.fitBounds?.(bounds, { padding: 48, maxZoom: 16, duration, essential: false });
      }
      post('locate-result', activeSnapshot?.revision ?? 0, {
        datasetId: payload.datasetId,
        status: 'located',
        message: 'Layer located on the working map.'
      }, data.requestId);
    }
  }

  function handleMessage(event) {
    if (event.source !== windowRef.parent || event.origin !== expectedOrigin) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'editor-preview:hello') {
      if (!validIncomingEnvelope(data, 'editor-preview:hello') || !exactKeys(data.payload, [])) return;
      post('ready', 0, {}, data.requestId);
      return;
    }
    if (data.type === 'editor-preview:start') {
      if (!validIncomingEnvelope(data, 'editor-preview:start')) return;
      try { validatePreviewSnapshot(data.payload); } catch { return; }
      if (data.payload.revision !== data.revision) return;
      if (latestRequestedSnapshot && data.revision <= latestRequestedSnapshot.revision) return;
      void start(data.payload, data.requestId).catch(() => {});
      return;
    }
    if (validCommand(data) && data.revision === latestRequestedSnapshot?.revision) handleCommand(data);
  }

  windowRef.addEventListener('message', handleMessage);
  post('ready');

  function dispose() {
    disposed = true;
    cancelCameraCaptures();
    windowRef.removeEventListener('message', handleMessage);
    replacement = replacement.then(async () => {
      destroyAuthoringAdapter();
      removeCameraListener?.();
      removeCameraListener = null;
      removeUrbanContextListener?.();
      removeUrbanContextListener = null;
      await activeRuntime?.destroy?.();
      activeRuntime = null;
      activeResolver?.revoke();
      activeResolver = null;
    });
    return replacement;
  }

  return { start, dispose };
}
