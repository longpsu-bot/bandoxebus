import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import { loadProject } from '../src/project/project-loader.js';

const ROOT = new URL('./fixtures/well-rounded-template-v1/', import.meta.url);
async function fileFetch(url) {
  try { const text = await readFile(url, 'utf8'); return { ok: true, status: 200, async json() { return JSON.parse(text); } }; }
  catch { return { ok: false, status: 404, async json() { throw new Error('missing'); } }; }
}
async function files(url, prefix = '') {
  const result = []; for (const entry of await readdir(url, { withFileTypes: true })) { const path = `${prefix}${entry.name}`; if (entry.isDirectory()) result.push(...await files(new URL(`${entry.name}/`, url), `${path}/`)); else result.push(path); } return result;
}

test('synthetic package exercises every baseline resource, content, focus, and action form using data only', async () => {
  const project = await loadProject(new URL('project.json', ROOT), { fetchImpl: fileFetch, capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY });
  assert.deepEqual([...project.resources].filter(([, value]) => value.kind === 'dataset').map(([, value]) => `${value.descriptor.type}:${value.descriptor.geometry ?? ''}`).sort(), ['geojson:line', 'geojson:line', 'geojson:point', 'geojson:polygon', 'table-json:']);
  const actions = new Set(project.story.states.flatMap((state) => [...state.map.enter, ...state.map.exit]).map(({ type }) => type));
  assert.deepEqual(actions, new Set(['map.focus', 'map.set-visibility', 'map.set-emphasis', 'map.clear-emphasis']));
  const blocks = new Set(project.story.states.flatMap((state) => state.content.blocks).map(({ type }) => type));
  for (const type of ['heading', 'paragraph', 'stat-group', 'table', 'chart', 'image', 'legend']) assert.equal(blocks.has(type), true, type);
  assert.deepEqual(new Set(project.story.states.flatMap((state) => state.content.blocks.filter((block) => block.type === 'chart')).map(({ chartType }) => chartType)), new Set(['bar', 'line', 'area']));
  assert.deepEqual(Object.values(project.focusTargets).map(({ type }) => type).sort(), ['bounds', 'coordinate', 'datasets']);
  assert.equal((await files(ROOT)).some((path) => /\.(?:js|mjs|html)$/i.test(path)), false);
});

test('fixture represents the six ordinary authoring stories', async () => {
  const story = JSON.parse(await readFile(new URL('stories/main.story.json', ROOT), 'utf8'));
  assert.deepEqual(story.states.map(({ id }) => id), ['route-realignment', 'service-area-context', 'route-stop-rationalization', 'demand-evidence', 'network-connectivity', 'image-supported-evidence']);
});
