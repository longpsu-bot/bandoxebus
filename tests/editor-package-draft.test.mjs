import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDeclaredPackageEntries,
  createNewProjectEntries,
  createPackageStore,
  normalizePackagePath
} from '../editor/core/package-store.js';
import { createDraftStore, createStableId, moveArrayItem } from '../editor/core/draft-store.js';
import { createPackageFetch } from '../editor/preview/package-resolver.js';
import { createMemoryStorageAdapter } from '../editor/storage/adapters.js';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function json(entries, path) {
  const entry = entries.find((candidate) => candidate.path === path);
  return JSON.parse(decoder.decode(entry.bytes ?? entry.currentBytes));
}

test('New Project is production-shaped Story 1.1 with a fixed basemap', () => {
  const entries = createNewProjectEntries({ id: 'corridor-plan', title: 'Corridor plan', locale: 'en-US' });
  const manifest = json(entries, 'project.json');
  const story = json(entries, 'stories/main.story.json');

  assert.deepEqual(entries.map(({ path }) => path), ['project.json', 'stories/main.story.json']);
  assert.equal(manifest.schemaVersion, '1.0');
  assert.equal(manifest.map.basemap, 'openfreemap-dark');
  assert.deepEqual(manifest.capabilities, []);
  assert.equal('gui' in manifest, false);
  assert.equal(story.schemaVersion, '1.1');
  assert.equal(story.states.length, 1);
  assert.deepEqual(story.states[0].map, { enter: [], exit: [] });
});

test('draft changes serialize only the mutated file and track byte dirtiness', () => {
  const store = createPackageStore({
    origin: { kind: 'memory', label: 'New project' },
    entries: createNewProjectEntries()
  });
  const originalStory = store.get('stories/main.story.json').currentBytes.slice();
  const draft = createDraftStore({ packageStore: store });
  let notifications = 0;
  draft.subscribe(() => { notifications += 1; });

  draft.mutate('project.json', (manifest) => { manifest.title = ''; });

  assert.equal(draft.revision, 1);
  assert.equal(store.revision, 1);
  assert.equal(store.dirty, true);
  assert.equal(notifications, 1);
  assert.deepEqual(store.get('stories/main.story.json').currentBytes, originalStory);
  const serializedManifest = decoder.decode(store.get('project.json').currentBytes);
  assert.equal(JSON.parse(serializedManifest).title, '');
  assert.equal(serializedManifest.endsWith('\n'), true);
});

test('a package snapshot exposes fetch-compatible managed resources', async () => {
  const store = createPackageStore({
    origin: { kind: 'memory', label: 'New project' },
    entries: createNewProjectEntries()
  });
  const transport = createPackageFetch(store.snapshot());
  const response = await transport.fetchImpl(transport.manifestUrl);

  assert.equal(response.status, 200);
  assert.equal((await response.json()).schemaVersion, '1.0');
  assert.equal((await transport.fetchImpl(new URL('absent.json', transport.manifestUrl))).status, 404);
});

test('stable IDs and array moves are deterministic and atomic', () => {
  assert.equal(createStableId('Bus Stop'), 'bus-stop');
  assert.equal(createStableId('Bus Stop', ['bus-stop', 'bus-stop-2']), 'bus-stop-3');
  assert.equal(createStableId('***'), 'item');
  assert.deepEqual(moveArrayItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveArrayItem(['a', 'b'], 4, 0), ['a', 'b']);
});

test('package paths normalize safe relative forms and reject escape forms', () => {
  assert.equal(normalizePackagePath('./stories/main.story.json'), 'stories/main.story.json');
  for (const path of ['', '/', '../secret', 'data/%252e%252e/secret', 'C:/secret', 'https://evil.example/x', 'data\\x', 'data/x?raw=1', 'data//x']) {
    assert.throws(() => normalizePackagePath(path), /package path/i, path);
  }
});

test('snapshots exclude pass-through entries and successful writes clear only matching dirtiness', () => {
  const store = createPackageStore({
    origin: { kind: 'zip', label: 'fixture.zip' },
    entries: [
      { path: 'project.json', bytes: encoder.encode('{"schemaVersion":"1.0"}\n'), mediaType: 'application/json', kind: 'manifest', managed: true },
      { path: 'notes.txt', bytes: encoder.encode('keep'), mediaType: 'text/plain', kind: 'pass-through', managed: false }
    ]
  });
  store.setCurrentBytes('project.json', encoder.encode('{"schemaVersion":"1.0","title":"Changed"}\n'));
  store.setCurrentBytes('notes.txt', encoder.encode('changed'));

  assert.deepEqual(store.snapshot().entries.map(({ path }) => path), ['project.json']);
  assert.deepEqual(store.snapshot({ managedOnly: false }).entries.map(({ path }) => path), ['notes.txt', 'project.json']);
  assert.deepEqual(store.changeSet().map(({ path }) => path), ['notes.txt', 'project.json']);
  store.markWritten(['project.json']);
  assert.deepEqual(store.changeSet().map(({ path }) => path), ['notes.txt']);
});

test('invalid known JSON stays editable as source until a valid repair restores its value', () => {
  const entries = createNewProjectEntries();
  entries[0] = { ...entries[0], bytes: encoder.encode('{ invalid json') };
  const store = createPackageStore({ origin: { kind: 'memory', label: 'Broken' }, entries });
  const draft = createDraftStore({ packageStore: store });

  assert.equal(draft.get('project.json'), undefined);
  assert.equal(draft.diagnostics.length, 1);
  assert.equal(decoder.decode(store.get('project.json').currentBytes), '{ invalid json');

  draft.replaceText('project.json', '{"schemaVersion":"1.0","title":"Repaired"}\n');
  assert.equal(draft.get('project.json').title, 'Repaired');
  assert.deepEqual(draft.diagnostics, []);
});

test('declared entries are collected through production package URL rules', () => {
  const manifest = json(createNewProjectEntries(), 'project.json');
  manifest.datasets = {
    route: { type: 'geojson', geometry: 'line', src: './data/route.geojson', label: 'Route' }
  };
  manifest.assets = {
    photo: { type: 'image', src: './assets/photo.png', mediaType: 'image/png' }
  };
  manifest.metrics = { src: './data/metrics.json' };

  assert.deepEqual(collectDeclaredPackageEntries(manifest), [
    { path: 'stories/main.story.json', kind: 'story', mediaType: 'application/json' },
    { path: 'data/route.geojson', kind: 'dataset', mediaType: 'application/geo+json' },
    { path: 'assets/photo.png', kind: 'asset', mediaType: 'image/png' },
    { path: 'data/metrics.json', kind: 'metrics', mediaType: 'application/json' }
  ]);
});

test('memory storage opens an isolated copy with memory capabilities', async () => {
  const entries = createNewProjectEntries();
  const adapter = createMemoryStorageAdapter({ entries, label: 'Untitled project' });
  const opened = await adapter.open();

  assert.deepEqual(opened.origin, { kind: 'memory', label: 'Untitled project' });
  assert.equal(opened.capabilities.writeInPlace, false);
  opened.entries[0].bytes[0] = 0;
  assert.notEqual(entries[0].bytes[0], 0);
});
