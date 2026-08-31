import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../src/app.js', import.meta.url);
const genericAppUrl = new URL('../src/runtime/generic-app.js', import.meta.url);
const genericShellUrl = new URL('../src/runtime/generic-shell.js', import.meta.url);

test('root application delegates only to the neutral production entry', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.match(source, /^import ['"]\.\/runtime\/generic-app\.js['"];?\s*$/);
  assert.doesNotMatch(source, /route-61-2|route-data|transport-poi|urban-context|simulation/i);
});

test('neutral production entry uses the same bootstrap for root and editor preview', async () => {
  const source = await readFile(genericAppUrl, 'utf8');
  assert.match(source, /startApplication\(createGenericApplicationOptions\(transport\)\)/);
  assert.match(source, /editorPreview['"]\)\s*===\s*['"]1['"]/);
  assert.match(source, /startProductionApplication:\s*startGenericProductionApplication/);
  assert.match(source, /return startGenericProductionApplication\(\)/);
});

test('application keeps one MapLibre map and one generic story runtime', async () => {
  const [appSource, shellSource] = await Promise.all([
    readFile(genericAppUrl, 'utf8'),
    readFile(genericShellUrl, 'utf8')
  ]);
  assert.equal((appSource.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
  assert.equal((appSource.match(/createStoryRuntime\(/g) ?? []).length, 0);
  assert.match(appSource, /bindStoryExperience:\s*bindGenericStoryExperience/);
  assert.match(shellSource, /createGenericStoryExperience\(\{\s*runtime,\s*sceneController,\s*authoringPolicy\s*\}\)/);
  assert.match(shellSource, /map\?\.once[^\n]*map\.once\(['"]load['"],\s*start\)/);
  assert.doesNotMatch(`${appSource}\n${shellSource}`, /route-61-2|route-data|transport-poi|urban-context|simulation/i);
});
