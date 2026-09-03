import assert from 'node:assert/strict';
import test from 'node:test';

import { createContentAddressedPmtilesResolver } from '../src/project/hosted-asset-resolver.js';
import { parseProbeUrl, validatePmtilesRangeResponse } from '../scripts/r2-pmtiles-range-probe.mjs';

const HASH = 'a'.repeat(64);
const PMTILES_ID = 'overture-buildings-snapshot';
const PMTILES_DESCRIPTOR = Object.freeze({ type: 'pmtiles', mediaType: 'application/vnd.pmtiles' });

function frozenManifest(overrides = {}) {
  return {
    id: 'route-61-2',
    capabilities: [{
      id: 'urban-context-v1',
      settings: {
        buildingSource: 'project-snapshot',
        snapshot: { asset: PMTILES_ID, sha256: HASH }
      }
    }],
    ...overrides
  };
}

function pmtilesResponse({ status = 206, contentRange = 'bytes 0-16383/99999', body } = {}) {
  const bytes = body ?? new Uint8Array(16384);
  bytes[0] = 0x50;
  bytes[1] = 0x4d;
  return new Response(bytes, {
    status,
    headers: { 'Content-Range': contentRange, ETag: '"snapshot"' }
  });
}

test('content-addressed resolver maps the declared frozen PMTiles asset to its immutable hosted object', () => {
  const resolver = createContentAddressedPmtilesResolver({ pmtilesOrigin: 'https://maps.example.test/' });
  assert.equal(
    resolver(new URL('https://pages.example.test/assets/context/overture-buildings.pmtiles'), {
      id: PMTILES_ID,
      descriptor: PMTILES_DESCRIPTOR,
      manifest: frozenManifest()
    }).href,
    `https://maps.example.test/projects/route-61-2/${HASH}/overture-buildings.pmtiles`
  );
});

test('content-addressed resolver preserves a non-PMTiles asset URL by identity', () => {
  const resolver = createContentAddressedPmtilesResolver({ pmtilesOrigin: 'https://maps.example.test/' });
  const imageUrl = new URL('https://pages.example.test/assets/photo.png');
  assert.equal(resolver(imageUrl, {
    id: 'photo',
    descriptor: { type: 'image', mediaType: 'image/png' },
    manifest: frozenManifest()
  }), imageUrl);
});

test('content-addressed resolver rejects a PMTiles asset without exactly one matching snapshot declaration', () => {
  const resolver = createContentAddressedPmtilesResolver({ pmtilesOrigin: 'https://maps.example.test/' });
  const url = new URL('https://pages.example.test/assets/context/overture-buildings.pmtiles');
  assert.throws(() => resolver(url, {
    id: PMTILES_ID,
    descriptor: PMTILES_DESCRIPTOR,
    manifest: frozenManifest({ capabilities: [] })
  }), /exactly one/i);
  assert.throws(() => resolver(url, {
    id: PMTILES_ID,
    descriptor: PMTILES_DESCRIPTOR,
    manifest: frozenManifest({ capabilities: [
      ...frozenManifest().capabilities,
      structuredClone(frozenManifest().capabilities[0])
    ] })
  }), /exactly one/i);
});

test('content-addressed resolver rejects an invalid snapshot hash', () => {
  const resolver = createContentAddressedPmtilesResolver({ pmtilesOrigin: 'https://maps.example.test/' });
  assert.throws(() => resolver(new URL('https://pages.example.test/assets/context/overture-buildings.pmtiles'), {
    id: PMTILES_ID,
    descriptor: PMTILES_DESCRIPTOR,
    manifest: frozenManifest({ capabilities: [{
      id: 'urban-context-v1',
      settings: { buildingSource: 'project-snapshot', snapshot: { asset: PMTILES_ID, sha256: 'invalid' } }
    }] })
  }), /sha-256/i);
});

test('Range validator accepts the required 16 KiB PMTiles partial response', async () => {
  const result = await validatePmtilesRangeResponse(pmtilesResponse());
  assert.deepEqual(result, {
    contentRange: 'bytes 0-16383/99999',
    byteLength: 16384,
    etag: '"snapshot"'
  });
});

test('Range validator rejects an invalid status or range before reading the body', async () => {
  for (const response of [
    { status: 200, headers: new Headers({ 'Content-Range': 'bytes 0-16383/99999' }) },
    { status: 206, headers: new Headers({ 'Content-Range': 'bytes 0-999/99999' }) }
  ]) {
    Object.defineProperty(response, 'body', {
      get() { throw new Error('invalid response body must not be read'); }
    });
    await assert.rejects(validatePmtilesRangeResponse(response), /partial-content semantics/i);
  }
});

test('Range validator cancels an oversized streamed body instead of collecting it', async () => {
  let cancelled = false;
  const response = {
    status: 206,
    headers: new Headers({ 'Content-Range': 'bytes 0-16383/99999' }),
    body: {
      getReader() {
        return {
          async read() { return { done: false, value: new Uint8Array(16385) }; },
          async cancel() { cancelled = true; },
          releaseLock() {}
        };
      }
    }
  };
  await assert.rejects(validatePmtilesRangeResponse(response), /exceeds 16384 bytes/i);
  assert.equal(cancelled, true);
});

test('Range validator cancels a declared oversized body before reading it', async () => {
  let cancelled = false;
  let read = false;
  const response = {
    status: 206,
    headers: new Headers({ 'Content-Range': 'bytes 0-16383/99999', 'Content-Length': '1048576' }),
    body: {
      async cancel() { cancelled = true; },
      getReader() { read = true; throw new Error('oversized body must not be read'); }
    }
  };
  await assert.rejects(validatePmtilesRangeResponse(response), /exactly 16384 bytes/i);
  assert.equal(cancelled, true);
  assert.equal(read, false);
});

test('Range probe rejects URL credentials before its JSON output can expose them', () => {
  assert.throws(
    () => parseProbeUrl(['--url=https://user:secret@maps.example.test/projects/route-61-2/archive.pmtiles']),
    /without credentials/i
  );
});
