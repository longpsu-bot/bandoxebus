import assert from 'node:assert/strict';
import test from 'node:test';

import { createNewProjectEntries } from '../editor/core/package-store.js';
import {
  createBlankMapStoryTemplate,
  createNetworkServicePlanTemplate,
  createRouteProposalTemplate
} from '../editor/core/templates.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import { loadProject } from '../src/project/project-loader.js';

const decoder = new TextDecoder();
const parse = (entries, path) => JSON.parse(decoder.decode(entries.find((entry) => entry.path === path).bytes));

function packageFetch(entries) {
  const values = new Map(entries.map((entry) => [
    `https://template.invalid/${entry.path}`,
    JSON.parse(decoder.decode(entry.bytes))
  ]));
  return async (url) => {
    const value = values.get(String(url));
    return { ok: value !== undefined, status: value === undefined ? 404 : 200, async json() { return structuredClone(value); } };
  };
}

async function load(entries) {
  return loadProject('https://template.invalid/project.json', {
    fetchImpl: packageFetch(entries),
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY
  });
}

test('Blank is ordinary immediately valid Story 1.2 data and remains the default New project', async () => {
  const options = { id: 'blank-plan', title: 'Blank plan', locale: 'en-US' };
  const entries = createBlankMapStoryTemplate(options);
  const manifest = parse(entries, 'project.json');
  const story = parse(entries, 'stories/main.story.json');
  assert.deepEqual(manifest.capabilities, []);
  assert.deepEqual(manifest.datasets, {});
  assert.equal(story.schemaVersion, '1.2');
  assert.equal(story.states.length, 1);
  assert.deepEqual(story.states[0].content.blocks, []);
  assert.deepEqual(createNewProjectEntries(options), entries);
  assert.equal((await load(entries)).story.schemaVersion, '1.2');
});

test('Route Proposal satisfies required route roles with bounded empty resources and five complete snapshots', async () => {
  const entries = createRouteProposalTemplate({ id: 'route-plan', title: 'Route plan' });
  const manifest = parse(entries, 'project.json');
  const story = parse(entries, 'stories/main.story.json');
  assert.deepEqual(Object.fromEntries(Object.entries(manifest.datasets).map(([id, value]) => [id, value.role])), {
    'existing-route': 'route.existing', 'proposed-route': 'route.proposed'
  });
  assert.deepEqual(manifest.capabilities, [{ id: 'route-comparison-v1' }]);
  assert.deepEqual(story.states.map(({ id }) => id), ['context', 'existing-route', 'proposed-change', 'key-connection', 'recommendation']);
  for (const state of story.states) assert.deepEqual(Object.keys(state.map.layerVisibility).sort(), ['existing-route', 'proposed-route']);
  for (const path of ['data/existing-route.geojson', 'data/proposed-route.geojson']) {
    assert.deepEqual(parse(entries, path), { type: 'FeatureCollection', features: [] });
  }
  assert.deepEqual((await load(entries)).manifest.capabilities, [{ id: 'route-comparison-v1' }]);
});

test('Network / Service Plan is neutral ordinary data with no unsatisfied capability role', async () => {
  const entries = createNetworkServicePlanTemplate({ id: 'network-plan', title: 'Network plan' });
  const manifest = parse(entries, 'project.json');
  const story = parse(entries, 'stories/main.story.json');
  assert.deepEqual(manifest.capabilities, []);
  assert.deepEqual(Object.keys(manifest.datasets).sort(), ['network-lines', 'service-points']);
  assert.deepEqual(story.states.map(({ id }) => id), ['network-overview', 'service-needs', 'service-plan']);
  assert.equal((await load(entries)).story.states.length, 3);
});

test('templates persist no template runtime identity or metadata', () => {
  for (const factory of [createBlankMapStoryTemplate, createRouteProposalTemplate, createNetworkServicePlanTemplate]) {
    const text = factory({ id: 'ordinary-project' }).map(({ bytes }) => decoder.decode(bytes)).join('\n');
    assert.doesNotMatch(text, /templateId|templateMetadata|templateEngine/);
  }
});
