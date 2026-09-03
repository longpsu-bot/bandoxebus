import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePreviewSnapshot } from '../editor/preview/bridge.js';

function pmtilesEntry(file = new File(['PMTiles'], 'overture-buildings.pmtiles')) {
  return { path: 'assets/context/overture-buildings.pmtiles', file, mediaType: 'application/vnd.pmtiles', kind: 'asset' };
}

test('preview accepts exact byte and PMTiles File entry shapes after structured clone', () => {
  const snapshot = structuredClone({ revision: 1, entries: [
    { path: 'project.json', bytes: new TextEncoder().encode('{}'), mediaType: 'application/json', kind: 'manifest' },
    pmtilesEntry()
  ] });
  assert.equal(validatePreviewSnapshot(snapshot), snapshot);
});

test('preview rejects file-backed non-assets, non-PMTiles, invalid Files, and extra entry fields', () => {
  const entry = pmtilesEntry();
  const nonfiniteFile = new File([], 'invalid.pmtiles');
  Object.defineProperty(nonfiniteFile, 'size', { value: Infinity });
  for (const invalid of [
    { ...entry, mediaType: 'application/json' },
    { ...entry, mediaType: 'image/png' },
    { ...entry, kind: 'dataset' },
    { ...entry, file: { size: 1 } },
    { ...entry, file: nonfiniteFile },
    { ...entry, bytes: new Uint8Array() },
    { ...entry, byteLength: 7 },
    { path: 'data.json', bytes: new Uint8Array(), mediaType: 'application/json', kind: 'dataset', file: undefined }
  ]) {
    assert.throws(() => validatePreviewSnapshot({ revision: 1, entries: [invalid] }), TypeError);
  }
});

test('preview counts PMTiles File sizes together with bytes against the 256 MiB ceiling', () => {
  const file = new File([new Uint8Array(1024 * 1024)], 'one-mib.pmtiles');
  const entries = Array.from({ length: 256 }, (_, index) => ({ ...pmtilesEntry(file), path: `assets/${index}.pmtiles` }));
  assert.doesNotThrow(() => validatePreviewSnapshot({ revision: 1, entries }));
  entries.push({ path: 'extra.bin', bytes: new Uint8Array(1), mediaType: 'application/octet-stream', kind: 'resource' });
  assert.throws(() => validatePreviewSnapshot({ revision: 1, entries }), /oversized/i);
});
