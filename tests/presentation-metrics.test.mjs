import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPresentationMetrics,
  formatPresentationMetric,
  resolvePresentationMetric
} from '../src/presentation-metrics.js';

const routeComparison = {
  metrics: {
    existingLengthMeters: 1_250,
    proposedLengthMeters: 1_500,
    retainedLengthMeters: 1_100,
    addedLengthMeters: 400,
    removedLengthMeters: 150
  }
};

const stopComparison = {
  retained: { type: 'FeatureCollection', features: [{}, {}, {}] },
  added: { type: 'FeatureCollection', features: [{}] },
  removed: { type: 'FeatureCollection', features: [{}, {}] }
};

test('presentation metrics reuse route comparison outputs and stop collections as raw numbers', () => {
  const metrics = buildPresentationMetrics({
    routeComparison,
    stopComparison,
    landmarks: [{}, {}, {}]
  });

  assert.deepEqual(metrics, {
    existingLengthMeters: 1_250,
    proposedLengthMeters: 1_500,
    retainedLengthMeters: 1_100,
    addedLengthMeters: 400,
    removedLengthMeters: 150,
    existingStopCount: 5,
    proposedStopCount: 4,
    retainedStopCount: 3,
    addedStopCount: 1,
    removedStopCount: 2,
    poiCount: 3
  });
  Object.values(metrics).forEach((value) => assert.equal(typeof value, 'number'));
});

test('presentation metrics remain fixture-driven rather than hard-coded to route 61-2', () => {
  const metrics = buildPresentationMetrics({
    routeComparison: {
      metrics: {
        existingLengthMeters: 42,
        proposedLengthMeters: 84,
        retainedLengthMeters: 21,
        addedLengthMeters: 63,
        removedLengthMeters: 21
      }
    },
    stopComparison: {
      retained: { features: [] },
      added: { features: [] },
      removed: { features: [] }
    },
    landmarks: []
  });

  assert.equal(metrics.existingLengthMeters, 42);
  assert.equal(metrics.proposedLengthMeters, 84);
  assert.equal(metrics.poiCount, 0);
});

test('distance and integer metric formats use presentation-quality Vietnamese values', () => {
  assert.equal(formatPresentationMetric(1_500, 'distance'), '1,5 km');
  assert.equal(formatPresentationMetric(400, 'signed-distance'), '+0,4 km');
  assert.equal(formatPresentationMetric(12, 'integer'), '12');
});

test('missing metric binding resolves to an explicit graceful value', () => {
  assert.equal(resolvePresentationMetric({ metric: 'unknown', format: 'distance' }, {}), '—');
  assert.equal(formatPresentationMetric(undefined, 'integer'), '—');
});
