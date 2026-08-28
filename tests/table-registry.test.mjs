import test from 'node:test';
import assert from 'node:assert/strict';

import { createTableRegistry } from '../src/data/table-registry.js';

const table = {
  schemaVersion: '1.0',
  columns: [
    { id: 'year', label: 'Year', type: 'integer' },
    { id: 'boardings', label: 'Boardings', type: 'number' }
  ],
  rows: [{ year: 2026, boardings: 1234.5 }]
};

test('table registry exposes immutable normalized data by stable dataset ID', () => {
  const registry = createTableRegistry([['demand', table]]);
  assert.equal(registry.has('demand'), true);
  assert.deepEqual(registry.columns('demand').map(({ id }) => id), ['year', 'boardings']);
  assert.deepEqual(registry.rows('demand'), [{ year: 2026, boardings: 1234.5 }]);
  assert.throws(() => { registry.rows('demand')[0].boardings = 0; }, TypeError);
  assert.deepEqual(registry.catalog(), [{ id: 'demand', columns: table.columns }]);
});

test('table registry rejects unknown and non-normalized datasets deterministically', () => {
  const registry = createTableRegistry([['demand', table]]);
  assert.throws(() => registry.get('missing'), (error) => error.code === 'TABLE_DATASET_UNKNOWN' && error.path === '$.datasets.missing');
  assert.throws(() => createTableRegistry([['bad', { columns: [], rows: [] }]]), (error) => error.code === 'TABLE_DATA_INVALID');
});
