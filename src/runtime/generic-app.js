import { startApplication } from '../application.js';
import { prepareBasemapStyle, stripOpenFreeMapDarkStyle } from '../basemap-style.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../capabilities/installed-capabilities.js';
import { renderProjectLoadError } from '../project/bootstrap.js';
import { bindGenericStoryExperience, resolveGenericOutputMode } from './generic-shell.js';
import { COMPACT_ATTRIBUTION_OPTIONS, startCompactAttributionCollapsed } from '../map/compact-attribution.js';

async function createGenericMap({ project, maplibregl, cooperativeScroll = false }) {
  const response = await fetch(new URL('../../style-openfreemap-dark.json', import.meta.url));
  if (!response.ok) throw new Error(`Could not load basemap style (${response.status}).`);
  const style = prepareBasemapStyle(stripOpenFreeMapDarkStyle(await response.json()));
  return startCompactAttributionCollapsed(new maplibregl.Map({
    container: 'map',
    style,
    attributionControl: COMPACT_ATTRIBUTION_OPTIONS,
    cooperativeGestures: cooperativeScroll,
    ...project.map.initialView,
    maxPitch: 72,
    antialias: true,
    canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' }
  }));
}

export function createGenericApplicationOptions({
  manifestUrl = new URL('../../project.json', import.meta.url).href,
  fetchImpl = fetch,
  resolveAssetUrl,
  resolvePmtilesAssetFile,
  signal,
  owner,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  maplibregl = globalThis.maplibregl,
  Chart = globalThis.Chart,
  outputMode,
  replaceExisting = false
} = {}) {
  const reducedMotion = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const selectedOutputMode = resolveGenericOutputMode(outputMode, windowRef?.location?.search ?? '');
  return {
    manifestUrl,
    fetchImpl,
    resolveAssetUrl,
    resolvePmtilesAssetFile,
    signal,
    owner,
    replaceExisting,
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY,
    maplibregl,
    Chart,
    documentRef,
    reducedMotion,
    outputMode: selectedOutputMode,
    cooperativeScroll: selectedOutputMode === 'scroll',
    createMap: createGenericMap,
    bindStoryExperience: bindGenericStoryExperience,
    sceneRoot: documentRef?.getElementById?.('scene-compositor'),
    capabilityControlHost: documentRef?.getElementById?.('capability-controls')
  };
}

export function startGenericProductionApplication(transport = {}) {
  return startApplication(createGenericApplicationOptions(transport));
}

async function initialize() {
  if (new URLSearchParams(globalThis.location?.search ?? '').get('editorPreview') === '1') {
    const { startEditorPreviewHost } = await import('../../editor/preview/package-resolver.js');
    return startEditorPreviewHost({
      windowRef: globalThis.window,
      startProductionApplication: startGenericProductionApplication,
      expectedOrigin: globalThis.location.origin
    });
  }
  return startGenericProductionApplication();
}

if (globalThis.document) {
  initialize().catch((error) => {
    console.error(error);
    renderProjectLoadError(error, { documentRef: globalThis.document });
    const status = globalThis.document.getElementById('runtime-status');
    if (status) status.textContent = 'Project failed to load.';
  });
}
