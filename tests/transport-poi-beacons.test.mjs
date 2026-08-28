import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createTransportPoiBeacons } from '../src/transport-poi-beacons.js';
import { buildGeoJsonLayerDefinitions } from '../src/map/geojson-renderer.js';

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
  beacons.setEmphasis(true);
  assert.equal(markers.every(({ options }) => options.element.classList.contains('is-emphasized')), true);
  const generic = buildGeoJsonLayerDefinitions('ordinary', { geometry: 'point', render: { type: 'point', color: '#FFFFFF' } }, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] });
  assert.equal(generic.layers[0].type, 'circle');
  beacons.destroy();
  assert.equal(markers.every(({ removed }) => removed), true);
});

test('the MapLibre marker root remains absolutely positioned at its geographic anchor', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.maplibregl-marker\.transport-poi-beacon\s*\{[^}]*position:\s*absolute/s);
  assert.doesNotMatch(css, /\.transport-poi-beacon\s*\{[^}]*position:\s*relative/s);
});
