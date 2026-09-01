const VENDOR_PATHS = Object.freeze({
  toGeoJson: '../../vendor/data-import/togeojson/7.1.2/togeojson.es.mjs',
  shp: '../../vendor/data-import/shpjs/6.2.0/shp.esm.min.js',
  proj4: '../../vendor/data-import/proj4/2.22.0/proj4.js',
  papaParse: '../../vendor/data-import/papaparse/5.7.0/papaparse.min.js',
  sheetJs: '../../vendor/data-import/sheetjs/0.20.3/xlsx.mjs',
  geoPackage: '../../vendor/data-import/geopackage/4.2.9/geopackage.min.js',
  geoPackageWasm: '../../vendor/data-import/geopackage/4.2.9/sql-wasm.wasm'
});

function defaultLoadScript(url, documentRef) {
  return new Promise((resolve, reject) => {
    if (!documentRef?.createElement || !documentRef.head?.append) {
      reject(new TypeError(`Cannot load browser script without a document: ${url}`));
      return;
    }
    const script = documentRef.createElement('script');
    script.src = url;
    script.async = true;
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new TypeError(`Failed to load local parser: ${url}`)), { once: true });
    documentRef.head.append(script);
  });
}

function requiredGlobal(globalRef, name) {
  const value = globalRef?.[name];
  if (!value) throw new TypeError(`Local parser did not expose ${name}.`);
  return value;
}

export function createVendorLoaders({
  documentRef = globalThis.document,
  globalRef = globalThis,
  importModule = (url) => import(url),
  resolveUrl = (url) => new URL(url, import.meta.url).href,
  loadScript = (url) => defaultLoadScript(url, documentRef)
} = {}) {
  const cache = new Map();
  function cached(name, load) {
    if (cache.has(name)) return cache.get(name);
    const promise = Promise.resolve().then(load);
    cache.set(name, promise);
    promise.catch(() => {
      if (cache.get(name) === promise) cache.delete(name);
    });
    return promise;
  }
  function module(name, path, select = (value) => value) {
    return cached(name, async () => select(await importModule(resolveUrl(path))));
  }
  function browserGlobal(name, path, globalName, prepare = (value) => value) {
    return cached(name, async () => {
      await loadScript(resolveUrl(path));
      return prepare(requiredGlobal(globalRef, globalName));
    });
  }

  return Object.freeze({
    loadToGeoJson: () => module('togeojson', VENDOR_PATHS.toGeoJson),
    loadShp: () => module('shpjs', VENDOR_PATHS.shp, (value) => value.default ?? value),
    loadProj4: () => browserGlobal('proj4', VENDOR_PATHS.proj4, 'proj4'),
    loadPapaParse: () => browserGlobal('papaparse', VENDOR_PATHS.papaParse, 'Papa'),
    loadSheetJs: () => module('sheetjs', VENDOR_PATHS.sheetJs),
    loadGeoPackage: () => browserGlobal('geopackage', VENDOR_PATHS.geoPackage, 'GeoPackage', (api) => {
      if (typeof api.setSqljsWasmLocateFile !== 'function') {
        throw new TypeError('Local GeoPackage parser cannot configure SQL.js WASM.');
      }
      api.setSqljsWasmLocateFile(() => resolveUrl(VENDOR_PATHS.geoPackageWasm));
      return api;
    })
  });
}

export const vendorLoaders = createVendorLoaders();
