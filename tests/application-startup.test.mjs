import assert from 'node:assert/strict';
import test from 'node:test';

import { startApplication } from '../src/application.js';
import { ProjectLoadError } from '../src/project/project-error.js';

test('fatal project load never enters interactive bootstrap', async () => {
  const failure = new ProjectLoadError('PROJECT_MANIFEST_INVALID', '$.title', 'Title is required.');
  let bootstrapCalls = 0;
  await assert.rejects(
    startApplication({
      loadProjectImpl: async () => { throw failure; },
      bootstrapImpl: async () => { bootstrapCalls += 1; }
    }),
    (error) => error === failure
  );
  assert.equal(bootstrapCalls, 0);
});

test('startup calls loader and bootstrap once with the same project and abort signal', async () => {
  const controller = new AbortController();
  const project = { id: 'validated' };
  const calls = [];
  const runtime = { destroy() {} };
  const result = await startApplication({
    manifestUrl: './fixture.json',
    signal: controller.signal,
    loadProjectImpl: async (url, options) => {
      calls.push(['load', url, options.signal]);
      return project;
    },
    bootstrapImpl: async (options) => {
      calls.push(['bootstrap', options.project, options.signal]);
      return runtime;
    }
  });
  assert.equal(result, runtime);
  assert.deepEqual(calls, [
    ['load', './fixture.json', controller.signal],
    ['bootstrap', project, controller.signal]
  ]);
});

test('an owner replaces an in-flight start only when explicitly requested', async () => {
  const owner = {};
  let firstSignal;
  let resolveFirst;
  const first = startApplication({
    owner,
    loadProjectImpl: async (_url, { signal }) => {
      firstSignal = signal;
      return new Promise((resolve, reject) => {
        resolveFirst = resolve;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    bootstrapImpl: async () => ({})
  });
  await Promise.resolve();

  const second = startApplication({
    owner,
    replaceExisting: true,
    loadProjectImpl: async () => ({ id: 'second' }),
    bootstrapImpl: async ({ project }) => project
  });
  await assert.rejects(first, (error) => error.name === 'AbortError');
  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(await second, { id: 'second' });
  resolveFirst?.({ id: 'too-late' });
});
