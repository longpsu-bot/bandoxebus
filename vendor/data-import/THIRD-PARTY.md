# Data Import Third-Party Software

All runtime parser artifacts are stored locally. Studio does not fetch these projects from a CDN at runtime. Versions and files are pinned; SHA-256 values below are for the exact repository copies.

## @tmcw/togeojson 7.1.2

- Upstream: https://github.com/placemark/togeojson
- Source: https://registry.npmjs.org/@tmcw/togeojson/-/togeojson-7.1.2.tgz
- License: BSD-2-Clause
- `togeojson/7.1.2/togeojson.es.mjs` — `beb7c0fa5e9837104c4bf0d81d3e0f2b43a3e66be5e734d10b7dd535f3270e88`
- `togeojson/7.1.2/LICENSE` — `7cb180a3e5857ed9f27742bee2371b0a3055e3d302877ed91f62f390a12f5080`

## shpjs 6.2.0

- Upstream: https://github.com/calvinmetcalf/shapefile-js
- Source: https://registry.npmjs.org/shpjs/-/shpjs-6.2.0.tgz
- License: MIT
- `shpjs/6.2.0/shp.esm.min.js` — `7741f6659b78ca6c6345c932c5b834c79be04ada82f0b4ac91e1e04ab7ac9e30`
- `shpjs/6.2.0/LICENSE.md` — `2de371ae03e427342d4c7aacdf295d5ce98476b5fbe951d66ce11aa009613894`

## proj4 2.22.0

- Upstream: https://github.com/proj4js/proj4js
- Source: https://registry.npmjs.org/proj4/-/proj4-2.22.0.tgz
- License: MIT
- `proj4/2.22.0/proj4.js` — `af7df653d91ea591f33d26fb958990bbd3071b2db644a4edaba441cc9861a474`
- `proj4/2.22.0/LICENSE.md` — `d514fd8b286fc00a5c97a29f8a99b73f1a4053bbdd00c400aee5f24a1b6b301e`

## PapaParse 5.7.0

- Upstream: https://github.com/mholt/PapaParse
- Source: https://registry.npmjs.org/papaparse/-/papaparse-5.7.0.tgz
- License: MIT
- `papaparse/5.7.0/papaparse.min.js` — `4d5d2d6e3282b66aafaa5e6de8ca3ae06f8d3440111ae99c6a30f6c00cfac33e`
- `papaparse/5.7.0/LICENSE` — `99aa68e4b42758b09828a46515f70369e5463458ab7a990189f641af2b8d9b4e`

## SheetJS Community Edition 0.20.3

- Upstream: https://git.sheetjs.com/SheetJS/sheetjs
- Source: https://cdn.sheetjs.com/xlsx-0.20.3/package/
- License: Apache-2.0
- Attribution: SheetJS Community Edition — https://sheetjs.com/ — Copyright (C) 2012-present SheetJS LLC
- `sheetjs/0.20.3/xlsx.mjs` — `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db`
- `sheetjs/0.20.3/LICENSE` — `4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64`

The stale public npm `xlsx@0.18.5` package is not used.

## @ngageoint/geopackage 4.2.9

- Upstream: https://github.com/ngageoint/geopackage-js
- Source: https://registry.npmjs.org/@ngageoint/geopackage/-/geopackage-4.2.9.tgz
- License: MIT
- `geopackage/4.2.9/geopackage.min.js` — `54e5f822f552e3cdf99a8f95825e14f2e1b47034ece8ff68dfec2f11ca36b2cf`
- `geopackage/4.2.9/sql-wasm.wasm` — `8c71e50148e407c984fdf67e60823d0b0253c1c80c37ab15c36f4e1fd9eb3c47`
- `geopackage/4.2.9/geopackage.min.js.LICENSE.txt` — `5f19ab2fbdbec57d6f27e8ad6059164f27e2c82c719cead5b7a9b6c43853b628`
- `geopackage/4.2.9/LICENSE` — `516dbe0f3b43d3e1fb37877aac1942e60a3a0ae0ad52b73b689f409647cda98d`

The bundled license notice covers transitive code included in `geopackage.min.js`; the matching SQL.js WASM is copied from the same 4.2.9 package.

## fflate 0.8.3 (existing)

- Upstream: https://github.com/101arrowz/fflate
- Source: existing certified repository vendor copy
- License: MIT
- Files: `../fflate/0.8.3/fflate.esm.js`, `../fflate/0.8.3/LICENSE`

Data Workbench V2 reuses this copy for bounded ZIP expansion. It does not vendor another ZIP implementation.
