const EPSG_CODE = /^EPSG:\d+$/i;
const SUPPORTED_GEOMETRIES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'
]);

function clone(value) {
  return structuredClone(value);
}

export function resolveLocalCrs(value, proj4) {
  if (typeof proj4 !== 'function' || typeof proj4.defs !== 'function') throw new TypeError('A local proj4 parser is required.');
  const input = String(value ?? '').trim();
  if (!input) throw new TypeError('Source CRS is required.');
  const code = EPSG_CODE.test(input) ? input.toUpperCase() : input;
  if (EPSG_CODE.test(code) && !proj4.defs(code)) {
    throw new TypeError(`Projection definition for ${code} is not available locally.`);
  }
  try {
    const projection = new proj4.Proj(code);
    return { code, definition: proj4.defs(code) ?? code, label: code, projection };
  } catch (error) {
    throw new TypeError(`Projection definition for ${code} is not available locally.`, { cause: error });
  }
}

function visitPositions(geometry, callback, depth = 0) {
  if (depth > 64) throw new TypeError('GeoJSON geometry nesting exceeds the safety limit.');
  if (!geometry || typeof geometry !== 'object') throw new TypeError('GeoJSON geometry must be an object.');
  if (geometry.type === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries)) throw new TypeError('GeometryCollection geometries must be an array.');
    return { ...geometry, geometries: geometry.geometries.map((child) => visitPositions(child, callback, depth + 1)) };
  }
  if (!SUPPORTED_GEOMETRIES.has(geometry.type)) throw new TypeError(`Unsupported GeoJSON geometry: ${geometry.type}.`);
  const positionDepth = geometry.type === 'Point' ? 0
    : ['MultiPoint', 'LineString'].includes(geometry.type) ? 1
      : ['MultiLineString', 'Polygon'].includes(geometry.type) ? 2 : 3;
  function walk(value, remaining) {
    if (remaining === 0) return callback(value);
    if (!Array.isArray(value)) throw new TypeError('GeoJSON coordinates have invalid nesting.');
    return value.map((child) => walk(child, remaining - 1));
  }
  return { ...geometry, coordinates: walk(geometry.coordinates, positionDepth) };
}

function assertPosition(position) {
  if (!Array.isArray(position) || position.length < 2) throw new TypeError('GeoJSON position requires X and Y coordinates.');
  const [longitude, latitude] = position;
  if (typeof longitude !== 'number' || typeof latitude !== 'number' || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new TypeError('GeoJSON coordinates must be finite numbers.');
  }
  if (longitude < -180 || longitude > 180) throw new TypeError(`GeoJSON longitude is outside -180..180: ${longitude}.`);
  if (latitude < -90 || latitude > 90) throw new TypeError(`GeoJSON latitude is outside -90..90: ${latitude}.`);
  return position.slice();
}

function mapCollection(collection, callback) {
  if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new TypeError('Spatial conversion requires a GeoJSON FeatureCollection.');
  }
  return {
    type: 'FeatureCollection',
    features: collection.features.map((feature) => {
      if (!feature || feature.type !== 'Feature' || !feature.geometry) throw new TypeError('Spatial conversion requires Features with geometry.');
      return { ...clone(feature), geometry: visitPositions(feature.geometry, callback) };
    })
  };
}

export function assertWgs84Coordinates(collection) {
  return mapCollection(collection, assertPosition);
}

export function reprojectFeatureCollection(collection, { sourceCrs, proj4 }) {
  const source = resolveLocalCrs(sourceCrs, proj4);
  const output = source.code === 'EPSG:4326'
    ? clone(collection)
    : mapCollection(collection, (position) => {
      if (!Array.isArray(position) || position.length < 2) throw new TypeError('GeoJSON position requires X and Y coordinates.');
      const [x, y, ...later] = position;
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError('Source coordinates must be finite numbers.');
      }
      const [longitude, latitude] = proj4(source.code, 'EPSG:4326', [x, y]);
      return [longitude, latitude, ...later];
    });
  return assertWgs84Coordinates(output);
}
