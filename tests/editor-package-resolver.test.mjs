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
