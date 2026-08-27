const HIDDEN_LOCAL_LABELS = /(poi|housenumber|house_number|place_hamlet|place_suburb|place_village)/i;
const MINOR_ROADS = /(road|highway)_(minor|service|path)/i;
const ROAD_LABELS = /(road|highway)_(label|shield|name)/i;

export function prepareBasemapStyle(style) {
  const copy = structuredClone(style);
  copy.glyphs = 'https://orangemug.github.io/font-glyphs/glyphs/{fontstack}/{range}.pbf';
  copy.layers.forEach((layer) => {
    if (layer.type === 'symbol' && layer.layout?.['text-field']) {
      layer.layout = { ...(layer.layout ?? {}), 'text-font': ['Roboto Regular'] };
    }
    if (layer.type === 'symbol' && HIDDEN_LOCAL_LABELS.test(layer.id)) {
      layer.layout = { ...(layer.layout ?? {}), visibility: 'none' };
    }
    if (MINOR_ROADS.test(layer.id) && layer.type === 'line') {
      layer.paint = { ...(layer.paint ?? {}), 'line-opacity': 0.42 };
    }
    if (ROAD_LABELS.test(layer.id) && layer.type === 'symbol') {
      layer.layout = {
        ...(layer.layout ?? {}),
        visibility: 'none',
        'text-pitch-alignment': 'viewport',
        'text-rotation-alignment': 'map',
        'text-allow-overlap': false,
        'text-ignore-placement': false
      };
      layer.paint = {
        ...(layer.paint ?? {}),
        'text-halo-color': 'rgba(5, 11, 20, .92)',
        'text-halo-width': 1.5
      };
    }
  });
  return copy;
}

export function stripOpenFreeMapDarkStyle(style) {
  const noisySourceLayers = new Set(['poi', 'building', 'housenumber']);
  const retained = structuredClone(style);
  retained.name = 'Route 61-2 · Stripped OpenFreeMap Dark';
  retained.layers = retained.layers.filter((layer) => (
    !noisySourceLayers.has(layer['source-layer']) && !layer.paint?.['fill-pattern']
  ));
  return retained;
}
