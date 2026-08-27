import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appUrl = new URL('../src/app.js', import.meta.url);

test('application query-gates POC and retains legacy binding', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.match(source, /isStoryShellPocEnabled\(window\.location\.search\)/);
  assert.match(source, /storyShellPocEnabled\s*\?\s*bindStoryShell\(\)\s*:\s*bindPresentation\(\)/);
});

test('application keeps one MapLibre map and one generic story runtime', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
  assert.equal((source.match(/createStoryRuntime\(/g) ?? []).length, 1);
  assert.match(source, /renderContent:\s*renderPresentationContent/);
  assert.doesNotMatch(source, /story-poc-content|mobile-story|scroll-story/i);
});
