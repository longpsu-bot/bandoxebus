import test from 'node:test';
import assert from 'node:assert/strict';

import { createCapabilityRegistry } from '../src/capabilities/capability-registry.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import {
  createEditorDescriptorCatalog,
  isGuiAddable,
  renderSchemaControls
} from '../editor/core/descriptors.js';
import {
  createFixtureCapability,
  VALID_CAPABILITY_DESCRIPTOR
} from './fixtures/capabilities/valid-capability.mjs';

test('only explicit trusted gui.addable true permits a new declaration', () => {
  assert.equal(isGuiAddable({ gui: { addable: true } }), true);
  assert.equal(isGuiAddable({ gui: { addable: false } }), false);
  assert.equal(isGuiAddable({ gui: { group: 'Existing only' } }), false);
  assert.equal(isGuiAddable({}), false);

  const descriptor = structuredClone(VALID_CAPABILITY_DESCRIPTOR);
  descriptor.gui.addable = true;
  const registry = createCapabilityRegistry([{ descriptor, createCapability: createFixtureCapability }]);
  const catalog = createEditorDescriptorCatalog({ registry, declarations: [] });
  assert.deepEqual(catalog.addable.map(({ id }) => id), ['fixture-capability-v1']);
});

test('installed Route packs stay non-addable while an existing declaration remains inspectable', () => {
  const catalog = createEditorDescriptorCatalog({
    registry: INSTALLED_CAPABILITY_REGISTRY,
    declarations: [{ id: 'route-comparison-v1', settings: { adapter: 'route-61-2-current' } }]
  });

  assert.equal(catalog.addable.some(({ id }) => id === 'route-comparison-v1'), false);
  assert.equal(catalog.addable.some(({ id }) => id === 'urban-context-v1'), false);
  assert.equal(catalog.existing.find(({ id }) => id === 'route-comparison-v1').declaration.settings.adapter, 'route-61-2-current');
});

test('bounded field controls cover trusted scalar, object, simple-array, and semantic selector shapes', () => {
  const changes = [];
  const rendered = renderSchemaControls({
    type: 'object',
    additionalProperties: false,
    required: ['name', 'mode'],
    properties: {
      name: { type: 'string' },
      mode: { type: 'string', enum: ['one', 'two'] },
      locked: { const: 'fixed' },
      ratio: { type: 'number', minimum: 0, maximum: 1 },
      count: { type: 'integer', minimum: 0 },
      enabled: { type: 'boolean' },
      camera: {
        type: 'object',
        additionalProperties: false,
        properties: { zoom: { type: 'number', minimum: 0, maximum: 24 } }
      },
      tags: { type: 'array', maxItems: 3, items: { type: 'string' } },
      dataset: { type: 'string', gui: { optionsFrom: 'datasets' } }
    }
  }, {
    value: {
      name: 'Fixture', mode: 'one', locked: 'fixed', ratio: 0.5,
      count: 2, enabled: true, camera: { zoom: 10 }, tags: ['a'], dataset: 'route'
    },
    catalogs: { datasets: [{ id: 'route', label: 'Route' }] },
    onChange: (path, value) => changes.push({ path, value })
  });

  assert.equal(rendered.supported, true);
  const controls = Object.fromEntries(rendered.controls.map((control) => [control.path, control]));
  assert.equal(controls['$.name'].kind, 'text');
  assert.equal(controls['$.name'].required, true);
  assert.deepEqual(controls['$.mode'].options.map(({ value }) => value), ['one', 'two']);
  assert.equal(controls['$.locked'].readOnly, true);
  assert.equal(controls['$.ratio'].kind, 'number');
  assert.equal(controls['$.count'].kind, 'integer');
  assert.equal(controls['$.enabled'].kind, 'checkbox');
  assert.equal(controls['$.camera.zoom'].kind, 'number');
  assert.equal(controls['$.tags'].kind, 'array');
  assert.deepEqual(controls['$.dataset'].options, [{ value: 'route', label: 'Route' }]);
  controls['$.count'].set(3);
  assert.deepEqual(changes, [{ path: '$.count', value: 3 }]);
});

test('unsupported schema shapes return GUI_SCHEMA_UNSUPPORTED without a raw JSON escape hatch', () => {
  const rendered = renderSchemaControls({
    type: 'array',
    items: { type: 'object', properties: { arbitrary: {} } }
  });

  assert.equal(rendered.supported, false);
  assert.equal(rendered.code, 'GUI_SCHEMA_UNSUPPORTED');
  assert.equal('rawJson' in rendered, false);
  assert.deepEqual(rendered.controls, []);
});
