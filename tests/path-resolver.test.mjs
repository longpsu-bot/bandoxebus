import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  resolveManifestResourceUrls,
  resolvePackageUrl
} from '../src/project/path-resolver.js';
import { validateProjectManifest } from '../src/project/project-schema.js';

const manifestUrl = 'https://host.test/maps/project.json';
const fixture = fileURLToPath(new URL('./fixtures/contracts/project.valid.json', import.meta.url));

async function validManifest() {
  return JSON.parse(await readFile(fixture, 'utf8'));
}

function assertUnsafe(authoredPath, options) {
  assert.throws(
    () => resolvePackageUrl(manifestUrl, authoredPath, options),
    (error) => error.code === 'UNSAFE_RESOURCE_PATH'
      && error.path === '$.src'
      && typeof error.message === 'string'
  );
}

test('resource resolution stays inside the same-origin manifest package', () => {
  assert.equal(
    resolvePackageUrl(manifestUrl, './data/a.json').href,
    'https://host.test/maps/data/a.json'
  );
  assert.equal(
    resolvePackageUrl(manifestUrl, 'assets/photo.webp').href,
    'https://host.test/maps/assets/photo.webp'
  );

  for (const value of [
    'https://evil.test/a.json',
    'https://host.test/maps/a.json',
    '//evil.test/a.json',
    '/root/a.json',
    '../a.json',
    './data/../../a.json'
  ]) assertUnsafe(value);
});

test('resource paths reject encoded traversal, backslashes, schemes, and path mutation', () => {
  for (const value of [
    './%2e%2e/a.json',
    './.%2E/a.json',
    './%252e%252e/a.json',
    '.\\data\\a.json',
    './data/%5c..%5ca.json',
    'javascript:alert(1)',
    'data:application/json,{}',
    './data/a.json?version=1',
    './data/a.json#fragment',
    './data/%3Fa.json',
    '',
    '   '
  ]) assertUnsafe(value);
});

test('resource paths reject executable extensions and executable resource kinds', () => {
  for (const value of ['./code.js', './code.mjs', './CODE.JS']) assertUnsafe(value);
  for (const kind of ['script', 'module', 'plugin']) {
    assertUnsafe('./data/config.json', { kind });
  }
});

test('external HTTPS is allowed only for attribution and provenance links', () => {
  assert.equal(
    resolvePackageUrl(manifestUrl, 'https://example.org/source', { kind: 'attribution' }).href,
    'https://example.org/source'
  );
  assert.equal(
    resolvePackageUrl(manifestUrl, 'https://example.org/source', { kind: 'provenance' }).href,
    'https://example.org/source'
  );
  assertUnsafe('http://example.org/source', { kind: 'attribution' });
  assertUnsafe('ftp://example.org/source', { kind: 'provenance' });
});

test('manifest resource resolution returns a frozen registry without mutating authored data', async () => {
  const manifest = await validManifest();
  manifest.datasets.route = {
    type: 'geojson',
    geometry: 'line',
    src: './data/route.geojson',
    label: 'Route'
  };
  manifest.assets.photo = {
    type: 'image',
    src: './assets/photo.webp',
    mediaType: 'image/webp'
  };
  const before = structuredClone(manifest);

  const registry = resolveManifestResourceUrls(manifest, manifestUrl);
  assert.equal(registry.stories.main.href, 'https://host.test/maps/stories/main.story.json');
  assert.equal(registry.datasets.route.href, 'https://host.test/maps/data/route.geojson');
  assert.equal(registry.assets.photo.href, 'https://host.test/maps/assets/photo.webp');
  assert.equal(registry.metrics.href, 'https://host.test/maps/data/metrics.json');
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry.stories), true);
  assert.equal(Object.isFrozen(registry.datasets), true);
  assert.equal(Object.isFrozen(registry.assets), true);
  assert.deepEqual(manifest, before);
});

test('manifest validation rejects unsafe authored runtime paths with their precise path', async () => {
  const manifest = await validManifest();
  manifest.stories.items[0].src = '../outside.story.json';
  assert.throws(
    () => validateProjectManifest(manifest),
    (error) => error.code === 'PROJECT_MANIFEST_INVALID'
      && error.path === '$.stories.items[0].src'
      && /package-relative|unsafe/i.test(error.message)
  );
});
