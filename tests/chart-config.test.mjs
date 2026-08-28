import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChartConfig } from '../src/content/chart-config.js';
import { createLocaleFormatter } from '../src/metrics/locale-formatter.js';

const table = { columns: [{ id: 'year', type: 'integer' }, { id: 'value', type: 'number' }], rows: [{ year: 2025, value: 10 }, { year: 2026, value: 20 }] };

test('approved chart vocabulary maps to bounded Chart.js configuration', () => {
  const area = buildChartConfig({ type: 'chart', chartType: 'area', title: 'Demand', data: { dataset: 'demand', x: 'year', series: [{ y: 'value', label: 'Demand' }] } }, { table, formatter: createLocaleFormatter('en-US'), reducedMotion: true });
  assert.equal(area.type, 'line');
  assert.equal(area.data.datasets[0].fill, true);
  assert.equal(area.options.animation, false);
  const stacked = buildChartConfig({ type: 'chart', chartType: 'bar', title: 'Demand', stacked: true, data: { dataset: 'demand', x: 'year', series: [{ y: 'value', label: 'Demand' }] } }, { table, formatter: createLocaleFormatter('en-US'), reducedMotion: false });
  assert.equal(stacked.options.scales.x.stacked, true);
  assert.equal(stacked.options.scales.y.stacked, true);
  assert.deepEqual(Object.keys(stacked.options).sort(), ['animation', 'maintainAspectRatio', 'plugins', 'responsive', 'scales']);
});
