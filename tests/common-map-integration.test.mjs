import test from 'node:test';
import assert from 'node:assert/strict';

import { createCoreMapCapability } from '../src/capabilities/core-map-v1.js';

test('core map installs ordinary authored GeoJSON once and exposes semantic actions', () => {
  const calls = [];
  const layerIds = new Set();
  const sourceIds = new Set();
  const map = {
    loaded: () => true,
    addSource(id) { sourceIds.add(id); calls.push(['source', id]); },
    addLayer(layer) { layerIds.add(layer.id); calls.push(['layer', layer.id, layer.type]); },
    getSource: (id) => sourceIds.has(id),
    getLayer: (id) => layerIds.has(id),
    setLayoutProperty(id, key, value) { calls.push(['layout', id, key, value]); },
    setPaintProperty() {}, fitBounds() {}, easeTo() {}
  };
  const collection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] };
  const resources = new Map([['ordinary-stops', { descriptor: { type: 'geojson', geometry: 'point', render: { type: 'point', color: '#FFFFFF' } }, value: collection }]]);
  const capability = createCoreMapCapability({
    map, resources, handlers: { 'map.focus': () => {}, 'map.set-visibility': () => {}, 'map.set-emphasis': () => {}, 'map.clear-emphasis': () => {} },
    project: { resources, focusTargets: { overview: { type: 'datasets', datasets: ['ordinary-stops'] } }, capabilities: { renderResponsibilities: {} } }
  });
  assert.deepEqual(calls.slice(0, 2), [['source', 'project-ordinary-stops'], ['layer', 'project-ordinary-stops', 'circle']]);
  assert.deepEqual(capability.sceneLayers.ids, ['ordinary-stops']);
  capability.sceneLayers.setVisible('ordinary-stops', false);
  assert.ok(calls.some((call) => call.join(':') === 'layout:project-ordinary-stops:visibility:none'));
  capability.handlers['map.set-visibility']({ target: 'ordinary-stops', visible: true });
  assert.ok(calls.some((call) => call.join(':') === 'layout:project-ordinary-stops:visibility:visible'));
  assert.equal(JSON.stringify(capability.sceneLayers).includes('project-ordinary-stops'), false);
});

test('datasets claimed by trusted special capabilities are not rendered by core map', () => {
  const calls = [];
  const resources = new Map([['route', { descriptor: { type: 'geojson', geometry: 'line', role: 'route.proposed', render: { type: 'line', color: '#00AAFF' } }, value: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] } }]]);
  const capability = createCoreMapCapability({
    map: { loaded: () => true, addSource() { calls.push('source'); }, addLayer() { calls.push('layer'); } },
    resources,
    project: { resources, focusTargets: {}, capabilities: { renderResponsibilities: { 'route.proposed': 'route-comparison-v1' } } }
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(capability.sceneLayers.ids, []);
});
