import { ProjectLoadError } from '../project/project-error.js';

function layerOpacityProperty(layer) {
  return layer.type === 'line' ? 'line-opacity' : layer.type === 'fill' ? 'fill-opacity' : layer.type === 'symbol' ? 'text-opacity' : 'circle-opacity';
}

function emphasisPaint(layer, active) {
  const opacityProperty = layerOpacityProperty(layer);
  const properties = [[opacityProperty, active ? 1 : (layer.paint?.[opacityProperty] ?? layer.baseOpacity ?? 1)]];
  if (layer.type === 'circle') {
    const radius = layer.paint?.['circle-radius'];
    if (Number.isFinite(radius)) properties.push(['circle-radius', active ? radius * 1.5 : radius]);
  }
  if (layer.type === 'line') {
    const width = layer.paint?.['line-width'];
    if (Number.isFinite(width)) properties.push(['line-width', active ? width * 1.5 : width]);
  }
  return properties;
}

function combinedPadding(shell, authored = 0) {
  const padding = typeof shell === 'function' ? shell() : shell;
  if (typeof padding === 'number') return padding + authored;
  const base = padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value + authored]));
}

export function createCoreMapController({ map, datasets = new Map(), focusRegistry, reducedMotion = false, shellPadding = 0 } = {}) {
  const visibility = new Map([...datasets].map(([id, value]) => [id, value.defaultVisible !== false]));
  const emphasized = new Set();
  let destroyed = false;
  const dataset = (id) => {
    const value = datasets.get(id);
    if (!value) throw new ProjectLoadError('MAP_TARGET_UNKNOWN', `$.map.target.${id}`, `Unknown map target ID: ${id}.`);
    return value;
  };
  const layers = (record) => record.layers ?? (record.layerIds ?? []).map((id) => ({ id, type: record.layerType ?? 'circle' }));
  const applyVisibility = (id) => {
    for (const layer of layers(dataset(id))) if (map.getLayer?.(layer.id) !== false) map.setLayoutProperty(layer.id, 'visibility', visibility.get(id) ? 'visible' : 'none');
  };
  return Object.freeze({
    focus(id, camera = {}) {
      const target = focusRegistry.get(id);
      const hints = { ...(target.camera ?? {}), ...camera };
      const options = {
        ...(hints.padding === undefined && !shellPadding ? {} : { padding: combinedPadding(shellPadding, hints.padding ?? 0) }),
        ...Object.fromEntries(['maxZoom', 'pitch', 'bearing'].filter((key) => hints[key] !== undefined).map((key) => [key, hints[key]])),
        duration: reducedMotion ? 0 : 900,
        essential: false
      };
      if (target.type === 'coordinate') map.easeTo({ center: target.center, zoom: target.zoom, ...options });
      else map.fitBounds(target.bounds, options);
    },
    setVisibility(id, visible) { dataset(id); visibility.set(id, Boolean(visible)); applyVisibility(id); },
    setEmphasis(id, active) {
      const record = dataset(id);
      active ? emphasized.add(id) : emphasized.delete(id);
      for (const layer of layers(record)) {
        for (const [property, value] of emphasisPaint(layer, active)) map.setPaintProperty(layer.id, property, value);
      }
    },
    clearEmphasis() {
      for (const id of [...emphasized]) this.setEmphasis(id, false);
      for (const id of visibility.keys()) applyVisibility(id);
    },
    reset() {
      this.clearEmphasis();
      for (const [id, record] of datasets) { visibility.set(id, record.defaultVisible !== false); applyVisibility(id); }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const [, record] of [...datasets].reverse()) {
        for (const layer of [...layers(record)].reverse()) if (map.getLayer?.(layer.id)) map.removeLayer?.(layer.id);
        if (record.sourceId && map.getSource?.(record.sourceId)) map.removeSource?.(record.sourceId);
      }
    }
  });
}
