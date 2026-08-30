import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDraftStore } from '../editor/core/draft-store.js';
import {
  collectDeclaredPackageEntries,
  createPackageStore
} from '../editor/core/package-store.js';
import { createPackageFetch } from '../editor/preview/package-resolver.js';
import {
  createFolderStorageAdapter,
  createZipStorageAdapter
} from '../editor/storage/adapters.js';
import { exportPackageZip } from '../editor/editor.js';
import { createStoryEditor } from '../editor/ui/story-editor.js';
import { createFixtureServer } from '../scripts/serve-project-fixture.mjs';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import { loadProject } from '../src/project/project-loader.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const decoder = new TextDecoder();
const ROUTE_STORY_PATH = 'data/stories/route-61-2.story.json';
const ROUTE_STORY_SHA256 = '29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function routeStoryCertificationBytes(value) {
  return new TextEncoder().encode(decoder.decode(value).replace(/\r\n?|\n/g, '\r\n'));
}

async function withTempProject(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'gui-editor-certification-'));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function declaredEntriesFromRoot(root) {
  const manifestBytes = new Uint8Array(await readFile(path.join(root, 'project.json')));
  const manifest = JSON.parse(decoder.decode(manifestBytes));
  const descriptors = collectDeclaredPackageEntries(manifest);
  const entries = [{
    path: 'project.json', bytes: manifestBytes, mediaType: 'application/json', kind: 'manifest', managed: true
  }];
  for (const descriptor of descriptors) entries.push({
    ...descriptor,
    bytes: new Uint8Array(await readFile(path.join(root, ...descriptor.path.split('/')))),
    managed: true
  });
  return entries;
}

async function copyDeclaredProject(sourceRoot, destinationRoot) {
  const entries = await declaredEntriesFromRoot(sourceRoot);
  for (const entry of entries) {
    const destination = path.join(destinationRoot, ...entry.path.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(sourceRoot, ...entry.path.split('/')), destination);
  }
}

function nodeDirectoryHandle(root, accessLog = { reads: [], writes: [] }, prefix = '') {
  return {
    name: prefix ? prefix.split('/').at(-2) : path.basename(root),
    async getDirectoryHandle(segment, options = {}) {
      const relative = `${prefix}${segment}/`;
      const filename = path.join(root, ...relative.split('/').filter(Boolean));
      let details = await stat(filename).catch(() => null);
      if (!details && options.create === true) {
        await mkdir(filename);
        accessLog.createdDirectories ??= [];
        accessLog.createdDirectories.push(relative.slice(0, -1));
        details = await stat(filename);
      }
      if (!details) throw new DOMException(`Missing directory: ${relative}`, 'NotFoundError');
      if (!details.isDirectory()) throw new DOMException(`Not a directory: ${relative}`, 'NotFoundError');
      return nodeDirectoryHandle(root, accessLog, relative);
    },
    async getFileHandle(segment, options = {}) {
      const relative = `${prefix}${segment}`;
      const filename = path.join(root, ...relative.split('/'));
      const details = await stat(filename).catch(() => null);
      if (!details && options.create === true) {
        accessLog.createdFiles ??= [];
        accessLog.createdFiles.push(relative);
      } else if (!details?.isFile()) {
        throw new DOMException(`Missing file: ${relative}`, 'NotFoundError');
      }
      return {
        name: segment,
        async getFile() {
          accessLog.reads.push(relative);
          const value = new Uint8Array(await readFile(filename));
          return { size: value.length, async arrayBuffer() { return value.slice().buffer; } };
        },
        async createWritable() {
          let staged;
          return {
            async write(value) { staged = new Uint8Array(value).slice(); },
            async close() {
              await writeFile(filename, staged);
              accessLog.writes.push(relative);
            }
          };
        }
      };
    }
  };
}

async function loadSnapshot(packageStore) {
  const transport = createPackageFetch(packageStore.snapshot());
  return loadProject(transport.manifestUrl, {
    fetchImpl: transport.fetchImpl,
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY
  });
}

async function mountEntries(entries, root) {
  for (const entry of entries) {
    const filename = path.join(root, ...entry.path.split('/'));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, entry.currentBytes ?? entry.bytes);
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}/`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('open, preview, and unrelated save preserve Route 61-2 Story bytes', async () => {
  await withTempProject(async (temporaryRoot) => {
    await copyDeclaredProject(repositoryRoot, temporaryRoot);
    const storyPath = path.join(temporaryRoot, ...ROUTE_STORY_PATH.split('/'));
    const before = await readFile(storyPath);
    const accessLog = { reads: [], writes: [] };
    const adapter = createFolderStorageAdapter({ directoryHandle: nodeDirectoryHandle(temporaryRoot, accessLog) });
    const opened = await adapter.open();
    const packageStore = createPackageStore(opened);
    const draftStore = createDraftStore({ packageStore });

    const project = await loadSnapshot(packageStore);
    assert.equal(project.story.schemaVersion, '1.0');
    draftStore.mutate('project.json', (manifest) => { manifest.subtitle = `${manifest.subtitle} `; });
    const result = await adapter.writeChanges(packageStore.changeSet());
    packageStore.markWritten(result.written);

    const after = await readFile(storyPath);
    assert.deepEqual(after, before);
    assert.equal(sha256(routeStoryCertificationBytes(after)), ROUTE_STORY_SHA256);
    assert.deepEqual(accessLog.writes, ['project.json']);
    assert.equal(accessLog.reads.includes(ROUTE_STORY_PATH), true);
  });
});

test('supported Story 1.0 content editing preserves schema version and exact legacy map actions', async () => {
  await withTempProject(async (temporaryRoot) => {
    await copyDeclaredProject(repositoryRoot, temporaryRoot);
    const adapter = createFolderStorageAdapter({ directoryHandle: nodeDirectoryHandle(temporaryRoot) });
    const opened = await adapter.open();
    const packageStore = createPackageStore(opened);
    const draftStore = createDraftStore({ packageStore });
    const manifest = draftStore.get('project.json');
    const original = draftStore.get(ROUTE_STORY_PATH);
    const originalActions = original.states.map(({ map }) => structuredClone(map));
    const stories = { [original.id]: original };
    const ui = createStoryEditor({
      manifest,
      stories,
      mutateManifest(updater) { draftStore.mutate('project.json', updater); },
      writeStory(_id, value) { draftStore.mutate(ROUTE_STORY_PATH, () => value); stories[original.id] = structuredClone(value); },
      removeStory() {}
    });

    ui.story(original.id).command('edit-block', {
      stateIndex: 0,
      blockIndex: 2,
      path: 'text',
      value: `${original.states[0].content.blocks[2].text} Chứng nhận GUI.`
    });
    const changed = draftStore.get(ROUTE_STORY_PATH);
    assert.equal(changed.schemaVersion, '1.0');
    assert.deepEqual(changed.states.map(({ map }) => map), originalActions);
  });
});

test('new folder resource is created, reopened, and resolved by the production loader', async () => {
  await withTempProject(async (temporaryRoot) => {
    await copyDeclaredProject(repositoryRoot, temporaryRoot);
    const accessLog = { reads: [], writes: [], createdDirectories: [], createdFiles: [] };
    const adapter = createFolderStorageAdapter({ directoryHandle: nodeDirectoryHandle(temporaryRoot, accessLog) });
    const opened = await adapter.open();
    const packageStore = createPackageStore(opened);
    const draftStore = createDraftStore({ packageStore });
    const resourcePath = 'data/gui-editor-certification/new-route.geojson';
    const resource = new TextEncoder().encode('{"type":"FeatureCollection","features":[]}\n');

    packageStore.setManaged(resourcePath, {
      bytes: resource,
      mediaType: 'application/geo+json',
      kind: 'dataset'
    });
    draftStore.mutate('project.json', (manifest) => {
      manifest.datasets['gui-editor-certification'] = {
        type: 'geojson',
        geometry: 'line',
        src: `./${resourcePath}`,
        label: 'GUI Editor certification'
      };
    });

    const result = await adapter.writeChanges(packageStore.changeSet());
    packageStore.markWritten(result.written);
    const reopened = await adapter.open();
    const reopenedStore = createPackageStore(reopened);
    const project = await loadSnapshot(reopenedStore);

    assert.deepEqual(result.written, [resourcePath, 'project.json']);
    assert.deepEqual(accessLog.createdDirectories, ['data/gui-editor-certification']);
    assert.deepEqual(accessLog.createdFiles, [resourcePath]);
    assert.deepEqual(new Uint8Array(await readFile(path.join(temporaryRoot, ...resourcePath.split('/')))), resource);
    assert.equal(reopened.entries.some(({ path: entryPath }) => entryPath === resourcePath), true);
    assert.deepEqual(project.resources.get('gui-editor-certification').value, {
      type: 'FeatureCollection',
      features: []
    });
  });
});

test('invalid-reference fixture opens in production repair mode with a navigable diagnostic', async () => {
  const fixtureRoot = path.join(repositoryRoot, 'tests', 'fixtures', 'editor', 'invalid-reference');
  const entries = await declaredEntriesFromRoot(fixtureRoot);
  const store = createPackageStore({ origin: { kind: 'memory', label: 'Invalid reference' }, entries });
  await assert.rejects(
    loadSnapshot(store),
    (error) => error.code === 'PROJECT_REFERENCE_INVALID' && /missing/i.test(error.message)
  );
});

test('exported ordinary project mounts into unchanged loadProject and normal production root', async () => {
  await withTempProject(async (temporaryRoot) => {
    const fixtureRoot = path.join(repositoryRoot, 'tests', 'fixtures', 'well-rounded-template-v1');
    const sourceEntries = await declaredEntriesFromRoot(fixtureRoot);
    const packageStore = createPackageStore({
      origin: { kind: 'memory', label: 'GUI-authored ordinary project' },
      entries: sourceEntries
    });
    const beforeExport = await loadSnapshot(packageStore);
    const zipBytes = await exportPackageZip({
      packageStore,
      validation: { status: 'valid', diagnostics: [], lastValid: beforeExport }
    });
    const imported = await createZipStorageAdapter({ zipBytes }).open();
    await mountEntries(imported.entries.filter(({ managed }) => managed), temporaryRoot);

    const server = createFixtureServer({ fixtureRoot: temporaryRoot, applicationRoot: repositoryRoot });
    const baseUrl = await listen(server);
    try {
      const rootResponse = await fetch(baseUrl);
      assert.equal(rootResponse.status, 200);
      assert.match(await rootResponse.text(), /src\/app\.js/);
      const project = await loadProject(new URL('project.json', baseUrl), {
        fetchImpl: fetch,
        capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY
      });
      const geometryKinds = new Set(Object.values(project.manifest.datasets)
        .filter(({ type }) => type === 'geojson').map(({ geometry }) => geometry));
      const blocks = project.story.states.flatMap(({ content }) => content.blocks.map(({ type }) => type));
      const actions = project.story.states.flatMap(({ map }) => [...map.enter, ...map.exit].map(({ type }) => type));
      assert.deepEqual([...geometryKinds].sort(), ['line', 'point', 'polygon']);
      assert.equal(Object.values(project.manifest.datasets).some(({ type }) => type === 'table-json'), true);
      assert.equal(Object.keys(project.manifest.assets).length > 0, true);
      assert.equal(Object.keys(project.manifest.focusTargets).length > 0, true);
      assert.equal(project.metrics.resolve('annual-demand').value, 1480);
      for (const type of ['table', 'chart', 'image', 'legend']) assert.equal(blocks.includes(type), true, type);
      for (const type of ['map.focus', 'map.set-visibility', 'map.set-emphasis']) assert.equal(actions.includes(type), true, type);
    } finally {
      await close(server);
    }
  });
});

test('PR A blank fixture is a production-valid neutral Story 1.2 project', async () => {
  const fixtureRoot = path.join(repositoryRoot, 'tests', 'fixtures', 'story-1.2-blank');
  const entries = await declaredEntriesFromRoot(fixtureRoot);
  const store = createPackageStore({
    origin: { kind: 'memory', label: 'Story 1.2 blank certification' },
    entries
  });
  const project = await loadSnapshot(store);

  assert.equal(project.story.schemaVersion, '1.2');
  assert.equal(project.story.states.length, 1);
  assert.deepEqual(project.story.states[0].content, {
    layout: 'freeform-16x9',
    blocks: []
  });
  assert.deepEqual(project.story.states[0].map.layerVisibility, {});
  assert.deepEqual(project.manifest.datasets, {});
});

test('PR A browser gate certifies bounded Studio revisions and compatibility', async () => {
  const source = await readFile(
    path.join(repositoryRoot, 'scripts', 'map-story-studio-browser-smoke.mjs'),
    'utf8'
  );

  for (const required of [
    'MAP_STORY_STUDIO_PR_A_RESULT: PASS',
    'maplibregl-canvas',
    'studio-scene-list',
    'Capture Camera',
    'Restore Saved Camera',
    '390',
    '844',
    'Route 61-2',
    'previewRevision',
    'consoleIssues'
  ]) assert.match(source, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
