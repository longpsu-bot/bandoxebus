import { DATA_IMPORT_ZIP_LIMITS, readSafeZipEntries } from '../core/safe-zip.js';
import { validateTableData } from '../../src/project/resource-schemas.js';
import { vendorLoaders } from './vendor-loaders.js';
import { openGeoPackageSource } from './geopackage-adapter.js';
import { createDataImportWorkerClient, selectDataImportExecution } from './data-import-worker-client.js';
import { friendlyLabel } from './import-identifiers.js';
import { openGeoJsonSource, openKmzSource, openShapefileSource, openXmlSpatialSource } from './spatial-adapters.js';
import { openCsvSource, openJsonTableSource, openXlsxSource } from './table-adapters.js';

const MIB = 1024 * 1024;
const SUPPORTED_MESSAGE = 'Supported formats: GeoJSON/JSON, KML/KMZ, Shapefile, GeoPackage, CSV, Excel XLSX, and GPX.';
const XML_ROOT = /<\s*(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b/i;
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0');

export const DATA_FILE_LIMITS = Object.freeze({
  maxFileBytes: 512 * MIB,
  maxAggregateBytes: 768 * MIB,
  maxFiles: 256,
  maxXmlBytes: 128 * MIB
});

function extension(name) {
  const match = /(?:^|\/)([^/]+?)(\.[^.\/]+)$/.exec(String(name ?? '').replaceAll('\\', '/'));
  return match ? match[2].toLowerCase() : '';
}

function assertSelectionLimits(files) {
  if (!Array.isArray(files) || !files.length) throw new TypeError('Choose at least one data file.');
  if (files.length > DATA_FILE_LIMITS.maxFiles) throw new TypeError(`Select no more than ${DATA_FILE_LIMITS.maxFiles} loose files.`);
  let total = 0;
  for (const input of files) {
    const size = Number(input?.size);
    if (!input?.name || !Number.isFinite(size) || size < 0 || typeof input.arrayBuffer !== 'function') {
      throw new TypeError('Selected data includes an invalid local file.');
    }
    if (size > DATA_FILE_LIMITS.maxFileBytes) throw new TypeError(`${input.name} is too large; the direct file limit is 512 MiB.`);
    total += size;
  }
  if (total > DATA_FILE_LIMITS.maxAggregateBytes) throw new TypeError('The selected loose files exceed the 768 MiB aggregate limit.');
}

async function bytesOf(input) {
  return new Uint8Array(await input.arrayBuffer());
}

function decode(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function assertXml(bytes, expectedRoot, name) {
  if (bytes.byteLength > DATA_FILE_LIMITS.maxXmlBytes) throw new TypeError(`${name} exceeds the 128 MiB XML limit.`);
  const text = decode(bytes);
  if (/<!DOCTYPE/i.test(text)) throw new TypeError(`DOCTYPE is unsupported in ${name}.`);
  const withoutDeclaration = text.replace(/^\s*<\?xml[^>]*\?>/i, '');
  const root = XML_ROOT.exec(withoutDeclaration)?.[1]?.toLowerCase();
  if (root !== expectedRoot) throw new TypeError(`Expected ${expectedRoot} root element in ${name}.`);
  return text;
}

function classifyJson(value) {
  if (value?.type === 'Feature' || (value?.type === 'FeatureCollection' && Array.isArray(value.features))) return 'spatial';
  if (Array.isArray(value) && value.length && value.every((record) => record && typeof record === 'object' && !Array.isArray(record))) return 'records';
  try {
    validateTableData(value);
    return 'normalized-table';
  } catch {
    throw new TypeError('Unsupported JSON data shape; expected GeoJSON, table-data-v1, or an array of scalar records.');
  }
}

function normalizedArchiveStem(path) {
  return path.replace(/\.[^.\/]+$/, '').toLowerCase();
}

function groupComponents(entries, pathKey = 'path', valueKey = 'bytes') {
  const groups = new Map();
  for (const entry of entries) {
    const path = String(entry[pathKey]);
    const ext = extension(path).slice(1);
    if (!['shp', 'dbf', 'prj', 'cpg'].includes(ext)) continue;
    const stem = normalizedArchiveStem(path);
    const leaf = stem.split('/').pop();
    if (!groups.has(stem)) groups.set(stem, { basename: leaf, files: {} });
    const group = groups.get(stem);
    if (group.files[ext]) throw new TypeError(`Duplicate Shapefile component for ${path}.`);
    group.files[ext] = entry[valueKey];
  }
  const result = [...groups.values()].filter(({ files }) => files.shp);
  result.sort((a, b) => a.basename.localeCompare(b.basename, 'en'));
  return result;
}

function hasPrefix(bytes, prefix) {
  return prefix.every((value, index) => bytes[index] === value);
}

async function detectJson(input, ext) {
  let value;
  try {
    value = JSON.parse(decode(await bytesOf(input)));
  } catch (error) {
    throw new TypeError(`Invalid JSON in ${input.name}.`, { cause: error });
  }
  const jsonKind = classifyJson(value);
  if (ext === '.geojson' && jsonKind !== 'spatial') throw new TypeError(`${input.name} is not GeoJSON.`);
  return { format: jsonKind === 'spatial' ? 'geojson' : 'json', jsonKind, files: [input], value };
}

async function detectArchive(input, ext) {
  const entries = readSafeZipEntries(await bytesOf(input), { limits: DATA_IMPORT_ZIP_LIMITS, caseInsensitivePaths: true });
  if (ext === '.xlsx') {
    const names = new Set(entries.map(({ path }) => path.toLowerCase()));
    if (!names.has('[content_types].xml') || !names.has('xl/workbook.xml')) throw new TypeError(`${input.name} is not a supported XLSX OOXML workbook.`);
    return { format: 'xlsx', files: [input] };
  }
  if (ext === '.kmz') {
    const items = entries
      .filter(({ path }) => extension(path) === '.kml')
      .map((entry) => ({ id: entry.path, path: entry.path, bytes: entry.bytes }));
    if (!items.length) throw new TypeError(`${input.name} contains no KML document.`);
    const preferred = items.find(({ path }) => path.toLowerCase() === 'doc.kml') ?? items[0];
    return { format: 'kmz', files: [input], items, preferredItemId: preferred.id };
  }
  const groups = groupComponents(entries);
  if (!groups.length) throw new TypeError(`Unsupported ZIP contents. ${SUPPORTED_MESSAGE}`);
  return { format: 'shapefile', files: [input], groups };
}

export async function detectDataFiles(selectedFiles) {
  const files = Array.from(selectedFiles ?? []);
  assertSelectionLimits(files);
  const extensions = files.map(({ name }) => extension(name));
  const looseShapeExtensions = new Set(['.shp', '.dbf', '.prj', '.cpg']);
  if (files.length > 1 || looseShapeExtensions.has(extensions[0])) {
    if (!extensions.every((ext) => looseShapeExtensions.has(ext))) throw new TypeError(`A selection may contain one source format at a time. ${SUPPORTED_MESSAGE}`);
    const entries = await Promise.all(files.map(async (input) => ({ path: input.name, input, bytes: await bytesOf(input) })));
    const groups = groupComponents(entries, 'path', 'bytes');
    if (!groups.length) throw new TypeError('A loose Shapefile selection requires a .shp file.');
    return { format: 'shapefile', files, groups };
  }

  const input = files[0];
  const ext = extensions[0];
  if (ext === '.geojson' || ext === '.json') return detectJson(input, ext);
  if (ext === '.kml' || ext === '.gpx') {
    const bytes = await bytesOf(input);
    const root = ext.slice(1);
    assertXml(bytes, root, input.name);
    return { format: root, files, bytes };
  }
  if (ext === '.kmz' || ext === '.zip' || ext === '.xlsx') return detectArchive(input, ext);
  if (ext === '.gpkg') {
    const bytes = await bytesOf(input);
    if (!hasPrefix(bytes, SQLITE_HEADER)) throw new TypeError(`${input.name} does not have a valid SQLite header.`);
    return { format: 'geopackage', files, bytes };
  }
  if (ext === '.csv') return { format: 'csv', files };
  throw new TypeError(`${input.name} is unsupported. ${SUPPORTED_MESSAGE}`);
}

function publicSourceItem(item) {
  return Object.freeze(Object.fromEntries(Object.entries(item).filter(([key]) => !['bytes', 'grid', 'group'].includes(key))));
}

function replacementError(candidate, replacement) {
  if (!replacement) return undefined;
  const replacementKind = replacement.kind ?? (replacement.type === 'geojson' ? 'spatial'
    : replacement.type === 'table-json' ? 'table' : undefined);
  if (candidate.kind !== replacementKind) return `Replacement is incompatible; expected ${replacementKind} data.`;
  if (candidate.kind === 'spatial' && candidate.geometry !== replacement.geometry) {
    return `Replacement is incompatible; expected ${replacement.geometry} geometry.`;
  }
  return undefined;
}

export function createDataImportSession({
  files,
  loaders = vendorLoaders,
  usedIds = [],
  replacement,
  domParser = globalThis.DOMParser ? new globalThis.DOMParser() : undefined,
  onStatus = () => {}
} = {}) {
  let disposed = false;
  let status = 'idle';
  let detection;
  let source;
  let sourceItems = [];
  let selectedItemId;
  let config = {};
  let candidates = [];

  function assertActive() {
    if (disposed) throw new TypeError('Data import session is disposed.');
  }
  function setStatus(value) {
    status = value;
    onStatus(value);
  }
  async function openDetectedSource() {
    switch (detection.format) {
      case 'geojson':
        return openGeoJsonSource(detection, { usedIds });
      case 'json':
        return openJsonTableSource(detection, { usedIds });
      case 'csv':
        return openCsvSource(detection.files[0], { papa: await loaders.loadPapaParse(), usedIds });
      case 'xlsx':
        return openXlsxSource(new Uint8Array(await detection.files[0].arrayBuffer()), { sheetJs: await loaders.loadSheetJs(), usedIds });
      case 'kml':
      case 'gpx':
        return openXmlSpatialSource(detection.files[0], {
          format: detection.format,
          domParser,
          toGeoJson: await loaders.loadToGeoJson(),
          usedIds
        });
      case 'kmz':
        return openKmzSource(detection, { domParser, toGeoJson: await loaders.loadToGeoJson(), usedIds });
      case 'shapefile':
        return openShapefileSource(detection, { shp: await loaders.loadShp(), usedIds });
      case 'geopackage':
        return openGeoPackageSource(detection.bytes, {
          geoPackageApi: await loaders.loadGeoPackage(),
          proj4: await loaders.loadProj4(),
          label: friendlyLabel(detection.files[0].name),
          usedIds
        });
      default:
        throw new TypeError(`No adapter exists for ${detection.format}.`);
    }
  }

  return Object.freeze({
    async read() {
      assertActive();
      if (source) return sourceItems.map(publicSourceItem);
      setStatus('reading');
      try {
        detection = await detectDataFiles(files);
        source = await openDetectedSource();
        sourceItems = [...source.sourceItems];
        setStatus('ready');
        return sourceItems.map(publicSourceItem);
      } catch (error) {
        status = 'error';
        source?.dispose?.();
        throw error;
      }
    },
    selectSourceItem(itemId) {
      assertActive();
      if (!sourceItems.some(({ id }) => id === itemId)) throw new TypeError(`Unknown source item: ${itemId}.`);
      selectedItemId = itemId;
      candidates = [];
    },
    configure(patch) {
      assertActive();
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Import configuration must be an object.');
      config = { ...config, ...patch };
      candidates = [];
    },
    async prepare() {
      assertActive();
      if (!source) throw new TypeError('Read the selected data before preparing it.');
      if (!selectedItemId) throw new TypeError('Select a source item before preparing data.');
      setStatus('preparing');
      try {
        const preparedConfig = { ...config };
        if ((detection.format === 'csv' && preparedConfig.mode === 'points')
          || (detection.format === 'shapefile' && preparedConfig.crsMode === 'manual')
          || (['geojson', 'kml', 'kmz', 'gpx'].includes(detection.format)
            && preparedConfig.sourceCrs && preparedConfig.sourceCrs !== 'EPSG:4326')) {
          preparedConfig.proj4 = await loaders.loadProj4();
        }
        const result = await source.prepare(selectedItemId, preparedConfig);
        candidates = Array.isArray(result) ? [...result] : [result];
        setStatus('prepared');
        return [...candidates];
      } catch (error) {
        status = 'error';
        throw error;
      }
    },
    candidate(candidateId) {
      assertActive();
      const candidate = candidates.find(({ id }) => id === candidateId);
      if (!candidate) throw new TypeError(`Unknown prepared candidate: ${candidateId}.`);
      const incompatible = replacementError(candidate, replacement);
      if (incompatible) throw new TypeError(incompatible);
      return candidate;
    },
    state() {
      return Object.freeze({
        status,
        disposed,
        format: detection?.format,
        sourceItems: sourceItems.map(publicSourceItem),
        selectedItemId,
        config: Object.freeze({ ...config }),
        candidates: candidates.map((candidate) => Object.freeze({ ...candidate, value: candidate.value }))
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      status = 'disposed';
      source?.dispose?.();
      candidates = [];
    }
  });
}

export function createResponsiveDataImportSession({
  directFactory = createDataImportSession,
  workerFactory = createDataImportWorkerClient,
  ...options
} = {}) {
  return selectDataImportExecution(options.files) === 'main-thread-xml'
    ? directFactory(options)
    : workerFactory(options);
}
