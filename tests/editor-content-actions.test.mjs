import assert from 'node:assert/strict';
import test from 'node:test';

import { CORE_MAP_V1_DESCRIPTOR } from '../src/capabilities/core-map-v1.js';
import { ROUTE_COMPARISON_V1_DESCRIPTOR } from '../src/capabilities/route-comparison-v1.js';
import { CONTENT_BLOCK_DESCRIPTORS } from '../src/content/content-descriptors.js';
import {
  createCanonicalAction,
  createContentActionEditor,
  createContentBlock
} from '../editor/ui/content-actions.js';

const catalogs = {
  metrics: [{ id: 'demand', format: { type: 'integer' } }],
  assets: [{ id: 'photo' }],
  targets: [{ id: 'service-area' }, { id: 'overview' }],
  actionTargets: {
    'map.focus': [{ id: 'service-area' }, { id: 'overview' }],
    'map.set-visibility': [{ id: 'service-area' }],
    'map.set-emphasis': [{ id: 'service-area' }]
  },
  tables: [{ id: 'demand-table', columns: [
    { id: 'name', type: 'text' }, { id: 'year', type: 'integer' }, { id: 'value', type: 'number' }
  ] }],
  attribution: [{ id: 'survey' }]
};

function story() {
  return {
    schemaVersion: '1.1', id: 'main', title: 'Main', states: [{
      id: 'opening', content: { layout: 'hero', blocks: [{ type: 'heading', text: 'Opening' }] },
      map: { enter: [], exit: [] }
    }]
  };
}

function harness() {
  let current = story();
  const ui = createContentActionEditor({
    story: current,
    contentDescriptors: CONTENT_BLOCK_DESCRIPTORS,
    actionDescriptors: [...CORE_MAP_V1_DESCRIPTOR.actions, ...ROUTE_COMPARISON_V1_DESCRIPTOR.actions],
    catalogs,
    save(next) { current = structuredClone(next); ui.replaceStory(current); }
  });
  return { ui, story: () => current };
}

test('canonical action objects come directly from production descriptors and semantic catalogs', () => {
  const action = createCanonicalAction('map.set-visibility', CORE_MAP_V1_DESCRIPTOR.actions, {
    target: 'service-area', visible: true
  });
  assert.deepEqual(action, { type: 'map.set-visibility', target: 'service-area', visible: true });
  assert.equal(action.target.includes('layer-'), false);
});

test('content factory creates the smallest production object for every composed block descriptor', () => {
  const { ui } = harness();
  assert.deepEqual(ui.contentTypes(), CONTENT_BLOCK_DESCRIPTORS.map(({ type }) => type));
  const blocks = Object.fromEntries(CONTENT_BLOCK_DESCRIPTORS.map(({ type }) => [
    type, createContentBlock(type, { descriptors: CONTENT_BLOCK_DESCRIPTORS, ...catalogs })
  ]));
  assert.deepEqual(Object.keys(blocks), ['eyebrow', 'heading', 'paragraph', 'stat-group', 'callout', 'disclosure', 'table', 'chart', 'image', 'legend']);
  assert.deepEqual(blocks.table.data, { dataset: 'demand-table', columns: [{ field: 'name' }] });
  assert.equal(blocks.chart.chartType, 'bar');
  assert.equal(blocks.chart.data.x, 'name');
  assert.equal(blocks.chart.data.series[0].y, 'year');
  assert.deepEqual(blocks.image, { type: 'image', asset: 'photo', alt: '', decorative: true });
  assert.deepEqual(blocks.legend.items[0], { label: '', sample: 'swatch', color: '#000000' });
});

test('table and chart editors use declared columns, numeric series, and bar-only stacking', () => {
  const { ui } = harness();
  const table = createContentBlock('table', { descriptors: CONTENT_BLOCK_DESCRIPTORS, ...catalogs });
  assert.deepEqual(ui.tableColumnOptions(table), ['name', 'year', 'value']);
  const chart = createContentBlock('chart', { descriptors: CONTENT_BLOCK_DESCRIPTORS, ...catalogs });
  assert.deepEqual(ui.chartXOptions(chart), ['name', 'year']);
  assert.deepEqual(ui.chartSeriesOptions(chart), ['year', 'value']);
  assert.deepEqual(ui.chartTypeOptions(), ['bar', 'line', 'area']);
  ui.setChartStacked(chart, true);
  assert.equal(chart.stacked, true);
  chart.chartType = 'line';
  assert.throws(() => ui.setChartStacked(chart, true), /bar charts/i);
  assert.equal('chartJs' in ui, false);
  assert.equal('rawConfig' in chart, false);
});

test('image and legend tailored editors enforce production invariants', () => {
  const { ui } = harness();
  const image = { type: 'image', asset: 'photo', alt: 'Photo' };
  ui.setImageDecorative(image, true);
  assert.deepEqual(image, { type: 'image', asset: 'photo', alt: '', decorative: true });
  assert.throws(() => ui.setImageAlt(image, 'Not empty'), /decorative/i);

  const swatch = { label: 'Area', sample: 'swatch', color: '#00AAFF' };
  ui.setLegendSample(swatch, 'icon');
  assert.equal('color' in swatch, false);
  assert.equal(swatch.asset, 'photo');
  ui.setLegendSample(swatch, 'line');
  assert.equal('asset' in swatch, false);
  assert.equal(swatch.color, '#000000');
});

test('content blocks move, duplicate, and delete while preserving a non-empty state', () => {
  const { ui, story: current } = harness();
  ui.command('add-block', { stateIndex: 0, type: 'paragraph' });
  ui.command('duplicate-block', { stateIndex: 0, blockIndex: 1 });
  ui.command('move-block', { stateIndex: 0, from: 2, to: 0 });
  assert.deepEqual(current().states[0].content.blocks.map(({ type }) => type), ['paragraph', 'heading', 'paragraph']);
  ui.command('delete-block', { stateIndex: 0, blockIndex: 2 });
  ui.command('delete-block', { stateIndex: 0, blockIndex: 1 });
  assert.throws(() => ui.command('delete-block', { stateIndex: 0, blockIndex: 0 }), /at least one block/i);
});

test('all ten content block production shapes can be added and edited without raw configuration', () => {
  const { ui, story: current } = harness();
  const edits = {
    eyebrow: ['text', 'Step 1'],
    heading: ['text', 'A heading'],
    paragraph: ['text', 'A paragraph'],
    'stat-group': ['items', [{ label: 'Demand', metric: 'demand', format: { type: 'integer' } }]],
    callout: ['items', [{ text: 'Important', tone: 'added' }]],
    disclosure: ['text', 'Source note'],
    table: ['caption', 'Demand table'],
    chart: ['description', 'Demand chart'],
    image: ['caption', 'Network map'],
    legend: ['title', 'Legend']
  };
  for (const [type, [path, value]] of Object.entries(edits)) {
    ui.command('add-block', { stateIndex: 0, type });
    const blockIndex = current().states[0].content.blocks.length - 1;
    ui.command('edit-block', { stateIndex: 0, blockIndex, path, value });
    assert.deepEqual(current().states[0].content.blocks[blockIndex][path], value);
  }
  assert.equal(current().states[0].content.blocks.some((block) => 'maplibre' in block || 'chartJs' in block), false);
});

test('Enter and Exit canonical actions retain order and include common and capability discovery', () => {
  const { ui, story: current } = harness();
  assert.deepEqual(ui.actionTypes().filter((type) => type.startsWith('map.')), [
    'map.focus', 'map.set-visibility', 'map.set-emphasis', 'map.clear-emphasis'
  ]);
  assert.equal(ui.actionTypes().includes('route.set-mode'), true);
  ui.command('add-action', { stateIndex: 0, phase: 'enter', type: 'map.focus', values: { target: 'overview' } });
  ui.command('add-action', { stateIndex: 0, phase: 'enter', type: 'map.set-visibility', values: { target: 'service-area', visible: true } });
  ui.command('edit-action', { stateIndex: 0, phase: 'enter', actionIndex: 1, path: 'visible', value: false });
  ui.command('duplicate-action', { stateIndex: 0, phase: 'enter', actionIndex: 0 });
  ui.command('move-action', { stateIndex: 0, phase: 'enter', from: 2, to: 1 });
  ui.command('add-action', { stateIndex: 0, phase: 'exit', type: 'map.clear-emphasis' });
  assert.deepEqual(current().states[0].map.enter.map(({ type }) => type), ['map.focus', 'map.set-visibility', 'map.focus']);
  assert.equal(current().states[0].map.enter[1].visible, false);
  assert.deepEqual(current().states[0].map.exit, [{ type: 'map.clear-emphasis' }]);
  ui.command('delete-action', { stateIndex: 0, phase: 'enter', actionIndex: 1 });
  assert.equal(current().states[0].map.enter.length, 2);
});

test('action controls expose semantic targets without raw MapLibre IDs', () => {
  const { ui } = harness();
  const controls = ui.actionControls('map.set-visibility', { target: 'service-area', visible: true });
  assert.equal(controls.supported, true);
  const target = controls.controls.find(({ path }) => path.endsWith('.target'));
  assert.deepEqual(target.options.map(({ value }) => value), ['service-area']);
  assert.equal(target.options.some(({ value }) => value.includes('layer-') || value.includes('source-')), false);
  assert.equal(ui.actionControls('map.clear-emphasis').controls.some(({ path }) => path.endsWith('.target')), false);
});

test('trusted capability actions use descriptor catalogs and reject unsafe free-form target schemas', () => {
  const trusted = {
    type: 'fixture.show', label: 'Show fixture', parameters: {
      type: 'object', additionalProperties: false, required: ['type', 'target'],
      properties: {
        type: { const: 'fixture.show' },
        target: { type: 'string', gui: { optionsFrom: 'capabilityTargets' } }
      }
    }
  };
  const unsafe = {
    type: 'fixture.unsafe', label: 'Unsafe fixture', parameters: {
      type: 'object', additionalProperties: false, required: ['type', 'target'],
      properties: { type: { const: 'fixture.unsafe' }, target: { type: 'string' } }
    }
  };
  const ui = createContentActionEditor({
    story: story(), contentDescriptors: CONTENT_BLOCK_DESCRIPTORS,
    actionDescriptors: [...CORE_MAP_V1_DESCRIPTOR.actions, trusted, unsafe],
    catalogs: { ...catalogs, capabilityTargets: [{ id: 'fixture-area', label: 'Fixture area' }] },
    save() {}
  });

  assert.equal(ui.actionTypes().includes('fixture.show'), true);
  assert.deepEqual(
    ui.actionControls('fixture.show').controls.find(({ path }) => path.endsWith('.target')).options,
    [{ value: 'fixture-area', label: 'Fixture area' }]
  );
  assert.equal(ui.actionControls('fixture.unsafe').code, 'GUI_SCHEMA_UNSUPPORTED');
});

test('unsupported descriptor shapes return stable GUI diagnostics', () => {
  const unsupported = [{
    type: 'custom.open', label: 'Open', parameters: {
      type: 'object', additionalProperties: true,
      properties: { type: { const: 'custom.open' } }
    }
  }];
  const ui = createContentActionEditor({ story: story(), contentDescriptors: CONTENT_BLOCK_DESCRIPTORS, actionDescriptors: unsupported, catalogs, save() {} });
  assert.deepEqual(ui.actionControls('custom.open', {}), {
    supported: false,
    code: 'GUI_SCHEMA_UNSUPPORTED',
    path: '$.action',
    message: 'Only closed object descriptor schemas are supported.',
    controls: []
  });
  assert.throws(() => createCanonicalAction('missing', unsupported), (error) => error.code === 'GUI_SCHEMA_UNSUPPORTED');
});
