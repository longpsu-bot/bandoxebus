import test from 'node:test';
import assert from 'node:assert/strict';

import { validateResolvedReferences } from '../src/project/reference-validator.js';

function context(block) {
  const table = {
    schemaVersion: '1.0',
    columns: [
      { id: 'year', label: 'Year', type: 'integer' },
      { id: 'demand', label: 'Demand', type: 'number' },
      { id: 'name', label: 'Name', type: 'text' }
    ],
    rows: [{ year: 2026, demand: 10, name: 'A' }]
  };
  return {
    manifest: {
      stories: { primary: 'main', items: [{ id: 'main', src: './story.json' }] },
      datasets: { demand: { type: 'table-json', src: './demand.json', label: 'Demand', attribution: ['survey'] } },
      assets: { photo: { type: 'image', src: './photo.svg', mediaType: 'image/svg+xml', attribution: ['photo-credit'] } },
      focusTargets: {}, capabilities: [],
      attribution: { survey: { name: 'Survey' }, 'photo-credit': { name: 'Photo' } }
    },
    story: { schemaVersion: '1.1', states: [{ id: 'state', content: { blocks: [block] }, map: { enter: [], exit: [] } }] },
    resources: new Map([['demand', { descriptor: { type: 'table-json' }, value: table }], ['photo', { kind: 'asset', descriptor: { type: 'image' } }]]),
    metrics: { has: (id) => id === 'ridership' },
    capabilities: { datasetRoles: [] }
  };
}

test('table, chart, metric, image, legend, and attribution references resolve', () => {
  assert.equal(validateResolvedReferences(context({ type: 'table', data: { dataset: 'demand', columns: [{ field: 'name', format: { type: 'text' } }] }, source: 'survey' })), true);
  assert.equal(validateResolvedReferences(context({ type: 'chart', chartType: 'bar', title: 'Demand', data: { dataset: 'demand', x: 'year', series: [{ y: 'demand', label: 'Demand' }] } })), true);
  assert.equal(validateResolvedReferences(context({ type: 'stat-group', items: [{ label: 'Demand', metric: 'ridership', format: { type: 'integer' } }] })), true);
  assert.equal(validateResolvedReferences(context({ type: 'image', asset: 'photo', alt: 'A stop' })), true);
  assert.equal(validateResolvedReferences(context({ type: 'legend', items: [{ label: 'Photo', sample: 'icon', asset: 'photo' }] })), true);
});

test('cross-resource errors retain code, path, and message', () => {
  const invalid = context({ type: 'chart', chartType: 'line', title: 'Demand', data: { dataset: 'demand', x: 'year', series: [{ y: 'missing', label: 'Demand' }] } });
  assert.throws(() => validateResolvedReferences(invalid), (error) => (
    error.code === 'TABLE_COLUMN_UNKNOWN'
      && error.path === '$.states.state.content.blocks[0].data.series[0].y'
      && /missing/.test(error.message)
  ));
  assert.throws(() => validateResolvedReferences(context({ type: 'image', asset: 'missing', alt: 'Missing' })), (error) => error.code === 'ASSET_UNKNOWN');
  assert.throws(() => validateResolvedReferences(context({ type: 'stat-group', items: [{ label: 'X', metric: 'missing', format: { type: 'integer' } }] })), (error) => error.code === 'METRIC_UNKNOWN');
});
