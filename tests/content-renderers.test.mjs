import test from 'node:test';
import assert from 'node:assert/strict';

import { createTableRegistry } from '../src/data/table-registry.js';
import { createLocaleFormatter } from '../src/metrics/locale-formatter.js';
import { createContentRendererRegistry, renderImageBlock, renderLegendBlock, renderTableBlock } from '../src/content/content-renderers.js';

class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.attributes = {}; this.className = ''; this.textContent = ''; this.dataset = {}; }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}
const documentRef = { createElement: (tag) => new Element(tag) };
const tables = createTableRegistry([['demand', { schemaVersion: '1.0', columns: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'value', label: 'Value', type: 'integer' }], rows: [{ name: '<Stop>', value: 1200 }] }]]);
const context = { documentRef, tables, formatter: createLocaleFormatter('en-US'), assets: { get: (id) => ({ id, url: `/${id}.svg`, descriptor: { type: 'image' } }) }, attribution: { survey: { name: 'Survey 2026' } } };
const find = (root, tag) => root.tagName === tag ? [root] : root.children.flatMap((child) => find(child, tag));

test('table renderer emits ordered native table semantics with formatted text', () => {
  const node = renderTableBlock({ type: 'table', caption: 'Changes', data: { dataset: 'demand', columns: [{ field: 'name', header: 'Stop', align: 'start', format: { type: 'text' } }, { field: 'value', header: 'Demand', align: 'end', format: { type: 'integer' } }] }, source: 'survey' }, context);
  assert.equal(find(node, 'caption')[0].textContent, 'Changes');
  assert.equal(find(node, 'th')[0].attributes.scope, 'col');
  assert.equal(find(node, 'td')[0].textContent, '<Stop>');
  assert.equal(find(node, 'td')[1].textContent, '1,200');
  assert.equal(find(node, 'tbody')[0].children.length, 1);
});

test('image and legend render safe native semantics and declared assets', () => {
  const image = renderImageBlock({ type: 'image', asset: 'photo', alt: 'Bus stop', caption: 'Site', source: 'survey' }, context);
  assert.equal(find(image, 'img')[0].attributes.alt, 'Bus stop');
  assert.equal(find(image, 'figcaption')[0].textContent, 'Site');
  const legend = renderLegendBlock({ type: 'legend', title: 'Legend', items: [{ label: 'Route', sample: 'line', color: '#00AAFF' }, { label: 'Photo', sample: 'icon', asset: 'photo' }] }, context);
  assert.equal(find(legend, 'li').length, 2);
  assert.equal(find(legend, 'img')[0].attributes.src, '/photo.svg');
});

test('legacy metric strings retain signed-distance presentation formatting', () => {
  const registry = createContentRendererRegistry({
    ...context,
    metrics: { resolve: () => ({ value: 1250 }) },
    chartRenderer: { render() {} }
  });
  const node = registry.renderBlock({
    type: 'stat-group',
    items: [{ label: 'Added', metric: 'addedLengthMeters', format: 'signed-distance', tone: 'added' }]
  });
  assert.equal(find(node, 'strong')[0].textContent, '+1.3 km');
});
