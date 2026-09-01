import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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

async function realProj4() {
  const source = await readFile(new URL('../vendor/data-import/proj4/2.22.0/proj4.js', import.meta.url), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  return context.proj4;
}

function featureCollection(type, coordinates, properties = {}, extra = {}) {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties, geometry: { type, coordinates }, ...extra }]
  };
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

test('Vietnamese filenames keep readable labels and generate stable ASCII IDs', async () => {
  const identifiers = await optionalModule('../editor/import/import-identifiers.js');
  assert.equal(typeof identifiers.friendlyLabel, 'function');
  assert.equal(typeof identifiers.createImportId, 'function');

  assert.equal(identifiers.friendlyLabel('Trạm dừng fix UTM.csv'), 'Trạm dừng fix UTM');
  assert.equal(identifiers.createImportId('Trạm dừng fix UTM', []), 'tram-dung-fix-utm');
  assert.equal(identifiers.createImportId('Điểm 1', ['diem-1']), 'diem-1-2');
  assert.equal(identifiers.createImportId('2026 stops', []), 'data-2026-stops');
  assert.equal(identifiers.createImportId('!!!', []), 'data');
});

test('table normalization infers conservative production types and preserves leading zeros', async () => {
  const tables = await optionalModule('../editor/import/table-normalizer.js');
  assert.equal(typeof tables.normalizeTableGrid, 'function');

  const result = tables.normalizeTableGrid([
    ['Code', 'Count', 'Ratio', 'Active', 'Date'],
    ['001', '7', '2.5', 'TRUE', '2026-09-01'],
    ['', '', '', '', '']
  ]);
  assert.deepEqual(result.columns.map(({ id, label, type }) => ({ id, label, type })), [
    { id: 'code', label: 'Code', type: 'text' },
    { id: 'count', label: 'Count', type: 'integer' },
    { id: 'ratio', label: 'Ratio', type: 'number' },
    { id: 'active', label: 'Active', type: 'boolean' },
    { id: 'date', label: 'Date', type: 'date' }
  ]);
  assert.deepEqual(result.rows, [
    { code: '001', count: 7, ratio: 2.5, active: true, date: '2026-09-01' },
    { code: null, count: null, ratio: null, active: null, date: null }
  ]);
});

test('table normalization preserves duplicate labels with unique IDs and route-like text', async () => {
  const tables = await optionalModule('../editor/import/table-normalizer.js');
  assert.equal(typeof tables.normalizeTableGrid, 'function');

  const result = tables.normalizeTableGrid([
    ['Value', 'Value', '', 'Route'],
    ['1', '2', '3', '61-2']
  ]);
  assert.deepEqual(result.columns.map(({ id, label, type }) => ({ id, label, type })), [
    { id: 'value', label: 'Value', type: 'integer' },
    { id: 'value-2', label: 'Value', type: 'integer' },
    { id: 'column-3', label: 'Column 3', type: 'integer' },
    { id: 'route', label: 'Route', type: 'text' }
  ]);
  assert.deepEqual(result.rows[0], { value: 1, 'value-2': 2, 'column-3': 3, route: '61-2' });
});

test('record-array normalization rejects nested cells instead of flattening them', async () => {
  const tables = await optionalModule('../editor/import/table-normalizer.js');
  assert.equal(typeof tables.normalizeRecordArray, 'function');

  assert.throws(
    () => tables.normalizeRecordArray([{ name: 'A', details: { nested: true } }]),
    /nested|scalar|unsupported JSON data shape/i
  );
});

test('table normalization handles tall inputs without spread argument overflow', async () => {
  const { normalizeTableGrid } = await optionalModule('../editor/import/table-normalizer.js');
  const grid = [['Value'], ...Array.from({ length: 150_000 }, (_, index) => [String(index)])];
  const result = normalizeTableGrid(grid);
  assert.equal(result.rows.length, 150_000);
  assert.equal(result.rows[149_999].value, 149_999);
});

test('EPSG:4326 is stable and EPSG:3857 converts to bounded longitude/latitude', async () => {
  const crs = await optionalModule('../editor/import/crs.js');
  assert.equal(typeof crs.reprojectFeatureCollection, 'function');
  const proj4 = await realProj4();

  const geographic = featureCollection('Point', [106.7, 10.8, 4]);
  assert.deepEqual(
    crs.reprojectFeatureCollection(geographic, { sourceCrs: 'EPSG:4326', proj4 }),
    geographic
  );
  const projected = crs.reprojectFeatureCollection(featureCollection('Point', [11131949.079327356, 1118889.9748579594]), {
    sourceCrs: 'EPSG:3857',
    proj4
  });
  const [lng, lat] = projected.features[0].geometry.coordinates;
  assert.ok(Math.abs(lng - 100) < 1e-9);
  assert.ok(Math.abs(lat - 10) < 1e-9);
});

test('EPSG:32648 converts XY while preserving optional Z', async () => {
  const crs = await optionalModule('../editor/import/crs.js');
  assert.equal(typeof crs.reprojectFeatureCollection, 'function');
  const proj4 = await realProj4();

  const result = crs.reprojectFeatureCollection(featureCollection('Point', [686143.36, 1200320.45, 17]), {
    sourceCrs: 'EPSG:32648',
    proj4
  });
  const [lng, lat, z] = result.features[0].geometry.coordinates;
  assert.ok(Math.abs(lng - 106.7028563810) < 1e-7);
  assert.ok(Math.abs(lat - 10.8536676064) < 1e-7);
  assert.equal(z, 17);
});

test('unsupported local EPSG fails clearly without a network fallback', async () => {
  const crs = await optionalModule('../editor/import/crs.js');
  assert.equal(typeof crs.resolveLocalCrs, 'function');
  const proj4 = await realProj4();
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { fetched = true; throw new Error('network forbidden'); };
  try {
    assert.throws(() => crs.resolveLocalCrs('EPSG:999999', proj4), /not available locally.*EPSG:999999|EPSG:999999.*not available locally/i);
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('spatial normalization wraps Features and partitions mixed geometry families', async () => {
  const spatial = await optionalModule('../editor/import/spatial-normalizer.js');
  assert.equal(typeof spatial.normalizeSpatialSource, 'function');

  const source = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Stop' }, geometry: { type: 'Point', coordinates: [106, 11] } },
      { type: 'Feature', properties: { name: 'Route' }, geometry: { type: 'LineString', coordinates: [[106, 11], [107, 12]] } },
      { type: 'Feature', properties: { name: 'Zone' }, geometry: { type: 'Polygon', coordinates: [[[106, 11], [107, 11], [106, 12], [106, 11]]] } }
    ]
  };
  const result = spatial.normalizeSpatialSource(source, { label: 'Transport', id: 'transport', sourceFormat: 'GeoJSON', sourceCrs: 'EPSG:4326' });
  assert.deepEqual(result.map(({ geometry }) => geometry), ['point', 'line', 'polygon']);
  assert.deepEqual(result.map(({ id }) => id), ['transport-points', 'transport-lines', 'transport-polygons']);
  assert.equal(result.some(({ geometry }) => geometry === 'mixed'), false);

  const wrapped = spatial.normalizeSpatialSource(source.features[0], {
    label: 'Stop', id: 'stop', sourceFormat: 'GeoJSON', sourceCrs: 'EPSG:4326'
  });
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].value.type, 'FeatureCollection');
  assert.equal(wrapped[0].featureCount, 1);
});

test('spatial normalization recursively flattens collections and rejects malformed nesting', async () => {
  const spatial = await optionalModule('../editor/import/spatial-normalizer.js');
  const crs = await optionalModule('../editor/import/crs.js');

  const result = spatial.normalizeSpatialSource({
    type: 'Feature',
    properties: { name: 'Nested' },
    geometry: {
      type: 'GeometryCollection',
      geometries: [{
        type: 'GeometryCollection',
        geometries: [{ type: 'Point', coordinates: [106, 11, 8] }]
      }]
    }
  }, { label: 'Nested', id: 'nested', sourceFormat: 'GeoJSON' });
  assert.deepEqual(result[0].value.features[0].geometry.coordinates, [106, 11, 8]);
  assert.throws(
    () => crs.assertWgs84Coordinates(featureCollection('LineString', [106, 11])),
    /nesting|position/i
  );
});

test('GeometryCollection flattening preserves scalar properties and reports null geometries', async () => {
  const spatial = await optionalModule('../editor/import/spatial-normalizer.js');
  assert.equal(typeof spatial.normalizeSpatialSource, 'function');

  const source = {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:4326' } },
    features: [
      {
        type: 'Feature',
        properties: { name: 'Combined', order: 2 },
        geometry: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'Point', coordinates: [106, 11] },
            { type: 'LineString', coordinates: [[106, 11], [107, 12]] }
          ]
        }
      },
      { type: 'Feature', properties: { name: 'Missing' }, geometry: null }
    ]
  };
  const result = spatial.normalizeSpatialSource(source, { label: 'Combined', id: 'combined', sourceFormat: 'GeoJSON', sourceCrs: 'EPSG:4326' });
  assert.deepEqual(result.map(({ featureCount }) => featureCount), [1, 1]);
  assert.deepEqual(result[0].value.features[0].properties, { name: 'Combined', order: 2 });
  assert.equal('crs' in result[0].value, false);
  assert.match(result[0].warnings.join(' '), /1 record.*no usable geometry/i);
});

test('spatial coordinate validation rejects non-finite and out-of-range output', async () => {
  const crs = await optionalModule('../editor/import/crs.js');
  assert.equal(typeof crs.assertWgs84Coordinates, 'function');

  assert.throws(() => crs.assertWgs84Coordinates(featureCollection('Point', [Infinity, 10])), /finite/i);
  assert.throws(() => crs.assertWgs84Coordinates(featureCollection('Point', [181, 10])), /longitude/i);
  assert.throws(() => crs.assertWgs84Coordinates(featureCollection('Point', [100, -91])), /latitude/i);
});

test('transient import session prepares mixed candidates without exposing persistence APIs', async () => {
  const { createDataImportSession } = await optionalModule('../editor/import/data-import.js');
  assert.equal(typeof createDataImportSession, 'function');
  const file = new File([JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Stop' }, geometry: { type: 'Point', coordinates: [106, 11] } },
      { type: 'Feature', properties: { name: 'Route' }, geometry: { type: 'LineString', coordinates: [[106, 11], [107, 12]] } }
    ]
  })], 'Transport.geojson');
  const statuses = [];
  const session = createDataImportSession({ files: [file], usedIds: ['transport-points'], onStatus: (status) => statuses.push(status) });
  assert.equal('write' in session, false);
  assert.equal('serialize' in session, false);
  assert.equal('commit' in session, false);
  const items = await session.read();
  assert.equal(items.length, 1);
  session.selectSourceItem(items[0].id);
  session.configure({ sourceCrs: 'EPSG:4326' });
  const candidates = await session.prepare();
  assert.deepEqual(candidates.map(({ geometry, id }) => [geometry, id]), [
    ['point', 'transport-points-2'], ['line', 'transport-lines']
  ]);
  assert.equal(session.candidate(candidates[1].id).geometry, 'line');
  assert.deepEqual(statuses, ['reading', 'ready', 'preparing', 'prepared']);
  assert.equal(session.state().disposed, false);
  session.dispose();
  assert.equal(session.state().disposed, true);
  await assert.rejects(session.prepare(), /disposed/i);
});

test('transient session lazy-loads only the parser required by the selected format', async () => {
  const { createDataImportSession } = await optionalModule('../editor/import/data-import.js');
  const calls = [];
  const loaders = {
    loadPapaParse: async () => {
      calls.push('papa');
      return { parse: (_input, options) => {
        options.chunk({ data: [['Name', 'Code'], ['Stop', '001']], errors: [], meta: { delimiter: ',' } });
        options.complete();
      } };
    },
    loadToGeoJson: async () => { calls.push('togeojson'); },
    loadShp: async () => { calls.push('shp'); },
    loadProj4: async () => { calls.push('proj4'); },
    loadSheetJs: async () => { calls.push('sheetjs'); },
    loadGeoPackage: async () => { calls.push('geopackage'); }
  };
  const session = createDataImportSession({ files: [new File(['ignored'], 'stops.csv')], loaders });
  const items = await session.read();
  session.selectSourceItem(items[0].id);
  const candidates = await session.prepare();
  assert.equal(candidates[0].kind, 'table');
  assert.deepEqual(calls, ['papa']);
});

test('transient session validates candidate selection and replacement family constraints locally', async () => {
  const { createDataImportSession } = await optionalModule('../editor/import/data-import.js');
  const point = new File([JSON.stringify(featureCollection('Point', [106, 11]))], 'stop.geojson');
  const session = createDataImportSession({ files: [point], replacement: { id: 'route', kind: 'spatial', geometry: 'line' } });
  await session.read();
  await assert.rejects(session.prepare(), /select.*source/i);
  session.selectSourceItem(session.state().sourceItems[0].id);
  const candidates = await session.prepare();
  assert.throws(() => session.candidate(candidates[0].id), /incompatible.*line|line.*incompatible/i);
  session.dispose();
});
