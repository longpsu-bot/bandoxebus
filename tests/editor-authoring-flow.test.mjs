import assert from 'node:assert/strict';
import test from 'node:test';

import { CORE_CONTENT_V1_DESCRIPTOR } from '../src/capabilities/core-content-v1.js';
import { CORE_MAP_V1_DESCRIPTOR } from '../src/capabilities/core-map-v1.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import { loadProject } from '../src/project/project-loader.js';
import { createDraftStore } from '../editor/core/draft-store.js';
import { createNewProjectEntries, createPackageStore } from '../editor/core/package-store.js';
import { createPackageFetch } from '../editor/preview/package-resolver.js';
import { renderEntityInspector } from '../editor/ui/inspectors.js';
import { createStoryEditor } from '../editor/ui/story-editor.js';

function geo(type, coordinates, properties = {}) {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties, geometry: { type, coordinates } }] };
}

function createHarness() {
  const packageStore = createPackageStore({ origin: { kind: 'memory' }, entries: createNewProjectEntries() });
  const draftStore = createDraftStore({ packageStore });
  function manifest() { return draftStore.get('project.json'); }
  function mutate(updater) { draftStore.mutate('project.json', updater); }
  function writeJson(path, value, descriptor) {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    if (!packageStore.get(path)) packageStore.setManaged(path, { bytes: text, ...descriptor, managed: true });
    draftStore.replaceText(path, text);
  }
  function writeBinary(path, bytes, descriptor) {
    if (packageStore.get(path)) packageStore.setCurrentBytes(path, bytes);
    else packageStore.setManaged(path, { bytes, ...descriptor, managed: true });
  }
  function inspect(kind, options = {}) {
    const current = manifest();
    const resources = Object.fromEntries(Object.entries(current.datasets).map(([id, descriptor]) => [id, draftStore.get(descriptor.src.slice(2))]));
    return renderEntityInspector({
      kind, manifest: current, resources, mutate,
      writeResource: writeJson,
      writeBinary,
      removeResource: (path) => packageStore.removeManaged(path),
      assetBytes: Object.fromEntries(Object.entries(current.assets).map(([id, descriptor]) => [id, packageStore.get(descriptor.src.slice(2)).currentBytes.slice()])),
      metricsFile: current.metrics ? draftStore.get(current.metrics.src.slice(2)) : undefined,
      ...options
    });
  }
  return { packageStore, draftStore, manifest, mutate, writeJson, inspect };
}

test('integrated UI commands author a production-loadable project without editor metadata', async () => {
  const h = createHarness();
  const data = h.inspect('dataset');
  data.command('add-geojson', 'route', {
    geometry: 'line', label: 'Route', value: geo('LineString', [[106.5, 10.9], [106.7, 11.1]], { name: 'Route' })
  });
  data.entity('route').control('render.type').set('line');
  data.entity('route').control('render.color').set('#00AAFF');
  data.command('add-geojson', 'stops', {
    geometry: 'point', label: 'Stops', value: geo('Point', [106.6, 11], { name: 'Stop' })
  });
  data.entity('stops').control('render.type').set('point');
  data.entity('stops').control('render.color').set('#FFFFFF');
  data.command('add-geojson', 'area', {
    geometry: 'polygon', label: 'Area',
    value: geo('Polygon', [[[106.5, 10.9], [106.7, 10.9], [106.7, 11.1], [106.5, 10.9]]], { name: 'Area' })
  });
  data.entity('area').control('render.type').set('fill');
  data.entity('area').control('render.color').set('#00AAFF33');
  data.command('add-table', 'demand', {
    label: 'Demand', value: {
      schemaVersion: '1.0',
      columns: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'value', label: 'Value', type: 'number' }],
      rows: [{ name: 'A', value: 10 }]
    }
  });

  h.inspect('asset').command('add-image', 'photo', { bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png' });
  h.inspect('metric').command('add-static', 'total', { label: 'Total', value: 10, format: { type: 'integer' } });
  h.inspect('focus').command('add', 'overview', { type: 'datasets', datasets: ['route', 'stops', 'area'], camera: { padding: 24 } });

  const currentManifest = h.manifest();
  const stories = { main: h.draftStore.get('stories/main.story.json') };
  const metricFile = h.draftStore.get('data/metrics.json');
  const storyUi = createStoryEditor({
    manifest: currentManifest,
    stories,
    mutateManifest: h.mutate,
    writeStory: (_id, value) => h.draftStore.mutate('stories/main.story.json', () => value),
    removeStory() {},
    contentDescriptors: CORE_CONTENT_V1_DESCRIPTOR.content,
    actionDescriptors: CORE_MAP_V1_DESCRIPTOR.actions,
    catalogs: {
      tables: [{ id: 'demand', columns: h.draftStore.get('data/demand.json').columns }],
      assets: [{ id: 'photo' }],
      metrics: Object.entries(metricFile.metrics).map(([id, metric]) => ({ id, label: metric.label, format: metric.format })),
      targets: ['overview', 'route', 'stops', 'area'].map((id) => ({ id })),
      attribution: []
    }
  });
  storyUi.story('main').command('add-state', { title: 'Details' });
  const authoring = storyUi.story('main').authoring();
  for (const type of ['table', 'chart', 'image', 'legend']) authoring.command('add-block', { stateIndex: 1, type });
  authoring.command('add-action', { stateIndex: 0, phase: 'enter', type: 'map.focus', values: { target: 'overview' } });
  authoring.command('add-action', { stateIndex: 0, phase: 'enter', type: 'map.set-visibility', values: { target: 'area', visible: true } });
  authoring.command('add-action', { stateIndex: 1, phase: 'enter', type: 'map.set-emphasis', values: { target: 'route', active: true } });
  storyUi.story('main').command('move-state', { from: 1, to: 0 });

  const snapshot = h.packageStore.snapshot();
  const transport = createPackageFetch(snapshot);
  const project = await loadProject(transport.manifestUrl, {
    fetchImpl: transport.fetchImpl,
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY
  });
  assert.equal(project.story.states.length, 2);
  assert.deepEqual(Object.keys(project.manifest.datasets).sort(), ['area', 'demand', 'route', 'stops']);
  assert.deepEqual(Object.keys(project.manifest.assets), ['photo']);
  assert.deepEqual(Object.keys(project.manifest.focusTargets), ['overview']);
  assert.equal(project.metrics.resolve('total').value, 10);

  for (const entry of snapshot.entries.filter(({ mediaType }) => mediaType.includes('json'))) {
    const value = JSON.parse(new TextDecoder().decode(entry.bytes));
    const serialized = JSON.stringify(value);
    assert.equal(/"(?:editor|uiState|guiMetadata)"\s*:/.test(serialized), false, entry.path);
  }
  assert.equal(snapshot.entries.some(({ path }) => path.includes('chartjs') || path.includes('maplibre-layer')), false);
});
