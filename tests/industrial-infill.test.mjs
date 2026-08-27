import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateNativeCoverage,
  calculateTargetCount,
  CAMPUS_TEMPLATE_IDS,
  campusOrientationForAnchor,
  createSeededRandom,
  createCampusTemplate,
  DEFAULT_INDUSTRIAL_CONFIG,
  generateIndustrialCampuses,
  generateIndustrialInfill,
  validatePlacement
} from '../src/industrial-infill.js';
import { createLocalProjector, placementFootprint, pointInPolygon, polygonsIntersect } from '../src/urban-spatial.js';

const zone = {
  type: 'Feature',
  id: 'test-zone',
  properties: { id: 'test-zone' },
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [106.59, 11.125],
      [106.60, 11.125],
      [106.60, 11.135],
      [106.59, 11.135],
      [106.59, 11.125]
    ]]
  }
};

const generatorInput = {
  zone,
  nativeBuildings: [],
  routeCoordinates: [],
  pois: [],
  seed: 'route-61-2:test-zone:poc-v1',
  config: { ...DEFAULT_INDUSTRIAL_CONFIG, maxInstances: 24, targetOccupancy: 0.08 }
};

test('seeded random produces a stable sequence without using Math.random', () => {
  const first = createSeededRandom('industrial-seed');
  const second = createSeededRandom('industrial-seed');
  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
});

test('same generator input produces exactly the same industrial arrangement', () => {
  const first = generateIndustrialInfill(generatorInput);
  const second = generateIndustrialInfill(generatorInput);
  assert.deepEqual(first, second);
});

test('a different seed produces a different valid arrangement', () => {
  const first = generateIndustrialInfill(generatorInput);
  const second = generateIndustrialInfill({ ...generatorInput, seed: 'route-61-2:test-zone:poc-v2' });
  assert.notDeepEqual(first.placements, second.placements);
  assert.ok(second.placements.length > 0);
});

test('every accepted building footprint remains inside the industrial polygon', () => {
  const result = generateIndustrialInfill(generatorInput);
  const projector = createLocalProjector(result.origin);
  const localZone = zone.geometry.coordinates[0].map(projector.toLocal);

  result.placements.forEach((placement) => {
    placementFootprint(placement).forEach((corner) => assert.equal(pointInPolygon(corner, localZone), true));
  });
});

test('candidate validator rejects native building overlap', () => {
  const reason = validatePlacement({
    placement: { xM: 0, yM: 0, widthM: 12, lengthM: 20, rotation: 0 },
    zonePolygon: [[-100, -100], [100, -100], [100, 100], [-100, 100], [-100, -100]],
    nativePolygons: [[[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]]],
    routeCoordinates: [],
    pois: [],
    nearbyPlacements: [],
    config: { ...DEFAULT_INDUSTRIAL_CONFIG, nativeBuildingClearanceM: 5 }
  });
  assert.equal(reason, 'nativeCollision');
});

test('candidate validator rejects the route presentation clearance', () => {
  const reason = validatePlacement({
    placement: { xM: 0, yM: 15, widthM: 10, lengthM: 10, rotation: 0 },
    zonePolygon: [[-100, -100], [100, -100], [100, 100], [-100, 100], [-100, -100]],
    nativePolygons: [],
    routeCoordinates: [[-100, 0], [100, 0]],
    pois: [],
    nearbyPlacements: [],
    config: { ...DEFAULT_INDUSTRIAL_CONFIG, routeClearanceM: 20 }
  });
  assert.equal(reason, 'routeClearance');
});

test('candidate validator checks multiple route alignments without connecting them', () => {
  const common = {
    placement: { xM: 0, yM: 0, widthM: 10, lengthM: 10, rotation: 0 },
    zonePolygon: [[-200, -200], [200, -200], [200, 200], [-200, 200], [-200, -200]],
    nativePolygons: [],
    pois: [],
    nearbyPlacements: [],
    config: { ...DEFAULT_INDUSTRIAL_CONFIG, routeClearanceM: 20 }
  };
  assert.equal(validatePlacement({ ...common, routeCoordinates: [[[-100, 100], [100, 100]], [[-100, -100], [100, -100]]] }), null);
  assert.equal(validatePlacement({ ...common, routeCoordinates: [[[-100, 10], [100, 10]], [[-100, -100], [100, -100]]] }), 'routeClearance');
});

test('candidate validator rejects the POI presentation clearance', () => {
  const reason = validatePlacement({
    placement: { xM: 25, yM: 0, widthM: 10, lengthM: 10, rotation: 0 },
    zonePolygon: [[-100, -100], [100, -100], [100, 100], [-100, 100], [-100, -100]],
    nativePolygons: [],
    routeCoordinates: [],
    pois: [[0, 0]],
    nearbyPlacements: [],
    config: { ...DEFAULT_INDUSTRIAL_CONFIG, poiClearanceM: 30 }
  });
  assert.equal(reason, 'poiClearance');
});

test('candidate validator rejects synthetic building collisions', () => {
  const existing = { xM: 0, yM: 0, widthM: 20, lengthM: 30, rotation: 0 };
  const reason = validatePlacement({
    placement: { xM: 8, yM: 0, widthM: 20, lengthM: 30, rotation: 0 },
    zonePolygon: [[-100, -100], [100, -100], [100, 100], [-100, 100], [-100, -100]],
    nativePolygons: [],
    routeCoordinates: [],
    pois: [],
    nearbyPlacements: [existing],
    config: DEFAULT_INDUSTRIAL_CONFIG
  });
  assert.equal(reason, 'syntheticCollision');
});

test('lower native coverage never requests less synthetic infill', () => {
  const empty = calculateTargetCount({ zoneAreaM2: 1_000_000, nativeCoverageRatio: 0, config: DEFAULT_INDUSTRIAL_CONFIG });
  const high = calculateTargetCount({ zoneAreaM2: 1_000_000, nativeCoverageRatio: 0.75, config: DEFAULT_INDUSTRIAL_CONFIG });
  assert.ok(empty >= high);
});

test('native coverage reports deterministic area, ratio, and building count', () => {
  const coverage = calculateNativeCoverage({
    zonePolygon: [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]],
    nativePolygons: [
      [[10, 10], [30, 10], [30, 30], [10, 30], [10, 10]],
      [[60, 60], [80, 60], [80, 80], [60, 80], [60, 60]]
    ]
  });
  assert.deepEqual(coverage, {
    zoneAreaM2: 10_000,
    nativeBuildingAreaM2: 800,
    nativeCoverageRatio: 0.08,
    nativeBuildingCount: 2
  });
});

test('diagnostic counters account for every candidate attempt', () => {
  const result = generateIndustrialInfill(generatorInput);
  const rejected = Object.values(result.diagnostics.rejections).reduce((sum, count) => sum + count, 0);
  assert.equal(result.diagnostics.attempts, result.diagnostics.acceptedCount + rejected);
  assert.equal(result.diagnostics.acceptedCount, result.placements.length);
  assert.ok(result.diagnostics.acceptedCount <= result.diagnostics.targetCount);

  for (let first = 0; first < result.placements.length; first += 1) {
    for (let second = first + 1; second < result.placements.length; second += 1) {
      assert.equal(polygonsIntersect(
        placementFootprint(result.placements[first]),
        placementFootprint(result.placements[second])
      ), false);
    }
  }
});

test('five campus templates have stable IDs, compositions, and non-overlapping arrangements', () => {
  assert.deepEqual(CAMPUS_TEMPLATE_IDS, [
    'single-hall', 'hall-office', 'parallel-halls', 'factory-complex', 'hall-silos'
  ]);
  const expectedRoles = {
    'single-hall': ['main-hall'],
    'hall-office': ['main-hall', 'office'],
    'parallel-halls': ['main-hall', 'secondary-hall'],
    'factory-complex': ['main-hall', 'secondary-shed', 'office'],
    'hall-silos': ['main-hall', 'silo']
  };

  CAMPUS_TEMPLATE_IDS.forEach((templateId) => {
    const build = () => createCampusTemplate({
      templateId,
      campusId: `campus-${templateId}`,
      anchor: [0, 0],
      orientation: Math.PI / 6,
      random: createSeededRandom(`template:${templateId}`)
    });
    const campus = build();
    assert.deepEqual(campus, build());
    assert.equal(campus.template, templateId);
    expectedRoles[templateId].forEach((role) => assert.ok(campus.buildings.some((building) => building.role === role)));
    assert.equal(new Set(campus.buildings.map((building) => building.id)).size, campus.buildings.length);
    for (let first = 0; first < campus.buildings.length; first += 1) {
      for (let second = first + 1; second < campus.buildings.length; second += 1) {
        assert.equal(polygonsIntersect(
          placementFootprint(campus.buildings[first]),
          placementFootprint(campus.buildings[second])
        ), false);
      }
    }
  });
});

test('campus orientation follows a nearby meaningful road within seven degrees', () => {
  const orientation = campusOrientationForAnchor({
    anchor: [0, 30],
    roads: [{ id: 'road', roadClass: 'secondary', coordinates: [[-200, 0], [200, 0]], clearanceM: 18 }],
    zonePolygon: [[-300, -300], [300, -300], [300, 300], [-300, 300], [-300, -300]],
    random: createSeededRandom('orientation')
  });
  const parallelError = Math.abs(Math.sin(orientation));
  const perpendicularError = Math.abs(Math.cos(orientation));
  assert.ok(Math.min(parallelError, perpendicularError) <= Math.sin(7 * Math.PI / 180));
});

test('factory complex keeps secondary buildings within the main hall longitudinal envelope', () => {
  const campus = createCampusTemplate({
    templateId: 'factory-complex',
    campusId: 'compact-factory',
    anchor: [0, 0],
    orientation: 0,
    random: createSeededRandom('compact-factory')
  });
  const mainHall = campus.buildings.find((building) => building.role === 'main-hall');
  campus.buildings.filter((building) => building.role !== 'main-hall').forEach((building) => {
    assert.ok(Math.abs(building.xM) + building.lengthM / 2 <= mainHall.lengthM / 2 + 20);
  });
});

const morphologyInput = {
  zone,
  nativeBuildings: [],
  roads: [{ id: 'local-road', roadClass: 'street', coordinates: [[-450, 0], [450, 0]], clearanceM: 10 }],
  routeCoordinates: [],
  pois: [],
  seed: 'route-61-2:test-zone:industrial-morphology-v2',
  config: {
    ...DEFAULT_INDUSTRIAL_CONFIG,
    targetSyntheticCoverage: 0.08,
    coverageTolerance: 0.025,
    maxCampuses: 30,
    maxCampusAttempts: 1_500
  }
};

test('campus morphology is deterministic and a different seed changes it', () => {
  const first = generateIndustrialCampuses(morphologyInput);
  const second = generateIndustrialCampuses(morphologyInput);
  const different = generateIndustrialCampuses({ ...morphologyInput, seed: 'route-61-2:test-zone:industrial-morphology-v2b' });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.campuses, different.campuses);
  assert.equal(first.placements.length, first.diagnostics.buildingCount);
  assert.equal(first.campuses.length, first.diagnostics.campusCount);
});

test('campus generator keeps every full building footprint inside the zone and campuses separated', () => {
  const result = generateIndustrialCampuses(morphologyInput);
  const projector = createLocalProjector(result.origin);
  const localZone = zone.geometry.coordinates[0].map(projector.toLocal);
  result.placements.forEach((placement) => {
    placementFootprint(placement).slice(0, -1).forEach((corner) => assert.equal(pointInPolygon(corner, localZone), true));
  });
  for (let first = 0; first < result.campuses.length; first += 1) {
    for (let second = first + 1; second < result.campuses.length; second += 1) {
      assert.equal(polygonsIntersect(
        placementFootprint(result.campuses[first].footprintExtent),
        placementFootprint(result.campuses[second].footprintExtent)
      ), false);
    }
  }
});

test('campus generator approaches configured footprint coverage without fixing building count', () => {
  const result = generateIndustrialCampuses(morphologyInput);
  assert.ok(result.diagnostics.actualSyntheticCoverage >= 0.055);
  assert.ok(result.diagnostics.actualSyntheticCoverage <= 0.105);
  assert.ok(result.diagnostics.buildingCount > result.diagnostics.campusCount);
  assert.ok(result.diagnostics.averageHallLengthM >= 60);
  assert.ok(result.diagnostics.averageHallWidthM >= 30);
});
