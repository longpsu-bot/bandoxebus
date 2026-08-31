import { createRoute612Controls } from './controls.js';

const adapters = new WeakMap();

function resourceByRole(resources, role) {
  return [...(resources ?? [])].find(([, resource]) => resource.descriptor?.role === role)?.[1] ?? null;
}

function lineCoordinates(resource) {
  const geometry = resource?.value?.features?.[0]?.geometry;
  if (geometry?.type === 'LineString') return structuredClone(geometry.coordinates);
  if (geometry?.type === 'MultiLineString') return structuredClone(geometry.coordinates.flat());
  return [];
}

function setVisible(map, id, visible) {
  if (map?.getLayer?.(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

function installDataset(map, id, resource, style) {
  if (!resource?.value || map.getSource?.(id)) return;
  map.addSource(id, { type: 'geojson', data: resource.value, ...(style.type === 'line' ? { lineMetrics: true } : {}) });
  map.addLayer({ id, source: id, ...style });
}

export function createRoute612RuntimeAdapter(context = {}) {
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
  const map = context.map;
  const ids = Object.freeze({
    existing: 'route-61-2-existing', proposed: 'route-61-2-proposed', stops: 'route-61-2-stops', area: 'route-61-2-urban-context'
  });
  let mode = 'difference';
  let revealActive = false;
  let poiActive = false;
  let contextMode = 'off';
  let simulation = Object.freeze({ active: false, speed: 1 });
  let destroyed = false;
  let controls = null;

  const install = () => {
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
      type: 'fill', paint: { 'fill-color': '#38BDF8', 'fill-opacity': 0.18 }
    });
    applyMode(mode);
    applyContext(contextMode);
  };

  function applyMode(nextMode) {
    mode = nextMode;
    const showExisting = ['existing', 'difference', 'compare'].includes(nextMode);
    const showProposed = ['proposed', 'difference', 'compare'].includes(nextMode);
    setVisible(map, ids.existing, showExisting);
    setVisible(map, ids.proposed, showProposed);
    setVisible(map, ids.stops, nextMode !== 'proposed');
    context.documentRef?.getElementById?.('map')?.setAttribute?.('data-route-mode', nextMode);
  }

  function applyContext(nextMode) {
    contextMode = nextMode;
    setVisible(map, ids.area, nextMode === 'industrial-context');
    context.documentRef?.getElementById?.('map')?.setAttribute?.('data-urban-context', nextMode);
  }

  if (delegates.setMode || delegates.setRouteReveal || delegates.setPoiEmphasis || delegates.setContextMode) {
    // The certified legacy shell supplies these callbacks. Keeping the delegation
    // here extracts adapter selection without changing its visible behavior.
  } else if (map?.loaded?.() === false && map.once) map.once('load', install);
  else install();

  const adapter = {
    id: 'route-61-2-current',
    routeCoordinates: Object.freeze({
      existing: lineCoordinates(existingResource),
      proposed: lineCoordinates(proposedResource)
    }),
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
      else {
        const apply = () => {
          if (map?.getLayer?.(ids.proposed)) map.setPaintProperty(ids.proposed, 'line-opacity', revealActive ? 0.98 : 0);
          context.documentRef?.getElementById?.('map')?.setAttribute?.('data-route-reveal', String(revealActive));
        };
        if (delayMs > 0) globalThis.setTimeout(apply, delayMs); else apply();
      }
    },
    setPoiEmphasis(target, active) {
      poiActive = Boolean(active);
      if (delegates.setPoiEmphasis) delegates.setPoiEmphasis(target, poiActive);
      else context.documentRef?.getElementById?.('map')?.setAttribute?.('data-poi-emphasis', String(poiActive));
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
      else {
        const mapElement = context.documentRef?.getElementById?.('map');
        mapElement?.setAttribute?.('data-simulation-active', String(simulation.active));
        mapElement?.setAttribute?.('data-simulation-speed', String(simulation.speed));
      }
    },
    sceneLayers: Object.freeze({
      ids: Object.freeze([...(context.resources ?? [])].filter(([, resource]) => ['route.existing', 'route.proposed', 'stops.existing', 'context.area'].includes(resource.descriptor?.role)).map(([id]) => id)),
      setVisible(datasetId, visible) {
        const role = context.resources.get(datasetId)?.descriptor?.role;
        const layerId = role === 'route.existing' ? ids.existing : role === 'route.proposed' ? ids.proposed : role === 'stops.existing' ? ids.stops : ids.area;
        setVisible(map, layerId, visible);
      },
      reset() { applyMode('difference'); applyContext('off'); }
    }),
    get state() { return Object.freeze({ mode, revealActive, poiActive, contextMode, simulation }); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      controls?.destroy();
      for (const id of Object.values(ids).toReversed()) {
        if (map?.getLayer?.(id)) map.removeLayer?.(id);
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
