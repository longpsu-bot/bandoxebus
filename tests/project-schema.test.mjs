import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  PROJECT_MANIFEST_SCHEMA_URL,
  PROJECT_MANIFEST_V1_SCHEMA,
  validateProjectManifest
} from '../src/project/project-schema.js';
import { ProjectLoadError } from '../src/project/project-error.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/contracts/${name}`, import.meta.url));

async function loadFixture(name = 'project.valid.json') {
  return JSON.parse(await readFile(fixture(name), 'utf8'));
}

function assertManifestIssue(manifest, path, message = /./) {
  assert.throws(
    () => validateProjectManifest(manifest),
    (error) => error instanceof ProjectLoadError
      && error.code === 'PROJECT_MANIFEST_INVALID'
      && error.path === path
      && message.test(error.message)
  );
}

test('Manifest 1.0 accepts the minimal safe package and rejects executable fields', async () => {
  const valid = await loadFixture();
  assert.equal(validateProjectManifest(valid), valid);

  const unsafe = await loadFixture('project.invalid-executable.json');
  assertManifestIssue(unsafe, '$.capabilities[0].module', /unknown property/i);
});

test('canonical manifest schema is frozen and points to the checked-in JSON schema', () => {
  assert.equal(Object.isFrozen(PROJECT_MANIFEST_V1_SCHEMA), true);
  assert.equal(PROJECT_MANIFEST_SCHEMA_URL.protocol, 'file:');
  assert.match(PROJECT_MANIFEST_SCHEMA_URL.pathname, /project-manifest-v1\.schema\.json$/);
});

test('ProjectLoadError exposes deterministic enumerable contract fields and preserves cause', () => {
  const cause = new Error('root cause');
  const error = new ProjectLoadError('TEST_CODE', '$.value', 'Safe message.', { cause });
  assert.deepEqual(Object.keys(error), ['code', 'path', 'message']);
  assert.equal(error.code, 'TEST_CODE');
  assert.equal(error.path, '$.value');
  assert.equal(error.message, 'Safe message.');
  assert.equal(error.cause, cause);
});

test('manifest rejects unknown top-level properties and malformed stable IDs', async () => {
  const unknown = await loadFixture();
  unknown.callback = 'runProject';
  assertManifestIssue(unknown, '$.callback', /unknown property/i);

  const invalidProjectId = await loadFixture();
  invalidProjectId.id = 'Invalid_ID';
  assertManifestIssue(invalidProjectId, '$.id', /pattern/i);

  const invalidStoryId = await loadFixture();
  invalidStoryId.stories.items[0].id = 'Main Story';
  assertManifestIssue(invalidStoryId, '$.stories.items[0].id', /pattern/i);
});

test('manifest requires unique Story IDs and rejects explicit implicit-core declarations', async () => {
  const duplicate = await loadFixture();
  duplicate.stories.items.push({ id: 'main', src: './stories/alternate.story.json' });
  assertManifestIssue(duplicate, '$.stories.items[1].id', /duplicate Story ID/i);

  for (const id of ['core-content-v1', 'core-map-v1']) {
    const manifest = await loadFixture();
    manifest.capabilities = [{ id }];
    assertManifestIssue(manifest, '$.capabilities[0].id', /implicit core capability/i);
  }
});

test('manifest enforces ISO project dates', async () => {
  for (const projectDate of ['2026-02-30', '2026-8-28', 'not-a-date']) {
    const manifest = await loadFixture();
    manifest.projectDate = projectDate;
    assertManifestIssue(manifest, '$.projectDate', /date/i);
  }
});

test('manifest bounds the initial camera without coercion', async () => {
  const cases = [
    ['center', [181, 11], '$.map.initialView.center[0]'],
    ['center', [106, 91], '$.map.initialView.center[1]'],
    ['center', [106], '$.map.initialView.center'],
    ['zoom', -1, '$.map.initialView.zoom'],
    ['zoom', 25, '$.map.initialView.zoom'],
    ['pitch', -1, '$.map.initialView.pitch'],
    ['pitch', 73, '$.map.initialView.pitch'],
    ['bearing', -361, '$.map.initialView.bearing'],
    ['bearing', 361, '$.map.initialView.bearing'],
    ['zoom', '10', '$.map.initialView.zoom']
  ];

  for (const [field, value, path] of cases) {
    const manifest = await loadFixture();
    manifest.map.initialView[field] = value;
    assertManifestIssue(manifest, path);
  }
});

test('manifest minZoom and maxZoom must contain the initial zoom', async () => {
  const cases = [
    [12, 18, '$.map.minZoom'],
    [8, 10, '$.map.maxZoom'],
    [19, 18, '$.map.minZoom']
  ];

  for (const [minZoom, maxZoom, path] of cases) {
    const manifest = await loadFixture();
    manifest.map.minZoom = minZoom;
    manifest.map.maxZoom = maxZoom;
    assertManifestIssue(manifest, path, /zoom/i);
  }
});

test('manifest accepts the bounded PMTiles asset kind and enforces exact media pairing', async () => {
  const valid = await loadFixture();
  valid.assets['overture-buildings-snapshot'] = {
    type: 'pmtiles',
    src: './assets/context/overture-buildings.pmtiles',
    mediaType: 'application/vnd.pmtiles',
    required: true,
    attribution: []
  };
  assert.equal(validateProjectManifest(valid), valid);

  for (const [type, mediaType] of [
    ['image', 'application/vnd.pmtiles'],
    ['pmtiles', 'image/png'],
    ['pmtiles', 'application/octet-stream']
  ]) {
    const manifest = await loadFixture();
    manifest.assets['bad-asset'] = {
      type,
      src: './assets/bad-asset.bin',
      mediaType,
      required: true,
      attribution: []
    };
    assertManifestIssue(manifest, '$.assets.bad-asset.mediaType', /media|allowed|enum/i);
  }
});
