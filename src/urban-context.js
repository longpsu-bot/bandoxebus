import { DEFAULT_INDUSTRIAL_CONFIG, generateIndustrialCampuses } from './industrial-infill.js';
import {
  normalizeNativeBuildingFeatures,
  normalizeRoadFeatures
} from './urban-spatial.js';
import {
  createOvertureLayerDefinitions,
  inspectOvertureCollection,
  OVERTURE_BUILDING_LAYER_ID,
  OVERTURE_BUILDING_SOURCE_ID
} from './overture-buildings.js';
import {
  createOverturePmtilesLayerDefinitions,
  ensurePmtilesProtocol,
  OVERTURE_PMTILES_FLAT_LAYER_ID,
  OVERTURE_PMTILES_RELEASE_PATTERN
} from './overture-pmtiles.js';

export const INDUSTRIAL_CONTEXT_MODE = 'industrial-context';
const MORPHOLOGY_V2_FALLBACK_SEED = 'route-61-2:osm-industrial-759187612:industrial-morphology-v2';
const GROUND_SOURCE_ID = 'industrial-context-zone';
const GROUND_FILL_LAYER_ID = 'industrial-context-ground';
const GROUND_LINE_LAYER_ID = 'industrial-context-boundary';
const SYNTHETIC_INDUSTRIAL_LAYER_ID = 'synthetic-industrial-infill';

function validateBuildingConfig(config) {
  if (
    !config
    || typeof config !== 'object'
    || Array.isArray(config)
    || Object.keys(config).length !== 2
    || !['overture-pmtiles', 'local-geojson'].includes(config.buildingSource)
    || typeof config.overtureRelease !== 'string'
    || !OVERTURE_PMTILES_RELEASE_PATTERN.test(config.overtureRelease)
  ) {
    throw new TypeError('Invalid urban context building configuration.');
  }
  return Object.freeze({
    buildingSource: config.buildingSource,
    overtureRelease: config.overtureRelease
  });
}

function failureCategory(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  if (message.includes('cors')) return 'cors';
  if (message.includes('range')) return 'range-request';
  if (message.includes('404') || message.includes('403') || message.includes('not found')) return 'release-unavailable';
  if (message.includes('network') || message.includes('fetch') || message.includes('failed') || message.includes('blocked')) return 'network';
  if (message.includes('parse') || message.includes('tile')) return 'malformed-data';
  return 'remote';
}

export function createUrbanContextController({
  map,
  maplibregl,
  zone,
  overtureBuildings = null,
  routeCoordinates,
  pois,
  reducedMotion = false,
  beforeLayerId = 'route-removed',
  buildingConfig: initialBuildingConfig = {
    buildingSource: 'local-geojson',
    overtureRelease: '2026-08-19.0'
  },
  ensureOnlineProtocol = ensurePmtilesProtocol,
  createOnlineDefinitions = createOverturePmtilesLayerDefinitions,
  onStatus = () => {}
}) {
  const mapElement = map.getContainer();
  let buildingConfig = validateBuildingConfig(initialBuildingConfig);
  let desiredMode = 'off';
  let preparing = false;
  let prepared = false;
  let idleHandler = null;
  let layer = null;
  let diagnostics = {};
  let fpsMeasurementStarted = false;
  let destroyed = false;
  let onlineInstallPromise = null;
  let onlineErrorHandler = null;
  let onlineSourceHandler = null;
  const overtureInspection = inspectOvertureCollection(overtureBuildings);
  let provider = buildingConfig.buildingSource === 'overture-pmtiles'
    ? 'overture'
    : overtureInspection.usable ? 'overture' : 'synthetic-v2';

  function addGroundContext() {
    if (!map.getSource(GROUND_SOURCE_ID)) map.addSource(GROUND_SOURCE_ID, { type: 'geojson', data: zone });
    const beforeId = map.getLayer(beforeLayerId) ? beforeLayerId : undefined;
    if (!map.getLayer(GROUND_FILL_LAYER_ID)) map.addLayer({
      id: GROUND_FILL_LAYER_ID,
      type: 'fill',
      source: GROUND_SOURCE_ID,
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#496174', 'fill-opacity': 0.09 }
    }, beforeId);
    if (!map.getLayer(GROUND_LINE_LAYER_ID)) map.addLayer({
      id: GROUND_LINE_LAYER_ID,
      type: 'line',
      source: GROUND_SOURCE_ID,
      layout: { visibility: 'none' },
      paint: { 'line-color': '#7690a3', 'line-opacity': 0.24, 'line-width': 1.1, 'line-dasharray': [3, 2] }
    }, beforeId);
  }

  function setContextVisible(visible) {
    mapElement.dataset.urbanGroundState = visible ? 'visible' : 'hidden';
    [GROUND_FILL_LAYER_ID, GROUND_LINE_LAYER_ID].forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    });
    for (const layerId of [OVERTURE_PMTILES_FLAT_LAYER_ID, OVERTURE_BUILDING_LAYER_ID]) {
      if (!map.getLayer(layerId)) continue;
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      mapElement.dataset.urbanOvertureLayerState = visible ? 'visible' : 'hidden';
    }
  }

  function emitStatus(status, nextFailureCategory = null) {
    const payload = Object.freeze({
      status,
      source: buildingConfig.buildingSource,
      release: buildingConfig.overtureRelease,
      failureCategory: nextFailureCategory
    });
    diagnostics = { ...diagnostics, ...payload };
    mapElement.dataset.urbanContextSource = payload.source;
    mapElement.dataset.urbanContextStatus = payload.status;
    mapElement.dataset.urbanOvertureRelease = payload.release;
    mapElement.dataset.urbanContextFailure = payload.failureCategory ?? '';
    onStatus(payload);
    return payload;
  }

  function updateDiagnostics(next) {
    diagnostics = { ...diagnostics, ...next };
    mapElement.dataset.urbanContextProvider = provider;
    mapElement.dataset.urbanContextState = desiredMode === INDUSTRIAL_CONTEXT_MODE ? (prepared ? 'active' : 'preparing') : 'off';
    if (diagnostics.syntheticCount !== undefined) mapElement.dataset.urbanSyntheticCount = String(diagnostics.syntheticCount);
    if (diagnostics.campusCount !== undefined) mapElement.dataset.urbanCampusCount = String(diagnostics.campusCount);
    if (diagnostics.roadFeatureCount !== undefined) mapElement.dataset.urbanRoadCount = String(diagnostics.roadFeatureCount);
    if (diagnostics.roadClassCounts !== undefined) mapElement.dataset.urbanRoadClasses = JSON.stringify(diagnostics.roadClassCounts);
    if (diagnostics.actualSyntheticCoverage !== undefined) mapElement.dataset.urbanSyntheticCoverage = diagnostics.actualSyntheticCoverage.toFixed(4);
    if (diagnostics.templateCounts !== undefined) mapElement.dataset.urbanTemplateCounts = JSON.stringify(diagnostics.templateCounts);
    if (diagnostics.averageHallLengthM !== undefined) mapElement.dataset.urbanAverageHallLength = diagnostics.averageHallLengthM.toFixed(1);
    if (diagnostics.averageHallWidthM !== undefined) mapElement.dataset.urbanAverageHallWidth = diagnostics.averageHallWidthM.toFixed(1);
    if (diagnostics.averageHallHeightM !== undefined) mapElement.dataset.urbanAverageHallHeight = diagnostics.averageHallHeightM.toFixed(1);
    if (diagnostics.nativeBuildingCount !== undefined) mapElement.dataset.urbanNativeCount = String(diagnostics.nativeBuildingCount);
    if (diagnostics.nativeCoverageRatio !== undefined) mapElement.dataset.urbanNativeCoverage = diagnostics.nativeCoverageRatio.toFixed(4);
    if (diagnostics.generationMs !== undefined) mapElement.dataset.urbanGenerationMs = diagnostics.generationMs.toFixed(1);
    if (diagnostics.drawGroups !== undefined) mapElement.dataset.urbanDrawGroups = String(diagnostics.drawGroups);
    if (diagnostics.observedFps !== undefined) mapElement.dataset.urbanObservedFps = String(diagnostics.observedFps);
    if (diagnostics.overtureFeatureCount !== undefined) mapElement.dataset.urbanOvertureCount = String(diagnostics.overtureFeatureCount);
    if (diagnostics.overtureCoverageRatio !== undefined) mapElement.dataset.urbanOvertureCoverage = diagnostics.overtureCoverageRatio.toFixed(6);
    if (diagnostics.overtureRelease !== undefined) mapElement.dataset.urbanOvertureRelease = diagnostics.overtureRelease;
  }

  function addLocalOvertureContext() {
    if (!overtureInspection.usable) return false;
    const definitions = createOvertureLayerDefinitions(overtureBuildings);
    if (!map.getSource(OVERTURE_BUILDING_SOURCE_ID)) map.addSource(OVERTURE_BUILDING_SOURCE_ID, definitions.source);
    if (!map.getLayer(OVERTURE_BUILDING_LAYER_ID)) {
      map.addLayer(definitions.layer, map.getLayer(beforeLayerId) ? beforeLayerId : undefined);
    }
    const layerIds = map.getStyle().layers.map(({ id }) => id);
    mapElement.dataset.urbanRouteOrderPreserved = String(
      layerIds.indexOf(OVERTURE_BUILDING_LAYER_ID) < layerIds.indexOf(beforeLayerId)
    );
    mapElement.dataset.urbanOvertureDataState = 'validating';
    map.once('idle', () => {
      mapElement.dataset.urbanOvertureDataState = map.isSourceLoaded(OVERTURE_BUILDING_SOURCE_ID) ? 'loaded' : 'error';
    });
    const statistics = overtureBuildings.metadata.statistics;
    prepared = true;
    updateDiagnostics({
      overtureFeatureCount: overtureInspection.featureCount,
      overtureCoverageRatio: overtureInspection.coverageRatio,
      overtureRelease: overtureInspection.release,
      heightSourceCounts: statistics.heightSourceCounts,
      heightSourcePercentages: statistics.heightSourcePercentages
    });
    emitStatus('local-benchmark');
    return true;
  }

  function detachOnlineListeners() {
    if (onlineErrorHandler) map.off?.('error', onlineErrorHandler);
    if (onlineSourceHandler) map.off?.('sourcedata', onlineSourceHandler);
    onlineErrorHandler = null;
    onlineSourceHandler = null;
  }

  function markOnlineAvailable() {
    if (destroyed || diagnostics.status !== 'loading') return;
    if (map.isSourceLoaded?.(OVERTURE_BUILDING_SOURCE_ID) === false) return;
    emitStatus('available');
  }

  async function installOnlineContext() {
    if (onlineInstallPromise) return onlineInstallPromise;
    emitStatus('loading');
    onlineInstallPromise = (async () => {
      try {
        await ensureOnlineProtocol(maplibregl);
        if (destroyed) return;
        const definitions = createOnlineDefinitions({ release: buildingConfig.overtureRelease });
        onlineErrorHandler = (event = {}) => {
          const message = String(event?.error?.message ?? event?.message ?? '');
          if (event.sourceId !== OVERTURE_BUILDING_SOURCE_ID && !/buildings\.pmtiles|pmtiles/i.test(message)) return;
          setContextVisible(false);
          emitStatus('unavailable', failureCategory(event.error ?? event));
        };
        onlineSourceHandler = (event = {}) => {
          if (event.sourceId === OVERTURE_BUILDING_SOURCE_ID) markOnlineAvailable();
        };
        map.on?.('error', onlineErrorHandler);
        map.on?.('sourcedata', onlineSourceHandler);
        if (!map.getSource(OVERTURE_BUILDING_SOURCE_ID)) map.addSource(OVERTURE_BUILDING_SOURCE_ID, definitions.source);
        const beforeId = map.getLayer(beforeLayerId) ? beforeLayerId : undefined;
        if (!map.getLayer(OVERTURE_PMTILES_FLAT_LAYER_ID)) map.addLayer(definitions.flat, beforeId);
        if (!map.getLayer(OVERTURE_BUILDING_LAYER_ID)) map.addLayer(definitions.extrusion, beforeId);
        prepared = true;
        provider = 'overture';
        setContextVisible(desiredMode === INDUSTRIAL_CONTEXT_MODE);
        updateDiagnostics({ overtureRelease: buildingConfig.overtureRelease });
        map.once?.('idle', markOnlineAvailable);
      } catch (error) {
        prepared = false;
        setContextVisible(false);
        emitStatus('unavailable', failureCategory(error));
      }
    })();
    return onlineInstallPromise;
  }

  function measureOvertureFps() {
    if (provider !== 'overture' || fpsMeasurementStarted) return;
    fpsMeasurementStarted = true;
    map.once('idle', () => {
      const startedAt = performance.now();
      let frames = 0;
      const sample = (timestamp) => {
        frames += 1;
        const elapsed = timestamp - startedAt;
        if (elapsed < 2_000) {
          requestAnimationFrame(sample);
          return;
        }
        updateDiagnostics({ observedFps: Math.round(frames * 1_000 / elapsed) });
      };
      requestAnimationFrame(sample);
    });
  }

  async function prepare() {
    idleHandler = null;
    if (buildingConfig.buildingSource === 'overture-pmtiles') return installOnlineContext();
    if (prepared || preparing) return;
    preparing = true;
    updateDiagnostics({});
    try {
      const nativeFeatures = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
      const roadFeatures = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' });
      const nativeBuildings = normalizeNativeBuildingFeatures({ features: nativeFeatures, zone });
      const roads = normalizeRoadFeatures({ features: roadFeatures, zone });
      const roadClassCounts = roads.reduce((counts, road) => ({
        ...counts,
        [road.roadClass]: (counts[road.roadClass] ?? 0) + 1
      }), {});
      const startedAt = performance.now();
      const result = generateIndustrialCampuses({
        zone,
        nativeBuildings,
        roads,
        routeCoordinates,
        pois,
        seed: MORPHOLOGY_V2_FALLBACK_SEED,
        config: {
          ...DEFAULT_INDUSTRIAL_CONFIG,
          targetSyntheticCoverage: 0.115,
          coverageTolerance: 0.015,
          maxCampuses: 60,
          maxCampusAttempts: 3_000
        }
      });
      const generationMs = performance.now() - startedAt;
      const { createThreeUrbanLayer } = await import('./three-urban-layer.js');
      layer = createThreeUrbanLayer({
        maplibregl,
        placements: result.placements,
        origin: result.origin,
        reducedMotion,
        onDiagnostics: updateDiagnostics
      });
      map.addLayer(layer, map.getLayer(beforeLayerId) ? beforeLayerId : undefined);
      prepared = true;
      preparing = false;
      updateDiagnostics({
        ...result.diagnostics,
        syntheticCount: result.placements.length,
        roadFeatureCount: roads.length,
        roadClassCounts,
        generationMs
      });
      layer.setEnabled(desiredMode === INDUSTRIAL_CONTEXT_MODE, { immediate: reducedMotion });
    } catch (error) {
      preparing = false;
      mapElement.dataset.urbanContextState = 'error';
      console.warn('Không thể chuẩn bị bối cảnh công nghiệp minh họa:', error);
    }
  }

  addGroundContext();
  if (buildingConfig.buildingSource === 'local-geojson') {
    if (!addLocalOvertureContext()) emitStatus('local-benchmark');
  } else {
    emitStatus('not-requested');
  }
  updateDiagnostics({});

  return {
    configureBuildings(nextConfig) {
      if (destroyed) throw new TypeError('Cannot configure a destroyed urban context controller.');
      const next = validateBuildingConfig(nextConfig);
      if (
        next.buildingSource === buildingConfig.buildingSource
        && next.overtureRelease === buildingConfig.overtureRelease
      ) return buildingConfig;
      if (prepared || preparing || onlineInstallPromise || map.getSource(OVERTURE_BUILDING_SOURCE_ID)) {
        throw new TypeError('Cannot reconfigure urban context buildings after initialization.');
      }
      buildingConfig = next;
      provider = next.buildingSource === 'overture-pmtiles' ? 'overture' : 'synthetic-v2';
      emitStatus(next.buildingSource === 'overture-pmtiles' ? 'not-requested' : 'local-benchmark');
      return buildingConfig;
    },
    setMode(mode) {
      desiredMode = mode === INDUSTRIAL_CONTEXT_MODE ? INDUSTRIAL_CONTEXT_MODE : 'off';
      setContextVisible(desiredMode === INDUSTRIAL_CONTEXT_MODE);
      updateDiagnostics({});
      if (buildingConfig.buildingSource === 'overture-pmtiles') {
        if (desiredMode === INDUSTRIAL_CONTEXT_MODE) return installOnlineContext();
        return onlineInstallPromise ?? Promise.resolve();
      }
      if (prepared) {
        if (layer) layer.setEnabled(desiredMode === INDUSTRIAL_CONTEXT_MODE, { immediate: reducedMotion });
        if (desiredMode === INDUSTRIAL_CONTEXT_MODE) measureOvertureFps();
      } else if (desiredMode === INDUSTRIAL_CONTEXT_MODE && !preparing && !idleHandler) {
        idleHandler = prepare;
        map.once('idle', idleHandler);
      }
      return Promise.resolve();
    },
    getDiagnostics: () => ({ ...diagnostics }),
    destroy({ removeLayer = true } = {}) {
      if (destroyed) return;
      destroyed = true;
      if (idleHandler) map.off('idle', idleHandler);
      detachOnlineListeners();
      if (removeLayer) {
        if (map.getLayer(SYNTHETIC_INDUSTRIAL_LAYER_ID)) map.removeLayer(SYNTHETIC_INDUSTRIAL_LAYER_ID);
        [OVERTURE_BUILDING_LAYER_ID, OVERTURE_PMTILES_FLAT_LAYER_ID, GROUND_LINE_LAYER_ID, GROUND_FILL_LAYER_ID].forEach((layerId) => {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        });
        if (map.getSource(OVERTURE_BUILDING_SOURCE_ID)) map.removeSource(OVERTURE_BUILDING_SOURCE_ID);
        if (map.getSource(GROUND_SOURCE_ID)) map.removeSource(GROUND_SOURCE_ID);
      }
      layer = null;
    }
  };
}
