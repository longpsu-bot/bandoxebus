// Hai KML được thu thập với mức chi tiết khác nhau. 40 m coi các tim tuyến
// cùng hành lang đường là giữ lại, nhưng vẫn tách rõ đoạn vòng điều chỉnh thật.
export const ROUTE_MATCH_THRESHOLD_METERS = 40;
export const STOP_MATCH_THRESHOLD_METERS = 25;
export const ROUTE_SAMPLE_STEP_METERS = 10;

const EARTH_RADIUS_METERS = 6_371_008.8;

export function haversineMeters([lngA, latA], [lngB, latB]) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLat = radians(latB - latA);
  const deltaLng = radians(lngB - lngA);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(latA)) * Math.cos(radians(latB)) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function projectMeters([lng, lat], referenceLat) {
  const latRadians = referenceLat * Math.PI / 180;
  return [lng * 111_320 * Math.cos(latRadians), lat * 111_132];
}

export function distancePointToSegmentMeters(point, start, end) {
  const referenceLat = (point[1] + start[1] + end[1]) / 3;
  const [px, py] = projectMeters(point, referenceLat);
  const [ax, ay] = projectMeters(start, referenceLat);
  const [bx, by] = projectMeters(end, referenceLat);
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distancePointToLineMeters(point, coordinates) {
  if (coordinates.length === 0) return Number.POSITIVE_INFINITY;
  if (coordinates.length === 1) return haversineMeters(point, coordinates[0]);
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < coordinates.length; index += 1) {
    nearest = Math.min(nearest, distancePointToSegmentMeters(point, coordinates[index - 1], coordinates[index]));
  }
  return nearest;
}

export function lineLengthMeters(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += haversineMeters(coordinates[index - 1], coordinates[index]);
  }
  return total;
}

function sampleSegment(start, end, stepMeters) {
  const steps = Math.max(1, Math.ceil(haversineMeters(start, end) / stepMeters));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const ratio = index / steps;
    return [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio
    ];
  });
}

function classifySegments(coordinates, comparisonCoordinates, nearStatus, farStatus, options) {
  const { routeThresholdMeters, sampleStepMeters } = options;
  const segments = [];
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const samples = sampleSegment(start, end, sampleStepMeters);
    const nearCount = samples.filter((point) => (
      distancePointToLineMeters(point, comparisonCoordinates) <= routeThresholdMeters
    )).length;
    const status = nearCount / samples.length >= 0.67 ? nearStatus : farStatus;
    segments.push({ status, coordinates: [start, end] });
  }
  return segments;
}

export function mergeAdjacentSegments(segments) {
  const merged = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && previous.status === segment.status) {
      previous.coordinates.push(segment.coordinates[1]);
    } else {
      merged.push({ status: segment.status, coordinates: [...segment.coordinates] });
    }
  }
  return merged;
}

function featureCollectionForStatus(segments, status) {
  return {
    type: 'FeatureCollection',
    features: segments
      .filter((segment) => segment.status === status)
      .map((segment, index) => ({
        type: 'Feature',
        id: `${status}-${index}`,
        properties: { status },
        geometry: { type: 'LineString', coordinates: segment.coordinates }
      }))
  };
}

export function compareRoutes(existingCoordinates, proposedCoordinates, options = {}) {
  const settings = {
    routeThresholdMeters: options.routeThresholdMeters ?? ROUTE_MATCH_THRESHOLD_METERS,
    sampleStepMeters: options.sampleStepMeters ?? ROUTE_SAMPLE_STEP_METERS
  };
  const existingSegments = mergeAdjacentSegments(classifySegments(
    existingCoordinates,
    proposedCoordinates,
    'retained',
    'removed',
    settings
  ));
  const proposedSegments = mergeAdjacentSegments(classifySegments(
    proposedCoordinates,
    existingCoordinates,
    'retained',
    'added',
    settings
  ));

  const retained = featureCollectionForStatus(proposedSegments, 'retained');
  const added = featureCollectionForStatus(proposedSegments, 'added');
  const removed = featureCollectionForStatus(existingSegments, 'removed');

  return {
    retained,
    added,
    removed,
    all: {
      type: 'FeatureCollection',
      features: [...removed.features, ...retained.features, ...added.features]
    },
    metrics: {
      existingLengthMeters: lineLengthMeters(existingCoordinates),
      proposedLengthMeters: lineLengthMeters(proposedCoordinates),
      retainedLengthMeters: retained.features.reduce((sum, feature) => sum + lineLengthMeters(feature.geometry.coordinates), 0),
      addedLengthMeters: added.features.reduce((sum, feature) => sum + lineLengthMeters(feature.geometry.coordinates), 0),
      removedLengthMeters: removed.features.reduce((sum, feature) => sum + lineLengthMeters(feature.geometry.coordinates), 0)
    },
    thresholds: settings
  };
}

function stopCoordinates(stop) {
  if (stop?.type === 'Feature') return stop.geometry.coordinates;
  if (Array.isArray(stop?.coordinates)) return stop.coordinates;
  throw new TypeError('Điểm dừng phải có coordinates hoặc là GeoJSON Point Feature.');
}

function stopStableId(stop) {
  return stop?.id ?? stop?.properties?.id ?? stop?.properties?.stopId ?? null;
}

function stopFeature(stop, index, dataset, status, matchMethod = null) {
  const sourceProperties = stop?.type === 'Feature' ? stop.properties : stop?.properties;
  return {
    type: 'Feature',
    id: `${dataset}-${index}`,
    properties: {
      ...(sourceProperties ?? {}),
      dataset,
      sourceIndex: index,
      status,
      matchMethod
    },
    geometry: { type: 'Point', coordinates: [...stopCoordinates(stop)] }
  };
}

export function compareStops(existingStops, proposedStops, options = {}) {
  const thresholdMeters = options.stopThresholdMeters ?? STOP_MATCH_THRESHOLD_METERS;
  const usedExisting = new Set();
  const retained = [];
  const added = [];

  proposedStops.forEach((proposedStop, proposedIndex) => {
    const proposedId = stopStableId(proposedStop);
    let existingIndex = -1;
    let matchMethod = null;

    if (proposedId !== null) {
      existingIndex = existingStops.findIndex((existingStop, index) => (
        !usedExisting.has(index)
        && stopStableId(existingStop) !== null
        && String(stopStableId(existingStop)) === String(proposedId)
      ));
      if (existingIndex >= 0) matchMethod = 'id';
    }

    if (existingIndex < 0) {
      let nearestDistance = Number.POSITIVE_INFINITY;
      existingStops.forEach((existingStop, index) => {
        if (usedExisting.has(index)) return;
        const distance = haversineMeters(stopCoordinates(proposedStop), stopCoordinates(existingStop));
        if (distance <= thresholdMeters && distance < nearestDistance) {
          nearestDistance = distance;
          existingIndex = index;
        }
      });
      if (existingIndex >= 0) matchMethod = 'spatial';
    }

    if (existingIndex >= 0) {
      usedExisting.add(existingIndex);
      retained.push(stopFeature(proposedStop, proposedIndex, 'proposed', 'retained', matchMethod));
    } else {
      added.push(stopFeature(proposedStop, proposedIndex, 'proposed', 'added'));
    }
  });

  const removed = existingStops
    .map((stop, index) => ({ stop, index }))
    .filter(({ index }) => !usedExisting.has(index))
    .map(({ stop, index }) => stopFeature(stop, index, 'existing', 'removed'));

  return {
    retained: { type: 'FeatureCollection', features: retained },
    added: { type: 'FeatureCollection', features: added },
    removed: { type: 'FeatureCollection', features: removed },
    all: { type: 'FeatureCollection', features: [...removed, ...retained, ...added] },
    metrics: { retained: retained.length, added: added.length, removed: removed.length },
    thresholdMeters
  };
}
