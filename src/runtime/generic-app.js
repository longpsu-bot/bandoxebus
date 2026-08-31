import { startApplication } from '../application.js';
import { prepareBasemapStyle, stripOpenFreeMapDarkStyle } from '../basemap-style.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../capabilities/installed-capabilities.js';
import { renderProjectLoadError } from '../project/bootstrap.js';
import { bindGenericStoryExperience } from './generic-shell.js';

async function createGenericMap({ project, maplibregl }) {
  const response = await fetch('../../style-openfreemap-dark.json');
  if (!response.ok) throw new Error(`Could not load basemap style (${response.status}).`);
  const style = prepareBasemapStyle(stripOpenFreeMapDarkStyle(await response.json()));
  return new maplibregl.Map({
    container: 'map',
    style,
    ...project.map.initialView,
    maxPitch: 72,
    antialias: true,
    canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' }
  });
}

export function createGenericApplicationOptions({
  manifestUrl = '../../project.json',
  fetchImpl = fetch,
  resolveAssetUrl,
  signal,
  owner,
  replaceExisting = false,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  maplibregl = globalThis.maplibregl,
  Chart = globalThis.Chart
} = {}) {
  const reducedMotion = windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  return {
    manifestUrl,
    fetchImpl,
    resolveAssetUrl,
    signal,
    owner,
    replaceExisting,
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY,
    maplibregl,
    Chart,
    documentRef,
    reducedMotion,
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
