import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../src/app.js', import.meta.url);

test('normal and preview transports share the same production composition', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.match(source, /export function createProductionApplicationOptions\(/);
  assert.match(source, /export function startProductionApplication\(/);
  assert.match(source, /startApplication\(createProductionApplicationOptions\(transport\)\)/);
  assert.match(source, /capabilityRegistry:\s*INSTALLED_CAPABILITY_REGISTRY/);
  assert.match(source, /createMap:\s*createRouteMap/);
  assert.match(source, /bindStoryExperience:\s*bindRouteStoryExperience/);
  assert.match(source, /initialize\(\)[\s\S]*?startProductionApplication\(\)/);
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
});
