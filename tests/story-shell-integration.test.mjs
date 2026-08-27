import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../src/app.js', import.meta.url);

test('application selects Story Shell by default and retains explicit legacy binding', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.match(source, /resolveStoryExperience\(window\.location\.search\)/);
  assert.match(source, /storyExperience\s*===\s*['"]legacy['"]\s*\?\s*bindPresentation\(\)\s*:\s*bindStoryShell\(\)/);
});

test('default application bootstrap binds the launcher without auto-entering Story Shell', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.match(source, /openButton\.addEventListener\(['"]click['"],\s*\(\)\s*=>\s*storyShell\.enter\(\)\)/);
  assert.doesNotMatch(source, /map\.on\(['"]load['"][\s\S]*?storyShell\.enter\(\)[\s\S]*?map\.once\(['"]idle['"]/);
});

test('application keeps one MapLibre map and one generic story runtime', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
  assert.equal((source.match(/createStoryRuntime\(/g) ?? []).length, 1);
  assert.match(source, /loadStoryDefinition\(['"]\.\/data\/stories\/route-61-2\.story\.json['"]/);
  assert.match(source, /createStoryShell\(\{\s*runtime:\s*storyRuntime,/);
  assert.match(source, /renderContent:\s*renderPresentationContent/);
  assert.match(source, /function bindPresentation\(\)/);
  assert.doesNotMatch(source, /story-poc-content|mobile-story|scroll-story/i);
});
