import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  prepareBasemapStyle,
  stripOpenFreeMapDarkStyle
} from '../src/basemap-style.js';

const fixtureStyle = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#111' } },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building' },
    { id: 'highway_major_inner', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    { id: 'highway_minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
    { id: 'poi-shop', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', layout: { 'text-field': ['get', 'name'] } },
    { id: 'landcover_wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', paint: { 'fill-pattern': 'wood-pattern' } },
    { id: 'place_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': ['get', 'name'] } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' }
  ]
};

test('basemap preparation preserves reference building layers for fair A/B comparison', () => {
  const prepared = prepareBasemapStyle(fixtureStyle);
  assert.equal(prepared.layers.find(({ id }) => id === 'building').layout, undefined);
  assert.equal(prepared.glyphs, 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
  assert.deepEqual(prepared.layers.find(({ id }) => id === 'place_city').layout['text-font'], ['Noto Sans Regular']);
  assert.equal(fixtureStyle.layers.find(({ id }) => id === 'building').layout, undefined);
});

test('stripped Dark retains geographic context while removing noisy POIs and buildings', () => {
  const stripped = stripOpenFreeMapDarkStyle(fixtureStyle);
  assert.deepEqual(stripped.layers.map(({ id }) => id), [
    'background', 'highway_major_inner', 'highway_minor', 'place_city', 'water'
  ]);
});

test('application-owned map labels use the available fixed glyph stack', async () => {
  const [applicationSource, basemapSource] = await Promise.all([
    readFile(new URL('../src/runtime/generic-app.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/basemap-style.js', import.meta.url), 'utf8')
  ]);
  assert.match(applicationSource, /prepareBasemapStyle\(stripOpenFreeMapDarkStyle\(/);
  assert.doesNotMatch(`${applicationSource}\n${basemapSource}`, /Roboto Regular/);
  assert.match(basemapSource, /Noto Sans Regular/);
});
