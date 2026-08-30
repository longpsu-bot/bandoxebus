import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createPreviewBridge, PREVIEW_PROTOCOL_VERSION } from '../editor/preview/bridge.js';
import { startEditorPreviewHost } from '../editor/preview/package-resolver.js';
import { createNewProjectEntries } from '../editor/core/package-store.js';
import { validateProjectManifest } from '../src/project/project-schema.js';

function fakeWindow() {
  const listeners = new Map();
  return {
    location: { origin: 'https://editor.example' },
    parent: null,
    document: { getElementById: () => null },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    emit(type, event) { listeners.get(type)?.(event); }
  };
}

function envelope(type, revision, payload = {}) {
  return { protocol: PREVIEW_PROTOCOL_VERSION, type: `editor-preview:${type}`, revision, requestId: `request-${revision}`, payload };
}

test('bridge accepts only the known iframe, origin, version, and newest revision', () => {
  const windowRef = fakeWindow();
  const frame = { postMessage() {} };
  const iframe = { contentWindow: frame };
  const events = [];
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin, onEvent: (event) => events.push(event) });
  bridge.start({ revision: 1, snapshot: { revision: 1, entries: [] } });

  windowRef.emit('message', { source: {}, origin: windowRef.location.origin, data: envelope('loaded', 1) });
  windowRef.emit('message', { source: frame, origin: 'https://evil.example', data: envelope('loaded', 1) });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: { ...envelope('loaded', 1), protocol: 0 } });
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('loaded', 0) });
  assert.deepEqual(events, []);
  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('loaded', 1) });
  assert.equal(events[0].type, 'editor-preview:loaded');
  bridge.dispose();
});

test('bridge queues the newest valid snapshot until the production iframe is ready', () => {
  const windowRef = fakeWindow();
  const messages = [];
  const frame = { postMessage(message, origin) { messages.push({ message, origin }); } };
  const iframe = { contentWindow: frame };
  const bridge = createPreviewBridge({ iframe, windowRef, origin: windowRef.location.origin });
  const snapshot = { revision: 2, entries: [{ path: 'project.json', bytes: new Uint8Array([1]), mediaType: 'application/json', kind: 'manifest' }] };
  bridge.start({ revision: 2, snapshot });
  snapshot.entries[0].bytes[0] = 9;
  assert.equal(messages.length, 0);

  windowRef.emit('message', { source: frame, origin: windowRef.location.origin, data: envelope('ready', 0) });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.type, 'editor-preview:start');
  assert.equal(messages[0].message.payload.entries[0].bytes[0], 1);
  assert.equal(messages[0].origin, windowRef.location.origin);
  bridge.dispose();
});

test('replacement destroys runtime and revokes revision URLs before starting one map', async () => {
  const events = [];
  const windowRef = fakeWindow();
  windowRef.parent = { postMessage() {} };
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver(snapshot) {
      return {
        manifestUrl: new URL(`https://editor.example/__editor_package__/${snapshot.revision}/project.json`),
        fetchImpl() {},
        resolveAssetUrl() {},
        revoke() { events.push(`revoke:${snapshot.revision}`); }
      };
    },
    async startProductionApplication({ manifestUrl }) {
      const revision = Number(manifestUrl.pathname.split('/').at(-2));
      events.push(`start:${revision}`);
      return { destroy() { events.push(`destroy:${revision}`); } };
    }
  });

  await host.start({ revision: 1, entries: [] });
  await host.start({ revision: 2, entries: [] });
  assert.deepEqual(events, ['start:1', 'destroy:1', 'revoke:1', 'start:2']);
  host.dispose();
});

test('preview host reports loaded only after the production map load lifecycle', async () => {
  const messages = [];
  const windowRef = fakeWindow();
  windowRef.parent = { postMessage(message) { messages.push(message); } };
  let loadListener;
  const host = startEditorPreviewHost({
    windowRef,
    expectedOrigin: windowRef.location.origin,
    createResolver(snapshot) {
      return {
        manifestUrl: new URL(`https://editor.example/${snapshot.revision}/project.json`),
        fetchImpl() {},
        resolveAssetUrl() {},
        revoke() {}
      };
    },
    async startProductionApplication() {
      return {
        map: {
          loaded: () => false,
          once(type, listener) { if (type === 'load') loadListener = listener; }
        },
        destroy() {}
      };
    }
  });

  const starting = host.start({ revision: 1, entries: [] });
  for (let turn = 0; turn < 10 && !loadListener; turn += 1) await Promise.resolve();
  assert.equal(messages.some(({ type }) => type === 'editor-preview:loaded'), false);
  assert.equal(typeof loadListener, 'function');
  loadListener();
  await starting;
  assert.equal(messages.some(({ type }) => type === 'editor-preview:loaded'), true);
  await host.dispose();
});

test('static editor shell and production preview mode expose only the PR A spine', async () => {
  const [html, editorSource, css, appSource, smokeSource] = await Promise.all([
    readFile(new URL('../editor/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../editor/editor.js', import.meta.url), 'utf8'),
    readFile(new URL('../editor/editor.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/editor-browser-smoke.mjs', import.meta.url), 'utf8')
  ]);

  assert.match(html, /<header[\s>]/);
  assert.match(html, /<nav[\s>]/);
  assert.match(html, /<main[\s>]/);
  assert.match(html, /<aside[\s>]/);
  assert.match(html, /Production project preview/);
  assert.match(html, /sandbox="allow-scripts allow-same-origin"/);
  assert.doesNotMatch(html, /allow-forms|allow-popups|allow-downloads|allow-top-navigation/);
  assert.match(html, /id="project-locale"/);
  assert.doesNotMatch(html, /id="project-title"[^>]*required/);
  assert.match(html, /id="story-heading"/);
  assert.match(html, /id="preview-desktop"/);
  assert.match(html, /id="preview-mobile"/);
  assert.match(html, /id="preview-status"/);
  assert.match(html, /id="dirty-status"/);
  assert.match(css, /preview-frame--mobile/);
  assert.doesNotMatch(editorSource, /innerHTML/);
  assert.match(appSource, /get\(['"]editorPreview['"]\)\s*===\s*['"]1['"]/);
  assert.match(appSource, /startEditorPreviewHost/);
  assert.match(appSource, /return startProductionApplication\(\)/);
  assert.match(smokeSource, /project-locale/);
  assert.doesNotMatch(smokeSource, /project-title/);
});

test('empty title remains valid because the GUI uses production validation only', () => {
  const entry = createNewProjectEntries().find(({ path }) => path === 'project.json');
  const manifest = JSON.parse(new TextDecoder().decode(entry.bytes));
  manifest.title = '';
  assert.equal(validateProjectManifest(manifest), manifest);
});
