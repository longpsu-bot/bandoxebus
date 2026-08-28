import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTENT_BLOCK_DESCRIPTORS } from '../src/content/content-descriptors.js';
import { createProjectContentRenderer, createRuntimeMetricRegistry } from '../src/project/bootstrap.js';
import { createTableRegistry } from '../src/data/table-registry.js';
import { createMetricRegistry } from '../src/metrics/metric-registry.js';

class Element { constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.className = ''; this.textContent = ''; this.style = {}; } append(...children) { this.children.push(...children); } replaceChildren(...children) { this.children = children; } setAttribute(k, v) { this.attributes[k] = String(v); } getContext() { return {}; } }
class Chart { destroy() {} }

test('Story 1.1 discovery, validation, and production rendering have exact type parity', async () => {
  const documentRef = { createElement: (tag) => new Element(tag) };
  const tables = createTableRegistry([['demand', { schemaVersion: '1.0', columns: [{ id: 'year', label: 'Year', type: 'integer' }, { id: 'value', label: 'Value', type: 'number' }], rows: [{ year: 2026, value: 10 }] }]]);
  const metrics = await createMetricRegistry({ staticMetrics: { demand: { label: 'Demand', value: 10, format: { type: 'integer' } } } });
  const project = { locale: 'en-US', tables, metrics, resources: new Map([['photo', { url: new URL('https://host/photo.svg'), descriptor: { type: 'image' } }]]), attribution: {} };
  const renderer = createProjectContentRenderer(project, { documentRef, Chart, reducedMotion: true });
  assert.deepEqual(renderer.types.toSorted(), CONTENT_BLOCK_DESCRIPTORS.map(({ type }) => type).toSorted());
  for (const block of [
    { type: 'table', data: { dataset: 'demand', columns: [{ field: 'year', format: { type: 'integer' } }] } },
    { type: 'chart', chartType: 'bar', title: 'Demand', data: { dataset: 'demand', x: 'year', series: [{ y: 'value', label: 'Value' }] } },
    { type: 'image', asset: 'photo', alt: 'Photo' },
    { type: 'legend', items: [{ label: 'Route', sample: 'line', color: '#00AAFF' }] }
  ]) assert.ok(renderer.renderBlock(block));
});

test('bootstrap metric registry composes static and instantiated capability providers', async () => {
  const project = { resources: new Map([['metrics', { value: { metrics: { static: { label: 'Static', value: 1, format: { type: 'integer' } } } } }]]) };
  const instances = [{ entry: { descriptor: { metrics: [{ id: 'computed', label: 'Computed', format: { type: 'integer' } }] } }, implementation: { metricProviders: { computed: () => 2 } } }];
  const metrics = await createRuntimeMetricRegistry(project, instances);
  assert.equal(metrics.resolve('static').value, 1);
  assert.equal(metrics.resolve('computed').value, 2);
});
