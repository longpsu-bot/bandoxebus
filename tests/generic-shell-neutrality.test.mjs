import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('root production shell is neutral and contains only generic runtime hosts', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8')
  ]);
  for (const id of ['map', 'scene-compositor', 'runtime-navigation', 'capability-controls', 'runtime-status', 'project-load-error']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  for (const forbidden of ['61-2', 'Existing', 'Proposed', 'Difference', 'simulation', 'industrial', 'route-specific']) {
    assert.doesNotMatch(`${html}\n${app}`, new RegExp(forbidden, 'i'), forbidden);
  }
  assert.match(app, /runtime\/generic-app\.js/);
  assert.doesNotMatch(app, /route-61-2|route-data|route-comparison/);
});

test('every editor Story version previews through the same neutral root', async () => {
  const html = await readFile(new URL('../editor/index.html', import.meta.url), 'utf8');
  const match = html.match(/<iframe[\s\S]*?<\/iframe>/)?.[0] ?? '';
  assert.match(match, /data-preview-src="\.\.\/\?editorPreview=1"/);
  assert.doesNotMatch(match, /data-preview-src-legacy|data-preview-src-story12|src\/runtime/);
});
