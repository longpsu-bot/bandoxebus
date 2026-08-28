import { createLocaleFormatter } from './metrics/locale-formatter.js';

const DEFAULT_FORMATTER = createLocaleFormatter('vi-VN');

function collectionSize(collection) {
  return Array.isArray(collection?.features) ? collection.features.length : 0;
}

export function buildPresentationMetrics({ routeComparison, stopComparison, landmarks = [] }) {
  const retainedStopCount = collectionSize(stopComparison?.retained);
  const addedStopCount = collectionSize(stopComparison?.added);
  const removedStopCount = collectionSize(stopComparison?.removed);
  const routeMetrics = routeComparison?.metrics ?? {};

  return {
    existingLengthMeters: Number(routeMetrics.existingLengthMeters),
    proposedLengthMeters: Number(routeMetrics.proposedLengthMeters),
    retainedLengthMeters: Number(routeMetrics.retainedLengthMeters),
    addedLengthMeters: Number(routeMetrics.addedLengthMeters),
    removedLengthMeters: Number(routeMetrics.removedLengthMeters),
    existingStopCount: retainedStopCount + removedStopCount,
    proposedStopCount: retainedStopCount + addedStopCount,
    retainedStopCount,
    addedStopCount,
    removedStopCount,
    poiCount: landmarks.length
  };
}

export function formatPresentationMetric(value, format = 'integer', formatter = DEFAULT_FORMATTER) {
  if (!Number.isFinite(value)) return '—';

  if (format === 'distance' || format === 'signed-distance') {
    const prefix = format === 'signed-distance' && value > 0 ? '+' : '';
    return `${prefix}${formatter.format(value / 1000, { type: 'decimal', decimals: 1 })} km`;
  }

  return formatter.format(value, { type: 'integer' });
}

export function resolvePresentationMetric(binding, metrics) {
  return formatPresentationMetric(metrics?.[binding.metric], binding.format);
}
