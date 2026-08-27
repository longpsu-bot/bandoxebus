import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocalProjector,
  pointInPolygon,
  polygonAreaM2,
  placementFootprint,
  polygonsIntersect,
  distancePointToLineM,
  normalizeNativeBuildingFeatures,
  roadClearanceForClass,
  placementIntersectsRoadCorridor,
  nearestRoadSegment,
  normalizeRoadFeatures
} from '../src/urban-spatial.js';

const square = [
  [-50, -50],
  [50, -50],
  [50, 50],
  [-50, 50],
  [-50, -50]
];

test('local projection round-trips longitude and latitude near its origin', () => {
  const projector = createLocalProjector([106.595, 11.13]);
  const coordinate = [106.6012, 11.1374];
  const roundTrip = projector.toLngLat(projector.toLocal(coordinate));

  assert.ok(Math.abs(roundTrip[0] - coordinate[0]) < 1e-9);
  assert.ok(Math.abs(roundTrip[1] - coordinate[1]) < 1e-9);
});

test('point containment distinguishes inside, boundary, and outside positions', () => {
  assert.equal(pointInPolygon([0, 0], square), true);
  assert.equal(pointInPolygon([50, 10], square), true);
  assert.equal(pointInPolygon([51, 0], square), false);
});

test('polygon area uses local metre coordinates', () => {
  assert.equal(polygonAreaM2(square), 10_000);
});

test('rotated placement footprints collide only when their polygons overlap', () => {
  const first = placementFootprint({ xM: 0, yM: 0, widthM: 20, lengthM: 40, rotation: Math.PI / 4 });
  const overlapping = placementFootprint({ xM: 10, yM: 0, widthM: 20, lengthM: 40, rotation: 0 });
  const separate = placementFootprint({ xM: 80, yM: 0, widthM: 20, lengthM: 40, rotation: 0 });

  assert.equal(polygonsIntersect(first, overlapping), true);
  assert.equal(polygonsIntersect(first, separate), false);
});

test('distance to a route polyline returns the closest segment distance', () => {
  assert.ok(Math.abs(distancePointToLineM([50, 30], [[0, 0], [100, 0], [100, 100]]) - 30) < 1e-9);
});

test('native building normalization deduplicates tile repeats and excludes polygons outside the zone', () => {
  const zone = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[
      [106.59, 11.12], [106.60, 11.12], [106.60, 11.13], [106.59, 11.13], [106.59, 11.12]
    ]] }
  };
  const inside = {
    type: 'Feature', id: 42, properties: { render_height: 12 },
    geometry: { type: 'Polygon', coordinates: [[
      [106.594, 11.124], [106.595, 11.124], [106.595, 11.125], [106.594, 11.125], [106.594, 11.124]
    ]] }
  };
  const outside = {
    type: 'Feature', id: 99, properties: {},
    geometry: { type: 'Polygon', coordinates: [[
      [106.70, 11.20], [106.71, 11.20], [106.71, 11.21], [106.70, 11.21], [106.70, 11.20]
    ]] }
  };

  const normalized = normalizeNativeBuildingFeatures({ features: [inside, structuredClone(inside), outside], zone });
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, 42);
});

test('road clearances preserve OpenMapTiles hierarchy and use a safe fallback', () => {
  assert.ok(roadClearanceForClass('primary') > roadClearanceForClass('tertiary'));
  assert.ok(roadClearanceForClass('tertiary') > roadClearanceForClass('service'));
  assert.equal(roadClearanceForClass('unknown-road-class'), 10);
});

test('road collision checks the whole oriented building footprint', () => {
  const road = { coordinates: [[-100, 0], [100, 0]], clearanceM: 10 };
  const edgeOverlaps = { xM: 0, yM: 24, lengthM: 70, widthM: 30, rotation: 0 };
  const clear = { ...edgeOverlaps, yM: 26 };
  const threshold = { ...edgeOverlaps, yM: 25 };

  assert.equal(placementIntersectsRoadCorridor(edgeOverlaps, road), true);
  assert.equal(placementIntersectsRoadCorridor(clear, road), false);
  assert.equal(placementIntersectsRoadCorridor(threshold, road), true);
});

test('nearest road segment returns its local bearing and ignores path-like classes', () => {
  const result = nearestRoadSegment([0, 20], [
    { id: 'path', roadClass: 'path', coordinates: [[-100, 18], [100, 18]] },
    { id: 'primary', roadClass: 'primary', coordinates: [[-100, 0], [100, 0]] }
  ]);

  assert.equal(result.road.id, 'primary');
  assert.ok(Math.abs(result.bearing) < 1e-9);
  assert.equal(result.distanceM, 20);
});

test('road normalization deduplicates tile repeats, preserves classes, and limits context', () => {
  const zone = {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[
      [106.59, 11.12], [106.60, 11.12], [106.60, 11.13], [106.59, 11.13], [106.59, 11.12]
    ]] }
  };
  const inside = {
    type: 'Feature', id: 7, properties: { class: 'secondary' },
    geometry: { type: 'LineString', coordinates: [[106.5898, 11.125], [106.6002, 11.125]] }
  };
  const outside = {
    type: 'Feature', id: 8, properties: { class: 'service' },
    geometry: { type: 'LineString', coordinates: [[106.70, 11.20], [106.71, 11.20]] }
  };
  const splitSegment = {
    ...structuredClone(inside),
    geometry: { type: 'LineString', coordinates: [[106.595, 11.12], [106.595, 11.13]] }
  };
  const normalized = normalizeRoadFeatures({ features: [inside, structuredClone(inside), splitSegment, outside], zone });
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].id, 7);
  assert.equal(normalized[0].roadClass, 'secondary');
  assert.equal(normalized[0].clearanceM, 18);
  assert.equal(normalized[0].bearingSegments.length, 1);
});
