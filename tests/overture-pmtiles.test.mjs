import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as overturePmtiles from '../src/overture-pmtiles.js';
import {
  createOverturePmtilesLayerDefinitions,
  deriveOvertureBuildingsPmtilesUrl,
  ensurePmtilesProtocol,
  loadPmtilesBrowser,
  OVERTURE_PMTILES_FLAT_LAYER_ID,
  OVERTURE_PMTILES_RELEASE_PATTERN
} from '../src/overture-pmtiles.js';
import {
  OVERTURE_BUILDING_LAYER_ID,
  OVERTURE_BUILDING_SOURCE_ID
} from '../src/overture-buildings.js';

const root = new URL('../', import.meta.url);

const snapshot = Object.freeze({
  asset: 'overture-buildings-snapshot',
  bounds: Object.freeze([106.59, 11.11, 106.61, 11.14]),
  sha256: 'a'.repeat(64)
});
const snapshotSettings = Object.freeze({
  buildingSource: 'project-snapshot', overtureRelease: '2026-08-19.0', snapshot
});
const snapshotResource = Object.freeze({
  id: 'overture-buildings-snapshot',
  descriptor: Object.freeze({ type: 'pmtiles', mediaType: 'application/vnd.pmtiles' }),
  url: new URL('https://r2.example.test/projects/route-61-2/a/overture-buildings.pmtiles')
});
const snapshotResources = new Map([[snapshotResource.id, snapshotResource]]);

function fakePmtilesRuntime() {
  const files = [];
  const archives = [];
  const added = [];
  const registrations = [];
  class FileSource {
    constructor(file) { this.file = file; files.push(file); }
    getKey() { return this.file.name; }
  }
  class PMTiles {
    constructor(source) { this.source = source; archives.push(this); }
  }
  class Protocol {
    tile() {}
    add(archive) { added.push(archive); }
  }
  return {
    files, archives, added, registrations,
    maplibregl: { addProtocol(name, tile) { registrations.push({ name, tile }); } },
    loadPmtiles: async () => ({ Protocol, FileSource, PMTiles })
  };
}

test('URL archive uses the existing protocol without registering an eager archive', async () => {
  const runtime = fakePmtilesRuntime();
  const binding = overturePmtiles.createOverturePmtilesArchiveBinding({ settings: snapshotSettings, resources: snapshotResources });
  const result = await overturePmtiles.ensurePmtilesArchive(runtime.maplibregl, binding, runtime);
  assert.equal(result.archiveUrl, 'https://r2.example.test/projects/route-61-2/a/overture-buildings.pmtiles');
  assert.equal(result.protocol, await ensurePmtilesProtocol(runtime.maplibregl, runtime));
  assert.equal(runtime.registrations.length, 1);
  assert.equal(runtime.added.length, 0);
  assert.equal(runtime.archives.length, 0);
});

test('concurrent File archive registration is shared and uses the full snapshot hash', async () => {
  const runtime = fakePmtilesRuntime();
  const file = new File([new Uint8Array([80, 77, 84, 105, 108, 101, 115])], 'overture-buildings.pmtiles');
  file.arrayBuffer = () => { throw new Error('must not read whole original file'); };
  const binding = overturePmtiles.createOverturePmtilesArchiveBinding({
    settings: snapshotSettings, resources: snapshotResources, resolvePmtilesAssetFile: () => file
  });
  const [first, second] = await Promise.all([
    overturePmtiles.ensurePmtilesArchive(runtime.maplibregl, binding, runtime),
    overturePmtiles.ensurePmtilesArchive(runtime.maplibregl, binding, runtime)
  ]);
  const third = await overturePmtiles.ensurePmtilesArchive(runtime.maplibregl, binding, runtime);
  assert.equal(first.archiveUrl, `overture-buildings-${'a'.repeat(64)}.pmtiles`);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.equal(runtime.registrations.length, 1);
  assert.equal(runtime.files.length, 1);
  assert.equal(runtime.archives.length, 1);
  assert.deepEqual(runtime.added, runtime.archives);
  assert.notEqual(runtime.files[0], file);
  assert.equal(runtime.files[0].type, 'application/vnd.pmtiles');
  assert.deepEqual(new Uint8Array(await runtime.files[0].arrayBuffer()), new Uint8Array([80, 77, 84, 105, 108, 101, 115]));

  const distinct = await overturePmtiles.ensurePmtilesArchive(runtime.maplibregl, {
    ...binding, key: `snapshot:${'a'.repeat(63)}b`
  }, runtime);
  assert.equal(distinct.archiveUrl, `overture-buildings-${'a'.repeat(63)}b.pmtiles`);
  assert.notEqual(distinct.archiveUrl, first.archiveUrl);
  assert.equal(distinct.protocol, first.protocol);
  assert.equal(runtime.added.length, 2);
  assert.equal(runtime.registrations.length, 1);
});

test('snapshot definitions change only the archive address and copied source bounds', () => {
  const snapshotDefinitions = createOverturePmtilesLayerDefinitions({
    archiveUrl: `overture-buildings-${'a'.repeat(64)}.pmtiles`, bounds: snapshot.bounds
  });
  assert.deepEqual(snapshotDefinitions.source, {
    type: 'vector', url: `pmtiles://overture-buildings-${'a'.repeat(64)}.pmtiles`,
    attribution: '© <a href="https://overturemaps.org/">Overture Maps Foundation</a>',
    bounds: [106.59, 11.11, 106.61, 11.14]
  });
  assert.notEqual(snapshotDefinitions.source.bounds, snapshot.bounds);
  const official = createOverturePmtilesLayerDefinitions({ release: '2026-08-19.0' });
  assert.deepEqual(snapshotDefinitions.flat, official.flat);
  assert.deepEqual(snapshotDefinitions.extrusion, official.extrusion);
});

test('snapshot binding uses the resolved resource URL and immutable copied bounds', () => {
  const binding = overturePmtiles.createOverturePmtilesArchiveBinding({
    settings: { ...snapshotSettings, snapshot: { ...snapshot, url: 'https://untrusted.test/override.pmtiles' } },
    resources: snapshotResources
  });
  assert.deepEqual(binding, {
    kind: 'url', source: 'project-snapshot', release: '2026-08-19.0',
    url: 'https://r2.example.test/projects/route-61-2/a/overture-buildings.pmtiles',
    bounds: [106.59, 11.11, 106.61, 11.14], key: `snapshot:${'a'.repeat(64)}`
  });
  assert.notEqual(binding.bounds, snapshot.bounds);
  assert.equal(Object.isFrozen(binding.bounds), true);
  assert.equal(Object.isFrozen(binding), true);
});

test('snapshot binding prefers a resolved File without reading its bytes', () => {
  const file = new File(['snapshot'], 'overture-buildings.pmtiles');
  file.arrayBuffer = () => { throw new Error('must remain lazy'); };
  const binding = overturePmtiles.createOverturePmtilesArchiveBinding({
    settings: snapshotSettings, resources: snapshotResources,
    resolvePmtilesAssetFile(url, metadata) {
      assert.equal(url, snapshotResource.url);
      assert.deepEqual(metadata, { id: snapshotResource.id, descriptor: snapshotResource.descriptor });
      return file;
    }
  });
  assert.deepEqual(binding, {
    kind: 'file', source: 'project-snapshot', release: '2026-08-19.0', file,
    bounds: [106.59, 11.11, 106.61, 11.14], key: `snapshot:${'a'.repeat(64)}`
  });
});

test('archive binding preserves official release derivation and skips local GeoJSON', () => {
  assert.equal(overturePmtiles.createOverturePmtilesArchiveBinding({ settings: { buildingSource: 'local-geojson' } }), null);
  const binding = overturePmtiles.createOverturePmtilesArchiveBinding({
    settings: { buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0', url: 'https://untrusted.test/' }
  });
  assert.equal(binding.kind, 'url');
  assert.equal(binding.source, 'overture-pmtiles');
  assert.equal(binding.url, 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles');
  assert.equal(binding.bounds, null);
  assert.throws(() => overturePmtiles.createOverturePmtilesArchiveBinding({
    settings: { buildingSource: 'overture-pmtiles', overtureRelease: 'latest' }
  }), /Overture release/);
});

test('snapshot binding rejects missing or non-PMTiles resources before invoking the resolver', () => {
  for (const resources of [new Map(), new Map([[snapshot.asset, {
    ...snapshotResource, descriptor: { type: 'geojson', mediaType: 'application/geo+json' }
  }]])]) {
    assert.throws(() => overturePmtiles.createOverturePmtilesArchiveBinding({
      settings: snapshotSettings, resources,
      resolvePmtilesAssetFile() { assert.fail('invalid resource must not reach resolver'); }
    }), /PMTiles resource/);
  }
});

function evaluateExpression(expression, properties, scope = new Map()) {
  if (!Array.isArray(expression)) return expression;
  const [operator, ...args] = expression;
  if (operator === 'get') return properties[args[0]] ?? null;
  if (operator === 'var') return scope.get(args[0]);
  if (operator === 'to-number') {
    for (const candidate of args) {
      const value = evaluateExpression(candidate, properties, scope);
      const number = Number(value);
      if (!Number.isNaN(number)) return number;
    }
  }
  if (operator === 'number') {
    for (const candidate of args) {
      const value = evaluateExpression(candidate, properties, scope);
      if (typeof value === 'number') return value;
    }
  }
  if (operator === 'let') {
    const nextScope = new Map(scope);
    for (let index = 0; index < args.length - 1; index += 2) {
      nextScope.set(args[index], evaluateExpression(args[index + 1], properties, nextScope));
    }
    return evaluateExpression(args.at(-1), properties, nextScope);
  }
  if (operator === 'case') {
    for (let index = 0; index < args.length - 1; index += 2) {
      if (evaluateExpression(args[index], properties, scope)) {
        return evaluateExpression(args[index + 1], properties, scope);
      }
    }
    return evaluateExpression(args.at(-1), properties, scope);
  }
  if (operator === 'all') return args.every((value) => evaluateExpression(value, properties, scope));
  if (operator === '*') return evaluateExpression(args[0], properties, scope) * evaluateExpression(args[1], properties, scope);
  if (operator === '>') return evaluateExpression(args[0], properties, scope) > evaluateExpression(args[1], properties, scope);
  if (operator === '>=') return evaluateExpression(args[0], properties, scope) >= evaluateExpression(args[1], properties, scope);
  if (operator === '<') return evaluateExpression(args[0], properties, scope) < evaluateExpression(args[1], properties, scope);
  if (operator === '<=') return evaluateExpression(args[0], properties, scope) <= evaluateExpression(args[1], properties, scope);
  throw new TypeError(`Unsupported test expression operator: ${operator}`);
}

test('PMTiles 4.5.0 is pinned locally with verified executable and license provenance', async () => {
  const bundle = await readFile(new URL('vendor/pmtiles/4.5.0/pmtiles.js', root));
  const license = await readFile(new URL('vendor/pmtiles/4.5.0/LICENSE', root), 'utf8');
  const provenance = await readFile(new URL('vendor/pmtiles/THIRD-PARTY.md', root), 'utf8');

  assert.match(bundle.subarray(0, 4000).toString('utf8'), /PMTiles|Protocol/);
  assert.equal(
    createHash('sha256').update(bundle).digest('hex'),
    'caf981bc46f6327ee7e65d5dc964d89d38a69f60edca2bd4c5c890c21b554c6c'
  );
  assert.match(license, /The below license \(BSD-3\) applies to the reference implementations/);
  assert.match(license, /Redistribution and use in source and binary forms/);
  assert.equal(
    createHash('sha256').update(license).digest('hex'),
    '0371c38f338835f7fc13ed71176f3d92144e22c8b736a31cced57adbbeb647b3'
  );
  assert.match(provenance, /Version:\s*4\.5\.0/);
  assert.match(provenance, /License:\s*BSD-3-Clause/);
  assert.match(provenance, /23ae7c575578ad24cd579377d69c46550631da219e6f179997ec2cf3b8c937e5/);
  assert.match(provenance, /182d5b3cfdc2f5a6adbc54630c612da2f6086bdd/);
  assert.doesNotMatch(provenance, /cdn\.jsdelivr|unpkg\.com/i);
});

test('trusted Overture release validation derives only the pinned archive shape', () => {
  assert.equal(OVERTURE_PMTILES_RELEASE_PATTERN.test('2026-08-19.0'), true);
  assert.equal(
    deriveOvertureBuildingsPmtilesUrl('2026-08-19.0'),
    'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles'
  );

  for (const invalid of [
    'latest',
    '2026-08-19',
    '2026-08-19.1',
    '../2026-08-19.0',
    'https://example.com/x',
    '2026-08-19.0?x=1',
    '2026-08-19.0#x',
    '2026%2f08%2f19.0'
  ]) {
    assert.throws(() => deriveOvertureBuildingsPmtilesUrl(invalid), /Overture release/i);
  }
});

test('online definitions use one vector source and the locked building layers', () => {
  const definitions = createOverturePmtilesLayerDefinitions({ release: '2026-08-19.0' });

  assert.deepEqual(definitions.source, {
    type: 'vector',
    url: 'pmtiles://https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles',
    attribution: '© <a href="https://overturemaps.org/">Overture Maps Foundation</a>'
  });
  assert.equal(definitions.flat.id, OVERTURE_PMTILES_FLAT_LAYER_ID);
  assert.equal(definitions.flat.source, OVERTURE_BUILDING_SOURCE_ID);
  assert.equal(definitions.flat['source-layer'], 'building');
  assert.equal(definitions.flat.minzoom, 11);
  assert.equal(definitions.flat.maxzoom, 14);
  assert.deepEqual(definitions.flat.layout, { visibility: 'none' });
  assert.deepEqual(definitions.flat.paint, { 'fill-color': '#748a9c', 'fill-opacity': 0.14 });
  assert.equal(definitions.extrusion.id, OVERTURE_BUILDING_LAYER_ID);
  assert.equal(definitions.extrusion.source, OVERTURE_BUILDING_SOURCE_ID);
  assert.equal(definitions.extrusion['source-layer'], 'building');
  assert.equal(definitions.extrusion.minzoom, 14);
  assert.deepEqual(definitions.extrusion.layout, { visibility: 'none' });
  assert.equal(definitions.extrusion.paint['fill-extrusion-color'], '#8298aa');
  assert.equal(definitions.extrusion.paint['fill-extrusion-opacity'], 0.78);
  assert.equal(definitions.extrusion.paint['fill-extrusion-vertical-gradient'], true);
});

test('online height expression enforces the bounded height policy', () => {
  const { extrusion } = createOverturePmtilesLayerDefinitions({ release: '2026-08-19.0' });
  const numeric = (name) => ['to-number', ['get', name], 0];
  const finalHeight = [
    'case',
    ['all', ['>', ['var', 'height'], 0], ['<=', ['var', 'height'], 300]], ['var', 'height'],
    ['all', ['>', ['var', 'floors'], 0], ['<=', ['var', 'floors'], 80]], ['*', ['var', 'floors'], 3.5],
    8.5
  ];

  assert.deepEqual(extrusion.paint['fill-extrusion-height'], [
    'let',
    'height', numeric('height'),
    'floors', numeric('num_floors'),
    finalHeight
  ]);
});

test('online base expression computes final height in an enclosing let scope', () => {
  const { extrusion } = createOverturePmtilesLayerDefinitions({ release: '2026-08-19.0' });
  const numeric = (name) => ['to-number', ['get', name], 0];
  const optionalNumeric = (name) => ['number', ['get', name], -1];
  const finalHeight = [
    'let',
    'height', numeric('height'),
    'floors', numeric('num_floors'),
    [
      'case',
      ['all', ['>', ['var', 'height'], 0], ['<=', ['var', 'height'], 300]], ['var', 'height'],
      ['all', ['>', ['var', 'floors'], 0], ['<=', ['var', 'floors'], 80]], ['*', ['var', 'floors'], 3.5],
      8.5
    ]
  ];

  assert.deepEqual(extrusion.paint['fill-extrusion-base'], [
    'let',
    'finalHeight', finalHeight,
    [
      'let',
      'minHeight', optionalNumeric('min_height'),
      'minFloor', optionalNumeric('min_floor'),
      [
        'case',
        ['all', ['>=', ['var', 'minHeight'], 0], ['<', ['var', 'minHeight'], ['var', 'finalHeight']]], ['var', 'minHeight'],
        ['all', ['>=', ['var', 'minFloor'], 0], ['<=', ['var', 'minFloor'], 80], ['<', ['*', ['var', 'minFloor'], 3.5], ['var', 'finalHeight']]], ['*', ['var', 'minFloor'], 3.5],
        0
      ]
    ]
  ]);
});

test('online base expression preserves optional-field absence for the min-floor fallback', () => {
  const { extrusion } = createOverturePmtilesLayerDefinitions({ release: '2026-08-19.0' });
  const expression = extrusion.paint['fill-extrusion-base'];

  assert.equal(evaluateExpression(expression, { height: 20, min_floor: 2 }), 7);
  assert.equal(evaluateExpression(expression, { height: 20, min_height: 4, min_floor: 2 }), 4);
  assert.equal(evaluateExpression(expression, { height: 20 }), 0);
});

test('browser loader appends one local script and shares its in-flight result', async () => {
  const globalRef = {};
  const appended = [];
  const documentRef = {
    head: {
      append(script) {
        appended.push(script);
        globalRef.pmtiles = { Protocol: class Protocol {} };
        queueMicrotask(() => script.onload());
      }
    },
    createElement(tagName) {
      assert.equal(tagName, 'script');
      return {};
    }
  };

  const [first, second] = await Promise.all([
    loadPmtilesBrowser({ documentRef, globalRef }),
    loadPmtilesBrowser({ documentRef, globalRef })
  ]);

  assert.equal(appended.length, 1);
  assert.match(appended[0].src, /\/vendor\/pmtiles\/4\.5\.0\/pmtiles\.js$/);
  assert.equal(first, globalRef.pmtiles);
  assert.equal(second, globalRef.pmtiles);
});

test('protocol installation is process-lifetime idempotent per MapLibre object', async () => {
  let loads = 0;
  let registrations = 0;
  class Protocol {
    tile() {}
  }
  const maplibregl = {
    addProtocol(name, tile) {
      registrations += 1;
      assert.equal(name, 'pmtiles');
      assert.equal(tile, Protocol.prototype.tile);
    }
  };
  const loadPmtiles = async () => {
    loads += 1;
    return { Protocol };
  };

  const first = await ensurePmtilesProtocol(maplibregl, { loadPmtiles });
  const second = await ensurePmtilesProtocol(maplibregl, { loadPmtiles });

  assert.equal(first, second);
  assert.equal(loads, 1);
  assert.equal(registrations, 1);
});
