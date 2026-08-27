import {
  distancePointToSegmentMeters,
  haversineMeters,
  lineLengthMeters
} from './comparison.js';

export const ROAD_LABEL_CORRIDOR_METERS = 45;
export const ROAD_LABEL_MINIMUM_LENGTH_METERS = 70;
export const ROAD_LABEL_MAX_ANGLE_DEGREES = 35;
const ROAD_LABEL_SAMPLE_STEP_METERS = 18;

function featureName(feature) {
  const properties = feature?.properties ?? {};
  return String(properties.name ?? properties.name_vi ?? properties.name_en ?? '').trim();
}

function geometryLines(feature) {
  if (feature?.geometry?.type === 'LineString') return [feature.geometry.coordinates];
  if (feature?.geometry?.type === 'MultiLineString') return feature.geometry.coordinates;
  return [];
}

function segmentAngle([lngA, latA], [lngB, latB]) {
  const referenceLat = (latA + latB) / 2 * Math.PI / 180;
  const dx = (lngB - lngA) * Math.cos(referenceLat);
  const dy = latB - latA;
  return Math.atan2(dy, dx);
}

function undirectedAngleDifference(angleA, angleB) {
  const raw = Math.abs(angleA - angleB) % Math.PI;
  return Math.min(raw, Math.PI - raw);
}

function nearestRouteRelation(point, roadAngle, routeCoordinateSets) {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestAngleDifference = Number.POSITIVE_INFINITY;
  routeCoordinateSets.forEach((coordinates) => {
    for (let index = 1; index < coordinates.length; index += 1) {
      const start = coordinates[index - 1];
      const end = coordinates[index];
      const distance = distancePointToSegmentMeters(point, start, end);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestAngleDifference = undirectedAngleDifference(roadAngle, segmentAngle(start, end));
      }
    }
  });
  return { distance: nearestDistance, angleDifference: nearestAngleDifference };
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

function matchedSubLines(roadCoordinates, routeCoordinateSets, options) {
  const maxAngleRadians = options.maximumAngleDegrees * Math.PI / 180;
  const matched = [];
  let current = null;

  for (let index = 1; index < roadCoordinates.length; index += 1) {
    const samples = sampleSegment(roadCoordinates[index - 1], roadCoordinates[index], ROAD_LABEL_SAMPLE_STEP_METERS);
    for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
      const start = samples[sampleIndex - 1];
      const end = samples[sampleIndex];
      const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const relation = nearestRouteRelation(midpoint, segmentAngle(start, end), routeCoordinateSets);
      const followsRoute = relation.distance <= options.corridorMeters
        && relation.angleDifference <= maxAngleRadians;

      if (followsRoute) {
        if (!current) current = [start, end];
        else current.push(end);
      } else if (current) {
        matched.push(current);
        current = null;
      }
    }
  }
  if (current) matched.push(current);
  return matched;
}

export function buildRouteRoadLabelFeatures(roadFeatures, routeCoordinateSets, options = {}) {
  const settings = {
    corridorMeters: options.corridorMeters ?? ROAD_LABEL_CORRIDOR_METERS,
    minimumLabelLengthMeters: options.minimumLabelLengthMeters ?? ROAD_LABEL_MINIMUM_LENGTH_METERS,
    maximumAngleDegrees: options.maximumAngleDegrees ?? ROAD_LABEL_MAX_ANGLE_DEGREES
  };
  const longestByName = new Map();

  roadFeatures.forEach((feature) => {
    const name = featureName(feature);
    if (!name) return;
    geometryLines(feature).forEach((line) => {
      matchedSubLines(line, routeCoordinateSets, settings).forEach((coordinates) => {
        const matchedLengthMeters = lineLengthMeters(coordinates);
        if (matchedLengthMeters < settings.minimumLabelLengthMeters) return;
        const key = name.toLocaleLowerCase('vi-VN');
        const previous = longestByName.get(key);
        if (!previous || matchedLengthMeters > previous.properties.matchedLengthMeters) {
          longestByName.set(key, {
            type: 'Feature',
            properties: {
              ...(feature.properties ?? {}),
              name,
              matchedLengthMeters
            },
            geometry: { type: 'LineString', coordinates }
          });
        }
      });
    });
  });

  return {
    type: 'FeatureCollection',
    features: [...longestByName.values()]
      .sort((featureA, featureB) => featureA.properties.name.localeCompare(featureB.properties.name, 'vi-VN'))
      .map((feature, index) => ({ ...feature, id: `route-road-${index}` }))
  };
}

function mergeRoadLabelCollections(...collections) {
  const longestByName = new Map();
  collections.forEach((collection) => {
    collection.features.forEach((feature) => {
      const key = feature.properties.name.toLocaleLowerCase('vi-VN');
      const previous = longestByName.get(key);
      if (!previous || feature.properties.matchedLengthMeters > previous.properties.matchedLengthMeters) {
        longestByName.set(key, feature);
      }
    });
  });

  return {
    type: 'FeatureCollection',
    features: [...longestByName.values()]
      .sort((featureA, featureB) => featureA.properties.name.localeCompare(featureB.properties.name, 'vi-VN'))
      .map((feature, index) => ({ ...feature, id: `route-road-${index}` }))
  };
}

export function buildRoadLabelModeCache({
  roadFeatures,
  existingCoordinates,
  proposedCoordinates
}, options = {}) {
  const existing = buildRouteRoadLabelFeatures(roadFeatures, [existingCoordinates], options);
  const proposed = buildRouteRoadLabelFeatures(roadFeatures, [proposedCoordinates], options);
  return {
    existing,
    proposed,
    compare: mergeRoadLabelCollections(existing, proposed)
  };
}

const emptyFeatureCollection = () => ({ type: 'FeatureCollection', features: [] });

export function createRoadLabelCacheController(computeLabels) {
  let cache = null;
  let pending = null;

  return {
    prime(input) {
      if (pending) return pending;
      pending = Promise.resolve()
        .then(() => computeLabels(input))
        .then((result) => {
          cache = result;
          return result;
        })
        .catch((error) => {
          pending = null;
          throw error;
        });
      return pending;
    },
    forMode(mode) {
      if (!cache) return emptyFeatureCollection();
      if (mode === 'existing') return cache.existing;
      if (mode === 'compare') return cache.compare;
      return cache.proposed;
    }
  };
}
