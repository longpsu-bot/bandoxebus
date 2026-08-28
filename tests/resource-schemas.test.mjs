import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  validateGeoJsonResource,
  validateMetricFile,
  validateTableData
} from '../src/project/resource-schemas.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/contracts/${name}`, import.meta.url));

async function loadFixture(name) {
  return JSON.parse(await readFile(fixture(name), 'utf8'));
}

function assertInvalid(validate, value, code, path, message = /./) {
  assert.throws(
    () => validate(value),
    (error) => error.code === code && error.path === path && message.test(error.message)
  );
}

test('normalized tables enforce declared scalar columns and exact row keys', async () => {
  const valid = await loadFixture('table.valid.json');
  assert.equal(validateTableData(valid), valid);

  const unknown = await loadFixture('table.invalid-row.json');
  assertInvalid(validateTableData, unknown, 'TABLE_DATA_INVALID', '$.rows[0].extra', /undeclared|unknown/i);

  const missing = structuredClone(valid);
  delete missing.rows[0].active;
  assertInvalid(validateTableData, missing, 'TABLE_DATA_INVALID', '$.rows[0].active', /missing|null/i);
});

test('normalized tables reject duplicate IDs and invalid IDs', async () => {
  const duplicate = await loadFixture('table.valid.json');
  duplicate.columns[1].id = 'name';
  assertInvalid(validateTableData, duplicate, 'TABLE_DATA_INVALID', '$.columns[1].id', /duplicate column ID/i);

  const invalidId = await loadFixture('table.valid.json');
  invalidId.columns[0].id = 'Display Name';
  assertInvalid(validateTableData, invalidId, 'TABLE_DATA_INVALID', '$.columns[0].id', /pattern/i);
});

test('normalized tables validate each declared type without coercion', async () => {
  const cases = [
    ['name', 12, '$.rows[0].name', /text/i],
    ['year', 2026.5, '$.rows[0].year', /integer/i],
    ['year', '2026', '$.rows[0].year', /integer/i],
    ['distance', '1250.5', '$.rows[0].distance', /finite number/i],
    ['distance', Number.POSITIVE_INFINITY, '$.rows[0].distance', /finite number/i],
    ['active', 1, '$.rows[0].active', /boolean/i],
    ['survey-date', '2026-02-30', '$.rows[0].survey-date', /date/i]
  ];

  for (const [column, value, path, message] of cases) {
    const table = await loadFixture('table.valid.json');
    table.rows[0][column] = value;
    assertInvalid(validateTableData, table, 'TABLE_DATA_INVALID', path, message);
  }
});

test('metric files permit only literal scalar or null values and reject expression fields', async () => {
  const valid = await loadFixture('metrics.valid.json');
  assert.equal(validateMetricFile(valid), valid);

  const expression = await loadFixture('metrics.invalid-expression.json');
  assertInvalid(validateMetricFile, expression, 'METRIC_FILE_INVALID', '$.metrics.route-delta.expression', /expression|unknown property/i);

  for (const value of [[], {}, () => 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const metrics = await loadFixture('metrics.valid.json');
    metrics.metrics.status.value = value;
    assertInvalid(validateMetricFile, metrics, 'METRIC_FILE_INVALID', '$.metrics.status.value', /literal|finite/i);
  }
});

test('metric IDs and formatting descriptors are bounded', async () => {
  const formats = [
    { type: 'integer' },
    { type: 'decimal', decimals: 3, unit: 'passengers' },
    { type: 'percentage', decimals: 2 },
    { type: 'distance', decimals: 2 },
    { type: 'currency', currency: 'USD' },
    { type: 'text' }
  ];

  for (const format of formats) {
    const metrics = await loadFixture('metrics.valid.json');
    metrics.metrics.status.format = format;
    assert.equal(validateMetricFile(metrics), metrics);
  }

  const invalidCases = [
    [{ type: 'formula' }, '$.metrics.status.format.type'],
    [{ type: 'decimal', decimals: 4 }, '$.metrics.status.format.decimals'],
    [{ type: 'percentage', decimals: 3 }, '$.metrics.status.format.decimals'],
    [{ type: 'distance', decimals: -1 }, '$.metrics.status.format.decimals'],
    [{ type: 'currency' }, '$.metrics.status.format.currency'],
    [{ type: 'currency', currency: 'usd' }, '$.metrics.status.format.currency']
  ];

  for (const [format, path] of invalidCases) {
    const metrics = await loadFixture('metrics.valid.json');
    metrics.metrics.status.format = format;
    assertInvalid(validateMetricFile, metrics, 'METRIC_FILE_INVALID', path);
  }

  const invalidId = await loadFixture('metrics.valid.json');
  invalidId.metrics['Invalid Metric'] = invalidId.metrics.status;
  delete invalidId.metrics.status;
  assertInvalid(validateMetricFile, invalidId, 'METRIC_FILE_INVALID', '$.metrics.Invalid Metric', /metric ID/i);
});

test('GeoJSON validation is structural and respects declared geometry', () => {
  const pointCollection = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'Stop A' }, geometry: { type: 'Point', coordinates: [106.6, 11.0] } }
    ]
  };
  assert.equal(validateGeoJsonResource(pointCollection, { geometry: 'point' }), pointCollection);
  assert.equal(validateGeoJsonResource(pointCollection, { geometry: 'mixed' }), pointCollection);

  assertInvalid(
    (value) => validateGeoJsonResource(value, { geometry: 'line' }),
    pointCollection,
    'GEOJSON_RESOURCE_INVALID',
    '$.features[0].geometry.type',
    /line/i
  );

  assertInvalid(
    (value) => validateGeoJsonResource(value, { geometry: 'point' }),
    { type: 'Feature', features: [] },
    'GEOJSON_RESOURCE_INVALID',
    '$.type',
    /FeatureCollection/i
  );
});
