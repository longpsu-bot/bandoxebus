import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../src/runtime/generic-app.js', import.meta.url);

test('normal and preview transports share the same production composition', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.match(source, /export function createGenericApplicationOptions\(/);
  assert.match(source, /export function startGenericProductionApplication\(/);
  assert.match(source, /startApplication\(createGenericApplicationOptions\(transport\)\)/);
  assert.match(source, /capabilityRegistry:\s*INSTALLED_CAPABILITY_REGISTRY/);
  assert.match(source, /createMap:\s*createGenericMap/);
  assert.match(source, /bindStoryExperience:\s*bindGenericStoryExperience/);
  assert.match(source, /startProductionApplication:\s*startGenericProductionApplication/);
  assert.match(source, /initialize\(\)[\s\S]*?startGenericProductionApplication\(\)/);
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
});
