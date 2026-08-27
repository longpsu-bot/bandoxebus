import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOvertureLayerDefinitions,
  deriveOvertureHeight,
  inspectOvertureCollection,
  OVERTURE_BUILDINGS_DATA_URL
} from '../src/overture-buildings.js';

test('height derivation prefers a valid source height', () => {
  assert.deepEqual(deriveOvertureHeight({ height: 12.4, num_floors: 5 }, 900), {
    heightM: 12.4,
    minHeightM: 0,
    heightSource: 'source-height'
  });
});

test('height derivation uses floors before the illustrative area fallback', () => {
  assert.deepEqual(deriveOvertureHeight({ height: null, num_floors: 3, min_height: 1.5 }, 2_000), {
    heightM: 10.5,
    minHeightM: 1.5,
    heightSource: 'floors-derived'
  });
});

test('height derivation uses deterministic footprint-area classes', () => {
  const thresholds = { smallMaxM2: 400, mediumMaxM2: 1_200, largeMaxM2: 3_000 };
  assert.equal(deriveOvertureHeight({}, 250, thresholds).heightM, 6.5);
  assert.equal(deriveOvertureHeight({}, 800, thresholds).heightM, 8.5);
  assert.equal(deriveOvertureHeight({}, 2_000, thresholds).heightM, 11);
  assert.equal(deriveOvertureHeight({}, 5_000, thresholds).heightM, 14);
  assert.equal(deriveOvertureHeight({}, 5_000, thresholds).heightSource, 'illustrative-height');
});

test('height derivation rejects implausible source values', () => {
  const result = deriveOvertureHeight({ height: -4, num_floors: 0, min_height: 99 }, 600);
  assert.deepEqual(result, { heightM: 8.5, minHeightM: 0, heightSource: 'illustrative-height' });
});

const usableCollection = {
  type: 'FeatureCollection',
  metadata: {
    provider: 'Overture Maps Foundation',
    overtureRelease: '2026-07-22.0',
    aoiFeatureId: 'osm-industrial-759187612',
    selectionRule: 'building intersects AOI; complete source footprint retained',
    coverageRule: 'area(building intersection AOI) / area(AOI)',
    statistics: { featureCount: 2, aoiCoverageRatio: 0.08 }
  },
  features: [
    { type: 'Feature', properties: { render_height_m: 9 }, geometry: { type: 'Polygon', coordinates: [] } },
    { type: 'Feature', properties: { render_height_m: 12 }, geometry: { type: 'MultiPolygon', coordinates: [] } }
  ]
};

test('collection inspection requires pinned release metadata and renderable features', () => {
  assert.deepEqual(inspectOvertureCollection(usableCollection), {
    usable: true,
    reason: null,
    featureCount: 2,
    release: '2026-07-22.0',
    coverageRatio: 0.08
  });
  assert.equal(inspectOvertureCollection({ ...usableCollection, metadata: {} }).usable, false);
  assert.equal(inspectOvertureCollection({ ...usableCollection, features: [] }).usable, false);
});

test('MapLibre definitions use native fill extrusion and remain hidden until Slide 05', () => {
  const { source, layer } = createOvertureLayerDefinitions(usableCollection);
  assert.equal(source.type, 'geojson');
  assert.equal(source.data, usableCollection);
  assert.match(source.attribution, /Overture Maps Foundation/);
  assert.equal(layer.type, 'fill-extrusion');
  assert.equal(layer.layout.visibility, 'none');
  assert.deepEqual(layer.paint['fill-extrusion-height'], ['get', 'render_height_m']);
  assert.deepEqual(layer.paint['fill-extrusion-base'], ['get', 'render_min_height_m']);
});

test('production dataset URL no longer points at the POC artifact', () => {
  assert.equal(OVERTURE_BUILDINGS_DATA_URL, './data/context/my-phuoc-1-buildings.geojson');
});
