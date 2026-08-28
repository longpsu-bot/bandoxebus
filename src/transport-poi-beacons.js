export function createTransportPoiBeacons({ map, maplibregl, documentRef = document, pois = [] }) {
  const entries = pois.map((poi) => {
    const root = documentRef.createElement('div');
    root.className = 'transport-poi-beacon';
    root.dataset.poiName = poi.name ?? '';
    const pillar = documentRef.createElement('span');
    pillar.className = 'transport-poi-beacon__pillar';
    const anchor = documentRef.createElement('span');
    anchor.className = 'transport-poi-beacon__anchor';
    root.append(pillar, anchor);
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
