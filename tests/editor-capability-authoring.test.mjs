import assert from 'node:assert/strict';
import test from 'node:test';

import { createCapabilityRegistry } from '../src/capabilities/capability-registry.js';
import { renderEntityInspector } from '../editor/ui/inspectors.js';

function descriptor(id, overrides = {}) {
  return {
    schemaVersion: '1.0', id, label: id, description: `${id} descriptor`,
    requires: [], datasetRoles: [], actions: [], content: [], targets: [], metrics: [],
    legacyActions: [], lifecycle: [],
    settingsSchema: { type: 'object', additionalProperties: false, properties: {} },
    ...overrides
  };
}

function action(type) {
  return { type, label: type, description: type, parameters: {
    type: 'object', additionalProperties: false, required: ['type'], properties: { type: { const: type } }
  } };
}

const roles = [
  { role: 'route.proposed', types: ['geojson'], geometry: ['line'], required: true, render: true },
  { role: 'stops.existing', types: ['geojson'], geometry: ['point'], required: false, render: true }
];

function registry() {
  const entries = [
    descriptor('core-content-v1'),
    descriptor('core-map-v1'),
    descriptor('route-comparison-v1', {
      requires: ['core-map-v1'], datasetRoles: roles,
      actions: [action('route.set-mode')],
      metrics: [{ id: 'route-length', label: 'Route length', valueType: 'number', format: { type: 'distance' } }],
      settingsSchema: { type: 'object', additionalProperties: false, properties: { adapter: { type: 'string', enum: ['route-61-2-current'] } } }
    }),
    descriptor('addable-map-v1', {
      requires: ['core-map-v1'], gui: { addable: true }, datasetRoles: roles,
      actions: [action('custom.show')],
      targets: [{ id: 'custom-area', label: 'Custom area', kind: 'map' }],
      metrics: [{ id: 'custom-count', label: 'Custom count', valueType: 'number', format: { type: 'integer' } }],
      settingsSchema: {
        type: 'object', additionalProperties: false, required: ['mode'],
        properties: { mode: { type: 'string', enum: ['safe', 'detailed'] } }
      }
    }),
    descriptor('private-base-v1'),
    descriptor('blocked-addon-v1', { requires: ['private-base-v1'], gui: { addable: true } })
  ];
  return createCapabilityRegistry(entries.map((value) => ({ descriptor: value, createCapability: () => ({ datasetRoles: {} }) })));
}

function harness({ declarations = [] } = {}) {
  const manifest = {
    capabilities: structuredClone(declarations),
    datasets: {
      route: { type: 'geojson', geometry: 'line', src: './data/route.geojson', label: 'Route' },
      stops: { type: 'geojson', geometry: 'point', src: './data/stops.geojson', label: 'Stops' },
      table: { type: 'table-json', src: './data/table.json', label: 'Table' }
    }
  };
  const stories = { main: { states: [{ content: { blocks: [] }, map: { enter: [{ type: 'custom.show' }], exit: [] } }] } };
  const ui = renderEntityInspector({
    kind: 'capability', manifest, registry: registry(), stories,
    mutate: (updater) => updater(manifest)
  });
  return { manifest, ui };
}

test('existing non-addable declaration is editable but absent from Add Capability', () => {
  const { ui, manifest } = harness({ declarations: [{ id: 'route-comparison-v1', settings: { adapter: 'route-61-2-current' } }] });
  assert.equal(ui.existingIds().includes('route-comparison-v1'), true);
  assert.equal(ui.addableIds().includes('route-comparison-v1'), false);
  assert.equal(ui.settingsControl('route-comparison-v1', 'adapter').value, 'route-61-2-current');
  ui.settingsControl('route-comparison-v1', 'adapter').set('route-61-2-current');
  assert.equal(manifest.capabilities[0].settings.adapter, 'route-61-2-current');
});

test('explicitly addable capability creates supported settings and discovers owned public catalogs', () => {
  const { ui, manifest } = harness();
  assert.equal(ui.addableIds().includes('addable-map-v1'), true);
  assert.deepEqual(ui.command('add', 'addable-map-v1'), ['addable-map-v1']);
  assert.deepEqual(manifest.capabilities, [{ id: 'addable-map-v1', settings: { mode: 'safe' } }]);
  ui.settingsControl('addable-map-v1', 'mode').set('detailed');
  assert.equal(manifest.capabilities[0].settings.mode, 'detailed');
  assert.deepEqual(ui.discovered(), {
    actions: ['custom.show'], targets: ['custom-area'], metrics: ['custom-count']
  });
});

test('required and optional roles list compatible datasets and bind only public role IDs', () => {
  const { ui, manifest } = harness({ declarations: [{ id: 'addable-map-v1', settings: { mode: 'safe' } }] });
  assert.deepEqual(ui.roles('addable-map-v1').map(({ role, required, compatibleDatasets }) => ({ role, required, compatibleDatasets })), [
    { role: 'route.proposed', required: true, compatibleDatasets: ['route'] },
    { role: 'stops.existing', required: false, compatibleDatasets: ['stops'] }
  ]);
  ui.bindRole('addable-map-v1', 'route.proposed', 'route');
  assert.equal(manifest.datasets.route.role, 'route.proposed');
  assert.throws(() => ui.bindRole('addable-map-v1', 'route.proposed', 'table'), /incompatible/i);
});

test('non-addable missing dependency is explained and never silently declared', () => {
  const { ui, manifest } = harness();
  assert.match(ui.dependencyExplanation('blocked-addon-v1'), /private-base-v1.*not explicitly addable/i);
  assert.throws(() => ui.command('add', 'blocked-addon-v1'), (error) => error.code === 'GUI_CAPABILITY_DEPENDENCY_UNAVAILABLE');
  assert.deepEqual(manifest.capabilities, []);
});

test('remove impact reports dependencies, bound roles, and Story references before cleanup', () => {
  const { ui, manifest } = harness({ declarations: [{ id: 'addable-map-v1', settings: { mode: 'safe' } }] });
  ui.bindRole('addable-map-v1', 'route.proposed', 'route');
  assert.deepEqual(ui.removeImpact('addable-map-v1'), {
    requiredBy: [], boundDatasets: ['route'], storyReferences: ['stories.main.states[0].map.enter[0]']
  });
  ui.command('confirm-remove', 'addable-map-v1');
  assert.deepEqual(manifest.capabilities, []);
  assert.equal('role' in manifest.datasets.route, false);
});
