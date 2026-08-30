import test from 'node:test';
import assert from 'node:assert/strict';

import { createDraftStore } from '../editor/core/draft-store.js';
import { createPackageStore } from '../editor/core/package-store.js';
import { savePackageChanges } from '../editor/editor.js';
import {
  canOpenFolder,
  createFolderStorageAdapter
} from '../editor/storage/adapters.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(value) {
  return typeof value === 'string' ? encoder.encode(value) : value.slice();
}

function manifestBytes(paths = {}) {
  const datasets = Object.fromEntries(Object.entries(paths.datasets ?? {}).map(([id, src]) => [
    id,
    { type: 'geojson', geometry: 'line', src, label: id }
  ]));
  return bytes(`${JSON.stringify({
    schemaVersion: '1.0',
    id: 'folder-fixture',
    title: 'Folder fixture',
    locale: 'en-US',
    stories: {
      primary: 'main',
      items: [{ id: 'main', src: paths.story ?? './stories/main.story.json' }]
    },
    map: {
      basemap: 'openfreemap-dark',
      initialView: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 }
    },
    datasets,
    assets: {},
    focusTargets: {},
    capabilities: [],
    attribution: {}
  }, null, 2)}\n`);
}

function storyBytes() {
  return bytes('{"schemaVersion":"1.1","id":"main","title":"Main","states":[]}\n');
}

function fakeDirectory(initialFiles, { failWrites = [] } = {}) {
  const fileData = new Map(Object.entries(initialFiles).map(([path, value]) => [path, bytes(value)]));
  const directories = new Set(['']);
  for (const path of fileData.keys()) {
    const segments = path.split('/');
    segments.pop();
    let prefix = '';
    for (const segment of segments) {
      prefix = `${prefix}${segment}/`;
      directories.add(prefix);
    }
  }
  const reads = [];
  const writes = [];
  const directoryRequests = [];
  const fileRequests = [];
  const createdDirectories = [];
  const createdFiles = [];
  let enumerationCalls = 0;

  function directory(prefix = '') {
    return {
      get name() { return prefix ? prefix.split('/').at(-1) : 'fixture'; },
      async getDirectoryHandle(segment, options = {}) {
        const next = `${prefix}${segment}/`;
        directoryRequests.push({ path: next, create: options.create });
        if (!directories.has(next) && options.create === true) {
          directories.add(next);
          createdDirectories.push(next.slice(0, -1));
        } else if (!directories.has(next)) {
          throw new DOMException(`Missing directory ${next}`, 'NotFoundError');
        }
        return directory(next);
      },
      async getFileHandle(segment, options = {}) {
        const path = `${prefix}${segment}`;
        fileRequests.push({ path, create: options.create });
        if (!fileData.has(path) && options.create === true) createdFiles.push(path);
        else if (!fileData.has(path)) throw new DOMException(`Missing file ${path}`, 'NotFoundError');
        return {
          name: segment,
          async getFile() {
            reads.push(path);
            const current = fileData.get(path);
            return { size: current.length, async arrayBuffer() { return current.slice().buffer; } };
          },
          async createWritable() {
            if (failWrites.includes(path)) throw new DOMException(`Denied ${path}`, 'NotAllowedError');
            let staged;
            return {
              async write(value) { staged = bytes(value); },
              async close() {
                writes.push(path);
                fileData.set(path, staged);
              }
            };
          }
        };
      },
      values() { enumerationCalls += 1; throw new Error('Folder enumeration is forbidden.'); },
      entries() { enumerationCalls += 1; throw new Error('Folder enumeration is forbidden.'); }
    };
  }

  return {
    root: directory(),
    reads,
    writes,
    directoryRequests,
    fileRequests,
    createdDirectories,
    createdFiles,
    fileData,
    get enumerationCalls() { return enumerationCalls; }
  };
}

test('Folder Open reads project.json and declared resources without enumeration', async () => {
  const fs = fakeDirectory({
    'project.json': manifestBytes({ datasets: { route: './data/route.geojson' } }),
    'stories/main.story.json': storyBytes(),
    'data/route.geojson': bytes('{"type":"FeatureCollection","features":[]}\n'),
    'secret.txt': bytes('untouched')
  });

  const opened = await createFolderStorageAdapter({ directoryHandle: fs.root }).open();

  assert.deepEqual(opened.entries.map(({ path }) => path).sort(), [
    'data/route.geojson',
    'project.json',
    'stories/main.story.json'
  ]);
  assert.deepEqual(fs.reads, ['project.json', 'stories/main.story.json', 'data/route.geojson']);
  assert.equal(fs.directoryRequests.every(({ create }) => create === false), true);
  assert.equal(fs.fileRequests.every(({ create }) => create === false), true);
  assert.equal(fs.enumerationCalls, 0);
  assert.equal(fs.reads.includes('secret.txt'), false);
});

test('Folder Open walks nested declared paths one segment at a time and retains invalid JSON bytes', async () => {
  const invalidStory = bytes('{ invalid story json');
  const fs = fakeDirectory({
    'project.json': manifestBytes({ story: './stories/nested/main.story.json' }),
    'stories/nested/main.story.json': invalidStory
  });

  const opened = await createFolderStorageAdapter({ directoryHandle: fs.root }).open();
  const store = createPackageStore(opened);
  const draft = createDraftStore({ packageStore: store });

  assert.deepEqual(store.get('stories/nested/main.story.json').currentBytes, invalidStory);
  assert.equal(draft.get('stories/nested/main.story.json'), undefined);
  assert.equal(draft.diagnostics.length, 1);
});

test('Folder Save writes changed resources in lexical order and project.json last', async () => {
  const fs = fakeDirectory({
    'project.json': manifestBytes({ datasets: { zed: './data/z.geojson', alpha: './data/a.geojson' } }),
    'stories/main.story.json': storyBytes(),
    'data/z.geojson': bytes('{"type":"FeatureCollection","features":[]}\n'),
    'data/a.geojson': bytes('{"type":"FeatureCollection","features":[]}\n'),
    'secret.txt': bytes('untouched')
  });
  const adapter = createFolderStorageAdapter({ directoryHandle: fs.root });
  const opened = await adapter.open();
  const store = createPackageStore(opened);
  store.setCurrentBytes('data/z.geojson', bytes('{"type":"FeatureCollection","features":[{"id":"z"}]}\n'));
  store.setCurrentBytes('data/a.geojson', bytes('{"type":"FeatureCollection","features":[{"id":"a"}]}\n'));
  store.setCurrentBytes('project.json', bytes(`${decoder.decode(store.get('project.json').currentBytes).trim()} \n`));

  const result = await adapter.writeChanges(store.changeSet());
  store.markWritten(result.written);

  assert.deepEqual(fs.writes, ['data/a.geojson', 'data/z.geojson', 'project.json']);
  assert.deepEqual(fs.fileRequests.slice(-3), [
    { path: 'data/a.geojson', create: false },
    { path: 'data/z.geojson', create: false },
    { path: 'project.json', create: false }
  ]);
  assert.deepEqual(result, {
    written: ['data/a.geojson', 'data/z.geojson', 'project.json'],
    failed: [],
    skipped: []
  });
  assert.equal(store.dirty, false);
  assert.equal(fs.fileData.get('secret.txt') && decoder.decode(fs.fileData.get('secret.txt')), 'untouched');
});

test('Folder Save explicitly creates a new nested managed resource before project.json', async () => {
  const fs = fakeDirectory({
    'project.json': manifestBytes(),
    'stories/main.story.json': storyBytes()
  });
  const adapter = createFolderStorageAdapter({ directoryHandle: fs.root });
  const opened = await adapter.open();
  const store = createPackageStore(opened);
  const draft = createDraftStore({ packageStore: store });
  const resource = bytes('{"type":"FeatureCollection","features":[]}\n');

  store.setManaged('data/nested/new-route.geojson', {
    bytes: resource,
    mediaType: 'application/geo+json',
    kind: 'dataset'
  });
  draft.mutate('project.json', (manifest) => {
    manifest.datasets['new-route'] = {
      type: 'geojson', geometry: 'line', src: './data/nested/new-route.geojson', label: 'New route'
    };
  });

  const result = await adapter.writeChanges(store.changeSet());
  store.markWritten(result.written);

  assert.deepEqual(result, {
    written: ['data/nested/new-route.geojson', 'project.json'],
    failed: [],
    skipped: []
  });
  assert.deepEqual(fs.createdDirectories, ['data', 'data/nested']);
  assert.deepEqual(fs.createdFiles, ['data/nested/new-route.geojson']);
  assert.deepEqual(fs.writes, ['data/nested/new-route.geojson', 'project.json']);
  assert.deepEqual(fs.fileData.get('data/nested/new-route.geojson'), resource);
  assert.equal(fs.enumerationCalls, 0);
  assert.equal(store.dirty, false);
});

test('failed new resource creation skips project.json and retains both dirty entries', async () => {
  const fs = fakeDirectory({
    'project.json': manifestBytes(),
    'stories/main.story.json': storyBytes()
  }, { failWrites: ['data/new-route.geojson'] });
  const adapter = createFolderStorageAdapter({ directoryHandle: fs.root });
  const opened = await adapter.open();
  const store = createPackageStore(opened);
  const draft = createDraftStore({ packageStore: store });
  const manifestBefore = store.get('project.json').currentBytes.slice();
  const resource = bytes('{"type":"FeatureCollection","features":[]}\n');

  store.setManaged('data/new-route.geojson', {
    bytes: resource,
    mediaType: 'application/geo+json',
    kind: 'dataset'
  });
  draft.mutate('project.json', (manifest) => {
    manifest.datasets['new-route'] = {
      type: 'geojson', geometry: 'line', src: './data/new-route.geojson', label: 'New route'
    };
  });
  const manifestDraft = store.get('project.json').currentBytes.slice();
  assert.notDeepEqual(manifestDraft, manifestBefore);

  const result = await adapter.writeChanges(store.changeSet());
  store.markWritten(result.written);

  assert.deepEqual(result.failed, [{ path: 'data/new-route.geojson', message: 'Denied data/new-route.geojson' }]);
  assert.deepEqual(result.skipped, ['project.json']);
  assert.deepEqual(result.written, []);
  assert.deepEqual(store.changeSet().map(({ path }) => path), ['data/new-route.geojson', 'project.json']);
  assert.deepEqual(store.get('data/new-route.geojson').currentBytes, resource);
  assert.deepEqual(store.get('project.json').currentBytes, manifestDraft);
  assert.equal(fs.fileData.has('data/new-route.geojson'), false);
  assert.equal(fs.enumerationCalls, 0);
});

test('resource write failure skips project.json and preserves failed and skipped dirtiness', async () => {
  const fs = fakeDirectory({
    'project.json': manifestBytes({ datasets: { alpha: './data/a.geojson', zed: './data/z.geojson' } }),
    'stories/main.story.json': storyBytes(),
    'data/a.geojson': bytes('{"type":"FeatureCollection","features":[]}\n'),
    'data/z.geojson': bytes('{"type":"FeatureCollection","features":[]}\n')
  }, { failWrites: ['data/z.geojson'] });
  const adapter = createFolderStorageAdapter({ directoryHandle: fs.root });
  const opened = await adapter.open();
  const store = createPackageStore(opened);
  for (const path of ['data/a.geojson', 'data/z.geojson', 'project.json']) {
    store.setCurrentBytes(path, bytes(`${decoder.decode(store.get(path).currentBytes)} `));
  }

  const result = await adapter.writeChanges(store.changeSet());
  store.markWritten(result.written);

  assert.deepEqual(fs.writes, ['data/a.geojson']);
  assert.deepEqual(result.written, ['data/a.geojson']);
  assert.deepEqual(result.failed, [{ path: 'data/z.geojson', message: 'Denied data/z.geojson' }]);
  assert.deepEqual(result.skipped, ['project.json']);
  assert.deepEqual(store.changeSet().map(({ path }) => path), ['data/z.geojson', 'project.json']);
});

test('permission denial reports failure without mutating the draft bytes', async () => {
  const fs = fakeDirectory({
    'project.json': manifestBytes(),
    'stories/main.story.json': storyBytes()
  }, { failWrites: ['stories/main.story.json'] });
  const adapter = createFolderStorageAdapter({ directoryHandle: fs.root });
  const opened = await adapter.open();
  const store = createPackageStore(opened);
  const changed = bytes('{"schemaVersion":"1.1","id":"main","title":"Draft retained","states":[]}\n');
  store.setCurrentBytes('stories/main.story.json', changed);

  const result = await adapter.writeChanges(store.changeSet());

  assert.deepEqual(result.failed, [{ path: 'stories/main.story.json', message: 'Denied stories/main.story.json' }]);
  assert.deepEqual(store.get('stories/main.story.json').currentBytes, changed);
  assert.equal(store.dirty, true);
});

test('folder capability detection is explicit and origin descriptions contain no handles', async () => {
  const fs = fakeDirectory({ 'project.json': bytes('{ invalid json') });
  const adapter = createFolderStorageAdapter({ directoryHandle: fs.root, label: 'Selected project' });

  assert.equal(canOpenFolder({ showDirectoryPicker() {} }), true);
  assert.equal(canOpenFolder({}), false);
  assert.deepEqual(adapter.describeOrigin(), { kind: 'folder', label: 'Selected project' });
  const opened = await adapter.open();
  assert.deepEqual(opened.entries.map(({ path }) => path), ['project.json']);
  assert.equal(opened.origin.kind, 'folder');
  assert.equal(opened.origin.label, 'Selected project');
  assert.equal(opened.origin.directoryHandle, fs.root);
});

test('editor save requires explicit confirmation for an invalid draft', async () => {
  const store = createPackageStore({
    origin: { kind: 'folder', label: 'Fixture' },
    entries: [{ path: 'project.json', bytes: bytes('{"title":"before"}\n'), managed: true }]
  });
  store.setCurrentBytes('project.json', bytes('{"title":"invalid draft retained"}\n'));
  let writes = 0;
  const adapter = {
    async writeChanges() {
      writes += 1;
      return { written: ['project.json'], failed: [], skipped: [] };
    }
  };

  const cancelled = await savePackageChanges({
    adapter,
    packageStore: store,
    validation: { status: 'invalid', diagnostics: [{ message: 'Invalid' }] },
    confirmInvalid: async () => false
  });
  assert.deepEqual(cancelled, { written: [], failed: [], skipped: ['project.json'] });
  assert.equal(writes, 0);
  assert.equal(store.dirty, true);

  const saved = await savePackageChanges({
    adapter,
    packageStore: store,
    validation: { status: 'invalid', diagnostics: [{ message: 'Invalid' }] },
    confirmInvalid: async () => true
  });
  assert.deepEqual(saved.written, ['project.json']);
  assert.equal(writes, 1);
  assert.equal(store.dirty, false);
});

test('editor save marks only adapter-reported successful paths as written', async () => {
  const store = createPackageStore({
    origin: { kind: 'folder', label: 'Fixture' },
    entries: [
      { path: 'project.json', bytes: bytes('{"title":"before"}\n'), managed: true },
      { path: 'stories/main.story.json', bytes: storyBytes(), managed: true }
    ]
  });
  store.setCurrentBytes('project.json', bytes('{"title":"after"}\n'));
  store.setCurrentBytes('stories/main.story.json', bytes('{ invalid story draft'));

  const result = await savePackageChanges({
    adapter: {
      async writeChanges() {
        return {
          written: ['stories/main.story.json'],
          failed: [],
          skipped: ['project.json']
        };
      }
    },
    packageStore: store,
    validation: { status: 'valid', diagnostics: [] }
  });

  assert.deepEqual(result.written, ['stories/main.story.json']);
  assert.deepEqual(store.changeSet().map(({ path }) => path), ['project.json']);
});
