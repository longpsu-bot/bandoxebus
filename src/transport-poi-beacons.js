const GROUND_STYLES = Object.freeze({
  normal: Object.freeze({
    'poi-halo': Object.freeze({
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 15, 16, 20],
      'circle-color': '#8defff', 'circle-opacity': 0.22, 'circle-blur': 0.65
    }),
    'poi-core': Object.freeze({
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 13, 3.5, 16, 4.5],
      'circle-color': '#dffaff', 'circle-opacity': 0.92,
      'circle-stroke-color': '#8defff', 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.7
    })
  }),
  emphasized: Object.freeze({
    'poi-halo': Object.freeze({
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 13, 13, 19, 16, 25],
      'circle-color': '#a8f5ff', 'circle-opacity': 0.34, 'circle-blur': 0.55
    }),
    'poi-core': Object.freeze({
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.25, 13, 4.5, 16, 5.75],
      'circle-color': '#f1feff', 'circle-opacity': 1,
      'circle-stroke-color': '#a8f5ff', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.9
    })
  })
});

export function buildTransportPoiGroundLayers({ source = 'route-pois' } = {}) {
  return Object.entries(GROUND_STYLES.normal).map(([id, paint]) => ({
    id,
    type: 'circle',
    source,
    paint: {
      ...paint,
      'circle-pitch-alignment': 'map',
      'circle-pitch-scale': 'map'
    }
  }));
}

export function setTransportPoiGroundEmphasis(map, active) {
  const styles = active ? GROUND_STYLES.emphasized : GROUND_STYLES.normal;
  for (const [layerId, paint] of Object.entries(styles)) {
    for (const [property, value] of Object.entries(paint)) map.setPaintProperty(layerId, property, value);
  }
}

export function createTransportPoiBeacons({ map, maplibregl, documentRef = document, pois = [] }) {
  const entries = pois.map((poi) => {
    const root = documentRef.createElement('div');
    root.className = 'transport-poi-beacon';
    root.dataset.poiName = poi.name ?? '';
    const pillar = documentRef.createElement('span');
    pillar.className = 'transport-poi-beacon__pillar';
    root.append(pillar);
    const marker = new maplibregl.Marker({ element: root, anchor: 'bottom' })
      .setLngLat(poi.coordinates)
      .addTo(map);
    return { root, marker };
  });
  let destroyed = false;
  return Object.freeze({
    count: entries.length,
    setEmphasis(active) { for (const { root } of entries) root.classList.toggle('is-emphasized', Boolean(active)); },
    setVisible(visible) { for (const { root } of entries) root.hidden = !visible; },
    destroy() { if (destroyed) return; destroyed = true; for (const { marker } of entries) marker.remove(); }
  });
}
