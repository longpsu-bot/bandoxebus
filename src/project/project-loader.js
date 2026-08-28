import { composeCapabilities } from '../capabilities/capability-composer.js';
import { createCoreMap10Normalizers } from '../capabilities/core-map-v1.js';
import { normalizeStory10 } from '../capabilities/story-1.0-normalizer.js';
import { validateStoryDefinition } from '../story-schema.js';
import { resolveManifestResourceUrls } from './path-resolver.js';
import { ProjectLoadError } from './project-error.js';
import { validateProjectManifest } from './project-schema.js';
import { validateManifestReferences, validateResolvedReferences } from './reference-validator.js';
import { loadJsonResource, loadProjectResources } from './resource-loader.js';
import { validateGeoJsonResource, validateMetricFile, validateTableData } from './resource-schemas.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function absoluteUrl(value) {
  return new URL(value, globalThis.location?.href ?? 'http://localhost/');
}

function semanticValidator(id, descriptor) {
  const path = `$.datasets.${id}`;
  if (descriptor.type === 'geojson') {
    return (value) => validateGeoJsonResource(value, descriptor, { path });
  }
  if (descriptor.type === 'table-json') {
    return (value) => validateTableData(value, { path });
  }
  return undefined;
}

function referencedDatasetIds(manifest, capabilities) {
  const referenced = new Set();
  for (const target of Object.values(manifest.focusTargets)) {
    for (const id of target.datasets ?? []) referenced.add(id);
  }
  const requiredRoles = new Set(capabilities.datasetRoles.filter(({ required }) => required).map(({ role }) => role));
  for (const [id, descriptor] of Object.entries(manifest.datasets)) {
    if (requiredRoles.has(descriptor.role)) referenced.add(id);
  }
  return referenced;
}

function resourceRequests(manifest, urls, capabilities) {
  const primaryIndex = manifest.stories.items.findIndex(({ id }) => id === manifest.stories.primary);
  const requests = [{
    id: `story:${manifest.stories.primary}`,
    url: urls.stories[manifest.stories.primary],
    path: `$.stories.items[${primaryIndex}].src`,
    required: true
  }];
  const referenced = referencedDatasetIds(manifest, capabilities);
  for (const [id, descriptor] of Object.entries(manifest.datasets)) {
    requests.push({
      id: `dataset:${id}`,
      url: urls.datasets[id],
      path: `$.datasets.${id}.src`,
      required: descriptor.required !== false,
      referenced: referenced.has(id),
      validate: semanticValidator(id, descriptor)
    });
  }
  if (manifest.metrics) {
    requests.push({
      id: 'metrics',
      url: urls.metrics,
      path: '$.metrics.src',
      required: true,
      validate: (value) => validateMetricFile(value, { path: '$.metrics' })
    });
  }
  return requests;
}

function resolvedResources(manifest, urls, values) {
  const resources = new Map();
  for (const [id, descriptor] of Object.entries(manifest.datasets)) {
    const key = `dataset:${id}`;
    if (values.has(key)) {
      resources.set(id, deepFreeze({ id, kind: 'dataset', descriptor, url: urls.datasets[id], value: values.get(key) }));
    }
  }
  for (const [id, descriptor] of Object.entries(manifest.assets)) {
    resources.set(id, deepFreeze({ id, kind: 'asset', descriptor, url: urls.assets[id] }));
  }
  if (manifest.metrics && values.has('metrics')) {
    resources.set('metrics', deepFreeze({ id: 'metrics', kind: 'metrics', url: urls.metrics, value: values.get('metrics') }));
  }
  return Object.freeze(resources);
}

function storyNormalizers(capabilities, focusTargets) {
  const byType = { ...capabilities.legacyNormalizers };
  for (const normalizer of createCoreMap10Normalizers({ focusTargets })) {
    byType[normalizer.legacyType] = normalizer;
  }
  return Object.freeze(Object.values(byType));
}

function rawStoryContracts(story, normalizers, capabilities) {
  const normalizerByType = new Map(normalizers.map((normalizer) => [normalizer.legacyType, normalizer]));
  const contracts = {};
  for (const state of story.states ?? []) {
    for (const phase of ['enter', 'exit']) {
      for (const action of state.map?.[phase] ?? []) {
        if (contracts[action?.type]) continue;
        const normalizer = normalizerByType.get(action?.type);
        if (normalizer) contracts[action.type] = (value, path) => normalizer.validate(value, path);
        else if (capabilities.actionDescriptors[action?.type]) {
          contracts[action.type] = (value, path) => {
            try { capabilities.validateAction(value, { path }); return null; }
            catch (error) { return error.message; }
          };
        } else if (typeof action?.type === 'string') {
          contracts[action.type] = () => null;
        }
      }
    }
  }
  return contracts;
}

function canonicalStoryContracts(capabilities) {
  return Object.fromEntries(Object.keys(capabilities.actionDescriptors).map((type) => [
    type,
    (value, path) => {
      try { capabilities.validateAction(value, { path }); return null; }
      catch (error) { return error.message; }
    }
  ]));
}

function bindingsFor(manifest) {
  const byRole = Object.fromEntries(Object.entries(manifest.datasets)
    .filter(([, descriptor]) => descriptor.role)
    .map(([id, descriptor]) => [descriptor.role, id]));
  const routeSettings = manifest.capabilities.find(({ id }) => id === 'route-comparison-v1')?.settings ?? {};
  return Object.freeze({
    proposedRouteTarget: routeSettings.proposedRouteTarget ?? byRole['route.proposed'],
    poiTarget: routeSettings.poiTarget
  });
}

function validateAndNormalizeStory(rawStory, manifest, capabilities) {
  if (rawStory?.schemaVersion !== '1.0') {
    throw new ProjectLoadError('STORY_VERSION_UNSUPPORTED', '$.schemaVersion', `Unsupported Story schemaVersion: ${rawStory?.schemaVersion ?? ''}.`);
  }
  const normalizers = storyNormalizers(capabilities, Object.keys(manifest.focusTargets));
  validateStoryDefinition(rawStory, { actionContracts: rawStoryContracts(rawStory, normalizers, capabilities) });
  const normalized = normalizeStory10(rawStory, {
    normalizers,
    actionDescriptors: capabilities.actionDescriptors,
    bindings: bindingsFor(manifest)
  });
  validateStoryDefinition(normalized, { actionContracts: canonicalStoryContracts(capabilities) });
  return normalized;
}

export async function loadProject(manifestUrl = './project.json', {
  fetchImpl = fetch,
  capabilityRegistry,
  signal
} = {}) {
  if (!capabilityRegistry) {
    throw new ProjectLoadError('CAPABILITY_REGISTRY_REQUIRED', '$.capabilities', 'A trusted capability registry is required.');
  }
  const resolvedManifestUrl = absoluteUrl(manifestUrl);
  const authoredManifest = await loadJsonResource(resolvedManifestUrl, {
    fetchImpl,
    signal,
    path: '$',
    validate: validateProjectManifest
  });
  validateManifestReferences(authoredManifest);
  const manifest = deepFreeze(structuredClone(authoredManifest));
  const urls = resolveManifestResourceUrls(manifest, resolvedManifestUrl);
  const capabilities = composeCapabilities({
    registry: capabilityRegistry,
    declarations: manifest.capabilities,
    datasets: manifest.datasets
  });
  const loaded = await loadProjectResources(resourceRequests(manifest, urls, capabilities), { fetchImpl, signal });
  const resources = resolvedResources(manifest, urls, loaded.values);
  const rawStory = loaded.values.get(`story:${manifest.stories.primary}`);
  validateResolvedReferences({ manifest, story: rawStory, resources, capabilities });
  const story = validateAndNormalizeStory(rawStory, manifest, capabilities);
  const metadata = deepFreeze(Object.fromEntries([
    'id', 'title', 'subtitle', 'description', 'organization', 'author', 'projectDate', 'projectVersion'
  ].filter((key) => manifest[key] !== undefined).map((key) => [key, manifest[key]])));

  return deepFreeze({
    manifest,
    manifestUrl: resolvedManifestUrl,
    urls,
    metadata,
    locale: manifest.locale,
    map: manifest.map,
    story,
    resources,
    focusTargets: manifest.focusTargets,
    attribution: manifest.attribution,
    capabilities,
    warnings: loaded.warnings
  });
}
