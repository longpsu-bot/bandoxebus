import { compareRoutes, haversineMeters } from '../comparison.js';
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
  const stopsResource = resourceByRole(context.resources, 'stops.existing');
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
  const ids = Object.freeze({
    existing: 'route-61-2-existing',
    proposed: 'route-61-2-proposed',
    stops: 'route-61-2-stops',
    area: 'route-61-2-urban-context',
    differenceSource: 'route-61-2-difference',
    differenceRemoved: 'route-61-2-difference-removed',
    differenceRetained: 'route-61-2-difference-retained',
    differenceAdded: 'route-61-2-difference-added',
    pois: 'route-61-2-pois',
    poiHalo: 'poi-halo',
    poiCore: 'poi-core',
    poiLabels: 'route-61-2-poi-labels'
  });
  let mode = 'difference'; let revealActive = false; let poiActive = false; let contextMode = 'off';
  let simulation = Object.freeze({ active: false, speed: 1 });
  let destroyed = false; let controls = null; let poiBeaconController = null; let busSimulation = null; let revealFrameId = null;
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
    setVisible(map, ids.proposed, showProposed);
    setVisible(map, ids.stops, nextMode !== 'proposed');
    for (const id of [ids.differenceRemoved, ids.differenceRetained, ids.differenceAdded]) setVisible(map, id, difference);
    context.documentRef?.getElementById?.('map')?.setAttribute?.('data-route-mode', nextMode);
  }

  function applyContext(nextMode) {
    contextMode = nextMode;
    setVisible(map, ids.area, nextMode === 'industrial-context');
    const mapElement = context.documentRef?.getElementById?.('map');
    mapElement?.setAttribute?.('data-urban-context', nextMode);
    mapElement?.setAttribute?.('data-urban-layer-visible', String(nextMode === 'industrial-context'));
  }

  function applyPoiEmphasis(active) {
    poiBeaconController?.setEmphasis(active);
    if (map?.getLayer?.(ids.poiHalo) && map?.getLayer?.(ids.poiCore)) setTransportPoiGroundEmphasis(map, active);
    context.documentRef?.body?.classList?.toggle?.('emphasize-pois', active);
    context.documentRef?.getElementById?.('map')?.setAttribute?.('data-poi-emphasis', String(active));
  }

  function install() {
    if (destroyed) return;
    installDataset(map, ids.existing, existingResource, {
      type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#718096', 'line-opacity': 0.82, 'line-width': 6 }
    });
    installDataset(map, ids.proposed, proposedResource, {
      type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2BB7FF', 'line-opacity': 0.98, 'line-width': 7 }
    });
    installDataset(map, ids.stops, stopsResource, {
      type: 'circle',
      paint: { 'circle-color': '#67E8F9', 'circle-radius': 5, 'circle-stroke-color': '#ECFEFF', 'circle-stroke-width': 1 }
    });
    installDataset(map, ids.area, areaResource, {
      type: 'fill', layout: { visibility: 'none' }, paint: { 'fill-color': '#38BDF8', 'fill-opacity': 0.18 }
    });
    if (!map.getSource?.(ids.differenceSource)) map.addSource(ids.differenceSource, { type: 'geojson', data: comparison.all });
    for (const [id, status, color, dasharray] of [
      [ids.differenceRemoved, 'removed', '#FFAD32', [1.35, 1.05]],
      [ids.differenceRetained, 'retained', '#708096', null],
      [ids.differenceAdded, 'added', '#2BB7FF', null]
    ]) {
      if (!map.getLayer?.(id)) map.addLayer({
        id, type: 'line', source: ids.differenceSource,
        filter: ['==', ['get', 'status'], status],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-opacity': status === 'retained' ? 0.64 : 1, 'line-width': status === 'added' ? 7 : 6, ...(dasharray ? { 'line-dasharray': dasharray } : {}) }
      });
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
    connect(next = {}) {
      for (const key of Object.keys(delegates)) if (typeof next[key] === 'function') delegates[key] = next[key];
      return adapter;
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
      else applyContext(nextMode);
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
        .filter(([, resource]) => ['route.existing', 'route.proposed', 'stops.existing', 'context.area', 'transport.poi'].includes(resource.descriptor?.role))
        .map(([id]) => id)),
      setVisible(datasetId, visible) {
        const role = context.resources.get(datasetId)?.descriptor?.role;
        if (role === 'route.existing') setVisible(map, ids.existing, visible);
        else if (role === 'route.proposed') setVisible(map, ids.proposed, visible);
        else if (role === 'stops.existing') setVisible(map, ids.stops, visible);
        else if (role === 'context.area') setVisible(map, ids.area, visible);
        else if (role === 'transport.poi') {
          for (const id of [ids.poiHalo, ids.poiCore, ids.poiLabels]) setVisible(map, id, visible);
          poiBeaconController?.setVisible(visible);
        }
      },
      reset() { applyMode('difference'); applyContext('off'); }
    }),
    get state() { return Object.freeze({ mode, revealActive, poiActive, contextMode, simulation }); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      routeRevealController.setActive(false);
      controls?.destroy();
      if (context.capabilityControlHost) context.capabilityControlHost.hidden = true;
      poiBeaconController?.destroy(); busSimulation?.destroy(); stylesheet?.remove?.();
      for (const id of [
        ids.poiLabels, ids.poiCore, ids.poiHalo,
        ids.differenceAdded, ids.differenceRetained, ids.differenceRemoved,
        ids.area, ids.stops, ids.proposed, ids.existing
      ]) if (map?.getLayer?.(id)) map.removeLayer?.(id);
      for (const id of [ids.pois, ids.differenceSource, ids.area, ids.stops, ids.proposed, ids.existing]) {
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
