import { assertWgs84Coordinates, reprojectFeatureCollection } from './crs.js';
import { createImportId, friendlyLabel } from './import-identifiers.js';
import { normalizeSpatialSource } from './spatial-normalizer.js';

const decoder = new TextDecoder('utf-8', { fatal: true });
const XML_LIMIT = 128 * 1024 * 1024;

function checkedItem(sourceItems, itemId) {
  const item = sourceItems.find(({ id }) => id === itemId);
  if (!item) throw new TypeError(`Unknown source item: ${itemId}.`);
  return item;
}

function xmlDocument(bytes, { format, domParser }) {
  if (bytes.byteLength > XML_LIMIT) throw new TypeError('XML source exceeds the 128 MiB limit.');
  const text = decoder.decode(bytes);
  if (/<!DOCTYPE/i.test(text)) throw new TypeError('DOCTYPE is unsupported in spatial XML.');
  if (!domParser?.parseFromString) throw new TypeError('A browser DOMParser is required for KML and GPX import.');
  const document = domParser.parseFromString(text, 'application/xml');
  const parserErrors = typeof document?.querySelectorAll === 'function' ? document.querySelectorAll('parsererror') : [];
  if (!document?.documentElement || parserErrors.length) throw new TypeError(`Invalid ${format.toUpperCase()} XML document.`);
  if (String(document.documentElement.localName ?? '').toLowerCase() !== format) {
    throw new TypeError(`Expected ${format} root element.`);
  }
  return document;
}

function decorateSpatial(candidates, metadata) {
  return candidates.map((candidate) => Object.freeze({ ...candidate, ...metadata }));
}

function parseXml(bytes, { format, domParser, toGeoJson }) {
  const parser = toGeoJson?.[format];
  if (typeof parser !== 'function') throw new TypeError(`togeojson does not provide a ${format.toUpperCase()} parser.`);
  const value = parser(xmlDocument(bytes, { format, domParser }));
  if (!value || value.type !== 'FeatureCollection') throw new TypeError(`${format.toUpperCase()} parser did not return GeoJSON.`);
  return value;
}

function spatialSource({ sourceItems, prepare }) {
  return Object.freeze({ sourceItems: Object.freeze(sourceItems), prepare, dispose() {} });
}

export async function openXmlSpatialSource(file, {
  format,
  domParser = globalThis.DOMParser ? new globalThis.DOMParser() : undefined,
  toGeoJson,
  usedIds = []
} = {}) {
  if (!['kml', 'gpx'].includes(format)) throw new TypeError('XML spatial import supports KML or GPX.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const label = friendlyLabel(file.name);
  const id = createImportId(label, usedIds);
  const sourceItems = [{ id, label }];
  return spatialSource({
    sourceItems,
    async prepare(itemId) {
      checkedItem(sourceItems, itemId);
      const value = parseXml(bytes, { format, domParser, toGeoJson });
      return decorateSpatial(normalizeSpatialSource(value, {
        label, id, sourceFormat: format.toUpperCase(), sourceCrs: 'EPSG:4326', usedIds
      }), { coordinateState: 'wgs84', reprojected: false });
    }
  });
}

export async function openKmzSource(detection, {
  domParser = globalThis.DOMParser ? new globalThis.DOMParser() : undefined,
  toGeoJson,
  usedIds = []
} = {}) {
  if (detection?.format !== 'kmz' || !Array.isArray(detection.items)) throw new TypeError('KMZ detection is required.');
  const occupied = [...usedIds];
  const sourceItems = detection.items.map(({ id: sourceId, path, bytes }) => {
    const label = friendlyLabel(path);
    const id = createImportId(label, occupied);
    occupied.push(id);
    return Object.freeze({ id: sourceId, label, candidateId: id, path, bytes });
  });
  return spatialSource({
    sourceItems,
    async prepare(itemId) {
      const item = checkedItem(sourceItems, itemId);
      const value = parseXml(item.bytes, { format: 'kml', domParser, toGeoJson });
      return decorateSpatial(normalizeSpatialSource(value, {
        label: item.label,
        id: item.candidateId,
        sourceFormat: 'KMZ',
        sourceCrs: 'EPSG:4326',
        usedIds
      }), { coordinateState: 'wgs84', reprojected: false });
    }
  });
}

function componentObject(files, { includePrj }) {
  const result = { shp: files.shp };
  if (files.dbf) result.dbf = files.dbf;
  if (includePrj && files.prj) result.prj = files.prj;
  if (files.cpg) result.cpg = files.cpg;
  return result;
}

function candidateWarnings(candidates, warnings) {
  if (!warnings.length) return candidates;
  return candidates.map((candidate) => Object.freeze({ ...candidate, warnings: [...candidate.warnings, ...warnings] }));
}

export async function openShapefileSource(detection, { shp, proj4, usedIds = [] } = {}) {
  if (detection?.format !== 'shapefile' || !Array.isArray(detection.groups) || !detection.groups.length) {
    throw new TypeError('Shapefile detection with at least one .shp group is required.');
  }
  if (typeof shp !== 'function') throw new TypeError('shpjs is required for Shapefile import.');
  const occupied = [...usedIds];
  const sourceItems = detection.groups.map((group) => {
    const label = friendlyLabel(group.basename);
    const id = createImportId(label, occupied);
    occupied.push(id);
    return Object.freeze({ id, label, group });
  });
  return spatialSource({
    sourceItems,
    async prepare(itemId, { crsMode, sourceCrs, proj4: configuredProj4 } = {}) {
      const item = checkedItem(sourceItems, itemId);
      const hasPrj = Boolean(item.group.files.prj);
      const mode = crsMode ?? (hasPrj ? 'prj' : undefined);
      if (!mode) throw new TypeError('Source CRS is required; explicitly assume EPSG:4326 or choose a local CRS.');
      if (!['prj', 'manual', 'assume-4326'].includes(mode)) throw new TypeError(`Unsupported Shapefile CRS mode: ${mode}.`);
      if (mode === 'prj' && !hasPrj) throw new TypeError('This Shapefile has no PRJ component.');
      if (mode === 'manual' && !sourceCrs) throw new TypeError('Manual Shapefile import requires a Source CRS.');

      const parsed = await shp(componentObject(item.group.files, { includePrj: mode === 'prj' }));
      const collection = mode === 'manual'
        ? reprojectFeatureCollection(parsed, { sourceCrs, proj4: configuredProj4 ?? proj4 })
        : assertWgs84Coordinates(parsed);
      const normalizedSourceCrs = mode === 'manual' ? sourceCrs : 'EPSG:4326';
      let candidates = normalizeSpatialSource(collection, {
        label: item.label,
        id: item.id,
        sourceFormat: 'Shapefile',
        sourceCrs: normalizedSourceCrs,
        usedIds
      });
      const warnings = [];
      if (!item.group.files.dbf) warnings.push('No DBF attributes file was provided; geometry will be imported without Shapefile attributes.');
      if (mode === 'assume-4326') warnings.push('Source coordinates were explicitly assumed EPSG:4326 because no PRJ was provided.');
      candidates = candidateWarnings(candidates, warnings);
      return decorateSpatial(candidates, {
        coordinateState: 'wgs84',
        reprojected: mode === 'prj' || mode === 'manual',
        sourceCrs: mode === 'prj' ? 'Shapefile PRJ (converted to EPSG:4326 by shpjs)' : normalizedSourceCrs
      });
    }
  });
}

export async function openGeoJsonSource(detection, { usedIds = [] } = {}) {
  if (detection?.format !== 'geojson' || detection.jsonKind !== 'spatial') throw new TypeError('GeoJSON detection is required.');
  const label = friendlyLabel(detection.files[0].name);
  const id = createImportId(label, usedIds);
  const sourceItems = [{ id, label }];
  return spatialSource({
    sourceItems,
    async prepare(itemId) {
      checkedItem(sourceItems, itemId);
      return decorateSpatial(normalizeSpatialSource(detection.value, {
        label, id, sourceFormat: 'GeoJSON', sourceCrs: 'EPSG:4326', usedIds
      }), { coordinateState: 'wgs84', reprojected: false });
    }
  });
}
