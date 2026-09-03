import {
  OVERTURE_BUILDING_LAYER_ID,
  OVERTURE_BUILDING_SOURCE_ID
} from './overture-buildings.js';

const OVERTURE_HOST = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com';
const PMTILES_VENDOR_URL = new URL('../vendor/pmtiles/4.5.0/pmtiles.js', import.meta.url);
const protocolByMapLibre = new WeakMap();
const archivesByProtocol = new WeakMap();
let pmtilesLoadPromise;

export const OVERTURE_PMTILES_RELEASE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.0$/;
export const OVERTURE_PMTILES_FLAT_LAYER_ID = 'overture-industrial-buildings-flat';

function freezeExpression(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeExpression);
    Object.freeze(value);
  }
  return value;
}

const NUMBER_FROM_PROPERTY = (name) => ['to-number', ['get', name], 0];
const OPTIONAL_NUMBER_FROM_PROPERTY = (name) => ['number', ['get', name], -1];

function buildingHeightExpression() {
  return [
    'let',
    'height', NUMBER_FROM_PROPERTY('height'),
    'floors', NUMBER_FROM_PROPERTY('num_floors'),
    [
      'case',
      ['all', ['>', ['var', 'height'], 0], ['<=', ['var', 'height'], 300]], ['var', 'height'],
      ['all', ['>', ['var', 'floors'], 0], ['<=', ['var', 'floors'], 80]], ['*', ['var', 'floors'], 3.5],
      8.5
    ]
  ];
}

const HEIGHT_EXPRESSION = freezeExpression(buildingHeightExpression());
const BASE_EXPRESSION = freezeExpression([
  'let',
  'finalHeight', buildingHeightExpression(),
  [
    'let',
    'minHeight', OPTIONAL_NUMBER_FROM_PROPERTY('min_height'),
    'minFloor', OPTIONAL_NUMBER_FROM_PROPERTY('min_floor'),
    [
      'case',
      ['all', ['>=', ['var', 'minHeight'], 0], ['<', ['var', 'minHeight'], ['var', 'finalHeight']]], ['var', 'minHeight'],
      ['all', ['>=', ['var', 'minFloor'], 0], ['<=', ['var', 'minFloor'], 80], ['<', ['*', ['var', 'minFloor'], 3.5], ['var', 'finalHeight']]], ['*', ['var', 'minFloor'], 3.5],
      0
    ]
  ]
]);

export function deriveOvertureBuildingsPmtilesUrl(release) {
  if (typeof release !== 'string' || !OVERTURE_PMTILES_RELEASE_PATTERN.test(release)) {
    throw new TypeError(`Invalid Overture release: ${release}.`);
  }
  return `${OVERTURE_HOST}/tiles/${release}/buildings.pmtiles`;
}

export function createOverturePmtilesArchiveBinding({ settings, resources, resolvePmtilesAssetFile }) {
  const source = settings?.buildingSource ?? 'local-geojson';
  if (source === 'local-geojson') return null;
  const release = settings.overtureRelease ?? '2026-08-19.0';
  if (source === 'overture-pmtiles') {
    const url = deriveOvertureBuildingsPmtilesUrl(release);
    return Object.freeze({ kind: 'url', source, release, url, bounds: null, key: url });
  }
  if (source !== 'project-snapshot') throw new TypeError('Invalid urban context building source.');
  const snapshot = settings.snapshot;
  const resource = resources?.get(snapshot?.asset);
  if (resource?.descriptor?.type !== 'pmtiles' || resource.descriptor.mediaType !== 'application/vnd.pmtiles') {
    throw new TypeError('A validated PMTiles resource is required for the project snapshot.');
  }
  const bounds = Object.freeze([...snapshot.bounds]);
  const key = `snapshot:${snapshot.sha256}`;
  const file = resolvePmtilesAssetFile?.(resource.url, { id: resource.id, descriptor: resource.descriptor });
  if (typeof File === 'function' && file instanceof File) {
    return Object.freeze({ kind: 'file', source, release, file, bounds, key });
  }
  return Object.freeze({ kind: 'url', source, release, url: String(resource.url), bounds, key });
}

export async function loadPmtilesBrowser({
  documentRef = globalThis.document,
  globalRef = globalThis
} = {}) {
  if (typeof globalRef?.pmtiles?.Protocol === 'function') {
    return globalRef.pmtiles;
  }
  if (pmtilesLoadPromise) return pmtilesLoadPromise;
  if (!documentRef?.head || typeof documentRef.createElement !== 'function') {
    throw new TypeError('A browser document is required to load PMTiles.');
  }

  pmtilesLoadPromise = new Promise((resolve, reject) => {
    const script = documentRef.createElement('script');
    script.src = PMTILES_VENDOR_URL.href;
    script.async = true;
    script.onload = () => {
      if (typeof globalRef?.pmtiles?.Protocol !== 'function') {
        reject(new TypeError('The local PMTiles browser bundle did not expose Protocol.'));
        return;
      }
      resolve(globalRef.pmtiles);
    };
    script.onerror = () => reject(new TypeError('The local PMTiles browser bundle failed to load.'));
    documentRef.head.append(script);
  });

  return pmtilesLoadPromise;
}

export async function ensurePmtilesProtocol(maplibregl, {
  loadPmtiles = loadPmtilesBrowser
} = {}) {
  if (!maplibregl || typeof maplibregl.addProtocol !== 'function') {
    throw new TypeError('MapLibre with addProtocol is required.');
  }
  const existing = protocolByMapLibre.get(maplibregl);
  if (existing) return existing;

  const installPromise = (async () => {
    const pmtiles = await loadPmtiles();
    if (typeof pmtiles?.Protocol !== 'function') {
      throw new TypeError('PMTiles Protocol is unavailable.');
    }
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    return protocol;
  })();
  protocolByMapLibre.set(maplibregl, installPromise);
  try {
    return await installPromise;
  } catch (error) {
    protocolByMapLibre.delete(maplibregl);
    throw error;
  }
}

export async function ensurePmtilesArchive(maplibregl, binding, {
  loadPmtiles = loadPmtilesBrowser
} = {}) {
  const protocol = await ensurePmtilesProtocol(maplibregl, { loadPmtiles });
  if (binding.kind === 'url') return { protocol, archiveUrl: binding.url };
  let archives = archivesByProtocol.get(protocol);
  if (!archives) {
    archives = new Map();
    archivesByProtocol.set(protocol, archives);
  }
  if (!archives.has(binding.key)) {
    archives.set(binding.key, (async () => {
      const pmtiles = await loadPmtiles();
      const alias = new File([binding.file], `overture-buildings-${binding.key.slice('snapshot:'.length)}.pmtiles`, {
        type: 'application/vnd.pmtiles'
      });
      const archive = new pmtiles.PMTiles(new pmtiles.FileSource(alias));
      protocol.add(archive);
      return archive.source.getKey();
    })());
  }
  return { protocol, archiveUrl: await archives.get(binding.key) };
}

export function createOverturePmtilesLayerDefinitions({ release, archiveUrl, bounds } = {}) {
  const resolvedArchiveUrl = archiveUrl ?? deriveOvertureBuildingsPmtilesUrl(release);
  return {
    source: {
      type: 'vector',
      url: `pmtiles://${resolvedArchiveUrl}`,
      attribution: '© <a href="https://overturemaps.org/">Overture Maps Foundation</a>',
      ...(bounds ? { bounds: [...bounds] } : {})
    },
    flat: {
      id: OVERTURE_PMTILES_FLAT_LAYER_ID,
      type: 'fill',
      source: OVERTURE_BUILDING_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 11,
      maxzoom: 14,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': '#748a9c',
        'fill-opacity': 0.14
      }
    },
    extrusion: {
      id: OVERTURE_BUILDING_LAYER_ID,
      type: 'fill-extrusion',
      source: OVERTURE_BUILDING_SOURCE_ID,
      'source-layer': 'building',
      minzoom: 14,
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': '#8298aa',
        'fill-extrusion-height': HEIGHT_EXPRESSION,
        'fill-extrusion-base': BASE_EXPRESSION,
        'fill-extrusion-opacity': 0.78,
        'fill-extrusion-vertical-gradient': true
      }
    }
  };
}
