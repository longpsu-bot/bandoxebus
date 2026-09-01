import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { Zip, ZipPassThrough } from '../vendor/fflate/0.8.3/fflate.esm.js';

const encoder = new TextEncoder();

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
  const zip = new Zip((error, chunk) => error ? failure = error : chunks.push(chunk.slice()));
  for (const [name, value] of entries) {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(typeof value === 'string' ? encoder.encode(value) : value, true);
  }
  zip.end();
  if (failure) throw failure;
  return concat(chunks);
}

function file(name, value, type = '') {
  return new File([typeof value === 'string' ? value : value], name, { type });
}

async function fixture(name, type = '') {
  return file(name.split('/').pop(), await readFile(new URL(`fixtures/data-import/${name}`, import.meta.url)), type);
}

async function optionalModule(path) {
  try {
    return await import(path);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

async function realPapa() {
  const source = await readFile(new URL('../vendor/data-import/papaparse/5.7.0/papaparse.min.js', import.meta.url), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  return context.Papa;
}

async function realProj4() {
  const source = await readFile(new URL('../vendor/data-import/proj4/2.22.0/proj4.js', import.meta.url), 'utf8');
  const context = {};
  vm.runInNewContext(source, context);
  return context.proj4;
}

test('detects GeoJSON and the two supported table JSON shapes by content', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  assert.equal(typeof detectDataFiles, 'function');

  assert.deepEqual(
    await detectDataFiles([await fixture('point.geojson')]).then(({ format, jsonKind }) => ({ format, jsonKind })),
    { format: 'geojson', jsonKind: 'spatial' }
  );
  assert.equal((await detectDataFiles([await fixture('normalized-table.json')])).jsonKind, 'normalized-table');
  assert.equal((await detectDataFiles([await fixture('records.json')])).jsonKind, 'records');
  await assert.rejects(detectDataFiles([await fixture('malformed.json')]), /invalid JSON/i);
  await assert.rejects(detectDataFiles([file('misleading.json', '{"hello":"world"}')]), /unsupported JSON data shape/i);
});

test('single GeoJSON Feature is wrapped before production coordinate validation', async () => {
  const { createDataImportSession } = await import('../editor/import/data-import.js');
  const session = createDataImportSession({ files: [await fixture('point.geojson')] });
  const sourceItems = await session.read();
  session.selectSourceItem(sourceItems[0].id);
  const candidates = await session.prepare();
  assert.equal(candidates[0].value.type, 'FeatureCollection');
  assert.equal(candidates[0].value.features.length, 1);
  assert.equal(candidates[0].value.features[0].geometry.type, 'Point');
  session.dispose();
});

test('detects local XML formats from extension and root element', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  assert.equal((await detectDataFiles([await fixture('mixed.kml')])).format, 'kml');
  assert.equal((await detectDataFiles([await fixture('route.gpx')])).format, 'gpx');
  await assert.rejects(
    detectDataFiles([file('wrong.kml', '<gpx version="1.1"></gpx>')]),
    /expected.*kml|root/i
  );
  await assert.rejects(detectDataFiles([await fixture('doctype.kml')]), /DOCTYPE/i);
});

test('detects KMZ entries, preferring a root doc.kml', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  const archive = makeZip([
    ['nested/other.kml', '<kml/>'],
    ['doc.kml', '<kml/>'],
    ['images/icon.png', new Uint8Array([1, 2, 3])]
  ]);
  const detection = await detectDataFiles([file('mixed.kmz', archive)]);
  assert.equal(detection.format, 'kmz');
  assert.deepEqual(detection.items.map(({ path }) => path), ['doc.kml', 'nested/other.kml']);
  assert.equal(detection.preferredItemId, 'doc.kml');
});

test('groups zipped and loose Shapefile components by case-insensitive basename', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  const zipped = await detectDataFiles([file('transport.zip', makeZip([
    ['Stops.SHP', 'shape'], ['stops.dbf', 'data'], ['stops.PRJ', 'projection'],
    ['routes.shp', 'shape'], ['routes.dbf', 'data']
  ]))]);
  assert.equal(zipped.format, 'shapefile');
  assert.deepEqual(zipped.groups.map(({ basename }) => basename), ['routes', 'stops']);

  const loose = await detectDataFiles([
    file('points.SHP', 'shape'), file('POINTS.dbf', 'data'), file('points.prj', 'projection'), file('points.cpg', 'UTF-8')
  ]);
  assert.equal(loose.format, 'shapefile');
  assert.deepEqual(loose.groups.map(({ basename, files }) => ({ basename, files: Object.keys(files).sort() })), [
    { basename: 'points', files: ['cpg', 'dbf', 'prj', 'shp'] }
  ]);
});

test('detects GeoPackage, CSV, and XLSX signatures and rejects unsupported inputs', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  const sqlite = new Uint8Array(32);
  sqlite.set(encoder.encode('SQLite format 3\0'));
  assert.equal((await detectDataFiles([file('features.gpkg', sqlite)])).format, 'geopackage');
  await assert.rejects(detectDataFiles([file('fake.gpkg', 'not sqlite')]), /SQLite header/i);
  assert.equal((await detectDataFiles([await fixture('utf8-table.csv')])).format, 'csv');

  const xlsx = makeZip([
    ['[Content_Types].xml', '<Types/>'],
    ['xl/workbook.xml', '<workbook/>']
  ]);
  assert.equal((await detectDataFiles([file('tables.xlsx', xlsx)])).format, 'xlsx');
  await assert.rejects(detectDataFiles([file('fake.xlsx', makeZip([['readme.txt', 'no workbook']]))]), /OOXML|XLSX/i);
  await assert.rejects(detectDataFiles([await fixture('unsupported.xyz')]), /supported formats.*GeoJSON.*KML.*Shapefile.*GeoPackage.*CSV.*Excel.*GPX/is);
});

test('enforces direct selection limits before format parsing', async () => {
  const { detectDataFiles, DATA_FILE_LIMITS } = await optionalModule('../editor/import/data-import.js');
  assert.equal(typeof DATA_FILE_LIMITS, 'object');
  const oversized = { name: 'huge.csv', size: DATA_FILE_LIMITS.maxFileBytes + 1, arrayBuffer: async () => new ArrayBuffer(0) };
  await assert.rejects(detectDataFiles([oversized]), /512 MiB|too large/i);
  await assert.rejects(detectDataFiles([]), /choose|select.*file/i);
});

test('CSV adapter handles quoted commas, BOM, delimiter detection, and CRLF without dynamic typing', async () => {
  const { openCsvSource } = await optionalModule('../editor/import/table-adapters.js');
  assert.equal(typeof openCsvSource, 'function');
  const papa = await realPapa();
  const source = await openCsvSource(await fixture('quoted-comma.csv'), { papa });
  assert.equal(source.sourceItems.length, 1);
  const candidate = await source.prepare(source.sourceItems[0].id, { mode: 'table', headerRow: 0 });
  assert.deepEqual(candidate.value.rows, [
    { name: 'Stop A', note: 'Main, northbound' },
    { name: 'Stop B', note: 'Line 1\nLine 2' }
  ]);

  const semicolon = file('bom.csv', `\ufeffName;Code\r\nBến Thành;001\r\nChợ Lớn;002\r\n`);
  const parsed = await openCsvSource(semicolon, { papa });
  const table = await parsed.prepare(parsed.sourceItems[0].id, { mode: 'table', headerRow: 0 });
  assert.equal(table.value.rows[0].code, '001');
  assert.equal(table.value.rows[0].name, 'Bến Thành');
});

test('CSV point mode requires explicit axes and reprojects EPSG:32648 into stored WGS84', async () => {
  const { openCsvSource } = await optionalModule('../editor/import/table-adapters.js');
  const source = await openCsvSource(await fixture('points-32648.csv'), { papa: await realPapa() });
  const candidates = await source.prepare(source.sourceItems[0].id, {
    mode: 'points', xColumn: 'x', yColumn: 'y', zColumn: 'z', sourceCrs: 'EPSG:32648', proj4: await realProj4()
  });
  assert.equal(candidates.length, 1);
  const point = candidates[0].value.features[0].geometry.coordinates;
  assert.ok(Math.abs(point[0] - 106.7028563810) < 1e-7);
  assert.ok(Math.abs(point[1] - 10.8536676064) < 1e-7);
  assert.equal(point[2], 17);
  assert.equal(candidates[0].outputCrs, 'EPSG:4326');

  await assert.rejects(
    source.prepare(source.sourceItems[0].id, { mode: 'points', xColumn: 'x', yColumn: 'missing', sourceCrs: 'EPSG:4326', proj4: await realProj4() }),
    /Y column|missing/i
  );
});

test('JSON table adapter preserves validated tables and normalizes record arrays', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  const { openJsonTableSource } = await optionalModule('../editor/import/table-adapters.js');
  assert.equal(typeof openJsonTableSource, 'function');
  const normalized = await openJsonTableSource(await detectDataFiles([await fixture('normalized-table.json')]));
  assert.equal((await normalized.prepare(normalized.sourceItems[0].id)).value.rows[0].code, '001');
  const records = await openJsonTableSource(await detectDataFiles([await fixture('records.json')]));
  const candidate = await records.prepare(records.sourceItems[0].id);
  assert.deepEqual(candidate.value.columns.map(({ id }) => id), ['name', 'code', 'active']);
  assert.equal(candidate.value.rows[0].code, '001');
});

test('XLSX adapter exposes sheets, bounded header choices, typed dates, and cached formula values only', async () => {
  const sheetJs = await import('../vendor/data-import/sheetjs/0.20.3/xlsx.mjs');
  const { openXlsxSource } = await optionalModule('../editor/import/table-adapters.js');
  assert.equal(typeof openXlsxSource, 'function');

  const workbook = sheetJs.utils.book_new();
  const first = sheetJs.utils.aoa_to_sheet([
    [],
    ['Date', 'Count', 'Code', 'Cached'],
    [new Date(Date.UTC(2026, 8, 1)), 7, '001', null]
  ], { cellDates: true });
  first.D3 = { t: 'n', f: '2+3', v: 5 };
  sheetJs.utils.book_append_sheet(workbook, first, 'Ridership');
  sheetJs.utils.book_append_sheet(workbook, sheetJs.utils.aoa_to_sheet([['Name'], ['Other']]), 'Other');
  const bytes = sheetJs.write(workbook, { type: 'array', bookType: 'xlsx', cellDates: true });

  const source = await openXlsxSource(bytes, { sheetJs });
  assert.deepEqual(source.sourceItems.map(({ label }) => label), ['Ridership', 'Other']);
  assert.equal(source.sourceItems[0].suggestedHeaderRow, 1);
  const candidate = await source.prepare(source.sourceItems[0].id, { headerRow: 1 });
  assert.deepEqual(candidate.value.columns.map(({ type }) => type), ['date', 'integer', 'text', 'integer']);
  assert.deepEqual(candidate.value.rows[0], { date: '2026-09-01', count: 7, code: '001', cached: 5 });
  await assert.rejects(source.prepare(source.sourceItems[0].id, { headerRow: 50 }), /first 50|header row/i);
});

test('KML and GPX adapters partition parser output and never follow network links', async () => {
  const { openXmlSpatialSource } = await optionalModule('../editor/import/spatial-adapters.js');
  assert.equal(typeof openXmlSpatialSource, 'function');
  let fetched = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { fetched = true; throw new Error('network forbidden'); };
  const parsed = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Stop', code: '001' }, geometry: { type: 'Point', coordinates: [106.7, 10.8] } },
      { type: 'Feature', properties: { name: 'Route' }, geometry: { type: 'LineString', coordinates: [[106.7, 10.8], [106.72, 10.82]] } }
    ]
  };
  const domParser = { parseFromString: (text) => ({ text, documentElement: { localName: 'kml' } }) };
  try {
    const kml = await openXmlSpatialSource(await fixture('mixed.kml'), {
      format: 'kml', domParser, toGeoJson: { kml: () => parsed }
    });
    const candidates = await kml.prepare(kml.sourceItems[0].id);
    assert.deepEqual(candidates.map(({ geometry }) => geometry), ['point', 'line']);
    assert.equal(candidates[0].value.features[0].properties.code, '001');
    assert.equal(fetched, false);

    const gpx = await openXmlSpatialSource(await fixture('route.gpx'), {
      format: 'gpx', domParser: { parseFromString: () => ({ documentElement: { localName: 'gpx' } }) },
      toGeoJson: { gpx: () => parsed }
    });
    assert.deepEqual((await gpx.prepare(gpx.sourceItems[0].id)).map(({ geometry }) => geometry), ['point', 'line']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('KMZ adapter exposes safe KML choices and prepares only the selected document', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  const { openKmzSource } = await optionalModule('../editor/import/spatial-adapters.js');
  const archive = makeZip([
    ['doc.kml', '<kml><Document><name>Main</name></Document></kml>'],
    ['nested/other.kml', '<kml><Document><name>Other</name></Document></kml>']
  ]);
  const detection = await detectDataFiles([file('mixed.kmz', archive)]);
  const seen = [];
  const source = await openKmzSource(detection, {
    domParser: { parseFromString: (text) => ({ text, documentElement: { localName: 'kml' } }) },
    toGeoJson: { kml: (document) => {
      seen.push(document.text);
      return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [106, 11] } }] };
    } }
  });
  assert.deepEqual(source.sourceItems.map(({ id }) => id), ['doc.kml', 'nested/other.kml']);
  await source.prepare('nested/other.kml');
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Other/);
});

test('Shapefile PRJ output is accepted as WGS84 without a second reprojection', async () => {
  const { openShapefileSource } = await optionalModule('../editor/import/spatial-adapters.js');
  assert.equal(typeof openShapefileSource, 'function');
  const calls = [];
  const group = {
    basename: 'stops',
    files: { shp: encoder.encode('shape'), dbf: encoder.encode('data'), prj: encoder.encode('projection'), cpg: encoder.encode('UTF-8') }
  };
  const shp = async (components) => {
    calls.push(Object.keys(components).sort());
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { NAME: 'Stop' }, geometry: { type: 'Point', coordinates: [106.7, 10.8] } }] };
  };
  const source = await openShapefileSource({ format: 'shapefile', groups: [group] }, {
    shp,
    proj4: () => { throw new Error('must not reproject PRJ output'); }
  });
  const candidates = await source.prepare(source.sourceItems[0].id, { crsMode: 'prj' });
  assert.deepEqual(calls, [['cpg', 'dbf', 'prj', 'shp']]);
  assert.deepEqual(candidates[0].value.features[0].geometry.coordinates, [106.7, 10.8]);
  assert.equal(candidates[0].coordinateState, 'wgs84');
  assert.equal(candidates[0].reprojected, true);
});

test('Shapefile manual CRS omits PRJ and transforms source-native coordinates exactly once', async () => {
  const { openShapefileSource } = await optionalModule('../editor/import/spatial-adapters.js');
  const calls = [];
  const group = { basename: 'stops', files: { shp: encoder.encode('shape'), prj: encoder.encode('projection') } };
  const shp = async (components) => {
    calls.push(Object.keys(components).sort());
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [686143.36, 1200320.45, 9] } }] };
  };
  const source = await openShapefileSource({ format: 'shapefile', groups: [group] }, { shp, proj4: await realProj4() });
  const candidates = await source.prepare(source.sourceItems[0].id, { crsMode: 'manual', sourceCrs: 'EPSG:32648' });
  assert.deepEqual(calls, [['shp']]);
  const [lng, lat, z] = candidates[0].value.features[0].geometry.coordinates;
  assert.ok(Math.abs(lng - 106.7028563810) < 1e-7);
  assert.ok(Math.abs(lat - 10.8536676064) < 1e-7);
  assert.equal(z, 9);
});

test('Shapefile without PRJ requires an explicit geographic assumption or manual CRS', async () => {
  const { openShapefileSource } = await optionalModule('../editor/import/spatial-adapters.js');
  const source = await openShapefileSource({
    format: 'shapefile', groups: [{ basename: 'stops', files: { shp: encoder.encode('shape') } }]
  }, {
    shp: async () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [106.7, 10.8] } }] }),
    proj4: await realProj4()
  });
  await assert.rejects(source.prepare(source.sourceItems[0].id), /Source CRS|required|assume/i);
  const candidates = await source.prepare(source.sourceItems[0].id, { crsMode: 'assume-4326' });
  assert.match(candidates[0].warnings.join(' '), /assumed EPSG:4326/i);
});

function fakeGeoPackageApi(events, { mismatch = false, exportFeatureDao = true } = {}) {
  const raw = [686143.36, 1200320.45, 6];
  const output = mismatch ? [0, 0, 6] : [106.7028563810, 10.8536676064, 6];
  const rows = [{ id: 1, values: { id: 1, geom: 'binary', name: 'Projected stop' }, geometry: { toGeoJSON: () => ({ type: 'Point', coordinates: raw }) } }];
  class FakeFeatureDao {}
  FakeFeatureDao.reprojectFeature = () => ({ type: 'Point', coordinates: output });
  return {
    ...(exportFeatureDao ? { FeatureDao: FakeFeatureDao } : {}),
    GeoPackageAPI: {
      async open(bytes) {
        events.push(['open', bytes.byteLength]);
        return {
          getFeatureTables: () => ['projected_stops', 'routes'],
          getTileTables: () => { throw new Error('tile tables must not be queried'); },
          getFeatureDao(table) {
            return Object.assign(new FakeFeatureDao(), {
              srs: { organization: 'EPSG', organization_coordsys_id: table === 'projected_stops' ? 32648 : 4326 },
              projection: {},
              getGeometryColumnName: () => 'geom',
              getRow: (value) => value,
              queryForEach() {
                let index = 0;
                return {
                  [Symbol.iterator]() { return this; },
                  next() { return index < rows.length ? { value: rows[index++], done: false } : { done: true }; },
                  return() { events.push('result-set:close'); return { done: true }; }
                };
              }
            });
          },
          close() { events.push('geopackage:close'); }
        };
      }
    }
  };
}

test('GeoPackage uses the FeatureDao instance constructor when the browser bundle does not export FeatureDao', async () => {
  const { openGeoPackageSource } = await optionalModule('../editor/import/geopackage-adapter.js');
  const events = [];
  const source = await openGeoPackageSource(new Uint8Array([1, 2, 3]), {
    geoPackageApi: fakeGeoPackageApi(events, { exportFeatureDao: false }), proj4: await realProj4(), label: 'Features'
  });
  const candidates = await source.prepare(source.sourceItems[0].id);
  assert.ok(Math.abs(candidates[0].value.features[0].geometry.coordinates[0] - 106.7028563810) < 1e-7);
});

test('GeoPackage lists feature tables only and verifies projected output independently', async () => {
  const { openGeoPackageSource } = await optionalModule('../editor/import/geopackage-adapter.js');
  assert.equal(typeof openGeoPackageSource, 'function');
  const events = [];
  const source = await openGeoPackageSource(new Uint8Array([1, 2, 3]), {
    geoPackageApi: fakeGeoPackageApi(events), proj4: await realProj4(), label: 'Features'
  });
  assert.deepEqual(source.sourceItems.map(({ tableName }) => tableName), ['projected_stops', 'routes']);
  const candidates = await source.prepare(source.sourceItems[0].id);
  const point = candidates[0].value.features[0];
  assert.equal(point.properties.name, 'Projected stop');
  assert.equal('geom' in point.properties, false);
  assert.ok(Math.abs(point.geometry.coordinates[0] - 106.7028563810) < 1e-7);
  assert.equal(candidates[0].sourceCrs, 'EPSG:32648');
  assert.deepEqual(events.slice(-2), ['result-set:close', 'geopackage:close']);
});

test('GeoPackage cleanup runs when projected verification fails and dispose is idempotent', async () => {
  const { openGeoPackageSource } = await optionalModule('../editor/import/geopackage-adapter.js');
  const events = [];
  const source = await openGeoPackageSource(new Uint8Array([1, 2, 3]), {
    geoPackageApi: fakeGeoPackageApi(events, { mismatch: true }), proj4: await realProj4(), label: 'Features'
  });
  await assert.rejects(source.prepare(source.sourceItems[0].id), /could not verify.*EPSG:4326/i);
  assert.deepEqual(events.slice(-2), ['result-set:close', 'geopackage:close']);
  source.dispose();
  assert.equal(events.filter((event) => event === 'geopackage:close').length, 2);
});

test('actual shpjs parses safe zipped and loose fixtures with projected coordinates once', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  const { openShapefileSource } = await optionalModule('../editor/import/spatial-adapters.js');
  const priorSelf = globalThis.self;
  globalThis.self = globalThis;
  const { default: shp } = await import('../vendor/data-import/shpjs/6.2.0/shp.esm.min.js');
  if (priorSelf === undefined) delete globalThis.self;
  else globalThis.self = priorSelf;

  for (const fixtureName of ['shapefile-wgs84.zip', 'shapefile-32648.zip']) {
    const detection = await detectDataFiles([await fixture(fixtureName)]);
    const source = await openShapefileSource(detection, { shp });
    const candidates = await source.prepare(source.sourceItems[0].id, { crsMode: 'prj' });
    const [lng, lat] = candidates[0].value.features[0].geometry.coordinates;
    const expected = fixtureName.includes('32648') ? [106.7028563810, 10.8536676064] : [106.7, 10.8];
    assert.ok(Math.abs(lng - expected[0]) < 1e-7, `${fixtureName} longitude`);
    assert.ok(Math.abs(lat - expected[1]) < 1e-7, `${fixtureName} latitude`);
    assert.equal(candidates[0].value.features[0].properties.NAME, fixtureName.includes('32648') ? 'UTM stop' : 'Stop A');
  }

  const loose = await Promise.all(['points.shp', 'points.dbf', 'points.prj', 'points.cpg'].map(async (name) => {
    const bytes = await readFile(new URL(`fixtures/data-import/shapefile-loose/${name}`, import.meta.url));
    return file(name, bytes);
  }));
  const detection = await detectDataFiles(loose);
  const source = await openShapefileSource(detection, { shp });
  const candidates = await source.prepare(source.sourceItems[0].id, { crsMode: 'prj' });
  assert.deepEqual(candidates[0].value.features[0].geometry.coordinates, [106.7, 10.8]);
});

test('actual SheetJS parses the committed two-sheet fixture deterministically', async () => {
  const sheetJs = await import('../vendor/data-import/sheetjs/0.20.3/xlsx.mjs');
  const { openXlsxSource } = await optionalModule('../editor/import/table-adapters.js');
  const bytes = new Uint8Array(await readFile(new URL('fixtures/data-import/tables.xlsx', import.meta.url)));
  const source = await openXlsxSource(bytes, { sheetJs });
  assert.deepEqual(source.sourceItems.map(({ label }) => label), ['Ridership', 'Other']);
  const candidate = await source.prepare(source.sourceItems[0].id);
  assert.deepEqual(candidate.value.rows[0], { date: '2026-09-01', count: 7, code: '001', text: 'Bến Thành' });
});

test('committed unsafe archive is rejected before adapter dispatch', async () => {
  const { detectDataFiles } = await optionalModule('../editor/import/data-import.js');
  await assert.rejects(detectDataFiles([await fixture('unsafe-path.zip')]), /traversal|unsafe.*path/i);
});

test('GeoJSON and KML explicit source CRS overrides transform exactly once before normalization', async () => {
  const { openGeoJsonSource, openXmlSpatialSource } = await optionalModule('../editor/import/spatial-adapters.js');
  const proj4 = await realProj4();
  const projected = {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:3857' } },
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [11131949.079327356, 1118889.9748579594, 3] } }]
  };
  const source = await openGeoJsonSource({
    format: 'geojson', jsonKind: 'spatial', files: [file('legacy.geojson', '{}')], value: projected
  });
  const candidate = (await source.prepare(source.sourceItems[0].id, { sourceCrs: 'EPSG:3857', proj4 }))[0];
  assert.ok(Math.abs(candidate.value.features[0].geometry.coordinates[0] - 100) < 1e-9);
  assert.equal(candidate.value.features[0].geometry.coordinates[2], 3);
  assert.equal(candidate.reprojected, true);

  const kml = await openXmlSpatialSource(file('override.kml', '<kml/>'), {
    format: 'kml', domParser: { parseFromString: () => ({ documentElement: { localName: 'kml' } }) },
    toGeoJson: { kml: () => projected }
  });
  const overridden = (await kml.prepare(kml.sourceItems[0].id, { sourceCrs: 'EPSG:3857', proj4 }))[0];
  assert.ok(Math.abs(overridden.value.features[0].geometry.coordinates[1] - 10) < 1e-9);
});
