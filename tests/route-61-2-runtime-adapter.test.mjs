import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoute612RuntimeAdapter } from '../src/route-61-2/runtime-adapter.js';
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
  for (const label of ['Existing', 'Proposed', 'Difference', 'Route reveal', 'POI emphasis', 'Urban context', 'Simulation']) {
    assert.ok(all.some(({ textContent }) => textContent === label), label);
  }
  all.find(({ textContent }) => textContent === 'Existing').listeners.click();
  const simulation = all.find(({ textContent }) => textContent === 'Simulation').children[0];
  simulation.checked = true;
  simulation.listeners.change();
  assert.deepEqual(events, [['mode', 'existing'], ['simulation', true, 1]]);
});
