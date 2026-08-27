import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareRoutes,
  compareStops,
  ROUTE_MATCH_THRESHOLD_METERS,
  STOP_MATCH_THRESHOLD_METERS
} from '../src/comparison.js';
import { existingRouteLatLng, proposedRouteLatLng } from '../src/route-data.js';

const A = [106.7000, 10.8000];
const B = [106.7010, 10.8000];
const C = [106.7020, 10.8000];

test('route comparison: identical routes are fully retained', () => {
  const result = compareRoutes([A, B, C], [A, B, C]);
  assert.equal(result.added.features.length, 0);
  assert.equal(result.removed.features.length, 0);
  assert.equal(result.retained.features.length, 1);
  assert.equal(result.thresholds.routeThresholdMeters, ROUTE_MATCH_THRESHOLD_METERS);
});

test('route comparison: an extension is added without removing the shared alignment', () => {
  const result = compareRoutes([A, B], [A, B, C]);
  assert.equal(result.retained.features.length, 1);
  assert.equal(result.added.features.length, 1);
  assert.equal(result.removed.features.length, 0);
});

test('route comparison: a diversion creates added and removed segments', () => {
  const diverted = [106.7010, 10.8010];
  const result = compareRoutes([A, B, C], [A, diverted, C]);
  assert.ok(result.added.features.length >= 1);
  assert.ok(result.removed.features.length >= 1);
});

test('route comparison: slight coordinate mismatch inside 20 m remains retained', () => {
  const shifted = [[106.7000, 10.80009], [106.7010, 10.80009], [106.7020, 10.80009]];
  const result = compareRoutes([A, B, C], shifted);
  assert.equal(result.added.features.length, 0);
  assert.equal(result.removed.features.length, 0);
  assert.equal(result.retained.features.length, 1);
});

test('route comparison: real KML sampling mismatch is retained while the true diversion remains', () => {
  const toLngLat = (coordinates) => coordinates.map(([lat, lng]) => [lng, lat]);
  const result = compareRoutes(toLngLat(existingRouteLatLng), toLngLat(proposedRouteLatLng));

  assert.equal(result.added.features.length, 1);
  assert.equal(result.removed.features.length, 1);
  assert.ok(result.metrics.addedLengthMeters > 6_000);
  assert.ok(result.metrics.removedLengthMeters > 1_500);
});

test('stop comparison: stable ID takes priority', () => {
  const existing = [{ id: 'A', coordinates: A }];
  const proposed = [{ id: 'A', coordinates: C }];
  const result = compareStops(existing, proposed);
  assert.equal(result.retained.features.length, 1);
  assert.equal(result.retained.features[0].properties.matchMethod, 'id');
  assert.equal(result.added.features.length, 0);
  assert.equal(result.removed.features.length, 0);
});

test('stop comparison: spatial fallback matches a nearby stop without an ID', () => {
  const result = compareStops(
    [{ coordinates: A }],
    [{ coordinates: [106.70005, 10.80003] }]
  );
  assert.equal(result.retained.features.length, 1);
  assert.equal(result.retained.features[0].properties.matchMethod, 'spatial');
  assert.equal(result.thresholdMeters, STOP_MATCH_THRESHOLD_METERS);
});

test('stop comparison: a point outside threshold becomes one added and one removed stop', () => {
  const result = compareStops([{ coordinates: A }], [{ coordinates: B }]);
  assert.equal(result.retained.features.length, 0);
  assert.equal(result.added.features.length, 1);
  assert.equal(result.removed.features.length, 1);
});

test('stop comparison: mixed inputs classify retained, added, and removed stops', () => {
  const existing = [
    { id: 'keep', coordinates: A },
    { id: 'remove', coordinates: B }
  ];
  const proposed = [
    { id: 'keep', coordinates: [106.70002, 10.80001] },
    { id: 'add', coordinates: C }
  ];
  const result = compareStops(existing, proposed);
  assert.deepEqual(result.metrics, { retained: 1, added: 1, removed: 1 });
  assert.deepEqual(existing[0], { id: 'keep', coordinates: A });
  assert.deepEqual(proposed[0], { id: 'keep', coordinates: [106.70002, 10.80001] });
});
