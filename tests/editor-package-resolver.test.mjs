import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewPackageResolver } from '../editor/preview/package-resolver.js';

const encoder = new TextEncoder();

function snapshotWithImage() {
  return {
    revision: 1,
    entries: [
      { path: 'project.json', bytes: encoder.encode('{"schemaVersion":"1.0"}\n'), mediaType: 'application/json', kind: 'manifest' },
      { path: 'assets/photo.png', bytes: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png', kind: 'asset' },
      { path: 'assets/code.js', bytes: encoder.encode('alert(1)'), mediaType: 'text/javascript', kind: 'script' },
      { path: 'assets/wrong.jpg', bytes: new Uint8Array([255, 216]), mediaType: 'image/jpeg', kind: 'asset' }
    ]
  };
}

function fakeUrlApi() {
  const created = [];
  const revoked = [];
  return {
    created,
    revoked,
    createObjectURL(blob) {
      created.push(blob);
      return `blob:revision-1/${created.length}`;
    },
    revokeObjectURL(url) { revoked.push(url); }
  };
}

test('preview resolver serves managed bytes and materializes declared images only', async () => {
  const urlApi = fakeUrlApi();
  const resolver = createPreviewPackageResolver(snapshotWithImage(), { urlApi });

  assert.equal((await resolver.fetchImpl(resolver.manifestUrl)).status, 200);
  const assetUrl = new URL('assets/photo.png', resolver.manifestUrl);
  const objectUrl = resolver.resolveAssetUrl(assetUrl, {
    id: 'photo', descriptor: { type: 'image', mediaType: 'image/png' }
  });
  assert.equal(objectUrl, 'blob:revision-1/1');
  assert.equal(resolver.resolveAssetUrl(assetUrl, {
    id: 'photo', descriptor: { type: 'image', mediaType: 'image/png' }
  }), objectUrl);
  assert.equal(urlApi.created.length, 1);
  assert.throws(() => resolver.resolveAssetUrl(new URL('../outside.png', resolver.manifestUrl), {
    id: 'outside', descriptor: { type: 'image', mediaType: 'image/png' }
  }), /outside|absent|unsafe/i);
  resolver.revoke();
  resolver.revoke();
  assert.deepEqual(urlApi.revoked, ['blob:revision-1/1']);
});

test('preview resolver rejects absent, executable, and mismatched image entries', () => {
  const resolver = createPreviewPackageResolver(snapshotWithImage(), { urlApi: fakeUrlApi() });
  const context = { id: 'asset', descriptor: { type: 'image', mediaType: 'image/png' } };

  assert.throws(() => resolver.resolveAssetUrl(new URL('assets/absent.png', resolver.manifestUrl), context), /absent/i);
  assert.throws(() => resolver.resolveAssetUrl(new URL('assets/code.js', resolver.manifestUrl), context), /image|executable|script/i);
  assert.throws(() => resolver.resolveAssetUrl(new URL('assets/wrong.jpg', resolver.manifestUrl), context), /media/i);
});

test('package fetch honors abort signals', async () => {
  const resolver = createPreviewPackageResolver(snapshotWithImage(), { urlApi: fakeUrlApi() });
  const controller = new AbortController();
  controller.abort(new DOMException('Cancelled.', 'AbortError'));
  await assert.rejects(
    resolver.fetchImpl(resolver.manifestUrl, { signal: controller.signal }),
    (error) => error.name === 'AbortError'
  );
});

const pmtilesPath = 'assets/context/overture-buildings.pmtiles';
const pmtilesContext = {
  id: 'overture-buildings-snapshot', descriptor: { type: 'pmtiles', mediaType: 'application/vnd.pmtiles' }
};

test('preview PMTiles resolver preserves Folder Files without full reads or image object URLs', async () => {
  const payload = new Uint8Array([80, 77, 84, 105, 108, 101, 115, 3]);
  const sourceFile = new File([payload], 'overture-buildings.pmtiles', { type: 'application/vnd.pmtiles' });
  sourceFile.arrayBuffer = () => { throw new Error('PMTiles File must stay lazy.'); };
  const snapshot = snapshotWithImage();
  snapshot.entries.push({ path: pmtilesPath, file: sourceFile, mediaType: 'application/vnd.pmtiles', kind: 'asset' });
  const urlApi = fakeUrlApi();
  const resolver = createPreviewPackageResolver(snapshot, { urlApi });
  const url = new URL(pmtilesPath, resolver.manifestUrl);
  const file = resolver.resolvePmtilesAssetFile(url, pmtilesContext);
  assert.equal(file, sourceFile);
  assert.equal(file.size, payload.length);
  assert.deepEqual(new Uint8Array(await file.slice(0, 3).arrayBuffer()), new Uint8Array([80, 77, 84]));
  assert.deepEqual(urlApi.created, []);
  assert.throws(() => resolver.resolveAssetUrl(url, pmtilesContext), /image/i);
  const response = await resolver.fetchImpl(url);
  assert.equal(response.headers.get('content-type'), 'application/vnd.pmtiles');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), payload);
  resolver.revoke();
  assert.throws(() => resolver.resolvePmtilesAssetFile(url, pmtilesContext), /revoked/i);
});

test('preview converts ZIP PMTiles bytes into an immutable File with exact bytes', async () => {
  const payload = new Uint8Array([80, 77, 84, 105, 108, 101, 115, 3, 255]);
  const snapshot = snapshotWithImage();
  snapshot.entries.push({ path: pmtilesPath, bytes: payload, mediaType: 'application/vnd.pmtiles', kind: 'asset' });
  const resolver = createPreviewPackageResolver(snapshot, { urlApi: fakeUrlApi() });
  payload.fill(0);
  const file = resolver.resolvePmtilesAssetFile(new URL(pmtilesPath, resolver.manifestUrl), pmtilesContext);
  assert.ok(file instanceof File);
  assert.equal(file.name, 'overture-buildings.pmtiles');
  assert.equal(file.type, 'application/vnd.pmtiles');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([80, 77, 84, 105, 108, 101, 115, 3, 255]));
});

test('preview PMTiles resolver enforces containment and declared asset type/media type', () => {
  const snapshot = snapshotWithImage();
  snapshot.entries.push({ path: pmtilesPath, bytes: new Uint8Array([80]), mediaType: 'application/vnd.pmtiles', kind: 'asset' });
  snapshot.entries.push({ path: 'data/not-an-asset.pmtiles', bytes: new Uint8Array([80]), mediaType: 'application/vnd.pmtiles', kind: 'dataset' });
  const resolver = createPreviewPackageResolver(snapshot, { urlApi: fakeUrlApi() });
  for (const [src, context] of [
    ['https://other.example/archive.pmtiles', pmtilesContext],
    ['../overture-buildings.pmtiles', pmtilesContext],
    ['missing.pmtiles', pmtilesContext],
    ['data/not-an-asset.pmtiles', pmtilesContext],
    ['assets/photo.png', pmtilesContext],
    [pmtilesPath, { descriptor: { type: 'image', mediaType: 'application/vnd.pmtiles' } }],
    [pmtilesPath, { descriptor: { type: 'pmtiles', mediaType: 'image/png' } }],
    [pmtilesPath, {}]
  ]) {
    assert.throws(() => resolver.resolvePmtilesAssetFile(new URL(src, resolver.manifestUrl), context), /outside|absent|declared PMTiles|media type/i);
  }
});
