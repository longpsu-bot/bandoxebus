import { compareRoutes, compareStops, haversineMeters } from '../comparison.js';
import { createUrbanContextController } from '../urban-context.js';
import { OVERTURE_BUILDINGS_DATA_URL } from '../overture-buildings.js';
import { OVERTURE_PMTILES_RELEASE_PATTERN } from '../overture-pmtiles.js';
import { createRouteRevealController } from './reveal-controller.js';
import {
  buildTransportPoiGroundLayers,
  createTransportPoiBeacons,
  setTransportPoiGroundEmphasis
} from '../transport-poi-beacons.js';
import { createRoute612Controls } from './controls.js';

const adapters = new WeakMap();
const BUS_LOOP_DURATION_MS = 50_000;
const REVEAL_DURATION_MS = 2_200;

export function installRoute612Styles(documentRef = globalThis.document) {
  const existing = documentRef?.getElementById?.('route-61-2-styles');
  if (existing) return existing;
  if (!documentRef?.createElement || !documentRef?.head?.append) return null;
  const stylesheet = documentRef.createElement('link');
  stylesheet.id = 'route-61-2-styles';
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./styles.css', import.meta.url).href;
  documentRef.head.append(stylesheet);
  return stylesheet;
}

function resourceByRole(resources, role) {
  return [...(resources ?? [])].find(([, resource]) => resource.descriptor?.role === role)?.[1] ?? null;
}

function lineCoordinates(resource) {
  const geometry = resource?.value?.features?.[0]?.geometry;
  if (geometry?.type === 'LineString') return structuredClone(geometry.coordinates);
  if (geometry?.type === 'MultiLineString') return structuredClone(geometry.coordinates.flat());
  return [];
}

function poiRecords(resource) {
  return (resource?.value?.features ?? [])
    .filter(({ geometry }) => geometry?.type === 'Point')
    .map(({ properties = {}, geometry }) => ({ ...structuredClone(properties), coordinates: structuredClone(geometry.coordinates) }));
}

function pointFeatures(resource) {
  return (resource?.value?.features ?? []).filter(({ geometry }) => geometry?.type === 'Point');
}

function polygonFeature(resource) {
  return (resource?.value?.features ?? []).find(({ geometry }) => ['Polygon', 'MultiPolygon'].includes(geometry?.type)) ?? null;
}

async function loadTrustedOvertureBuildings(context) {
  if (Object.hasOwn(context, 'overtureBuildings')) return context.overtureBuildings;
  const fetchImpl = context.trustedFetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return null;
  try {
    const rootUrl = new URL('../../', import.meta.url);
    const response = await fetchImpl(new URL(OVERTURE_BUILDINGS_DATA_URL, rootUrl));
    return response?.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function setVisible(map, id, visible) {
  if (map?.getLayer?.(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

function installDataset(map, id, resource, style) {
  if (!resource?.value || map.getSource?.(id)) return;
  map.addSource(id, { type: 'geojson', data: resource.value, ...(style.type === 'line' ? { lineMetrics: true } : {}) });
  map.addLayer({ id, source: id, ...style });
}

function buildMeasuredPath(coordinates) {
  if (coordinates.length < 2) return null;
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(cumulative[index - 1] + haversineMeters(coordinates[index - 1], coordinates[index]));
  }
  return cumulative.at(-1) > 0 ? { coordinates, cumulative, total: cumulative.at(-1) } : null;
}

function pointAlongPath(path, distance) {
  const wrapped = ((distance % path.total) + path.total) % path.total;
  let low = 1; let high = path.cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (path.cumulative[middle] < wrapped) low = middle + 1;
    else high = middle;
  }
  const endIndex = low;
  const startIndex = Math.max(0, endIndex - 1);
  const segmentLength = path.cumulative[endIndex] - path.cumulative[startIndex];
  const ratio = segmentLength ? (wrapped - path.cumulative[startIndex]) / segmentLength : 0;
  const start = path.coordinates[startIndex]; const end = path.coordinates[endIndex];
  return [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
}

function createBusSimulation({
  map,
  maplibregl,
  documentRef,
  routeCoordinates,
  requestAnimationFrame = globalThis.requestAnimationFrame,
  cancelAnimationFrame = globalThis.cancelAnimationFrame
}) {
  if (!maplibregl?.Marker || !documentRef?.createElement) return null;
  const entries = [
    ['existing', 'Xe buýt tuyến hiện hữu', routeCoordinates.existing, 0],
    ['proposed', 'Xe buýt tuyến đề xuất', routeCoordinates.proposed, 0.08]
  ].flatMap(([variant, label, coordinates, offset]) => {
    const path = buildMeasuredPath(coordinates);
    if (!path) return [];
    const element = documentRef.createElement('div');
    element.className = `bus-marker ${variant}`;
    element.textContent = 'BUS';
    element.hidden = true;
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', label);
    const distance = path.total * offset;
    const marker = new maplibregl.Marker({
      element, anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport'
    }).setLngLat(pointAlongPath(path, distance)).addTo(map);
    return [{ element, marker, path, distance, lastTime: null }];
  });
  let active = false; let speed = 1; let frameId = null; let destroyed = false;

  const tick = (timestamp) => {
    frameId = null;
    if (!active || destroyed) return;
    for (const entry of entries) {
      if (entry.lastTime === null) entry.lastTime = timestamp;
      const elapsed = Math.min(Math.max(0, timestamp - entry.lastTime), 120);
      entry.lastTime = timestamp;
      entry.distance = (entry.distance + elapsed * entry.path.total / BUS_LOOP_DURATION_MS * speed) % entry.path.total;
      entry.marker.setLngLat(pointAlongPath(entry.path, entry.distance));
      entry.element.dataset.simulationDistance = entry.distance.toFixed(2);
    }
    if (typeof requestAnimationFrame === 'function') frameId = requestAnimationFrame(tick);
  };

  return Object.freeze({
    set(nextActive, nextSpeed) {
      active = Boolean(nextActive); speed = nextSpeed;
      for (const entry of entries) { entry.element.hidden = !active; entry.lastTime = null; }
      if (!active && frameId !== null) { cancelAnimationFrame?.(frameId); frameId = null; }
      if (active && frameId === null && typeof requestAnimationFrame === 'function') frameId = requestAnimationFrame(tick);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; active = false;
      if (frameId !== null) cancelAnimationFrame?.(frameId);
      for (const { marker } of entries) marker.remove();
    }
  });
}

export function createRoute612RuntimeAdapter(context = {}) {
  const stylesheet = installRoute612Styles(context.documentRef);
  const delegates = {
    setMode: context.setMode,
    setRouteReveal: context.setRouteReveal,
    setPoiEmphasis: context.setPoiEmphasis,
    setContextMode: context.setContextMode,
    setSimulation: context.setSimulation
  };
  const existingResource = resourceByRole(context.resources, 'route.existing');
  const proposedResource = resourceByRole(context.resources, 'route.proposed');
  const existingStopsResource = resourceByRole(context.resources, 'stops.existing');
  const proposedStopsResource = resourceByRole(context.resources, 'stops.proposed');
  const areaResource = resourceByRole(context.resources, 'context.area');
  const poiResource = resourceByRole(context.resources, 'transport.poi');
  const map = context.map;
  const routeCoordinates = Object.freeze({
    existing: lineCoordinates(existingResource),
    proposed: lineCoordinates(proposedResource)
  });
  const comparison = routeCoordinates.existing.length > 1 && routeCoordinates.proposed.length > 1
    ? compareRoutes(routeCoordinates.existing, routeCoordinates.proposed)
    : { all: { type: 'FeatureCollection', features: [] } };
  const stopComparison = compareStops(pointFeatures(existingStopsResource), pointFeatures(proposedStopsResource));
  const ids = Object.freeze({
    existing: 'route-61-2-existing',
    proposedHalo: 'route-61-2-proposed-halo',
    proposed: 'route-61-2-proposed',
    stopsExistingSource: 'route-61-2-stops-existing-source',
    stopsExisting: 'route-61-2-stops-existing',
    stopsProposedSource: 'route-61-2-stops-proposed-source',
    stopsProposed: 'route-61-2-stops-proposed',
    stopsDifferenceSource: 'route-61-2-stops-difference',
    stopsRetained: 'route-61-2-stops-retained',
    stopsAddedHalo: 'route-61-2-stops-added-halo',
    stopsAdded: 'route-61-2-stops-added',
    stopsRemoved: 'route-61-2-stops-removed',
    differenceSource: 'route-61-2-difference',
    differenceRemoved: 'route-61-2-difference-removed',
    differenceRetained: 'route-61-2-difference-retained',
    differenceAddedHalo: 'route-61-2-difference-added-halo',
    differenceAdded: 'route-61-2-difference-added',
    pois: 'route-61-2-pois',
    poiHalo: 'poi-halo',
    poiCore: 'poi-core',
    poiLabels: 'route-61-2-poi-labels'
  });
  let mode = 'difference'; let revealActive = false; let poiActive = false; let contextMode = 'off';
  let simulation = Object.freeze({ active: false, speed: 1 });
  let destroyed = false; let controls = null; let poiBeaconController = null; let busSimulation = null; let revealFrameId = null;
  let urbanContextController = null; let urbanContextInitialization = null; let ready = Promise.resolve();
  let urbanContextConfig = Object.freeze({
    buildingSource: 'local-geojson',
    overtureRelease: '2026-08-19.0'
  });
  const raf = context.requestAnimationFrame ?? globalThis.requestAnimationFrame;
  const caf = context.cancelAnimationFrame ?? globalThis.cancelAnimationFrame;

  function resetProposedGradient() {
    if (revealFrameId !== null) { caf?.(revealFrameId); revealFrameId = null; }
    if (map?.getLayer?.(ids.proposed)) map.setPaintProperty(ids.proposed, 'line-gradient', '#2BB7FF');
  }

  function revealProposedRoute() {
    if (!map?.getLayer?.(ids.proposed)) return;
    if (context.reducedMotion || typeof raf !== 'function') { resetProposedGradient(); return; }
    const startedAt = globalThis.performance?.now?.() ?? 0;
    map.setPaintProperty(ids.proposed, 'line-gradient', ['step', ['line-progress'], '#2BB7FF', 0.001, 'rgba(43, 183, 255, 0)']);
    const frame = (timestamp) => {
      if (!revealActive || destroyed) return;
      const progress = Math.min(1, (timestamp - startedAt) / REVEAL_DURATION_MS);
      if (progress >= 1) { resetProposedGradient(); return; }
      map.setPaintProperty(ids.proposed, 'line-gradient', [
        'step', ['line-progress'], '#2BB7FF', Math.max(0.001, progress), 'rgba(43, 183, 255, 0)'
      ]);
      revealFrameId = raf(frame);
    };
    revealFrameId = raf(frame);
  }

  const routeRevealController = createRouteRevealController({
    start: revealProposedRoute,
    cancel: resetProposedGradient,
    schedule: context.setTimeout ?? globalThis.setTimeout,
    clear: context.clearTimeout ?? globalThis.clearTimeout,
    reducedMotion: context.reducedMotion ?? false
  });

  function applyMode(nextMode) {
    mode = nextMode;
    resetProposedGradient();
    const difference = nextMode === 'difference';
    const showExisting = ['existing', 'compare'].includes(nextMode);
    const showProposed = ['proposed', 'compare'].includes(nextMode);
    setVisible(map, ids.existing, showExisting);
    setVisible(map, ids.proposedHalo, showProposed);
    setVisible(map, ids.proposed, showProposed);
    for (const id of [ids.differenceRemoved, ids.differenceRetained, ids.differenceAddedHalo, ids.differenceAdded]) setVisible(map, id, difference);
    for (const id of [ids.stopsRetained, ids.stopsAddedHalo, ids.stopsAdded, ids.stopsRemoved]) setVisible(map, id, difference);
    setVisible(map, ids.stopsExisting, nextMode === 'existing');
    setVisible(map, ids.stopsProposed, ['proposed', 'compare'].includes(nextMode));
    const offset = nextMode === 'compare' ? 4.5 : 0;
    if (map?.getLayer?.(ids.existing)) map.setPaintProperty(ids.existing, 'line-offset', -offset);
    for (const id of [ids.proposedHalo, ids.proposed]) {
      if (map?.getLayer?.(id)) map.setPaintProperty(id, 'line-offset', offset);
    }
    const mapElement = context.documentRef?.getElementById?.('map');
    mapElement?.setAttribute?.('data-route-mode', nextMode);
    mapElement?.setAttribute?.('data-route-existing-visible', String(showExisting));
    mapElement?.setAttribute?.('data-route-proposed-visible', String(showProposed));
    mapElement?.setAttribute?.('data-route-existing-offset', String(-offset));
    mapElement?.setAttribute?.('data-route-proposed-offset', String(offset));
    mapElement?.setAttribute?.('data-route-stop-mode', difference ? 'difference' : nextMode === 'existing' ? 'existing' : 'proposed');
  }

  function applyContext(nextMode) {
    contextMode = nextMode;
    urbanContextController?.setMode(nextMode);
    const mapElement = context.documentRef?.getElementById?.('map');
    mapElement?.setAttribute?.('data-urban-context', nextMode);
    mapElement?.setAttribute?.('data-urban-layer-visible', String(
      nextMode === 'industrial-context' && Boolean(urbanContextController)
    ));
  }

  function applyPoiEmphasis(active) {
    poiBeaconController?.setEmphasis(active);
    if (map?.getLayer?.(ids.poiHalo) && map?.getLayer?.(ids.poiCore)) setTransportPoiGroundEmphasis(map, active);
    context.documentRef?.body?.classList?.toggle?.('emphasize-pois', active);
    context.documentRef?.getElementById?.('map')?.setAttribute?.('data-poi-emphasis', String(active));
  }

  function ensureUrbanContextController() {
    if (destroyed || urbanContextController) return ready;
    if (urbanContextInitialization) return urbanContextInitialization;
    const configured = urbanContextConfig;
    const buildingsPromise = configured.buildingSource === 'local-geojson'
      ? loadTrustedOvertureBuildings(context)
      : Promise.resolve(null);
    urbanContextInitialization = buildingsPromise.then((overtureBuildings) => {
      if (destroyed || urbanContextController) return;
      urbanContextController = createUrbanContextController({
        map,
        maplibregl: context.maplibregl,
        zone: polygonFeature(areaResource),
        overtureBuildings,
        buildingConfig: configured,
        routeCoordinates: [routeCoordinates.existing, routeCoordinates.proposed],
        pois: poiRecords(poiResource),
        reducedMotion: context.reducedMotion ?? false,
        beforeLayerId: ids.differenceRemoved,
        ensureOnlineProtocol: context.ensureOnlineProtocol,
        createOnlineDefinitions: context.createOnlineDefinitions,
        onStatus: context.onUrbanContextStatus
      });
      applyContext(contextMode);
    });
    ready = urbanContextInitialization;
    return urbanContextInitialization;
  }

  function install() {
    if (destroyed) return;
    installDataset(map, ids.existing, existingResource, {
      type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#718096', 'line-opacity': 0.82, 'line-width': 6, 'line-offset': 0 }
    });
    if (proposedResource?.value && !map.getSource?.(ids.proposed)) {
      map.addSource(ids.proposed, { type: 'geojson', data: proposedResource.value, lineMetrics: true });
    }
    if (!map.getLayer?.(ids.proposedHalo)) map.addLayer({
      id: ids.proposedHalo, source: ids.proposed, type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2BB7FF', 'line-opacity': 0.2, 'line-blur': 3, 'line-width': 12, 'line-offset': 0 }
    });
    if (!map.getLayer?.(ids.proposed)) map.addLayer({
      id: ids.proposed, source: ids.proposed, type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2BB7FF', 'line-opacity': 0.98, 'line-width': 7, 'line-offset': 0 }
    });
    if (!map.getSource?.(ids.differenceSource)) map.addSource(ids.differenceSource, { type: 'geojson', data: comparison.all });
    for (const [id, status, color, dasharray, opacity, width, blur] of [
      [ids.differenceRemoved, 'removed', '#FFAD32', [1.35, 1.05], 1, 6, 0],
      [ids.differenceRetained, 'retained', '#708096', null, 0.64, 5.5, 0],
      [ids.differenceAddedHalo, 'added', '#2BB7FF', null, 0.24, 12, 3],
      [ids.differenceAdded, 'added', '#2BB7FF', null, 1, 7, 0]
    ]) {
      if (!map.getLayer?.(id)) map.addLayer({
        id, type: 'line', source: ids.differenceSource,
        filter: ['==', ['get', 'status'], status],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-opacity': opacity, 'line-width': width, ...(blur ? { 'line-blur': blur } : {}), ...(dasharray ? { 'line-dasharray': dasharray } : {}) }
      });
    }
    if (existingStopsResource?.value && !map.getSource?.(ids.stopsExistingSource)) {
      map.addSource(ids.stopsExistingSource, { type: 'geojson', data: existingStopsResource.value });
    }
    if (proposedStopsResource?.value && !map.getSource?.(ids.stopsProposedSource)) {
      map.addSource(ids.stopsProposedSource, { type: 'geojson', data: proposedStopsResource.value });
    }
    if (!map.getSource?.(ids.stopsDifferenceSource)) {
      map.addSource(ids.stopsDifferenceSource, { type: 'geojson', data: stopComparison.all });
    }
    for (const layer of [
      { id: ids.stopsExisting, source: ids.stopsExistingSource, paint: { 'circle-radius': 4.5, 'circle-color': '#8A98AA', 'circle-opacity': 0.82, 'circle-stroke-color': '#E2E8F0', 'circle-stroke-width': 1 } },
      { id: ids.stopsProposed, source: ids.stopsProposedSource, paint: { 'circle-radius': 5, 'circle-color': '#67E8F9', 'circle-opacity': 0.92, 'circle-stroke-color': '#ECFEFF', 'circle-stroke-width': 1.2 } },
      { id: ids.stopsRetained, source: ids.stopsDifferenceSource, filter: ['==', ['get', 'status'], 'retained'], paint: { 'circle-radius': 4, 'circle-color': '#8290A3', 'circle-opacity': 0.74, 'circle-stroke-color': '#D4DBE5', 'circle-stroke-width': 0.8 } },
      { id: ids.stopsAddedHalo, source: ids.stopsDifferenceSource, filter: ['==', ['get', 'status'], 'added'], paint: { 'circle-radius': 9, 'circle-color': '#22D3EE', 'circle-opacity': 0.28, 'circle-blur': 0.65 } },
      { id: ids.stopsAdded, source: ids.stopsDifferenceSource, filter: ['==', ['get', 'status'], 'added'], paint: { 'circle-radius': 5.5, 'circle-color': '#67E8F9', 'circle-opacity': 1, 'circle-stroke-color': '#ECFEFF', 'circle-stroke-width': 1.8 } },
      { id: ids.stopsRemoved, source: ids.stopsDifferenceSource, filter: ['==', ['get', 'status'], 'removed'], paint: { 'circle-radius': 5, 'circle-color': 'rgba(245, 158, 11, 0)', 'circle-stroke-color': '#F59E0B', 'circle-stroke-width': 2, 'circle-opacity': 0.95 } }
    ]) {
      if (map.getSource?.(layer.source) && !map.getLayer?.(layer.id)) {
        map.addLayer({ ...layer, type: 'circle', layout: { visibility: 'none' } });
      }
    }
    if (poiResource?.value && !map.getSource?.(ids.pois)) {
      map.addSource(ids.pois, { type: 'geojson', data: poiResource.value });
      for (const layer of buildTransportPoiGroundLayers({ source: ids.pois })) if (!map.getLayer?.(layer.id)) map.addLayer(layer);
      if (!map.getLayer?.(ids.poiLabels)) map.addLayer({
        id: ids.poiLabels, type: 'symbol', source: ids.pois, minzoom: 9.5,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top' },
        paint: { 'text-color': '#EFFCFF', 'text-halo-color': '#050B14', 'text-halo-width': 2 }
      });
    }
    if (!poiBeaconController && poiResource?.value && context.maplibregl?.Marker && context.documentRef) {
      poiBeaconController = createTransportPoiBeacons({
        map, maplibregl: context.maplibregl, documentRef: context.documentRef, pois: poiRecords(poiResource)
      });
    }
    if (!busSimulation) busSimulation = createBusSimulation({
      map, maplibregl: context.maplibregl, documentRef: context.documentRef, routeCoordinates,
      requestAnimationFrame: raf, cancelAnimationFrame: caf
    });
    applyMode(mode); applyContext(contextMode); applyPoiEmphasis(poiActive); busSimulation?.set(simulation.active, simulation.speed);
  }

  if (delegates.setMode || delegates.setRouteReveal || delegates.setPoiEmphasis || delegates.setContextMode) {
    // The certified legacy shell supplies these callbacks. Keeping the delegation
    // here extracts adapter selection without changing its visible behavior.
  } else if (map?.loaded?.() === false && map.once) map.once('load', install);
  else install();

  const adapter = {
    id: 'route-61-2-current',
    routeCoordinates,
    ids,
    get ready() { return ready; },
    connect(next = {}) {
      for (const key of Object.keys(delegates)) if (typeof next[key] === 'function') delegates[key] = next[key];
      return adapter;
    },
    configureUrbanContext(next) {
      if (destroyed) throw new TypeError('Cannot configure a destroyed Route 61-2 adapter.');
      const keys = next && typeof next === 'object' && !Array.isArray(next) ? Object.keys(next) : [];
      if (
        keys.length !== 2
        || !keys.includes('buildingSource')
        || !keys.includes('overtureRelease')
        || !['overture-pmtiles', 'local-geojson'].includes(next.buildingSource)
        || typeof next.overtureRelease !== 'string'
        || !OVERTURE_PMTILES_RELEASE_PATTERN.test(next.overtureRelease)
      ) {
        throw new TypeError('Invalid urban context configuration.');
      }
      urbanContextConfig = Object.freeze({
        buildingSource: next.buildingSource,
        overtureRelease: next.overtureRelease
      });
      urbanContextController?.configureBuildings?.(urbanContextConfig);
      if (polygonFeature(areaResource)) ensureUrbanContextController();
      return urbanContextConfig;
    },
    setMode(nextMode) {
      if (!['existing', 'proposed', 'difference', 'compare'].includes(nextMode)) throw new TypeError(`Unsupported route mode: ${nextMode}.`);
      if (delegates.setMode) delegates.setMode(nextMode);
      else applyMode(nextMode);
    },
    setRouteReveal(target, active, delayMs = 0) {
      revealActive = Boolean(active);
      if (delegates.setRouteReveal) delegates.setRouteReveal(target, revealActive, delayMs);
      else routeRevealController.setActive(revealActive, delayMs);
      context.documentRef?.getElementById?.('map')?.setAttribute?.('data-route-reveal', String(revealActive));
    },
    setPoiEmphasis(target, active) {
      poiActive = Boolean(active);
      if (delegates.setPoiEmphasis) delegates.setPoiEmphasis(target, poiActive);
      else applyPoiEmphasis(poiActive);
    },
    setContextMode(nextMode) {
      if (!['off', 'industrial-context'].includes(nextMode)) throw new TypeError(`Unsupported urban context mode: ${nextMode}.`);
      if (delegates.setContextMode) delegates.setContextMode(nextMode);
      else if (urbanContextController) applyContext(nextMode);
      else {
        contextMode = nextMode;
        const initialization = polygonFeature(areaResource) ? ensureUrbanContextController() : Promise.resolve();
        initialization.then(() => applyContext(nextMode));
        return initialization;
      }
      return Promise.resolve();
    },
    setSimulation(active, speed = 1) {
      if (!Number.isFinite(speed) || speed <= 0 || speed > 4) throw new TypeError('Simulation speed must be greater than 0 and at most 4.');
      simulation = Object.freeze({ active: Boolean(active), speed });
      if (delegates.setSimulation) delegates.setSimulation(simulation.active, simulation.speed);
      else busSimulation?.set(simulation.active, simulation.speed);
      const mapElement = context.documentRef?.getElementById?.('map');
      mapElement?.setAttribute?.('data-simulation-active', String(simulation.active));
      mapElement?.setAttribute?.('data-simulation-speed', String(simulation.speed));
    },
    sceneLayers: Object.freeze({
      ids: Object.freeze([...(context.resources ?? [])]
        .filter(([, resource]) => ['route.existing', 'route.proposed', 'stops.existing', 'stops.proposed', 'context.area', 'transport.poi'].includes(resource.descriptor?.role))
        .map(([id]) => id)),
      setVisible(datasetId, visible) {
        const role = context.resources.get(datasetId)?.descriptor?.role;
        if (role === 'route.existing') setVisible(map, ids.existing, visible);
        else if (role === 'route.proposed') for (const id of [ids.proposedHalo, ids.proposed]) setVisible(map, id, visible);
        else if (role === 'stops.existing') setVisible(map, ids.stopsExisting, visible);
        else if (role === 'stops.proposed') setVisible(map, ids.stopsProposed, visible);
        else if (role === 'context.area') applyContext(visible ? 'industrial-context' : 'off');
        else if (role === 'transport.poi') {
          for (const id of [ids.poiHalo, ids.poiCore, ids.poiLabels]) setVisible(map, id, visible);
          poiBeaconController?.setVisible(visible);
        }
      },
      reset() { applyMode('difference'); applyContext('off'); }
    }),
    get state() {
      return Object.freeze({ mode, revealActive, poiActive, contextMode, simulation, urbanContextConfig });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      routeRevealController.setActive(false);
      controls?.destroy();
      if (context.capabilityControlHost) context.capabilityControlHost.hidden = true;
      poiBeaconController?.destroy(); busSimulation?.destroy(); urbanContextController?.destroy(); stylesheet?.remove?.();
      for (const id of [
        ids.poiLabels, ids.poiCore, ids.poiHalo,
        ids.stopsRemoved, ids.stopsAdded, ids.stopsAddedHalo, ids.stopsRetained, ids.stopsProposed, ids.stopsExisting,
        ids.differenceAdded, ids.differenceAddedHalo, ids.differenceRetained, ids.differenceRemoved,
        ids.proposed, ids.proposedHalo, ids.existing
      ]) if (map?.getLayer?.(id)) map.removeLayer?.(id);
      for (const id of [
        ids.pois, ids.stopsDifferenceSource, ids.stopsProposedSource, ids.stopsExistingSource,
        ids.differenceSource, ids.proposed, ids.existing
      ]) {
        if (map?.getSource?.(id)) map.removeSource?.(id);
      }
    }
  };
  if (context.capabilityControlHost) {
    context.capabilityControlHost.hidden = false;
    controls = createRoute612Controls({
      host: context.capabilityControlHost,
      documentRef: context.documentRef,
      onMode: adapter.setMode,
      onReveal: (active) => adapter.setRouteReveal(context.settings?.proposedRouteTarget ?? 'proposed-route', active),
      onPoi: (active) => adapter.setPoiEmphasis(context.settings?.poiTarget ?? 'connection-pois', active),
      onUrban: (active) => adapter.setContextMode(active ? 'industrial-context' : 'off'),
      onSimulation: adapter.setSimulation
    });
  }
  return Object.freeze(adapter);
}

export function getRoute612RuntimeAdapter(context = {}) {
  if (context.map && adapters.has(context.map)) return adapters.get(context.map).connect(context);
  const adapter = createRoute612RuntimeAdapter(context);
  if (context.map) adapters.set(context.map, adapter);
  return adapter;
}
