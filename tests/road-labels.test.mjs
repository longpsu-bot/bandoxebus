import test from 'node:test';
import assert from 'node:assert/strict';

const roadLabelsModule = await import('../src/road-labels.js').catch(() => ({}));
const {
  buildRoadLabelModeCache,
  buildRouteRoadLabelFeatures,
  createRoadLabelCacheController
} = roadLabelsModule;

const route = [[106.7000, 10.8000], [106.7100, 10.8000]];

function road(name, coordinates) {
  return {
    type: 'Feature',
    properties: name ? { name } : {},
    geometry: { type: 'LineString', coordinates }
  };
}

test('road label filtering keeps a parallel road and excludes crossing or distant roads', () => {
  assert.equal(typeof buildRouteRoadLabelFeatures, 'function');
  const result = buildRouteRoadLabelFeatures([
    road('Đường Tuyến', [[106.7000, 10.8001], [106.7100, 10.8001]]),
    road('Đường Cắt', [[106.7050, 10.7950], [106.7050, 10.8050]]),
    road('Đường Xa', [[106.7000, 10.8050], [106.7100, 10.8050]])
  ], [route], { corridorMeters: 40, minimumLabelLengthMeters: 90 });

  assert.deepEqual(result.features.map((feature) => feature.properties.name), ['Đường Tuyến']);
});

test('road label filtering removes unnamed features and keeps one longest segment per name', () => {
  assert.equal(typeof buildRouteRoadLabelFeatures, 'function');
  const result = buildRouteRoadLabelFeatures([
    road('Quốc lộ 13', [[106.7000, 10.8001], [106.7030, 10.8001]]),
    road(' Quốc lộ 13 ', [[106.7000, 10.8001], [106.7090, 10.8001]]),
    road('', [[106.7000, 10.8001], [106.7100, 10.8001]])
  ], [route], { corridorMeters: 40, minimumLabelLengthMeters: 90 });

  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.name, 'Quốc lộ 13');
  assert.ok(result.features[0].properties.matchedLengthMeters > 900);
});

test('road label cache computes once and mode changes only select cached data', async () => {
  assert.equal(typeof createRoadLabelCacheController, 'function');
  let computeCount = 0;
  const existing = { type: 'FeatureCollection', features: [{ id: 'existing-road' }] };
  const proposed = { type: 'FeatureCollection', features: [{ id: 'proposed-road' }] };
  const compare = { type: 'FeatureCollection', features: [{ id: 'compare-road' }] };
  const controller = createRoadLabelCacheController(async () => {
    computeCount += 1;
    return { existing, proposed, compare };
  });

  const firstPrime = controller.prime({ source: 'first idle' });
  const duplicatePrime = controller.prime({ source: 'second idle' });

  assert.strictEqual(firstPrime, duplicatePrime);
  await firstPrime;
  assert.equal(computeCount, 1);
  assert.strictEqual(controller.forMode('existing'), existing);
  assert.strictEqual(controller.forMode('proposed'), proposed);
  assert.strictEqual(controller.forMode('difference'), proposed);
  assert.strictEqual(controller.forMode('compare'), compare);
  assert.equal(computeCount, 1);
});

test('road label mode cache prepares existing, proposed, and combined labels in one job', () => {
  assert.equal(typeof buildRoadLabelModeCache, 'function');
  const proposedRoute = [[106.7000, 10.8100], [106.7100, 10.8100]];
  const result = buildRoadLabelModeCache({
    roadFeatures: [
      road('Đường Hiện Hữu', [[106.7000, 10.8001], [106.7100, 10.8001]]),
      road('Đường Điều Chỉnh', [[106.7000, 10.8101], [106.7100, 10.8101]])
    ],
    existingCoordinates: route,
    proposedCoordinates: proposedRoute
  }, { corridorMeters: 40, minimumLabelLengthMeters: 90 });

  assert.deepEqual(result.existing.features.map((feature) => feature.properties.name), ['Đường Hiện Hữu']);
  assert.deepEqual(result.proposed.features.map((feature) => feature.properties.name), ['Đường Điều Chỉnh']);
  assert.deepEqual(
    result.compare.features.map((feature) => feature.properties.name),
    ['Đường Điều Chỉnh', 'Đường Hiện Hữu']
  );
});
