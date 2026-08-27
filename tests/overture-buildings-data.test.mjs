import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const projectUrl = new URL('../', import.meta.url);

test('checked-in production Overture data is pinned, internally consistent, and render-ready', async () => {
  const collection = JSON.parse(await readFile(new URL('data/context/my-phuoc-1-buildings.geojson', projectUrl), 'utf8'));
  const { metadata, features } = collection;
  assert.equal(metadata.overtureRelease, '2026-08-19.0');
  assert.equal(metadata.overturemapsPackageVersion, '0.20.0');
  assert.equal(metadata.aoiFeatureId, 'osm-industrial-759187612');
  assert.equal(metadata.statistics.featureCount, features.length);
  assert.ok(features.length > 0);
  assert.ok(metadata.statistics.aoiCoverageRatio > 0);
  assert.match(metadata.selectionRule, /complete source footprint retained/i);
  assert.match(metadata.coverageRule, /intersection AOI/i);
  assert.equal(Object.values(metadata.statistics.heightSourceCounts).reduce((sum, count) => sum + count, 0), features.length);
  assert.equal(new Set(features.map((feature) => feature.id)).size, features.length);
  features.forEach((feature) => {
    assert.ok(['Polygon', 'MultiPolygon'].includes(feature.geometry.type));
    assert.ok(feature.properties.render_height_m > 0);
    assert.ok(feature.properties.aoi_intersection_area_m2 > 0);
    assert.ok(feature.properties.footprint_area_m2 >= feature.properties.aoi_intersection_area_m2 - 0.1);
    assert.ok(Array.isArray(feature.properties.sources));
  });
});

test('dataset bbox is derived from the authoritative polygon and matches the certified guardrail', async () => {
  const aoi = JSON.parse(await readFile(new URL('data/industrial-zone-poc.geojson', projectUrl), 'utf8'));
  const overture = JSON.parse(await readFile(new URL('data/context/my-phuoc-1-buildings.geojson', projectUrl), 'utf8'));
  const coordinates = aoi.features[0].geometry.coordinates[0];
  const derived = [
    Math.min(...coordinates.map(([lng]) => lng)),
    Math.min(...coordinates.map(([, lat]) => lat)),
    Math.max(...coordinates.map(([lng]) => lng)),
    Math.max(...coordinates.map(([, lat]) => lat))
  ];
  assert.deepEqual(overture.metadata.derivedBbox, derived);
  assert.ok(Math.max(...derived.map((value, index) => Math.abs(value - [106.5877666, 11.1174356, 106.6037689, 11.1414241][index]))) < 1e-7);
});

test('adjacent production metadata captures reproducibility and source composition', async () => {
  const metadata = JSON.parse(await readFile(new URL('data/context/my-phuoc-1-buildings.meta.json', projectUrl), 'utf8'));
  assert.equal(metadata.dataset.path, 'data/context/my-phuoc-1-buildings.geojson');
  assert.equal(metadata.dataset.featureCount, 1299);
  assert.equal(metadata.overture.release, '2026-08-19.0');
  assert.equal(metadata.overture.packageVersion, '0.20.0');
  assert.equal(metadata.aoi.authoritativePath, 'data/industrial-zone-poc.geojson');
  assert.equal(metadata.aoi.featureId, 'osm-industrial-759187612');
  assert.deepEqual(metadata.aoi.derivedBbox.map((value) => Number(value.toFixed(7))), [106.5877666, 11.1174356, 106.6037689, 11.1414241]);
  assert.equal(metadata.statistics.aoiCoverageRatio, 0.417409);
  assert.deepEqual(metadata.statistics.geometryTypeCounts, { Polygon: 1299 });
  assert.deepEqual(metadata.statistics.heightSourceCounts, {
    'source-height': 0,
    'floors-derived': 0,
    'illustrative-height': 1299
  });
  assert.deepEqual(metadata.provenance.featureCounts, {
    'Google Open Buildings': 905,
    'Microsoft ML Buildings': 370,
    OpenStreetMap: 24
  });
  assert.match(metadata.dataset.sha256, /^[a-f0-9]{64}$/);
  assert.match(metadata.aoi.sha256, /^[a-f0-9]{64}$/);
  assert.match(metadata.preprocessing.scriptSha256, /^[a-f0-9]{64}$/);
  assert.equal(metadata.preprocessing.heightPolicyVersion, 'route61-2-overture-height-v1');
});
