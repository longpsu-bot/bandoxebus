import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createChartEnvelope,
  createImageEnvelope,
  createLegendEnvelope,
  createMetricEnvelope,
  createTableEnvelope
} from '../editor/core/scene-object-factories.js';
import { createScene12 } from '../editor/core/scene-commands.js';
import { validateStoryDefinition } from '../src/story-schema.js';

const catalogs = {
  metrics: [{ id: 'ridership', label: 'Daily ridership', format: { type: 'integer' } }],
  tables: [{
    id: 'service-levels',
    columns: [
      { id: 'period', label: 'Period', type: 'text' },
      { id: 'trips', label: 'Trips', type: 'integer' }
    ]
  }],
  assets: [{ id: 'network-map' }]
};

function storyWith(envelope) {
  return {
    schemaVersion: '1.2', id: 'main', title: 'Main',
    states: [createScene12({
      id: 'opening',
      camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 },
      blocks: [envelope]
    })]
  };
}

test('rich factories wrap only existing semantic descriptors in valid Story 1.2 envelopes', () => {
  const cases = [
    [createMetricEnvelope, 'stat-group'],
    [createChartEnvelope, 'chart'],
    [createTableEnvelope, 'table'],
    [createImageEnvelope, 'image'],
    [createLegendEnvelope, 'legend']
  ];

  for (const [factory, type] of cases) {
    const envelope = factory({ catalogs, usedIds: [] });
    assert.equal(envelope.block.type, type);
    assert.deepEqual(Object.keys(envelope).sort(), ['block', 'frame', 'id']);
    assert.equal(validateStoryDefinition(storyWith(envelope), { actionContracts: {} }).states[0].content.blocks[0].block.type, type);
  }
});

test('chart and image factories expose bounded production semantics only', () => {
  const chart = createChartEnvelope({ catalogs, usedIds: [] }).block;
  assert.deepEqual(chart, {
    type: 'chart', chartType: 'bar', title: 'Trips',
    data: { dataset: 'service-levels', x: 'period', series: [{ y: 'trips', label: 'Trips' }] }
  });
  assert.equal('config' in chart, false, 'raw Chart.js configuration must never be authored');
  assert.equal('options' in chart, false, 'raw Chart.js options must never be authored');

  const image = createImageEnvelope({ catalogs, usedIds: [] }).block;
  assert.deepEqual(image, { type: 'image', asset: 'network-map', alt: '', decorative: true });
  for (const forbidden of ['crop', 'focalPoint', 'fit']) assert.equal(forbidden in image, false);
});

test('factories require the declared catalog entry needed by their descriptor', () => {
  assert.throws(() => createMetricEnvelope({ catalogs: {}, usedIds: [] }), /declared metric/i);
  assert.throws(() => createChartEnvelope({ catalogs: {}, usedIds: [] }), /normalized table/i);
  assert.throws(() => createImageEnvelope({ catalogs: {}, usedIds: [] }), /image asset/i);
});

test('rich factories bind the explicitly selected production resource', () => {
  const choices = {
    metrics: [
      ...catalogs.metrics,
      { id: 'on-time', label: 'On-time trips', format: { type: 'percentage' } }
    ],
    tables: [
      ...catalogs.tables,
      {
        id: 'ridership-by-stop',
        columns: [
          { id: 'stop', label: 'Stop', type: 'text' },
          { id: 'boardings', label: 'Boardings', type: 'number' }
        ]
      }
    ],
    assets: [...catalogs.assets, { id: 'stop-photo' }]
  };

  const metric = createMetricEnvelope({ catalogs: choices, metricId: 'on-time' }).block;
  const chart = createChartEnvelope({ catalogs: choices, datasetId: 'ridership-by-stop', chartType: 'line' }).block;
  const table = createTableEnvelope({ catalogs: choices, datasetId: 'ridership-by-stop' }).block;
  const image = createImageEnvelope({ catalogs: choices, assetId: 'stop-photo' }).block;

  assert.equal(metric.items[0].metric, 'on-time');
  assert.equal(chart.data.dataset, 'ridership-by-stop');
  assert.equal(chart.chartType, 'line');
  assert.equal(table.data.dataset, 'ridership-by-stop');
  assert.equal(image.asset, 'stop-photo');
  for (const envelope of [metric, chart, table, image]) {
    assert.equal(JSON.stringify(envelope).includes('chooser'), false);
    assert.equal(JSON.stringify(envelope).includes('pending'), false);
  }
});

test('an unknown or incompatible explicit resource is rejected before Story mutation', () => {
  assert.throws(() => createMetricEnvelope({ catalogs, metricId: 'missing' }), /unknown metric/i);
  assert.throws(() => createImageEnvelope({ catalogs, assetId: 'missing' }), /unknown image asset/i);
  assert.throws(() => createChartEnvelope({
    catalogs: { tables: [{ id: 'labels-only', columns: [{ id: 'label', type: 'text' }] }] },
    datasetId: 'labels-only'
  }), /categorical x column and a numeric series column/i);
});
