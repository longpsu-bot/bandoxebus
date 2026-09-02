import { assertWgs84Coordinates, reprojectFeatureCollection, resolveLocalCrs } from './crs.js';
import { createImportId, friendlyLabel } from './import-identifiers.js';
import { normalizeSpatialSource } from './spatial-normalizer.js';

function sourceCrsFor(srs) {
  const organization = String(srs?.organization ?? '').trim().toUpperCase();
  const id = Number(srs?.organization_coordsys_id);
  if (organization && Number.isInteger(id)) return `${organization}:${id}`;
  const definition = String(srs?.definition ?? '').trim();
  if (definition) return definition;
  throw new TypeError('GeoPackage feature table has no usable source SRS metadata.');
}

function firstPosition(geometry) {
  if (!geometry) return undefined;
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries ?? []) {
      const result = firstPosition(child);
      if (result) return result;
    }
    return undefined;
  }
  let value = geometry.coordinates;
  while (Array.isArray(value) && Array.isArray(value[0])) value = value[0];
  return Array.isArray(value) && value.length >= 2 ? value : undefined;
}

function scalarProperties(values, geometryColumn) {
  const result = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (key === geometryColumn) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) result[key] = value;
  }
  return result;
}

function verifyProjection(rawGeometry, outputGeometry, { sourceCrs, proj4 }) {
  const raw = firstPosition(rawGeometry);
  const output = firstPosition(outputGeometry);
  if (!raw || !output) return;
  const source = resolveLocalCrs(sourceCrs, proj4);
  const expected = source.code === 'EPSG:4326' ? raw : proj4(source.code, 'EPSG:4326', raw.slice(0, 2));
  if (!Number.isFinite(output[0]) || !Number.isFinite(output[1])
    || Math.abs(expected[0] - output[0]) > 1e-7
    || Math.abs(expected[1] - output[1]) > 1e-7) {
    throw new TypeError(`Could not verify GeoPackage output as EPSG:4326 from ${source.code}.`);
  }
}

export async function openGeoPackageSource(bytes, {
  geoPackageApi,
  proj4,
  label = 'GeoPackage',
  usedIds = []
} = {}) {
  if (!geoPackageApi?.GeoPackageAPI?.open) {
    throw new TypeError('GeoPackage JS is required for GeoPackage import.');
  }
  resolveLocalCrs('EPSG:4326', proj4);
  let inventory;
  let tableNames;
  try {
    inventory = await geoPackageApi.GeoPackageAPI.open(bytes);
    tableNames = inventory.getFeatureTables();
  } finally {
    inventory?.close?.();
  }
  if (!Array.isArray(tableNames) || !tableNames.length) throw new TypeError('GeoPackage contains no feature tables.');
  const occupied = [...usedIds];
  const sourceItems = tableNames.map((tableName) => {
    const itemLabel = friendlyLabel(tableName);
    const id = createImportId(itemLabel, occupied);
    occupied.push(id);
    return Object.freeze({ id, label: itemLabel, tableName });
  });
  let disposed = false;
  let activeConnection = null;
  return Object.freeze({
    sourceItems: Object.freeze(sourceItems),
    async prepare(itemId, { sourceCrs: sourceCrsOverride } = {}) {
      if (disposed) throw new TypeError('GeoPackage source is already closed.');
      const item = sourceItems.find(({ id }) => id === itemId);
      if (!item) throw new TypeError(`Unknown GeoPackage feature table: ${itemId}.`);
      const features = [];
      let iterator;
      let sourceCrs;
      let verified = false;
      try {
        activeConnection = await geoPackageApi.GeoPackageAPI.open(bytes);
        const dao = activeConnection.getFeatureDao(item.tableName);
        const reprojectFeature = geoPackageApi.FeatureDao?.reprojectFeature ?? dao?.constructor?.reprojectFeature;
        if (!sourceCrsOverride && typeof reprojectFeature !== 'function') {
          throw new TypeError('GeoPackage JS cannot reproject feature geometry.');
        }
        sourceCrs = sourceCrsOverride || sourceCrsFor(dao.srs);
        resolveLocalCrs(sourceCrs, proj4);
        const geometryColumn = dao.getGeometryColumnName();
        iterator = dao.queryForEach()[Symbol.iterator]();
        for (let next = iterator.next(); !next.done; next = iterator.next()) {
          const row = dao.getRow(next.value);
          if (!row?.geometry) continue;
          const rawGeometry = row.geometry.toGeoJSON();
          const outputGeometry = sourceCrsOverride
            ? rawGeometry
            : reprojectFeature(row, dao.srs, dao.projection);
          if (!sourceCrsOverride && !verified) {
            verifyProjection(rawGeometry, outputGeometry, { sourceCrs, proj4 });
            verified = true;
          }
          const feature = {
            type: 'Feature',
            properties: scalarProperties(row.values, geometryColumn),
            geometry: outputGeometry
          };
          if (row.id !== undefined && row.id !== null) feature.id = row.id;
          features.push(feature);
        }
        if (!features.length) throw new TypeError(`GeoPackage feature table ${item.tableName} contains no usable geometry.`);
        const rawCollection = { type: 'FeatureCollection', features };
        const collection = sourceCrsOverride
          ? reprojectFeatureCollection(rawCollection, { sourceCrs, proj4 })
          : assertWgs84Coordinates(rawCollection);
        return normalizeSpatialSource(collection, {
          label: item.label,
          id: item.id,
          sourceFormat: 'GeoPackage',
          sourceCrs,
          usedIds
        }).map((candidate) => Object.freeze({
          ...candidate,
          coordinateState: 'wgs84',
          reprojected: sourceCrs !== 'EPSG:4326'
        }));
      } finally {
        iterator?.return?.();
        activeConnection?.close?.();
        activeConnection = null;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activeConnection?.close?.();
      activeConnection = null;
    }
  });
}
