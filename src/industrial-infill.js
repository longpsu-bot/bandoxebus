import {
  createLocalProjector,
  distancePointToLineM,
  placementFootprint,
  placementIntersectsRoadCorridor,
  pointInPolygon,
  polygonAreaM2,
  polygonBounds,
  polygonsIntersect,
  nearestRoadSegment
} from './urban-spatial.js';

export const INDUSTRIAL_ARCHETYPES = Object.freeze({
  warehouse: Object.freeze({ weight: 0.42, lengthM: [32, 70], widthM: [18, 45], heightM: [7, 15] }),
  'factory-hall': Object.freeze({ weight: 0.32, lengthM: [28, 65], widthM: [16, 38], heightM: [8, 18] }),
  'office-block': Object.freeze({ weight: 0.16, lengthM: [18, 38], widthM: [14, 28], heightM: [10, 30] }),
  'tank-or-silo': Object.freeze({ weight: 0.10, lengthM: [10, 26], widthM: [10, 26], heightM: [8, 25] })
});

export const DEFAULT_INDUSTRIAL_CONFIG = Object.freeze({
  nativeBuildingClearanceM: 5,
  routeClearanceM: 22,
  poiClearanceM: 32,
  syntheticClearanceM: 4,
  targetOccupancy: 0.06,
  averageFootprintM2: 850,
  maxInstances: 420,
  maxAttemptsPerTarget: 50,
  spatialHashCellM: 100,
  targetSyntheticCoverage: 0.115,
  coverageTolerance: 0.015,
  maxCampuses: 60,
  maxCampusAttempts: 3_000,
  campusClearanceM: 35,
  orientationVariationDeg: 7
});

export const CAMPUS_TEMPLATE_IDS = Object.freeze([
  'single-hall',
  'hall-office',
  'parallel-halls',
  'factory-complex',
  'hall-silos'
]);

const MORPHOLOGY_ARCHETYPES = Object.freeze({
  warehouse: Object.freeze({ lengthM: [70, 170], widthM: [35, 85], heightM: [8, 16] }),
  'factory-hall': Object.freeze({ lengthM: [60, 150], widthM: [30, 75], heightM: [10, 20] }),
  'secondary-shed': Object.freeze({ lengthM: [30, 80], widthM: [18, 40], heightM: [6, 12] }),
  'office-block': Object.freeze({ lengthM: [20, 55], widthM: [15, 35], heightM: [10, 28] }),
  'tank-or-silo': Object.freeze({ lengthM: [8, 22], widthM: [8, 22], heightM: [10, 30] })
});

function hashSeed(value) {
  let hash = 2_166_136_261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6D2B79F5;
    let result = state;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function polygonCentroid(polygon) {
  const points = polygon.slice(0, -1);
  return points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
}

export function calculateNativeCoverage({ zonePolygon, nativePolygons }) {
  const zoneAreaM2 = polygonAreaM2(zonePolygon);
  const relevant = nativePolygons.filter((polygon) => (
    pointInPolygon(polygonCentroid(polygon), zonePolygon) || polygonsIntersect(polygon, zonePolygon)
  ));
  const nativeBuildingAreaM2 = Math.min(
    zoneAreaM2,
    relevant.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0)
  );
  return {
    zoneAreaM2,
    nativeBuildingAreaM2,
    nativeCoverageRatio: zoneAreaM2 > 0 ? nativeBuildingAreaM2 / zoneAreaM2 : 0,
    nativeBuildingCount: relevant.length
  };
}

export function calculateTargetCount({ zoneAreaM2, nativeCoverageRatio, config }) {
  const coverageDeficit = Math.max(0, Math.min(1, 1 - nativeCoverageRatio));
  const requested = Math.round((zoneAreaM2 * config.targetOccupancy * coverageDeficit) / config.averageFootprintM2);
  return Math.max(0, Math.min(config.maxInstances, requested));
}

export function validatePlacement({
  placement,
  zonePolygon,
  nativePolygons,
  routeCoordinates,
  pois,
  nearbyPlacements,
  config
}) {
  const footprint = placementFootprint(placement);
  if (!footprint.slice(0, -1).every((corner) => pointInPolygon(corner, zonePolygon))) return 'outsideZone';

  const nativeClearanceFootprint = placementFootprint(placement, config.nativeBuildingClearanceM);
  if (nativePolygons.some((polygon) => polygonsIntersect(nativeClearanceFootprint, polygon))) return 'nativeCollision';

  const halfDiagonal = Math.hypot(placement.lengthM, placement.widthM) / 2;
  const routeLines = Array.isArray(routeCoordinates?.[0]?.[0]) ? routeCoordinates : [routeCoordinates];
  const routeDistance = routeLines.reduce((minimum, line) => (
    Math.min(minimum, distancePointToLineM([placement.xM, placement.yM], line))
  ), Number.POSITIVE_INFINITY);
  if (routeDistance < config.routeClearanceM + halfDiagonal) return 'routeClearance';
  if (pois.some((poi) => Math.hypot(placement.xM - poi[0], placement.yM - poi[1]) < config.poiClearanceM + halfDiagonal)) return 'poiClearance';

  const syntheticFootprint = placementFootprint(placement, config.syntheticClearanceM / 2);
  if (nearbyPlacements.some((accepted) => polygonsIntersect(
    syntheticFootprint,
    placementFootprint(accepted, config.syntheticClearanceM / 2)
  ))) return 'syntheticCollision';
  return null;
}

function normalizedNativePolygons(nativeBuildings, projector) {
  return nativeBuildings.flatMap((building) => {
    if (Array.isArray(building?.[0]?.[0])) return [building[0].map(projector.toLocal)];
    if (Array.isArray(building?.[0])) return [building.map(projector.toLocal)];
    if (building?.geometry?.type === 'Polygon') return [building.geometry.coordinates[0].map(projector.toLocal)];
    if (building?.geometry?.type === 'MultiPolygon') return building.geometry.coordinates.map((polygon) => polygon[0].map(projector.toLocal));
    return [];
  });
}

function pickArchetype(random) {
  let sample = random();
  for (const [name, settings] of Object.entries(INDUSTRIAL_ARCHETYPES)) {
    sample -= settings.weight;
    if (sample <= 0) return [name, settings];
  }
  return ['warehouse', INDUSTRIAL_ARCHETYPES.warehouse];
}

function range(random, [minimum, maximum]) {
  return minimum + (maximum - minimum) * random();
}

function cellsForPlacement(placement, cellSizeM) {
  const bounds = polygonBounds(placementFootprint(placement, DEFAULT_INDUSTRIAL_CONFIG.syntheticClearanceM));
  const cells = [];
  for (let x = Math.floor(bounds.minX / cellSizeM); x <= Math.floor(bounds.maxX / cellSizeM); x += 1) {
    for (let y = Math.floor(bounds.minY / cellSizeM); y <= Math.floor(bounds.maxY / cellSizeM); y += 1) cells.push(`${x}:${y}`);
  }
  return cells;
}

export function generateIndustrialInfill({ zone, nativeBuildings, routeCoordinates, pois, seed, config = DEFAULT_INDUSTRIAL_CONFIG }) {
  if (zone?.geometry?.type !== 'Polygon') throw new TypeError('Industrial Morphology V2 fallback requires one GeoJSON Polygon feature.');
  const ring = zone.geometry.coordinates[0];
  const origin = [
    ring.reduce((sum, coordinate) => sum + coordinate[0], 0) / ring.length,
    ring.reduce((sum, coordinate) => sum + coordinate[1], 0) / ring.length
  ];
  const projector = createLocalProjector(origin);
  const zonePolygon = ring.map(projector.toLocal);
  const nativePolygons = normalizedNativePolygons(nativeBuildings, projector);
  const routeLines = Array.isArray(routeCoordinates?.[0]?.[0]) ? routeCoordinates : [routeCoordinates];
  const routeLocal = routeLines.map((line) => line.map(projector.toLocal));
  const poisLocal = pois.map((poi) => projector.toLocal(Array.isArray(poi) ? poi : poi.coordinates));
  const coverage = calculateNativeCoverage({ zonePolygon, nativePolygons });
  const targetCount = calculateTargetCount({ ...coverage, config });
  const random = createSeededRandom(seed);
  const bounds = polygonBounds(zonePolygon);
  const placements = [];
  const spatialHash = new Map();
  const rejections = { outsideZone: 0, nativeCollision: 0, routeClearance: 0, poiClearance: 0, syntheticCollision: 0 };
  const maximumAttempts = Math.max(targetCount, targetCount * config.maxAttemptsPerTarget);
  let attempts = 0;

  while (placements.length < targetCount && attempts < maximumAttempts) {
    attempts += 1;
    const [archetype, archetypeConfig] = pickArchetype(random);
    const widthM = range(random, archetypeConfig.widthM);
    const lengthM = archetype === 'tank-or-silo' ? widthM : range(random, archetypeConfig.lengthM);
    const placement = {
      id: `${zone.id ?? zone.properties?.id ?? 'industrial-zone'}-${placements.length}`,
      archetype,
      xM: bounds.minX + (bounds.maxX - bounds.minX) * random(),
      yM: bounds.minY + (bounds.maxY - bounds.minY) * random(),
      rotation: random() * Math.PI,
      widthM,
      lengthM,
      heightM: range(random, archetypeConfig.heightM)
    };
    const cells = cellsForPlacement(placement, config.spatialHashCellM);
    const nearbyPlacements = [...new Set(cells.flatMap((cell) => spatialHash.get(cell) ?? []))];
    const reason = validatePlacement({
      placement,
      zonePolygon,
      nativePolygons,
      routeCoordinates: routeLocal,
      pois: poisLocal,
      nearbyPlacements,
      config
    });
    if (reason) {
      rejections[reason] += 1;
      continue;
    }
    const [lng, lat] = projector.toLngLat([placement.xM, placement.yM]);
    const accepted = { ...placement, lng, lat };
    placements.push(accepted);
    cells.forEach((cell) => {
      const bucket = spatialHash.get(cell) ?? [];
      bucket.push(accepted);
      spatialHash.set(cell, bucket);
    });
  }

  return {
    origin,
    placements,
    diagnostics: {
      ...coverage,
      targetCount,
      acceptedCount: placements.length,
      attempts,
      rejections
    }
  };
}

function dimensionsFor(random, archetype) {
  const settings = MORPHOLOGY_ARCHETYPES[archetype];
  const widthM = range(random, settings.widthM);
  return {
    lengthM: archetype === 'tank-or-silo' ? widthM : range(random, settings.lengthM),
    widthM,
    heightM: range(random, settings.heightM)
  };
}

function offsetPoint(anchor, orientation, offsetX, offsetY) {
  const cosine = Math.cos(orientation);
  const sine = Math.sin(orientation);
  return [
    anchor[0] + offsetX * cosine - offsetY * sine,
    anchor[1] + offsetX * sine + offsetY * cosine
  ];
}

function campusExtent(buildings, orientation) {
  const cosine = Math.cos(orientation);
  const sine = Math.sin(orientation);
  const localCorners = buildings.flatMap((building) => placementFootprint(building).slice(0, -1)).map(([x, y]) => [
    x * cosine + y * sine,
    -x * sine + y * cosine
  ]);
  const bounds = polygonBounds(localCorners);
  const localCenter = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  const center = [
    localCenter[0] * cosine - localCenter[1] * sine,
    localCenter[0] * sine + localCenter[1] * cosine
  ];
  return {
    xM: center[0],
    yM: center[1],
    lengthM: bounds.maxX - bounds.minX,
    widthM: bounds.maxY - bounds.minY,
    heightM: Math.max(...buildings.map((building) => building.heightM)),
    rotation: orientation
  };
}

export function createCampusTemplate({ templateId, campusId, anchor, orientation, random }) {
  if (!CAMPUS_TEMPLATE_IDS.includes(templateId)) throw new RangeError(`Unknown industrial campus template: ${templateId}`);
  const buildings = [];
  function addBuilding(role, archetype, offsetX, offsetY, dimensions = dimensionsFor(random, archetype)) {
    const [xM, yM] = offsetPoint(anchor, orientation, offsetX, offsetY);
    buildings.push({
      id: `${campusId}-${role}-${buildings.length}`,
      campusId,
      role,
      archetype: archetype === 'secondary-shed' ? 'factory-hall' : archetype,
      xM,
      yM,
      rotation: orientation,
      ...dimensions
    });
    return dimensions;
  }

  if (templateId === 'single-hall') {
    addBuilding('main-hall', random() < 0.55 ? 'warehouse' : 'factory-hall', 0, 0);
  }

  if (templateId === 'hall-office') {
    const hall = dimensionsFor(random, 'warehouse');
    const office = dimensionsFor(random, 'office-block');
    const gap = range(random, [12, 30]);
    addBuilding('main-hall', 'warehouse', 0, 0, hall);
    addBuilding('office', 'office-block', hall.lengthM * 0.18, hall.widthM / 2 + gap + office.widthM / 2, office);
  }

  if (templateId === 'parallel-halls') {
    const first = dimensionsFor(random, 'factory-hall');
    const second = dimensionsFor(random, 'factory-hall');
    const gap = range(random, [20, 45]);
    const separation = (first.widthM + second.widthM) / 2 + gap;
    addBuilding('main-hall', 'factory-hall', 0, -separation / 2, first);
    addBuilding('secondary-hall', 'factory-hall', 0, separation / 2, second);
  }

  if (templateId === 'factory-complex') {
    const hall = dimensionsFor(random, 'factory-hall');
    const shed = dimensionsFor(random, 'secondary-shed');
    const office = dimensionsFor(random, 'office-block');
    const shedGap = range(random, [15, 35]);
    const officeGap = range(random, [18, 32]);
    addBuilding('main-hall', 'factory-hall', 0, 0, hall);
    addBuilding('secondary-shed', 'secondary-shed', -hall.lengthM * 0.1, hall.widthM / 2 + shedGap + shed.widthM / 2, shed);
    addBuilding('office', 'office-block', hall.lengthM * 0.1, -(hall.widthM / 2 + officeGap + office.widthM / 2), office);
  }

  if (templateId === 'hall-silos') {
    const hall = dimensionsFor(random, 'warehouse');
    const silo = dimensionsFor(random, 'tank-or-silo');
    const gap = range(random, [12, 30]);
    const siloY = hall.widthM / 2 + gap + silo.widthM / 2;
    addBuilding('main-hall', 'warehouse', 0, 0, hall);
    addBuilding('silo', 'tank-or-silo', -silo.widthM * 0.75, siloY, silo);
    if (random() < 0.65) {
      const secondSilo = dimensionsFor(random, 'tank-or-silo');
      addBuilding('silo', 'tank-or-silo', silo.widthM * 0.75 + secondSilo.widthM * 0.75 + 8, siloY, secondSilo);
    }
  }

  return {
    id: campusId,
    anchor: [...anchor],
    orientation,
    template: templateId,
    footprintExtent: campusExtent(buildings, orientation),
    buildings
  };
}

function polygonDominantAxis(zonePolygon) {
  let longest = { length: -1, bearing: 0 };
  for (let index = 0; index < zonePolygon.length - 1; index += 1) {
    const dx = zonePolygon[index + 1][0] - zonePolygon[index][0];
    const dy = zonePolygon[index + 1][1] - zonePolygon[index][1];
    const length = Math.hypot(dx, dy);
    if (length > longest.length) longest = { length, bearing: Math.atan2(dy, dx) };
  }
  return longest.bearing;
}

export function campusOrientationForAnchor({ anchor, roads, zonePolygon, random, variationDeg = 7 }) {
  const nearest = nearestRoadSegment(anchor, roads);
  let orientation = nearest?.bearing ?? polygonDominantAxis(zonePolygon);
  if (nearest && random() < 0.24) orientation += Math.PI / 2;
  orientation += (random() * 2 - 1) * variationDeg * Math.PI / 180;
  return orientation;
}

function pickCampusTemplate(random) {
  const weighted = [
    ['single-hall', 0.15],
    ['hall-office', 0.31],
    ['parallel-halls', 0.27],
    ['factory-complex', 0.21],
    ['hall-silos', 0.06]
  ];
  let sample = random();
  for (const [templateId, weight] of weighted) {
    sample -= weight;
    if (sample <= 0) return templateId;
  }
  return 'single-hall';
}

function buildingFootprintArea(building) {
  return building.archetype === 'tank-or-silo'
    ? Math.PI * (building.widthM / 2) ** 2
    : building.lengthM * building.widthM;
}

function morphologyRejection({ campus, zonePolygon, nativePolygons, roads, routeLocal, poisLocal, acceptedCampuses, acceptedBuildings, config }) {
  const extent = placementFootprint(campus.footprintExtent);
  if (!extent.slice(0, -1).every((corner) => pointInPolygon(corner, zonePolygon))) return 'outsideZone';
  if (roads.some((road) => placementIntersectsRoadCorridor(campus.footprintExtent, road))) return 'roadCollision';
  if (acceptedCampuses.some((accepted) => polygonsIntersect(
    placementFootprint(campus.footprintExtent, config.campusClearanceM / 2),
    placementFootprint(accepted.footprintExtent, config.campusClearanceM / 2)
  ))) return 'campusCollision';

  for (const building of campus.buildings) {
    const footprint = placementFootprint(building);
    if (!footprint.slice(0, -1).every((corner) => pointInPolygon(corner, zonePolygon))) return 'outsideZone';
    const nativeFootprint = placementFootprint(building, config.nativeBuildingClearanceM);
    if (nativePolygons.some((polygon) => polygonsIntersect(nativeFootprint, polygon))) return 'nativeCollision';
    if (roads.some((road) => placementIntersectsRoadCorridor(building, road))) return 'roadCollision';
    const halfDiagonal = Math.hypot(building.lengthM, building.widthM) / 2;
    const routeDistance = routeLocal.reduce((minimum, line) => (
      Math.min(minimum, distancePointToLineM([building.xM, building.yM], line))
    ), Number.POSITIVE_INFINITY);
    if (routeDistance < config.routeClearanceM + halfDiagonal) return 'routeClearance';
    if (poisLocal.some((poi) => Math.hypot(building.xM - poi[0], building.yM - poi[1]) < config.poiClearanceM + halfDiagonal)) return 'poiClearance';
    if (acceptedBuildings.some((accepted) => polygonsIntersect(
      placementFootprint(building, config.syntheticClearanceM / 2),
      placementFootprint(accepted, config.syntheticClearanceM / 2)
    ))) return 'syntheticCollision';
  }
  return null;
}

export function generateIndustrialCampuses({
  zone,
  nativeBuildings,
  roads = [],
  routeCoordinates,
  pois,
  seed,
  config = DEFAULT_INDUSTRIAL_CONFIG
}) {
  if (zone?.geometry?.type !== 'Polygon') throw new TypeError('Industrial morphology V2 requires one GeoJSON Polygon feature.');
  const ring = zone.geometry.coordinates[0];
  const origin = [
    ring.reduce((sum, coordinate) => sum + coordinate[0], 0) / ring.length,
    ring.reduce((sum, coordinate) => sum + coordinate[1], 0) / ring.length
  ];
  const projector = createLocalProjector(origin);
  const zonePolygon = ring.map(projector.toLocal);
  const nativePolygons = normalizedNativePolygons(nativeBuildings, projector);
  const routeLines = Array.isArray(routeCoordinates?.[0]?.[0]) ? routeCoordinates : [routeCoordinates];
  const routeLocal = routeLines.filter((line) => line?.length).map((line) => line.map(projector.toLocal));
  const poisLocal = pois.map((poi) => projector.toLocal(Array.isArray(poi) ? poi : poi.coordinates));
  const coverage = calculateNativeCoverage({ zonePolygon, nativePolygons });
  const usableAreaEstimateM2 = Math.max(0, coverage.zoneAreaM2 - coverage.nativeBuildingAreaM2);
  const targetSyntheticCoverage = config.targetSyntheticCoverage;
  const targetMinimumAreaM2 = usableAreaEstimateM2 * Math.max(0, targetSyntheticCoverage - config.coverageTolerance);
  const targetMaximumAreaM2 = usableAreaEstimateM2 * (targetSyntheticCoverage + config.coverageTolerance);
  const bounds = polygonBounds(zonePolygon);
  const random = createSeededRandom(seed);
  const campuses = [];
  const placements = [];
  const templateCounts = Object.fromEntries(CAMPUS_TEMPLATE_IDS.map((id) => [id, 0]));
  const rejections = {
    outsideZone: 0,
    roadCollision: 0,
    campusCollision: 0,
    nativeCollision: 0,
    routeClearance: 0,
    poiClearance: 0,
    syntheticCollision: 0,
    coverageOvershoot: 0
  };
  let syntheticFootprintAreaM2 = 0;
  let attempts = 0;

  while (syntheticFootprintAreaM2 < targetMinimumAreaM2
    && campuses.length < config.maxCampuses
    && attempts < config.maxCampusAttempts) {
    attempts += 1;
    const anchor = [
      bounds.minX + (bounds.maxX - bounds.minX) * random(),
      bounds.minY + (bounds.maxY - bounds.minY) * random()
    ];
    if (!pointInPolygon(anchor, zonePolygon)) {
      rejections.outsideZone += 1;
      continue;
    }
    const orientation = campusOrientationForAnchor({
      anchor,
      roads,
      zonePolygon,
      random,
      variationDeg: config.orientationVariationDeg
    });
    const templateId = pickCampusTemplate(random);
    const campus = createCampusTemplate({
      templateId,
      campusId: `${zone.id ?? zone.properties?.id ?? 'industrial-zone'}-campus-${campuses.length}`,
      anchor,
      orientation,
      random
    });
    const campusAreaM2 = campus.buildings.reduce((sum, building) => sum + buildingFootprintArea(building), 0);
    if (syntheticFootprintAreaM2 > 0 && syntheticFootprintAreaM2 + campusAreaM2 > targetMaximumAreaM2) {
      rejections.coverageOvershoot += 1;
      continue;
    }
    const reason = morphologyRejection({
      campus,
      zonePolygon,
      nativePolygons,
      roads,
      routeLocal,
      poisLocal,
      acceptedCampuses: campuses,
      acceptedBuildings: placements,
      config
    });
    if (reason) {
      rejections[reason] += 1;
      continue;
    }
    campus.buildings = campus.buildings.map((building) => {
      const [lng, lat] = projector.toLngLat([building.xM, building.yM]);
      return { ...building, lng, lat };
    });
    const [anchorLng, anchorLat] = projector.toLngLat(anchor);
    campus.anchor = { xM: anchor[0], yM: anchor[1], lng: anchorLng, lat: anchorLat };
    campuses.push(campus);
    placements.push(...campus.buildings);
    templateCounts[templateId] += 1;
    syntheticFootprintAreaM2 += campusAreaM2;
  }

  const dominantHalls = placements.filter((placement) => placement.role === 'main-hall');
  const averageHallDimension = (property) => dominantHalls.length
    ? dominantHalls.reduce((sum, hall) => sum + hall[property], 0) / dominantHalls.length
    : 0;

  return {
    origin,
    campuses,
    placements,
    diagnostics: {
      ...coverage,
      usableAreaEstimateM2,
      targetSyntheticCoverage,
      actualSyntheticCoverage: usableAreaEstimateM2 > 0 ? syntheticFootprintAreaM2 / usableAreaEstimateM2 : 0,
      syntheticFootprintAreaM2,
      campusCount: campuses.length,
      buildingCount: placements.length,
      averageBuildingFootprintM2: placements.length ? syntheticFootprintAreaM2 / placements.length : 0,
      averageCampusBuildings: campuses.length ? placements.length / campuses.length : 0,
      averageHallLengthM: averageHallDimension('lengthM'),
      averageHallWidthM: averageHallDimension('widthM'),
      averageHallHeightM: averageHallDimension('heightM'),
      templateCounts,
      attempts,
      rejections
    }
  };
}
