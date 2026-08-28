import test from 'node:test';
import assert from 'node:assert/strict';

import { createChartRenderer } from '../src/content/chart-renderer.js';
import { createLocaleFormatter } from '../src/metrics/locale-formatter.js';

class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.attributes = {}; this.className = ''; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getContext() { return {}; }
}
const documentRef = { createElement: (tag) => new Element(tag) };
const find = (root, tag) => root.tagName === tag ? [root] : root.children.flatMap((child) => find(child, tag));
class FakeChart {
  static instances = [];
  constructor(_context, config) { config.data.datasets = [...config.data.datasets]; this.config = config; this.destroyCalls = 0; FakeChart.instances.push(this); }
  destroy() { this.destroyCalls += 1; }
}

test('chart renderer creates accessible canvas, source table, and deterministic cleanup', () => {
  const table = { columns: [{ id: 'year', label: 'Year', type: 'integer' }, { id: 'value', label: 'Value', type: 'number' }], rows: [{ year: 2026, value: 20 }] };
  const renderer = createChartRenderer({ Chart: FakeChart, documentRef, reducedMotion: true, formatter: createLocaleFormatter('en-US') });
  const node = renderer.render({ type: 'chart', chartType: 'line', title: 'Demand', description: 'Annual demand', data: { dataset: 'demand', x: 'year', series: [{ y: 'value', label: 'Demand' }] } }, { table });
  assert.equal(find(node, 'canvas')[0].attributes.role, 'img');
  assert.equal(find(node, 'canvas')[0].attributes['aria-label'], 'Demand. Annual demand');
  assert.equal(find(node, 'table').length, 1);
  renderer.destroyAll();
  assert.equal(FakeChart.instances[0].destroyCalls, 1);
});
