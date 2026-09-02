import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

test('online extrusion expressions enforce bounded height and base policies', () => {
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
  assert.deepEqual(extrusion.paint['fill-extrusion-base'], [
    'let',
    'height', numeric('height'),
    'floors', numeric('num_floors'),
    'finalHeight', finalHeight,
    'minHeight', numeric('min_height'),
    'minFloor', numeric('min_floor'),
    [
      'case',
      ['all', ['>=', ['var', 'minHeight'], 0], ['<', ['var', 'minHeight'], ['var', 'finalHeight']]], ['var', 'minHeight'],
      ['all', ['>=', ['var', 'minFloor'], 0], ['<=', ['var', 'minFloor'], 80], ['<', ['*', ['var', 'minFloor'], 3.5], ['var', 'finalHeight']]], ['*', ['var', 'minFloor'], 3.5],
      0
    ]
  ]);
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
