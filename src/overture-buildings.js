export const OVERTURE_BUILDING_SOURCE_ID = 'overture-industrial-buildings';
export const OVERTURE_BUILDING_LAYER_ID = 'overture-industrial-buildings-3d';
export const OVERTURE_BUILDINGS_DATA_URL = './data/context/my-phuoc-1-buildings.geojson';

export const DEFAULT_AREA_HEIGHT_THRESHOLDS = Object.freeze({
  smallMaxM2: 400,
  mediumMaxM2: 1_200,
  largeMaxM2: 3_000
});

function positiveFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function deriveOvertureHeight(properties = {}, footprintAreaM2 = 0, thresholds = DEFAULT_AREA_HEIGHT_THRESHOLDS) {
  const sourceHeight = positiveFinite(properties.height);
  const minHeight = positiveFinite(properties.min_height) ?? 0;
  if (sourceHeight && sourceHeight <= 300 && minHeight < sourceHeight) {
    return { heightM: sourceHeight, minHeightM: minHeight, heightSource: 'source-height' };
  }

  const floors = positiveFinite(properties.num_floors);
  if (floors && floors <= 80) {
    const heightM = Math.round(floors * 3.5 * 10) / 10;
    return { heightM, minHeightM: minHeight < heightM ? minHeight : 0, heightSource: 'floors-derived' };
  }

  const area = Math.max(0, Number(footprintAreaM2) || 0);
  const heightM = area <= thresholds.smallMaxM2 ? 6.5
    : area <= thresholds.mediumMaxM2 ? 8.5
      : area <= thresholds.largeMaxM2 ? 11 : 14;
  return { heightM, minHeightM: 0, heightSource: 'illustrative-height' };
}

export function inspectOvertureCollection(collection) {
  const metadata = collection?.metadata;
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const release = typeof metadata?.overtureRelease === 'string' ? metadata.overtureRelease : null;
  const featureCount = Number(metadata?.statistics?.featureCount);
  const coverageRatio = Number(metadata?.statistics?.aoiCoverageRatio);
  const renderable = features.length > 0 && features.every((feature) => (
    ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
    && positiveFinite(feature?.properties?.render_height_m)
  ));
  const usable = collection?.type === 'FeatureCollection'
    && metadata?.provider === 'Overture Maps Foundation'
    && Boolean(release)
    && metadata?.aoiFeatureId === 'osm-industrial-759187612'
    && featureCount === features.length
    && Number.isFinite(coverageRatio)
    && coverageRatio >= 0
    && renderable;
  return {
    usable,
    reason: usable ? null : 'invalid-or-empty-overture-collection',
    featureCount: features.length,
    release,
    coverageRatio: Number.isFinite(coverageRatio) ? coverageRatio : null
  };
}

export function createOvertureLayerDefinitions(collection) {
  return {
    source: {
      type: 'geojson',
      data: collection,
      attribution: '© <a href="https://overturemaps.org/">Overture Maps Foundation</a>'
    },
    layer: {
      id: OVERTURE_BUILDING_LAYER_ID,
      type: 'fill-extrusion',
      source: OVERTURE_BUILDING_SOURCE_ID,
      minzoom: 11,
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': [
          'match', ['get', 'height_source'],
          'source-height', '#8da3b5',
          'floors-derived', '#8298aa',
          '#748a9c'
        ],
        'fill-extrusion-height': ['get', 'render_height_m'],
        'fill-extrusion-base': ['get', 'render_min_height_m'],
        'fill-extrusion-opacity': 0.78,
        'fill-extrusion-vertical-gradient': true
      }
    }
  };
}
