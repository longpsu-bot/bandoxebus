import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoute612RuntimeAdapter } from '../src/route-61-2/runtime-adapter.js';
import { selectRouteComparisonAdapter } from '../src/capabilities/route-comparison-v1.js';

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
