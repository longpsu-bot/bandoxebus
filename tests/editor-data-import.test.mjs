import assert from 'node:assert/strict';
import test from 'node:test';

import { Zip, ZipPassThrough } from '../vendor/fflate/0.8.3/fflate.esm.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(chunks) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function makeZip(entries) {
  const chunks = [];
  let failure;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk.slice());
  });
  for (const [name, value] of entries) {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(typeof value === 'string' ? encoder.encode(value) : value, true);
  }
  zip.end();
  if (failure) throw failure;
  return concat(chunks);
}

function setFirstLocalHeaderFlags(bytes, flags) {
  const result = bytes.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  view.setUint16(6, flags, true);
  return result;
}

async function optionalModule(path) {
  try {
    return await import(path);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

test('safe ZIP returns deterministic entries and exact bytes', async () => {
  const archive = await optionalModule('../editor/core/safe-zip.js');
  assert.equal(typeof archive.readSafeZipEntries, 'function');

  const result = archive.readSafeZipEntries(makeZip([
    ['z/route.dbf', 'attributes'],
    ['a/route.shp', 'geometry']
  ]), { limits: archive.DATA_IMPORT_ZIP_LIMITS, caseInsensitivePaths: true });

  assert.deepEqual(result.map(({ path }) => path), ['a/route.shp', 'z/route.dbf']);
  assert.equal(decoder.decode(result[0].bytes), 'geometry');
  assert.equal(decoder.decode(result[1].bytes), 'attributes');
});

test('safe ZIP rejects case-insensitive duplicate normalized paths', async () => {
  const archive = await optionalModule('../editor/core/safe-zip.js');
  assert.equal(typeof archive.readSafeZipEntries, 'function');

  assert.throws(
    () => archive.readSafeZipEntries(makeZip([
      ['A/roads.shp', 'first'],
      ['a/roads.shp', 'second']
    ]), { limits: archive.DATA_IMPORT_ZIP_LIMITS, caseInsensitivePaths: true }),
    /duplicate normalized (?:package|archive) path/i
  );
});

test('safe ZIP rejects traversal and encrypted archives before extraction', async () => {
  const archive = await optionalModule('../editor/core/safe-zip.js');
  assert.equal(typeof archive.readSafeZipEntries, 'function');

  assert.throws(
    () => archive.readSafeZipEntries(makeZip([['../escape.shp', 'unsafe']]), {
      limits: archive.DATA_IMPORT_ZIP_LIMITS,
      caseInsensitivePaths: true
    }),
    /invalid package path|archive path/i
  );
  assert.throws(
    () => archive.readSafeZipEntries(setFirstLocalHeaderFlags(makeZip([['roads.shp', 'geometry']]), 0x0001), {
      limits: archive.DATA_IMPORT_ZIP_LIMITS,
      caseInsensitivePaths: true
    }),
    /encrypted archives are unsupported/i
  );
});

test('vendor loaders cache success and retry a failed local script load', async () => {
  const vendor = await optionalModule('../editor/import/vendor-loaders.js');
  assert.equal(typeof vendor.createVendorLoaders, 'function');

  const calls = [];
  const globalRef = {};
  let failures = 1;
  const loaders = vendor.createVendorLoaders({
    globalRef,
    importModule: async () => ({}),
    resolveUrl: (url) => url,
    loadScript: async (url) => {
      calls.push(url);
      if (failures) {
        failures -= 1;
        throw new Error('temporary load failure');
      }
      globalRef.Papa = { parse: () => ({ data: [] }) };
    }
  });

  await assert.rejects(loaders.loadPapaParse(), /temporary load failure/);
  const first = await loaders.loadPapaParse();
  const second = await loaders.loadPapaParse();
  assert.equal(first, second);
  assert.deepEqual(calls, [
    '../../vendor/data-import/papaparse/5.7.0/papaparse.min.js',
    '../../vendor/data-import/papaparse/5.7.0/papaparse.min.js'
  ]);
});

test('GeoPackage loader binds SQL.js to the exact local matching WASM', async () => {
  const vendor = await optionalModule('../editor/import/vendor-loaders.js');
  assert.equal(typeof vendor.createVendorLoaders, 'function');

  const calls = [];
  const api = {
    setSqljsWasmLocateFile(locate) {
      calls.push(locate('sql-wasm.wasm'));
    }
  };
  const loaders = vendor.createVendorLoaders({
    globalRef: { GeoPackage: api },
    importModule: async () => ({}),
    resolveUrl: (url) => url,
    loadScript: async (url) => calls.push(url)
  });

  assert.equal(await loaders.loadGeoPackage(), api);
  assert.equal(await loaders.loadGeoPackage(), api);
  assert.deepEqual(calls, [
    '../../vendor/data-import/geopackage/4.2.9/geopackage.min.js',
    '../../vendor/data-import/geopackage/4.2.9/sql-wasm.wasm'
  ]);
});
