import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createPackageStore } from '../editor/core/package-store.js';
import { createDraftStore } from '../editor/core/draft-store.js';
import {
  createSourceRepairModel,
  createValidationNavigationIndex
} from '../editor/core/validation.js';
import {
  createPreviewBridge,
  isPreviewPackageWithinLimit,
  PREVIEW_PROTOCOL_VERSION
} from '../editor/preview/bridge.js';
import { toRuntimeErrorPayload } from '../editor/preview/package-resolver.js';
import { createContentActionEditor } from '../editor/ui/content-actions.js';
import { createStoryEditor } from '../editor/ui/story-editor.js';

const encoder = new TextEncoder();

function story(id = 'main') {
  return {
    schemaVersion: '1.1',
    id,
    title: id,
    states: [
      { id: 'one', content: { layout: 'hero', blocks: [{ type: 'heading', text: 'One' }] }, map: { enter: [], exit: [] } },
      { id: 'two', content: { layout: 'narrative', blocks: [{ type: 'heading', text: 'Two' }] }, map: { enter: [], exit: [] } }
    ]
  };
}

function fakeWindow() {
  const listeners = new Map();
  return {
    location: { origin: 'https://editor.example' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    emit(type, event) { listeners.get(type)?.(event); }
  };
}

function envelope(type, revision, payload = {}, requestId = `request-${revision}`) {
  return { protocol: PREVIEW_PROTOCOL_VERSION, type: `editor-preview:${type}`, revision, requestId, payload };
}

test('ordered Story, state, block, and action moves announce the resulting position and total', () => {
  const announcements = [];
  const manifest = {
    stories: {
      primary: 'one',
      items: [
        { id: 'one', src: './stories/one.story.json' },
        { id: 'two', src: './stories/two.story.json' }
      ]
    }
  };
  const stories = { one: story('one'), two: story('two') };
  const ui = createStoryEditor({
    manifest,
    stories,
    announce: (message) => announcements.push(message),
    mutateManifest(updater) { updater(manifest); },
    writeStory(id, value) { stories[id] = structuredClone(value); },
    removeStory() {}
  });

  ui.command('move-story', { from: 0, to: 1 });
  ui.story('one').command('move-state', { from: 0, to: 1 });

  const contentAnnouncements = [];
  let current = story();
  current.states[0].content.blocks.push({ type: 'paragraph', text: 'Details' });
  current.states[0].map.enter.push({ type: 'map.focus', target: 'one' }, { type: 'map.focus', target: 'two' });
  const content = createContentActionEditor({
    story: current,
    contentDescriptors: [],
    actionDescriptors: [],
    announce: (message) => contentAnnouncements.push(message),
    save(value) { current = value; }
  });
  content.command('move-block', { stateIndex: 0, from: 0, to: 1 });
  content.command('move-action', { stateIndex: 0, phase: 'enter', from: 0, to: 1 });

  assert.deepEqual(announcements, [
    'Story moved to position 2 of 2.',
    'State moved to position 2 of 2.'
  ]);
  assert.deepEqual(contentAnnouncements, [
    'Block moved to position 2 of 2.',
    'Action moved to position 2 of 2.'
  ]);
});

test('validation navigation selects the nearest editable control without validating', () => {
  const index = createValidationNavigationIndex([
    { packagePath: 'project.json', path: '$', selection: { section: 'project' }, controlId: 'author-project-title' },
    { packagePath: 'project.json', path: '$.datasets.route', selection: { section: 'datasets', entityId: 'route' }, controlId: 'author-dataset-existing' },
    { packagePath: 'stories/main.story.json', path: '$.states[1]', selection: { section: 'stories', storyId: 'main', stateIndex: 1 }, controlId: 'author-state-index' },
    { packagePath: 'stories/main.story.json', path: '$.states[1].map.enter[0]', selection: { section: 'stories', storyId: 'main', stateIndex: 1, phase: 'enter', actionIndex: 0 }, controlId: 'author-action-existing' }
  ]);

  assert.deepEqual(index.resolve({
    packagePath: 'stories/main.story.json',
    path: '$.states[1].map.enter[0].target'
  }), {
    selection: { section: 'stories', storyId: 'main', stateIndex: 1, phase: 'enter', actionIndex: 0 },
    controlId: 'author-action-existing'
  });
  assert.deepEqual(index.resolve({ packagePath: 'project.json', path: '$.datasets.route.src' }), {
    selection: { section: 'datasets', entityId: 'route' },
    controlId: 'author-dataset-existing'
  });
  assert.equal(index.resolve({ packagePath: 'missing.json', path: '$' }), null);
});

test('invalid known JSON repairs the production source and restores its parsed value', () => {
  const packageStore = createPackageStore({
    origin: { kind: 'memory', label: 'Broken' },
    entries: [{
      path: 'project.json',
      bytes: encoder.encode('{ invalid json'),
      mediaType: 'application/json',
      kind: 'manifest',
      managed: true
    }]
  });
  const draftStore = createDraftStore({ packageStore });
  const repair = createSourceRepairModel({ packageStore, draftStore, packagePath: 'project.json' });

  assert.equal(repair.parseable, false);
  assert.equal(repair.text, '{ invalid json');
  const result = repair.replace('{"schemaVersion":"1.0","title":"Repaired"}\n');
  assert.equal(result.parseable, true);
  assert.equal(repair.parseable, true);
  assert.equal(draftStore.get('project.json').title, 'Repaired');
});

test('preview protocol rejects extra keys and bounds package and runtime-error payloads', () => {
  const windowRef = fakeWindow();
  const messages = [];
  const events = [];
  const frame = { postMessage(message, origin) { messages.push({ message, origin }); } };
  const iframe = {
    contentWindow: frame,
    dataset: { previewSrc: '../?editorPreview=1' },
    addEventListener() {},
    removeEventListener() {}
  };
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin, onEvent: (event) => events.push(event) });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('ready', 0) });
  bridge.start({ revision: 1, snapshot: { revision: 1, entries: [] } });
  windowRef.emit('message', {
    source: frame,
    origin: windowRef.location.origin,
    data: { ...envelope('loaded', 1, {}, messages.at(-1).message.requestId), unexpected: true }
  });
  assert.deepEqual(events.map(({ type }) => type), ['editor-preview:ready']);

  assert.equal(isPreviewPackageWithinLimit([{ bytes: { byteLength: 256 * 1024 * 1024 } }]), true);
  assert.equal(isPreviewPackageWithinLimit([{ bytes: { byteLength: 256 * 1024 * 1024 + 1 } }]), false);
  assert.throws(() => bridge.start({
    revision: 2,
    snapshot: {
      revision: 2,
      entries: [{ path: 'project.json', bytes: new Uint8Array(), mediaType: 'application/json', kind: 'manifest', directoryHandle: {} }]
    }
  }), /preview snapshot/i);

  const safeError = toRuntimeErrorPayload({
    code: 'BAD<script>',
    path: '$.x',
    message: `<img src=x onerror=alert(1)>${'x'.repeat(5000)}`,
    stack: 'private stack'
  });
  assert.deepEqual(Object.keys(safeError), ['code', 'path', 'message']);
  assert.equal(safeError.message.length <= 4096, true);
  assert.equal('stack' in safeError, false);
  bridge.dispose();
});

test('viewport commands forward reduced motion through the exact-origin protocol', () => {
  const windowRef = fakeWindow();
  const messages = [];
  const frame = { postMessage(message, origin) { messages.push({ message, origin }); } };
  const bridge = createPreviewBridge({
    iframe: { contentWindow: frame, addEventListener() {}, removeEventListener() {}, dataset: {} },
    windowRef,
    origin: windowRef.location.origin
  });
  bridge.command('viewport', { preset: 'mobile', reducedMotion: true });
  assert.deepEqual(messages[0], {
    origin: 'https://editor.example',
    message: {
      protocol: PREVIEW_PROTOCOL_VERSION,
      type: 'editor-preview:command',
      revision: -1,
      requestId: 'request-1',
      payload: { name: 'viewport', payload: { preset: 'mobile', reducedMotion: true } }
    }
  });
  bridge.dispose();
});

test('editor shell exposes persistent labels, help/error associations, commands, and operable narrow layout', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../editor/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../editor/editor.css', import.meta.url), 'utf8')
  ]);
  for (const id of ['open-folder', 'import-zip', 'save-project', 'export-project-zip']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(html, /id="project-locale"[^>]+required[^>]+aria-describedby="project-locale-help"/);
  assert.match(html, /id="story-heading"[^>]+required[^>]+aria-describedby="story-heading-help"/);
  assert.match(html, /<nav[^>]+aria-label=/);
  assert.match(html, /<main[^>]+aria-label=/);
  assert.match(html, /<aside[^>]+aria-labelledby=/);
  assert.match(html, /id="ordering-announcements"[^>]+aria-live="polite"/);
  assert.match(css, /\.editor-inspector[^}]+overflow[^}]+auto/s);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]+minmax\(0, 1fr\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(html, /<dialog[^>]+id="project-template-chooser"[^>]+aria-labelledby="project-template-heading"/i);
  assert.match(html, /<form method="dialog"><button type="submit">Cancel<\/button><\/form>/i);
});

test('editor authored rendering and protocol sources prohibit executable and unsafe sinks', async () => {
  const sources = await Promise.all([
    '../editor/editor.js',
    '../editor/core/validation.js',
    '../editor/preview/bridge.js',
    '../editor/preview/package-resolver.js',
    '../editor/storage/adapters.js',
    '../editor/ui/inspectors.js',
    '../editor/ui/story-editor.js',
    '../editor/ui/studio-shell.js',
    '../editor/ui/content-actions.js'
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  const source = sources.join('\n');
  assert.doesNotMatch(source, /\.innerHTML\b/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /\bFunction\s*\(/);
  assert.doesNotMatch(source, /\bimport\s*\([^)]*(?:authored|project|resource)/i);
  assert.doesNotMatch(source, /postMessage\s*\([^,]+,\s*['"]\*['"]/);
  assert.doesNotMatch(source, /payload[^\n]*(?:directoryHandle|FileSystemFileHandle|FileSystemDirectoryHandle)/);
  assert.doesNotMatch(source, /createElement\s*\(\s*['"]script['"]|javascript:/i);
});
