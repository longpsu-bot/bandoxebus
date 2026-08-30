import assert from 'node:assert/strict';
import test from 'node:test';

import { renderEntityInspector } from '../editor/ui/inspectors.js';

function manifest() {
  return {
    datasets: {},
    assets: {},
    focusTargets: {},
    capabilities: [],
    attribution: { agency: { name: 'Agency' } }
  };
}

function metricFile() {
  return { schemaVersion: '1.0', metrics: {} };
}

function computed() {
  return [{ id: 'route-length', label: 'Route length', valueType: 'number', format: { type: 'distance' } }];
}

test('computed descriptors are selectable but never written to static metrics', () => {
  const draft = { manifest: manifest(), metrics: metricFile() };
  const writes = [];
  const ui = renderEntityInspector({
    kind: 'metric', manifest: draft.manifest, metricsFile: draft.metrics, computed: computed(),
    mutate: (updater) => updater(draft.manifest),
    writeResource: (_path, value) => { draft.metrics = structuredClone(value); writes.push(value); }
  });

  assert.equal(ui.metric('route-length').readOnly, true);
  assert.equal(ui.metricOptions().includes('route-length'), true);
  assert.equal(Object.hasOwn(draft.metrics.metrics, 'route-length'), false);
  assert.equal('poll' in ui, false);
  assert.equal('subscribeComputedValues' in ui, false);
  assert.deepEqual(writes, []);
});

test('image add writes only declared manifest vocabulary and stable package bytes', () => {
  const draft = manifest();
  const writes = [];
  const ui = renderEntityInspector({
    kind: 'asset', manifest: draft, assetBytes: {}, mutate: (updater) => updater(draft),
    writeBinary: (path, bytes, descriptor) => writes.push({ path, bytes: [...bytes], descriptor })
  });
  ui.command('add-image', 'network-map', {
    bytes: new Uint8Array([1, 2, 3]), mediaType: 'image/png', required: true, attribution: ['agency'],
    alt: 'Not manifest data', caption: 'Not manifest data', title: 'Not manifest data', decorative: false
  });

  assert.deepEqual(draft.assets['network-map'], {
    type: 'image', src: './assets/network-map.png', mediaType: 'image/png', required: true, attribution: ['agency']
  });
  assert.deepEqual(writes[0], {
    path: 'assets/network-map.png', bytes: [1, 2, 3],
    descriptor: { id: 'network-map', kind: 'asset', mediaType: 'image/png' }
  });
  for (const field of ['alt', 'caption', 'title', 'decorative']) assert.equal(field in draft.assets['network-map'], false);
});

test('image replacement keeps the declared path/type and removal reports Story reference impact', () => {
  const draft = manifest();
  draft.assets.photo = { type: 'image', src: './assets/photo.webp', mediaType: 'image/webp' };
  const bytes = { photo: new Uint8Array([1]) };
  const stories = {
    main: { schemaVersion: '1.1', states: [{ id: 'opening', content: { layout: 'hero', blocks: [
      { type: 'image', asset: 'photo', alt: 'A photo' },
      { type: 'legend', items: [{ label: 'Place', sample: 'icon', asset: 'photo' }] }
    ] }, map: { enter: [], exit: [] } }] }
  };
  const writes = [];
  const removals = [];
  const ui = renderEntityInspector({
    kind: 'asset', manifest: draft, assetBytes: bytes, stories,
    mutate: (updater) => updater(draft),
    writeBinary: (path, value) => { writes.push({ path, value: [...value] }); bytes.photo = value.slice(); },
    removeResource: (path) => removals.push(path)
  });

  ui.entity('photo').command('replace', new Uint8Array([4, 5]));
  assert.deepEqual(writes[0], { path: 'assets/photo.webp', value: [4, 5] });
  assert.equal(draft.assets.photo.mediaType, 'image/webp');
  const impact = ui.entity('photo').command('request-delete');
  assert.deepEqual(impact.brokenReferences, [
    'stories.main.states[0].content.blocks[0].asset',
    'stories.main.states[0].content.blocks[1].items[0].asset'
  ]);
  ui.entity('photo').command('confirm-delete');
  assert.equal(draft.assets.photo, undefined);
  assert.deepEqual(removals, ['assets/photo.webp']);
});

test('asset thumbnails use cached local object URLs and revoke them on cleanup', () => {
  const draft = manifest();
  draft.assets.photo = { type: 'image', src: './assets/photo.png', mediaType: 'image/png' };
  const created = [];
  const revoked = [];
  const ui = renderEntityInspector({
    kind: 'asset', manifest: draft, assetBytes: { photo: new Uint8Array([1, 2]) },
    mutate: (updater) => updater(draft), writeBinary() {}, removeResource() {},
    urlApi: {
      createObjectURL(blob) { created.push(blob.type); return 'blob:photo'; },
      revokeObjectURL(url) { revoked.push(url); }
    }
  });
  assert.equal(ui.entity('photo').thumbnailUrl(), 'blob:photo');
  assert.equal(ui.entity('photo').thumbnailUrl(), 'blob:photo');
  assert.deepEqual(created, ['image/png']);
  ui.dispose();
  assert.deepEqual(revoked, ['blob:photo']);
});

test('static metrics support literal scalar/null values and exact format controls', () => {
  const draft = { manifest: manifest(), metrics: metricFile() };
  const ui = renderEntityInspector({
    kind: 'metric', manifest: draft.manifest, metricsFile: draft.metrics, computed: computed(),
    mutate: (updater) => updater(draft.manifest),
    writeResource: (_path, value) => { draft.metrics = structuredClone(value); ui.replaceMetricsFile(draft.metrics); }
  });

  const formats = [
    ['count', 3, { type: 'integer' }],
    ['average', 3.25, { type: 'decimal', decimals: 2, unit: 'km' }],
    ['share', 0.5, { type: 'percentage', decimals: 1 }],
    ['length', 1200, { type: 'distance', decimals: 1 }],
    ['cost', 50, { type: 'currency', currency: 'USD' }],
    ['status', null, { type: 'text' }]
  ];
  for (const [id, value, format] of formats) ui.command('add-static', id, { label: id, value, format });

  assert.deepEqual(Object.keys(draft.metrics.metrics), formats.map(([id]) => id));
  assert.equal(draft.manifest.metrics.src, './data/metrics.json');
  assert.deepEqual(ui.metric('cost').formatControls(), ['type', 'currency']);
  assert.deepEqual(ui.metric('average').formatControls(), ['type', 'decimals', 'unit']);
  assert.equal(ui.metricOptions().includes('route-length'), true);
});

test('static metric edits surface production validation errors and computed entries stay disabled', () => {
  const draft = { manifest: manifest(), metrics: metricFile() };
  const ui = renderEntityInspector({
    kind: 'metric', manifest: draft.manifest, metricsFile: draft.metrics, computed: computed(),
    mutate: (updater) => updater(draft.manifest),
    writeResource: (_path, value) => { draft.metrics = structuredClone(value); ui.replaceMetricsFile(draft.metrics); }
  });
  ui.command('add-static', 'share', { label: 'Share', value: 0.5, format: { type: 'percentage', decimals: 1 } });
  assert.throws(
    () => ui.metric('share').control('format.decimals').set(3),
    (error) => error.code === 'METRIC_FILE_INVALID' && error.path === '$.metrics.share.format.decimals'
  );
  assert.throws(() => ui.metric('route-length').control('value').set(2), /read-only/i);
});
