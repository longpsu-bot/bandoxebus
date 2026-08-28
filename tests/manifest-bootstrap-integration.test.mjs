import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { applyProjectMetadata } from '../src/project/bootstrap.js';

const APP_URL = new URL('../src/app.js', import.meta.url);

test('production composition boots fixed project.json through one map/runtime path', async () => {
  const source = await readFile(APP_URL, 'utf8');
  assert.match(source, /startApplication\(\{/);
  assert.match(source, /manifestUrl:\s*['"]\.\/project\.json['"]/);
  assert.doesNotMatch(source, /loadStoryDefinition\(['"]\.\/data\/stories\/route-61-2\.story\.json/);
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
  assert.equal((source.match(/createStoryRuntime\(/g) ?? []).length, 0);
});

test('manifest metadata updates chrome through text-only assignments', () => {
  const elements = Object.fromEntries(['project-title', 'project-subtitle', 'map', 'control-panel']
    .map((id) => [id, {
      textContent: id === 'project-title' ? 'placeholder' : '',
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    }]));
  const documentRef = {
    title: 'placeholder',
    documentElement: { lang: 'en' },
    getElementById(id) { return elements[id] ?? null; }
  };
  applyProjectMetadata({
    locale: 'vi-VN',
    metadata: { title: '<b>Tuyến 61-2</b>', subtitle: 'Thủ Dầu Một ↔ Bến Cát' }
  }, { documentRef });
  assert.equal(documentRef.title, '<b>Tuyến 61-2</b> · Route Storytelling V1');
  assert.equal(documentRef.documentElement.lang, 'vi-VN');
  assert.equal(elements['project-title'].textContent, '<b>Tuyến 61-2</b>');
  assert.equal(elements['project-subtitle'].textContent, 'Thủ Dầu Một ↔ Bến Cát');
  assert.equal(elements.map.attributes['aria-label'], 'Bản đồ · <b>Tuyến 61-2</b>');
  assert.equal(elements['control-panel'].attributes['aria-label'], 'Bảng điều khiển · <b>Tuyến 61-2</b>');
});
