import test from 'node:test';
import assert from 'node:assert/strict';

import { createDraftStore } from '../editor/core/draft-store.js';
import { createNewProjectEntries, createPackageStore } from '../editor/core/package-store.js';
import { createValidationCoordinator, toProductionDiagnostic } from '../editor/core/validation.js';
import { ProjectLoadError } from '../src/project/project-error.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function validationHarness({ debounceMs = 10_000 } = {}) {
  const packageStore = createPackageStore({
    origin: { kind: 'memory', label: 'Validation fixture' },
    entries: createNewProjectEntries()
  });
  const draftStore = createDraftStore({ packageStore });
  const calls = [];
  const changes = [];
  const coordinator = createValidationCoordinator({
    draftStore,
    capabilityRegistry: { id: 'trusted-registry' },
    debounceMs,
    loadProjectImpl: (manifestUrl, options) => {
      const pending = deferred();
      calls.push({ manifestUrl, options, pending });
      return pending.promise;
    },
    onChange: (state) => changes.push(state)
  });
  return { packageStore, draftStore, calls, changes, coordinator };
}

test('invalid draft keeps the previous valid preview snapshot', async () => {
  const harness = validationHarness();
  const firstRun = harness.coordinator.validateNow();
  harness.calls[0].pending.resolve({ manifest: { title: 'Valid' } });
  await firstRun;
  const first = harness.coordinator.lastValid;

  harness.draftStore.mutate('project.json', (manifest) => { manifest.title = ''; });
  const invalidRun = harness.coordinator.validateNow();
  harness.calls[1].pending.reject(new ProjectLoadError('PROJECT_MANIFEST_INVALID', '$.title', 'Title is required.'));
  await invalidRun;

  assert.equal(harness.coordinator.lastValid, first);
  assert.equal(harness.coordinator.status, 'invalid');
  assert.deepEqual(harness.coordinator.diagnostics[0], {
    code: 'PROJECT_MANIFEST_INVALID',
    path: '$.title',
    message: 'Title is required.',
    packagePath: 'project.json',
    revision: 1
  });
  harness.coordinator.dispose();
});

test('first invalid revision has no last-valid project', async () => {
  const harness = validationHarness();
  const run = harness.coordinator.validateNow();
  harness.calls[0].pending.reject(new ProjectLoadError('PROJECT_MANIFEST_INVALID', '$.title', 'Title is required.'));
  await run;

  assert.equal(harness.coordinator.status, 'invalid');
  assert.equal(harness.coordinator.lastValid, null);
  harness.coordinator.dispose();
});

test('a stale validation completion cannot win and a mutation aborts its signal', async () => {
  const harness = validationHarness();
  const oldRun = harness.coordinator.validateNow();
  const oldCall = harness.calls[0];

  harness.draftStore.mutate('project.json', (manifest) => { manifest.title = 'New'; });
  assert.equal(oldCall.options.signal.aborted, true);
  const newRun = harness.coordinator.validateNow();
  const newCall = harness.calls[1];
  newCall.pending.resolve({ manifest: { title: 'New' } });
  await newRun;

  oldCall.pending.resolve({ manifest: { title: 'Old' } });
  await oldRun;
  assert.equal(harness.coordinator.lastValid.revision, 1);
  assert.equal(harness.coordinator.lastValid.project.manifest.title, 'New');
  harness.coordinator.dispose();
});

test('a valid repair promotes a structured-cloned newer snapshot', async () => {
  const harness = validationHarness();
  const firstRun = harness.coordinator.validateNow();
  harness.calls[0].pending.reject(new ProjectLoadError('PROJECT_MANIFEST_INVALID', '$.title', 'Title is required.'));
  await firstRun;

  harness.draftStore.mutate('project.json', (manifest) => { manifest.title = 'Repaired'; });
  const repairRun = harness.coordinator.validateNow();
  harness.calls[1].pending.resolve({ manifest: { title: 'Repaired' } });
  await repairRun;

  const promoted = harness.coordinator.lastValid;
  assert.equal(promoted.revision, 1);
  assert.equal(harness.coordinator.status, 'valid');
  harness.packageStore.get('project.json').currentBytes[0] = 0;
  assert.notEqual(promoted.snapshot.entries.find(({ path }) => path === 'project.json').bytes[0], 0);
  harness.coordinator.dispose();
});

test('production diagnostics retain stable fields without parsing message text', () => {
  const error = new ProjectLoadError('RESOURCE_INVALID', '$.datasets.route', 'Fixture failed.');
  assert.deepEqual(toProductionDiagnostic(error, { packagePath: 'data/route.geojson', revision: 7 }), {
    code: 'RESOURCE_INVALID',
    path: '$.datasets.route',
    message: 'Fixture failed.',
    packagePath: 'data/route.geojson',
    revision: 7
  });
});
