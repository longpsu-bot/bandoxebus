import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  validateManifestReferences,
  validateResolvedReferences
} from '../src/project/reference-validator.js';
import { validateProjectManifest } from '../src/project/project-schema.js';

const fixture = fileURLToPath(new URL('./fixtures/contracts/project.valid.json', import.meta.url));

async function validManifest() {
  return JSON.parse(await readFile(fixture, 'utf8'));
}

function assertReferenceIssue(manifest, path, message = /./) {
  assert.throws(
    () => validateManifestReferences(manifest),
    (error) => error.code === 'PROJECT_REFERENCE_INVALID'
      && error.path === path
      && message.test(error.message)
  );
}

function snapshotMetadata() {
  return {
    asset: 'overture-buildings-snapshot',
    theme: 'buildings',
    bounds: [106.58, 11.10, 106.62, 11.15],
    sha256: 'a'.repeat(64),
    byteLength: 12_345_678,
    generator: 'go-pmtiles',
    generatorVersion: '1.31.2',
    generatedAt: '2026-09-03T02:00:00Z'
  };
}

async function snapshotManifest() {
  const manifest = await validManifest();
  manifest.assets['overture-buildings-snapshot'] = {
    type: 'pmtiles',
    src: './assets/context/overture-buildings.pmtiles',
    mediaType: 'application/vnd.pmtiles',
    required: true,
    attribution: []
  };
  manifest.capabilities.push({
    id: 'urban-context-v1',
    settings: {
      adapter: 'route-61-2-current',
      buildingSource: 'project-snapshot',
      overtureRelease: '2026-08-19.0',
      snapshot: snapshotMetadata()
    }
  });
  return manifest;
}

test('manifest structural references resolve to declared IDs', async () => {
  const manifest = await validManifest();
  assert.equal(validateProjectManifest(manifest), manifest);
  assert.equal(validateManifestReferences(manifest), manifest);

  const invalid = structuredClone(manifest);
  invalid.focusTargets.overview.datasets = ['missing-route'];
  assertReferenceIssue(invalid, '$.focusTargets.overview.datasets[0]', /dataset/i);
});

test('primary Story ID must resolve to a declared Story', async () => {
  const manifest = await validManifest();
  manifest.stories.primary = 'missing-story';
  assertReferenceIssue(manifest, '$.stories.primary', /Story/i);
});

test('dataset and asset attribution IDs resolve without duplicates', async () => {
  const cases = [
    ['datasets', 'existing-route', '$.datasets.existing-route.attribution'],
    ['assets', 'site-photo', '$.assets.site-photo.attribution']
  ];

  for (const [registry, id, path] of cases) {
    const missing = await validManifest();
    missing[registry][id].attribution = ['missing-source'];
    assertReferenceIssue(missing, `${path}[0]`, /attribution/i);

    const duplicate = await validManifest();
    const source = duplicate[registry][id].attribution[0];
    duplicate[registry][id].attribution = [source, source];
    assertReferenceIssue(duplicate, `${path}[1]`, /duplicate attribution/i);
  }
});

test('focus target forms are mutually exclusive and require their declared shape', async () => {
  const cases = [
    ['overview', 'center', [106.6, 11], '$.focusTargets.overview.center'],
    ['town-center', 'bounds', [[106.5, 10.9], [106.7, 11.1]], '$.focusTargets.town-center.bounds'],
    ['study-area', 'datasets', ['existing-route'], '$.focusTargets.study-area.datasets']
  ];

  for (const [target, field, value, path] of cases) {
    const manifest = await validManifest();
    manifest.focusTargets[target][field] = value;
    assertReferenceIssue(manifest, path, /only|exclusive|unexpected/i);
  }

  const missingZoom = await validManifest();
  delete missingZoom.focusTargets['town-center'].zoom;
  assertReferenceIssue(missingZoom, '$.focusTargets.town-center.zoom', /required/i);
});

test('coordinate and bounds focus values are geographic and ordered southwest to northeast', async () => {
  const invalidCoordinate = await validManifest();
  invalidCoordinate.focusTargets['town-center'].center = [106.6, 91];
  assertReferenceIssue(invalidCoordinate, '$.focusTargets.town-center.center[1]', /latitude/i);

  const invalidZoom = await validManifest();
  invalidZoom.focusTargets['town-center'].zoom = 25;
  assertReferenceIssue(invalidZoom, '$.focusTargets.town-center.zoom', /zoom/i);

  for (const bounds of [
    [[106.72, 10.98], [106.55, 11.14]],
    [[106.55, 11.14], [106.72, 10.98]],
    [[106.55, 10.98], [106.55, 11.14]]
  ]) {
    const manifest = await validManifest();
    manifest.focusTargets['study-area'].bounds = bounds;
    assertReferenceIssue(manifest, '$.focusTargets.study-area.bounds', /southwest|northeast|order/i);
  }
});

test('focus camera hints stay finite and inside the contract bounds', async () => {
  const cases = [
    ['maxZoom', 25, '$.focusTargets.overview.camera.maxZoom'],
    ['pitch', 73, '$.focusTargets.overview.camera.pitch'],
    ['bearing', 361, '$.focusTargets.overview.camera.bearing'],
    ['padding', 257, '$.focusTargets.overview.camera.padding'],
    ['padding', Number.POSITIVE_INFINITY, '$.focusTargets.overview.camera.padding']
  ];

  for (const [field, value, path] of cases) {
    const manifest = await validManifest();
    manifest.focusTargets.overview.camera[field] = value;
    assertReferenceIssue(manifest, path, /bounded|between|finite/i);
  }
});

test('provenance registry IDs, dates, and URLs are structurally valid', async () => {
  const invalidId = await validManifest();
  invalidId.attribution['Invalid Source'] = invalidId.attribution['transport-authority'];
  delete invalidId.attribution['transport-authority'];
  assertReferenceIssue(invalidId, '$.attribution.Invalid Source', /ID/i);

  const invalidDate = await validManifest();
  invalidDate.attribution['transport-authority'].updated = '2026-02-30';
  assertReferenceIssue(invalidDate, '$.attribution.transport-authority.updated', /date/i);

  for (const url of ['not a url', 'http://example.org/data', 'javascript:alert(1)']) {
    const manifest = await validManifest();
    manifest.attribution['transport-authority'].url = url;
    assertReferenceIssue(manifest, '$.attribution.transport-authority.url', /HTTPS URL/i);
  }
});

test('all manifest registry keys use structurally valid IDs', async () => {
  for (const registry of ['datasets', 'assets', 'focusTargets']) {
    const manifest = await validManifest();
    const [id, value] = Object.entries(manifest[registry])[0];
    delete manifest[registry][id];
    manifest[registry]['Invalid ID'] = value;
    assertReferenceIssue(manifest, `$.${registry}.Invalid ID`, /ID/i);
  }
});

test('project-snapshot references one bounded declared PMTiles asset', async () => {
  const valid = await snapshotManifest();
  assert.equal(validateProjectManifest(valid), valid);
  assert.equal(validateManifestReferences(valid), valid);

  const capabilityIndex = valid.capabilities.findIndex(({ id }) => id === 'urban-context-v1');
  const basePath = `$.capabilities[${capabilityIndex}].settings.snapshot`;

  const cases = [
    ['missing-snapshot', `${basePath}`, (manifest) => { delete manifest.capabilities[capabilityIndex].settings.snapshot; }],
    ['missing-asset', `${basePath}.asset`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.asset = 'missing'; }],
    ['image-asset', `${basePath}.asset`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.asset = 'site-photo'; }],
    ['short-bounds', `${basePath}.bounds`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.bounds = [1, 2, 3]; }],
    ['lon-range', `${basePath}.bounds`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.bounds = [-181, 10, 20, 30]; }],
    ['lat-range', `${basePath}.bounds`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.bounds = [10, -91, 20, 30]; }],
    ['bounds-order', `${basePath}.bounds`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.bounds = [20, 10, 10, 30]; }],
    ['sha', `${basePath}.sha256`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.sha256 = 'ABC'; }],
    ['zero-bytes', `${basePath}.byteLength`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.byteLength = 0; }],
    ['too-large', `${basePath}.byteLength`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.byteLength = 67_108_865; }],
    ['theme', `${basePath}.theme`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.theme = 'roads'; }],
    ['generator', `${basePath}.generator`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.generator = 'custom'; }],
    ['generator-version', `${basePath}.generatorVersion`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.generatorVersion = 'latest'; }],
    ['generated-at', `${basePath}.generatedAt`, (manifest) => { manifest.capabilities[capabilityIndex].settings.snapshot.generatedAt = 'not-an-instant'; }]
  ];

  for (const [, path, mutate] of cases) {
    const manifest = await snapshotManifest();
    mutate(manifest);
    assertReferenceIssue(manifest, path);
  }

  for (const buildingSource of ['overture-pmtiles', 'local-geojson']) {
    const manifest = await snapshotManifest();
    manifest.capabilities[capabilityIndex].settings.buildingSource = buildingSource;
    assertReferenceIssue(manifest, basePath, /only/i);
  }
});

test('resolved-reference boundary defers fetched payload and capability semantics in Slice 1', async () => {
  const manifest = await validManifest();
  assert.equal(validateResolvedReferences({
    manifest,
    story: { future: 'unchecked' },
    resources: { future: 'unchecked' },
    metrics: { future: 'unchecked' },
    capabilities: { future: 'unchecked' }
  }), true);
});

test('snapshot generatedAt accepts canonical UTC instants and rejects calendar normalization', async () => {
  for (const generatedAt of [
    '2026-09-03T02:00:00Z',
    '2026-09-03T02:00:00.000Z',
    '2026-09-03T02:00:00.123Z'
  ]) {
    const manifest = await snapshotManifest();
    manifest.capabilities.at(-1).settings.snapshot.generatedAt = generatedAt;
    assert.equal(validateManifestReferences(manifest), manifest);
  }
  for (const generatedAt of [
    '2026-02-30T02:00:00Z',
    '2026-09-03T24:00:00Z',
    '2026-09-03T02:00:00+00:00',
    '2026-09-03T09:00:00+07:00',
    '2026-09-03T02:00:00',
    '2026-09-03'
  ]) {
    const manifest = await snapshotManifest();
    manifest.capabilities.at(-1).settings.snapshot.generatedAt = generatedAt;
    assertReferenceIssue(manifest, `$.capabilities[${manifest.capabilities.length - 1}].settings.snapshot.generatedAt`, /ISO instant/i);
  }
});

test('snapshot bounds require finite coordinates and strict order on both axes', async () => {
  for (const bounds of [
    [10, 20, 10, 30],
    [10, 20, 30, 20],
    [10, 30, 20, 20],
    [10, 20, 181, 30],
    [10, 20, 30, 91],
    [10, 20, 30, 40, 50],
    [10, 20, 30, Number.POSITIVE_INFINITY],
    [10, '20', 30, 40]
  ]) {
    const manifest = await snapshotManifest();
    manifest.capabilities.at(-1).settings.snapshot.bounds = bounds;
    assertReferenceIssue(manifest, `$.capabilities[${manifest.capabilities.length - 1}].settings.snapshot.bounds`);
  }
  const manifest = await snapshotManifest();
  manifest.capabilities.at(-1).settings.snapshot.bounds = [-180, -90, 180, 90];
  assert.equal(validateManifestReferences(manifest), manifest);
});

test('snapshot references require every logical field and enforce byte and provenance bounds', async () => {
  for (const field of ['asset', 'theme', 'bounds', 'sha256', 'byteLength', 'generator', 'generatorVersion', 'generatedAt']) {
    const manifest = await snapshotManifest();
    delete manifest.capabilities.at(-1).settings.snapshot[field];
    assertReferenceIssue(manifest, `$.capabilities[${manifest.capabilities.length - 1}].settings.snapshot.${field}`);
  }
  for (const [field, value] of [
    ['byteLength', -1], ['byteLength', 1.5],
    ['sha256', 'A'.repeat(64)], ['sha256', 'a'.repeat(63)], ['sha256', 'a'.repeat(65)],
    ['sourceContentLength', -1], ['sourceContentLength', 1.5], ['sourceEtag', 123]
  ]) {
    const manifest = await snapshotManifest();
    manifest.capabilities.at(-1).settings.snapshot[field] = value;
    assertReferenceIssue(manifest, `$.capabilities[${manifest.capabilities.length - 1}].settings.snapshot.${field}`);
  }
  for (const byteLength of [1, 67_108_864]) {
    const manifest = await snapshotManifest();
    Object.assign(manifest.capabilities.at(-1).settings.snapshot, {
      byteLength, sourceContentLength: 0, sourceEtag: '"source-version"'
    });
    assert.equal(validateManifestReferences(manifest), manifest);
  }
});
