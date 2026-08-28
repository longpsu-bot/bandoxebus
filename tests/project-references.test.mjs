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
