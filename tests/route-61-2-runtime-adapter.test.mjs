import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoute612RuntimeAdapter, installRoute612Styles } from '../src/route-61-2/runtime-adapter.js';
import { selectRouteComparisonAdapter } from '../src/capabilities/route-comparison-v1.js';
import { createRoute612Controls } from '../src/route-61-2/controls.js';

const line = (coordinates) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }] });

function context(overrides = {}) {
  return {
    map: { loaded: () => false, once() {}, getLayer() { return false; } },
    resources: new Map([
      ['existing-route', { descriptor: { role: 'route.existing' }, value: line([[1, 2], [3, 4]]) }],
      ['proposed-route', { descriptor: { role: 'route.proposed' }, value: line([[5, 6], [7, 8]]) }]
    ]),
    settings: { adapter: 'route-61-2-current' },
    ...overrides
  };
}

test('trusted adapter uses project route resources and preserves mode/reveal/POI/urban callbacks', () => {
  const events = [];
  const adapter = createRoute612RuntimeAdapter(context({
    setMode: (mode) => events.push(['mode', mode]),
    setRouteReveal: (target, active, delayMs) => events.push(['reveal', target, active, delayMs]),
    setPoiEmphasis: (target, active) => events.push(['poi', target, active]),
    setContextMode: (mode) => events.push(['urban', mode]),
    setSimulation: (active, speed) => events.push(['simulation', active, speed])
  }));
  assert.deepEqual(adapter.routeCoordinates, {
    existing: [[1, 2], [3, 4]], proposed: [[5, 6], [7, 8]]
  });
  adapter.setMode('difference');
  adapter.setRouteReveal('proposed-route', true, 250);
  adapter.setPoiEmphasis('connection-pois', true);
  adapter.setContextMode('industrial-context');
  adapter.setSimulation(true, 1.25);
  assert.deepEqual(events, [
    ['mode', 'difference'], ['reveal', 'proposed-route', true, 250],
    ['poi', 'connection-pois', true], ['urban', 'industrial-context'], ['simulation', true, 1.25]
  ]);
});

test('trusted adapter owns and installs its compatibility stylesheet', () => {
  const appended = [];
  const documentRef = {
    getElementById() { return null; },
    createElement(tagName) { return { tagName, remove() { this.removed = true; } }; },
    head: { append(node) { appended.push(node); } }
  };
  const stylesheet = installRoute612Styles(documentRef);
  assert.equal(stylesheet.id, 'route-61-2-styles');
  assert.equal(stylesheet.rel, 'stylesheet');
  assert.match(stylesheet.href, /\/route-61-2\/styles\.css$/);
  assert.deepEqual(appended, [stylesheet]);
});

test('route and urban capability contexts attach to the same map-owned adapter', () => {
  const map = { loaded: () => false, once() {}, getLayer() { return false; } };
  const events = [];
  const first = createRoute612RuntimeAdapter(context({ map, setMode: (mode) => events.push(['mode', mode]) }));
  first.connect({ setContextMode: (mode) => events.push(['urban', mode]) });
  first.setMode('existing');
  first.setContextMode('industrial-context');
  assert.deepEqual(events, [['mode', 'existing'], ['urban', 'industrial-context']]);
});

test('trusted installed code loads Route 61-2 adapter only for the explicit setting', async () => {
  const loads = [];
  const loadAdapter = () => { loads.push('load'); return { getRoute612RuntimeAdapter: () => ({ id: 'adapter' }) }; };
  assert.equal(await selectRouteComparisonAdapter({}, context(), loadAdapter), null);
  assert.equal(await selectRouteComparisonAdapter({ adapter: 'other' }, context(), loadAdapter), null);
  assert.deepEqual(await selectRouteComparisonAdapter({ adapter: 'route-61-2-current' }, context(), loadAdapter), { id: 'adapter' });
  assert.deepEqual(loads, ['load']);
});

test('trusted Route controls mount mode, reveal, POI, urban, and simulation behavior into a neutral host', () => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.textContent = ''; this.checked = false; this.value = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }
  const host = new Element('host');
  const events = [];
  createRoute612Controls({
    host,
    documentRef: { createElement: (tag) => new Element(tag) },
    onMode: (mode) => events.push(['mode', mode]),
    onReveal: (active) => events.push(['reveal', active]),
    onPoi: (active) => events.push(['poi', active]),
    onUrban: (active) => events.push(['urban', active]),
    onSimulation: (active, speed) => events.push(['simulation', active, speed])
  });
  const nodes = (node) => [node, ...node.children.flatMap(nodes)];
  const all = nodes(host);
  for (const label of ['Existing', 'Proposed', 'Difference', 'Compare', 'Route reveal', 'POI emphasis', 'Urban context', 'Simulation']) {
    assert.ok(all.some(({ textContent }) => textContent === label), label);
  }
  all.find(({ textContent }) => textContent === 'Existing').listeners.click();
  const simulation = all.find(({ textContent }) => textContent === 'Simulation').children[0];
  simulation.checked = true;
  simulation.listeners.change();
  assert.deepEqual(events, [['mode', 'existing'], ['simulation', true, 1]]);
});

test('all four route modes preserve route offsets and existing, proposed, and difference stop semantics', async () => {
  class Element {
    constructor() { this.dataset = {}; this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const mapElement = new Element();
  const sources = new Map(); const layers = new Map(); const paint = [];
  const map = {
    loaded: () => true,
    getContainer: () => mapElement,
    getSource: (id) => sources.get(id),
    addSource(id, spec) { sources.set(id, spec); },
    getLayer: (id) => layers.get(id),
    addLayer(layer) { layers.set(layer.id, structuredClone(layer)); },
    setLayoutProperty(id, property, value) { layers.get(id).layout = { ...layers.get(id).layout, [property]: value }; },
    setPaintProperty(id, property, value) { paint.push([id, property, value]); layers.get(id).paint[property] = value; },
    getStyle: () => ({ layers: [...layers.values()] }),
    once() {},
    isSourceLoaded: () => true
  };
  const pointCollection = (coordinates) => ({
    type: 'FeatureCollection',
    features: coordinates.map((point, index) => ({
      type: 'Feature', id: index, properties: { stopId: index }, geometry: { type: 'Point', coordinates: point }
    }))
  });
  const resources = new Map([
    ['existing-route', { descriptor: { role: 'route.existing' }, value: line([[106.6, 11], [106.61, 11.01]]) }],
    ['proposed-route', { descriptor: { role: 'route.proposed' }, value: line([[106.6, 11], [106.62, 11.02]]) }],
    ['existing-stops', { descriptor: { role: 'stops.existing' }, value: pointCollection([[106.6, 11], [106.61, 11.01]]) }],
    ['proposed-stops', { descriptor: { role: 'stops.proposed' }, value: pointCollection([[106.6, 11], [106.62, 11.02]]) }]
  ]);
  const adapter = createRoute612RuntimeAdapter({ map, resources, documentRef: { getElementById: () => mapElement } });
  await adapter.ready;

  for (const mode of ['difference', 'existing', 'proposed', 'compare']) {
    adapter.setMode(mode);
    assert.equal(mapElement.attributes['data-route-mode'], mode);
    assert.equal(mapElement.attributes['data-route-existing-visible'], String(['existing', 'compare'].includes(mode)));
    assert.equal(mapElement.attributes['data-route-proposed-visible'], String(['proposed', 'compare'].includes(mode)));
    assert.equal(mapElement.attributes['data-route-stop-mode'], mode === 'difference' ? 'difference' : mode === 'existing' ? 'existing' : 'proposed');
    if (mode === 'difference') {
      assert.equal(layers.get('route-61-2-stops-retained').layout.visibility, 'visible');
      assert.equal(layers.get('route-61-2-stops-existing').layout.visibility, 'none');
      assert.equal(layers.get('route-61-2-stops-proposed').layout.visibility, 'none');
    } else if (mode === 'existing') {
      assert.equal(layers.get('route-61-2-stops-existing').layout.visibility, 'visible');
      assert.equal(layers.get('route-61-2-stops-proposed').layout.visibility, 'none');
    } else {
      assert.equal(layers.get('route-61-2-stops-existing').layout.visibility, 'none');
      assert.equal(layers.get('route-61-2-stops-proposed').layout.visibility, 'visible');
    }
  }
  assert.equal(layers.get('route-61-2-existing').layout.visibility, 'visible');
  assert.equal(layers.get('route-61-2-proposed').layout.visibility, 'visible');
  assert.equal(layers.get('route-61-2-existing').paint['line-offset'], -4.5);
  assert.equal(layers.get('route-61-2-proposed').paint['line-offset'], 4.5);
  assert.equal(mapElement.attributes['data-route-existing-offset'], '-4.5');
  assert.equal(mapElement.attributes['data-route-proposed-offset'], '4.5');
  assert.ok(layers.has('route-61-2-stops-existing'));
  assert.ok(layers.has('route-61-2-stops-proposed'));
  for (const status of ['retained', 'added', 'removed']) assert.ok(layers.has(`route-61-2-stops-${status}`));
  assert.ok(paint.some(([id, property, value]) => id === 'route-61-2-proposed' && property === 'line-offset' && value === 4.5));
});

test('trusted adapter activates the existing Overture urban-context stack instead of a polygon approximation', async () => {
  const mapElement = { dataset: {}, setAttribute() {} };
  const sources = new Map(); const layers = new Map(); const placements = [];
  const overtureBuildings = {
    type: 'FeatureCollection',
    metadata: {
      provider: 'Overture Maps Foundation', overtureRelease: '2026-07-22.0',
      aoiFeatureId: 'osm-industrial-759187612', statistics: { featureCount: 1, aoiCoverageRatio: 0.05 }
    },
    features: [{
      type: 'Feature', properties: { render_height_m: 9 },
      geometry: { type: 'Polygon', coordinates: [[[106.6, 11], [106.601, 11], [106.601, 11.001], [106.6, 11]]] }
    }]
  };
  const zone = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[106.59, 10.99], [106.63, 10.99], [106.63, 11.03], [106.59, 10.99]]] } }]
  };
  const map = {
    loaded: () => true,
    getContainer: () => mapElement,
    getSource: (id) => sources.get(id), addSource(id, spec) { sources.set(id, spec); },
    getLayer: (id) => layers.get(id), addLayer(layer, beforeId) { layers.set(layer.id, structuredClone(layer)); placements.push([layer.id, beforeId]); },
    setLayoutProperty(id, property, value) { layers.get(id).layout = { ...layers.get(id).layout, [property]: value }; },
    setPaintProperty() {},
    getStyle: () => ({ layers: [...layers.values()] }),
    once() {},
    isSourceLoaded: () => true
  };
  const resources = new Map([
    ['existing-route', { descriptor: { role: 'route.existing' }, value: line([[106.6, 11], [106.61, 11.01]]) }],
    ['proposed-route', { descriptor: { role: 'route.proposed' }, value: line([[106.6, 11], [106.62, 11.02]]) }],
    ['industrial-zone', { descriptor: { role: 'context.area' }, value: zone }]
  ]);
  const adapter = createRoute612RuntimeAdapter({
    map, resources, overtureBuildings, documentRef: { getElementById: () => mapElement }
  });
  await adapter.ready;
  adapter.setContextMode('industrial-context');

  assert.equal(mapElement.dataset.urbanContextProvider, 'overture');
  assert.equal(mapElement.dataset.urbanGroundState, 'visible');
  assert.equal(mapElement.dataset.urbanOvertureLayerState, 'visible');
  assert.ok(layers.has('industrial-context-ground'));
  assert.ok(layers.has('industrial-context-boundary'));
  assert.ok(layers.has('overture-industrial-buildings-3d'));
  assert.equal(layers.has('route-61-2-urban-context'), false);
  assert.ok(placements.some(([id, beforeId]) => id === 'overture-industrial-buildings-3d' && beforeId === 'route-61-2-difference-removed'));
});

test('trusted adapter renders derived comparison, POI beacons, reveal, and moving buses', () => {
  class Element {
    constructor(tagName) {
      this.tagName = tagName; this.children = []; this.dataset = {}; this.attributes = {}; this.className = ''; this.hidden = false;
      this.classList = { values: new Set(), toggle: (name, active) => active ? this.classList.values.add(name) : this.classList.values.delete(name), contains: (name) => this.classList.values.has(name) };
    }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    remove() { this.removed = true; }
  }
  const mapElement = new Element('map');
  const documentRef = {
    head: { append() {} },
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => id === 'map' ? mapElement : null
  };
  const sources = new Map(); const layers = new Map(); const paint = [];
  const map = {
    loaded: () => true,
    getSource: (id) => sources.get(id), addSource(id, spec) { sources.set(id, spec); }, removeSource(id) { sources.delete(id); },
    getLayer: (id) => layers.get(id), addLayer(layer) { layers.set(layer.id, structuredClone(layer)); }, removeLayer(id) { layers.delete(id); },
    setLayoutProperty(id, property, value) { layers.get(id).layout = { ...layers.get(id).layout, [property]: value }; },
    setPaintProperty(id, property, value) { paint.push([id, property, value]); }
  };
  const markers = [];
  class Marker {
    constructor(options) { this.options = options; this.positions = []; markers.push(this); }
    setLngLat(position) { this.positions.push(position); return this; }
    addTo() { return this; }
    remove() { this.removed = true; }
  }
  const frames = [];
  const resources = new Map([
    ['existing-route', { descriptor: { role: 'route.existing' }, value: line([[106.6, 11], [106.61, 11.01], [106.62, 11.02]]) }],
    ['proposed-route', { descriptor: { role: 'route.proposed' }, value: line([[106.6, 11], [106.615, 11.02], [106.63, 11.03]]) }],
    ['existing-stops', { descriptor: { role: 'stops.existing' }, value: { type: 'FeatureCollection', features: [] } }],
    ['industrial-zone', { descriptor: { role: 'context.area' }, value: { type: 'FeatureCollection', features: [] } }],
    ['connection-pois', { descriptor: { role: 'transport.poi' }, value: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'Station' }, geometry: { type: 'Point', coordinates: [106.62, 11.01] } },
      { type: 'Feature', properties: { name: 'University' }, geometry: { type: 'Point', coordinates: [106.63, 11.02] } }
    ] } }]
  ]);
  const adapter = createRoute612RuntimeAdapter({
    map, resources, settings: {}, documentRef, maplibregl: { Marker },
    requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelAnimationFrame() {},
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {}
  });

  assert.ok(layers.has('route-61-2-difference-added'));
  assert.ok(layers.has('route-61-2-difference-removed'));
  assert.equal(markers.filter(({ options }) => options.element.className === 'transport-poi-beacon').length, 2);
  adapter.setPoiEmphasis('connection-pois', true);
  assert.equal(markers.filter(({ options }) => options.element.className === 'transport-poi-beacon')
    .every(({ options }) => options.element.classList.contains('is-emphasized')), true);

  adapter.setRouteReveal('proposed-route', true);
  assert.ok(paint.some(([id, property, value]) => (
    id === 'route-61-2-proposed' && property === 'line-gradient' && Array.isArray(value)
  )));
  adapter.setSimulation(true, 2);
  const buses = markers.filter(({ options }) => options.element.className.includes('bus-marker'));
  assert.equal(buses.length, 2);
  frames.shift()(1000);
  frames.shift()(1100);
  assert.equal(buses.every(({ positions }) => positions.length >= 2), true);
  adapter.destroy();
  assert.equal(markers.every(({ removed }) => removed), true);
});
