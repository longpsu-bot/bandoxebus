import test from 'node:test';
import assert from 'node:assert/strict';

import { createCoreMapController } from '../src/map/core-map-controller.js';

function fixture() {
  const calls = [];
  const map = {
    fitBounds(bounds, options) { calls.push(['fitBounds', bounds, options]); },
    easeTo(options) { calls.push(['easeTo', options]); },
    setLayoutProperty(layer, property, value) { calls.push(['layout', layer, property, value]); },
    setPaintProperty(layer, property, value) { calls.push(['paint', layer, property, value]); },
    getLayer() { return true; }, removeLayer() {}, getSource() { return true; }, removeSource() {}
  };
  const datasets = new Map([['stops', {
    layers: [{ id: 'project-stops', type: 'circle', paint: { 'circle-radius': 5, 'circle-opacity': 0.7 } }],
    sourceId: 'project-stops',
    defaultVisible: true
  }]]);
  const focusRegistry = { get: (id) => id === 'center' ? { type: 'coordinate', center: [1, 2], zoom: 12, camera: { pitch: 20 } } : { type: 'bounds', bounds: [[0, 0], [2, 2]], camera: { padding: 10 } } };
  return { map, calls, datasets, focusRegistry };
}

test('common actions use semantic IDs and preserve visibility across emphasis clear', () => {
  const context = fixture();
  const controller = createCoreMapController({ ...context, reducedMotion: true });
  controller.setVisibility('stops', false);
  controller.setEmphasis('stops', true);
  controller.clearEmphasis();
  assert.ok(context.calls.some((call) => call.join(':') === 'layout:project-stops:visibility:none'));
  assert.ok(context.calls.some((call) => call[0] === 'paint' && call[2].endsWith('-opacity')));
  assert.ok(context.calls.some((call) => call.join(':') === 'paint:project-stops:circle-radius:7.5'));
  assert.equal(context.calls.filter((call) => call[0] === 'paint' && call[2] === 'circle-radius').at(-1)[3], 5);
  assert.equal(context.calls.filter((call) => call[0] === 'layout').at(-1)[3], 'none');
});

test('focus combines semantic targets, camera hints, shell padding, and reduced motion', () => {
  const context = fixture();
  const controller = createCoreMapController({ ...context, reducedMotion: true, shellPadding: () => ({ top: 20, right: 20, bottom: 20, left: 20 }) });
  controller.focus('overview', { maxZoom: 11 });
  assert.deepEqual(context.calls.at(-1), ['fitBounds', [[0, 0], [2, 2]], { padding: { top: 30, right: 30, bottom: 30, left: 30 }, maxZoom: 11, duration: 0, essential: false }]);
  controller.focus('center');
  assert.deepEqual(context.calls.at(-1)[1].center, [1, 2]);
});
