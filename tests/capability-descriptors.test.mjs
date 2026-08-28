import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCapabilityRegistry
} from '../src/capabilities/capability-registry.js';
import {
  validateCapabilityDescriptor
} from '../src/capabilities/descriptor-schema.js';
import {
  fixtureEntry,
  VALID_CAPABILITY_DESCRIPTOR
} from './fixtures/capabilities/valid-capability.mjs';

function cloneEntry() {
  return {
    descriptor: structuredClone(VALID_CAPABILITY_DESCRIPTOR),
    createCapability: fixtureEntry.createCapability
  };
}

function assertDescriptorIssue(mutator, path, message = /./) {
  const entry = cloneEntry();
  mutator(entry.descriptor);
  assert.throws(
    () => validateCapabilityDescriptor(entry.descriptor),
    (error) => error.code === 'CAPABILITY_DESCRIPTOR_INVALID'
      && error.path === path
      && message.test(error.message)
  );
}

test('trusted registry exposes a serializable catalog but keeps factories private', () => {
  const registry = createCapabilityRegistry([fixtureEntry]);
  assert.deepEqual(registry.ids, ['fixture-capability-v1']);
  assert.equal(registry.has('fixture-capability-v1'), true);
  assert.equal(registry.get('fixture-capability-v1').createCapability, fixtureEntry.createCapability);

  const catalog = registry.catalog();
  assert.deepEqual(catalog, [VALID_CAPABILITY_DESCRIPTOR]);
  assert.equal(JSON.stringify(catalog).includes('createCapability'), false);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog[0]), true);
});

test('trusted registry rejects duplicate IDs and invalid factory entries without executing them', () => {
  let calls = 0;
  const entry = cloneEntry();
  entry.createCapability = () => { calls += 1; };
  createCapabilityRegistry([entry]);
  assert.equal(calls, 0);

  assert.throws(
    () => createCapabilityRegistry([fixtureEntry, fixtureEntry]),
    (error) => error.code === 'CAPABILITY_DUPLICATE' && /duplicate capability/i.test(error.message)
  );
  assert.throws(
    () => createCapabilityRegistry([{ descriptor: VALID_CAPABILITY_DESCRIPTOR, createCapability: './factory.js' }]),
    (error) => error.code === 'CAPABILITY_ENTRY_INVALID'
      && error.path === '$.entries[0].createCapability'
  );
});

test('descriptor validation rejects executable and non-serializable values at their paths', () => {
  assertDescriptorIssue(
    (descriptor) => { descriptor.actions[0].gui.options = () => ['one']; },
    '$.actions[0].gui.options',
    /serializable|function/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.gui.created = new Date(); },
    '$.gui.created',
    /plain|serializable/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.gui.help = undefined; },
    '$.gui.help',
    /serializable/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.module = './capability.js'; },
    '$.module',
    /executable|module/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.gui.factoryUrl = 'https://example.org/factory.js'; },
    '$.gui.factoryUrl',
    /executable|URL/i
  );

  const cyclic = cloneEntry().descriptor;
  cyclic.gui.self = cyclic;
  assert.throws(
    () => validateCapabilityDescriptor(cyclic),
    (error) => error.code === 'CAPABILITY_DESCRIPTOR_INVALID'
      && error.path === '$.gui.self'
      && /cyclic|serializable/i.test(error.message)
  );
});

test('descriptor identity and declarations use stable unique contract IDs', () => {
  assertDescriptorIssue((descriptor) => { descriptor.id = 'Invalid ID'; }, '$.id', /ID/i);
  assertDescriptorIssue((descriptor) => { descriptor.schemaVersion = '2.0'; }, '$.schemaVersion', /version/i);
  assertDescriptorIssue(
    (descriptor) => { descriptor.actions[0].type = 'invalid-action'; },
    '$.actions[0].type',
    /action type/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.actions.push(structuredClone(descriptor.actions[0])); },
    '$.actions[1].type',
    /duplicate action/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.metrics[0].valueType = 'function'; },
    '$.metrics[0].valueType',
    /metric value type/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.datasetRoles[0].types = ['script']; },
    '$.datasetRoles[0].types[0]',
    /dataset type/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.datasetRoles[0].role = 'Invalid Role'; },
    '$.datasetRoles[0].role',
    /role/i
  );
});

test('action parameter schemas own the canonical action type contract', () => {
  assert.equal(validateCapabilityDescriptor(VALID_CAPABILITY_DESCRIPTOR), VALID_CAPABILITY_DESCRIPTOR);
  assertDescriptorIssue(
    (descriptor) => { descriptor.actions[0].parameters.properties.type.const = 'private.set-mode'; },
    '$.actions[0].parameters.properties.type.const',
    /canonical action type/i
  );
  assertDescriptorIssue(
    (descriptor) => { descriptor.actions[0].parameters.additionalProperties = true; },
    '$.actions[0].parameters.additionalProperties',
    /additionalProperties/i
  );
});
