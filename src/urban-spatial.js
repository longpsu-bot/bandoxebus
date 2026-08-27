const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

export function createLocalProjector(origin) {
  const [originLng, originLat] = origin;
  const longitudeScale = EARTH_RADIUS_M * DEG_TO_RAD * Math.cos(originLat * DEG_TO_RAD);
  const latitudeScale = EARTH_RADIUS_M * DEG_TO_RAD;

  return {
    origin: [...origin],
    toLocal: ([lng, lat]) => [(lng - originLng) * longitudeScale, (lat - originLat) * latitudeScale],
    toLngLat: ([xM, yM]) => [originLng + xM / longitudeScale, originLat + yM / latitudeScale]
  };
}

function pointOnSegment([px, py], [ax, ay], [bx, by], epsilon = 1e-8) {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (px - ax) * (px - bx) + (py - ay) * (py - by);
  return dot <= epsilon;
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[previous];
    const b = polygon[current];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = ((a[1] > point[1]) !== (b[1] > point[1]))
      && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function polygonAreaM2(polygon) {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length - 1; index += 1) {
    twiceArea += polygon[index][0] * polygon[index + 1][1] - polygon[index + 1][0] * polygon[index][1];
  }
  return Math.abs(twiceArea) / 2;
}

export function polygonBounds(polygon) {
  return polygon.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

export function placementFootprint(placement, clearanceM = 0) {
  const halfLength = placement.lengthM / 2 + clearanceM;
  const halfWidth = placement.widthM / 2 + clearanceM;
  const cosine = Math.cos(placement.rotation);
  const sine = Math.sin(placement.rotation);
  const corners = [
    [-halfLength, -halfWidth],
    [halfLength, -halfWidth],
    [halfLength, halfWidth],
    [-halfLength, halfWidth]
  ].map(([x, y]) => [
    placement.xM + x * cosine - y * sine,
    placement.yM + x * sine + y * cosine
  ]);
  return [...corners, corners[0]];
}

function orientation(a, b, c) {
  return Math.sign((b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]));
}

function segmentsIntersect(a, b, c, d) {
  if (pointOnSegment(a, c, d) || pointOnSegment(b, c, d) || pointOnSegment(c, a, b) || pointOnSegment(d, a, b)) return true;
  return orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
}

export function polygonsIntersect(first, second) {
  for (let firstIndex = 0; firstIndex < first.length - 1; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < second.length - 1; secondIndex += 1) {
      if (segmentsIntersect(first[firstIndex], first[firstIndex + 1], second[secondIndex], second[secondIndex + 1])) return true;
    }
  }
  return pointInPolygon(first[0], second) || pointInPolygon(second[0], first);
}

export function distancePointToSegmentM(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const projection = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + projection * dx), point[1] - (start[1] + projection * dy));
}

export function distancePointToLineM(point, coordinates) {
  if (coordinates.length < 2) return Number.POSITIVE_INFINITY;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    distance = Math.min(distance, distancePointToSegmentM(point, coordinates[index], coordinates[index + 1]));
  }
  return distance;
}

export const ROAD_CLEARANCE_M = Object.freeze({
  motorway: 28,
  trunk: 28,
  primary: 22,
  secondary: 18,
  tertiary: 14,
  street: 10,
  street_limited: 10,
  residential: 10,
  minor: 10,
  service: 7
});

export function roadClearanceForClass(roadClass, mapping = ROAD_CLEARANCE_M, fallbackM = 10) {
  return mapping[roadClass] ?? fallbackM;
}

function distanceSegmentToSegmentM(startA, endA, startB, endB) {
  if (segmentsIntersect(startA, endA, startB, endB)) return 0;
  return Math.min(
    distancePointToSegmentM(startA, startB, endB),
    distancePointToSegmentM(endA, startB, endB),
    distancePointToSegmentM(startB, startA, endA),
    distancePointToSegmentM(endB, startA, endA)
  );
}

export function placementIntersectsRoadCorridor(placement, road) {
  const footprint = placementFootprint(placement);
  const clearanceM = road.clearanceM ?? roadClearanceForClass(road.roadClass);
  for (let roadIndex = 0; roadIndex < road.coordinates.length - 1; roadIndex += 1) {
    for (let edgeIndex = 0; edgeIndex < footprint.length - 1; edgeIndex += 1) {
      if (distanceSegmentToSegmentM(
        road.coordinates[roadIndex],
        road.coordinates[roadIndex + 1],
        footprint[edgeIndex],
        footprint[edgeIndex + 1]
      ) <= clearanceM + 1e-9) return true;
    }
  }
  return false;
}

const ORIENTATION_IGNORED_ROAD_CLASSES = new Set(['path', 'track', 'pedestrian', 'cycleway', 'footway', 'steps']);

export function nearestRoadSegment(point, roads) {
  let nearest = null;
  roads.forEach((road) => {
    if (ORIENTATION_IGNORED_ROAD_CLASSES.has(road.roadClass)) return;
    for (let index = 0; index < road.coordinates.length - 1; index += 1) {
      const start = road.coordinates[index];
      const end = road.coordinates[index + 1];
      const distanceM = distancePointToSegmentM(point, start, end);
      if (!nearest || distanceM < nearest.distanceM) {
        nearest = {
          road,
          segmentIndex: index,
          distanceM,
          bearing: Math.atan2(end[1] - start[1], end[0] - start[0])
        };
      }
    }
  });
  return nearest;
}

function lineNearPolygon(line, polygon, marginM) {
  if (line.some((point) => pointInPolygon(point, polygon))) return true;
  for (let lineIndex = 0; lineIndex < line.length - 1; lineIndex += 1) {
    for (let polygonIndex = 0; polygonIndex < polygon.length - 1; polygonIndex += 1) {
      if (distanceSegmentToSegmentM(
        line[lineIndex], line[lineIndex + 1], polygon[polygonIndex], polygon[polygonIndex + 1]
      ) <= marginM) return true;
    }
  }
  return false;
}

export function normalizeRoadFeatures({ features, zone, contextMarginM = 80 }) {
  if (zone?.geometry?.type !== 'Polygon') return [];
  const zoneRing = zone.geometry.coordinates[0];
  const origin = [
    zoneRing.reduce((sum, coordinate) => sum + coordinate[0], 0) / zoneRing.length,
    zoneRing.reduce((sum, coordinate) => sum + coordinate[1], 0) / zoneRing.length
  ];
  const projector = createLocalProjector(origin);
  const localZone = zoneRing.map(projector.toLocal);
  const seen = new Set();
  const roads = [];

  features.forEach((feature) => {
    const lines = feature?.geometry?.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature?.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [];
    lines.forEach((coordinates, lineIndex) => {
      if (coordinates.length < 2) return;
      const roadClass = feature.properties?.class ?? 'unknown';
      const stableId = feature.id ?? feature.properties?.osm_id ?? feature.properties?.id;
      const fingerprint = stableId === undefined || stableId === null
        ? `${roadClass}:${geometryFingerprint(coordinates)}`
        : `${stableId}:${lineIndex}:${geometryFingerprint(coordinates)}`;
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      const localCoordinates = coordinates.map(projector.toLocal);
      if (!lineNearPolygon(localCoordinates, localZone, contextMarginM)) return;
      roads.push({
        id: stableId ?? fingerprint,
        roadClass,
        coordinates: localCoordinates,
        lngLatCoordinates: coordinates.map((coordinate) => [...coordinate]),
        clearanceM: roadClearanceForClass(roadClass),
        bearingSegments: localCoordinates.slice(0, -1).map((start, index) => (
          Math.atan2(localCoordinates[index + 1][1] - start[1], localCoordinates[index + 1][0] - start[0])
        ))
      });
    });
  });
  return roads;
}

function geometryFingerprint(coordinates) {
  return coordinates
    .map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(';');
}

export function normalizeNativeBuildingFeatures({ features, zone }) {
  if (zone?.geometry?.type !== 'Polygon') return [];
  const zoneRing = zone.geometry.coordinates[0];
  const origin = [
    zoneRing.reduce((sum, coordinate) => sum + coordinate[0], 0) / zoneRing.length,
    zoneRing.reduce((sum, coordinate) => sum + coordinate[1], 0) / zoneRing.length
  ];
  const projector = createLocalProjector(origin);
  const localZone = zoneRing.map(projector.toLocal);
  const seen = new Set();
  const normalized = [];

  features.forEach((feature) => {
    const polygons = feature?.geometry?.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature?.geometry?.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
    polygons.forEach((polygon, polygonIndex) => {
      const coordinates = polygon[0];
      const stableId = feature.id ?? feature.properties?.osm_id ?? feature.properties?.id;
      const fingerprint = stableId === undefined || stableId === null
        ? geometryFingerprint(coordinates)
        : `${stableId}:${polygonIndex}`;
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      const localPolygon = coordinates.map(projector.toLocal);
      if (!pointInPolygon(localPolygon[0], localZone) && !polygonsIntersect(localPolygon, localZone)) return;
      normalized.push({
        type: 'Feature',
        id: stableId ?? fingerprint,
        properties: { ...(feature.properties ?? {}) },
        geometry: { type: 'Polygon', coordinates: [coordinates.map((coordinate) => [...coordinate])] }
      });
    });
  });
  return normalized;
}
