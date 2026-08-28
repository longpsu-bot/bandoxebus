import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CONTENT_BLOCK_DESCRIPTORS } from '../src/content/content-descriptors.js';
import { CORE_CONTENT_V1_DESCRIPTOR } from '../src/capabilities/core-content-v1.js';
import { STORY_SCHEMA_VERSIONS, getStorySchema, validateStoryDefinition } from '../src/story-schema.js';

function story(version, blocks) {
  return { schemaVersion: version, id: 'fixture', title: 'Fixture', states: [{ id: 'state', content: { layout: 'narrative', blocks }, map: { enter: [], exit: [] } }] };
}

const newBlocks = [
  { type: 'table', title: 'Table', data: { dataset: 'demand', columns: [{ field: 'name', header: 'Name', align: 'start', format: { type: 'text' } }] } },
  { type: 'chart', chartType: 'bar', title: 'Chart', description: 'Demand', data: { dataset: 'demand', x: 'name', series: [{ y: 'value', label: 'Value' }] } },
  { type: 'image', asset: 'photo', alt: 'A stop' },
  { type: 'legend', items: [{ label: 'Route', sample: 'line', color: '#00AAFF' }] }
];

test('Story 1.0 remains unchanged while 1.1 adds exactly four blocks', () => {
  assert.deepEqual(STORY_SCHEMA_VERSIONS, ['1.0', '1.1']);
  const old = story('1.0', [{ type: 'heading', text: 'Old' }]);
  assert.equal(validateStoryDefinition(old, { actionContracts: {} }), old);
  const next = story('1.1', [{ type: 'heading', text: 'New' }, ...newBlocks]);
  assert.equal(validateStoryDefinition(next, { actionContracts: {} }), next);
  assert.throws(() => validateStoryDefinition(story('1.0', newBlocks), { actionContracts: {} }), /unsupported content block.*table/i);
  assert.equal(getStorySchema('1.1').properties.schemaVersion.const, '1.1');
});

test('descriptor catalog is the single runtime and GUI discovery authority', () => {
  assert.deepEqual(CONTENT_BLOCK_DESCRIPTORS.map(({ type }) => type), ['eyebrow', 'heading', 'paragraph', 'stat-group', 'callout', 'disclosure', 'table', 'chart', 'image', 'legend']);
  assert.deepEqual(CORE_CONTENT_V1_DESCRIPTOR.content, CONTENT_BLOCK_DESCRIPTORS);
  const invalid = story('1.1', [{ type: 'image', asset: 'photo', alt: 'Photo', html: '<b>unsafe</b>' }]);
  assert.throws(() => validateStoryDefinition(invalid, { actionContracts: {} }), /unknown property/i);
});

test('Route 61-2 remains byte-identical Story 1.0', async () => {
  const route = await readFile(new URL('../data/stories/route-61-2.story.json', import.meta.url), 'utf8');
  assert.match(route, /"schemaVersion": "1\.0"/);
});
