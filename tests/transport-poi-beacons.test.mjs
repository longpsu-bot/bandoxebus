import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import * as transportPoi from '../src/transport-poi-beacons.js';
import { buildGeoJsonLayerDefinitions } from '../src/map/geojson-renderer.js';

const { createTransportPoiBeacons } = transportPoi;

function element() {
  return { className: '', dataset: {}, hidden: false, children: [], append(...children) { this.children.push(...children); }, classList: { state: new Set(), toggle(name, active) { active ? this.state.add(name) : this.state.delete(name); }, contains(name) { return this.state.has(name); } } };
}

test('trusted POI beacons are created and emphasized without changing generic point rendering', () => {
  const markers = [];
  class Marker {
    constructor(options) { this.options = options; markers.push(this); }
    setLngLat(value) { this.coordinates = value; return this; }
    addTo(value) { this.map = value; return this; }
    remove() { this.removed = true; }
  }
  const documentRef = { createElement: element };
  const beacons = createTransportPoiBeacons({ map: {}, maplibregl: { Marker }, documentRef, pois: [{ coordinates: [1, 2], name: 'Station' }, { coordinates: [3, 4], name: 'Hospital' }] });
  assert.equal(markers.length, 2);
  assert.equal(markers.every(({ options }) => options.anchor === 'bottom'), true);
  assert.equal(markers.every(({ options }) => options.element.children.length === 1), true);
  assert.equal(markers.every(({ options }) => options.element.children[0].className === 'transport-poi-beacon__pillar'), true);
  beacons.setEmphasis(true);
  assert.equal(markers.every(({ options }) => options.element.classList.contains('is-emphasized')), true);
  const generic = buildGeoJsonLayerDefinitions('ordinary', { geometry: 'point', render: { type: 'point', color: '#FFFFFF' } }, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] });
  assert.equal(generic.layers[0].type, 'circle');
  beacons.destroy();
  assert.equal(markers.every(({ removed }) => removed), true);
});

test('the MapLibre marker root remains absolutely positioned at its geographic anchor', async () => {
  const css = await readFile(new URL('../src/route-61-2/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.maplibregl-marker\.transport-poi-beacon\s*\{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(css, /\.transport-poi-beacon\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.transport-poi-beacon__pillar\s*\{[^}]*bottom:\s*0(?:px)?\s*;/s);
  assert.doesNotMatch(css, /\.transport-poi-beacon__pillar\s*\{[^}]*(?:top:|translateY\()/s);
});

test('trusted POI ground layers lie on the map plane and emphasis changes paint only', () => {
  assert.equal(typeof transportPoi.buildTransportPoiGroundLayers, 'function');
  assert.equal(typeof transportPoi.setTransportPoiGroundEmphasis, 'function');
  const layers = transportPoi.buildTransportPoiGroundLayers();
  assert.deepEqual(layers.map(({ id }) => id), ['poi-halo', 'poi-core']);
  for (const layer of layers) {
    assert.equal(layer.paint['circle-pitch-alignment'], 'map');
    assert.equal(layer.paint['circle-pitch-scale'], 'map');
    assert.ok(layer.paint['circle-opacity'] > 0);
  }
  const calls = [];
  const map = { setPaintProperty(...args) { calls.push(args); } };
  transportPoi.setTransportPoiGroundEmphasis(map, true);
  assert.ok(calls.some(([id, property]) => id === 'poi-halo' && property === 'circle-radius'));
  assert.ok(calls.some(([id, property]) => id === 'poi-core' && property === 'circle-opacity'));
  assert.equal(Object.hasOwn(map, 'setData'), false);
});
