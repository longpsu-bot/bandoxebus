import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createPackageStore } from '../editor/core/package-store.js';
import { exportPackageZip } from '../editor/editor.js';
import { createZipStorageAdapter } from '../editor/storage/adapters.js';
import {
  Unzip,
  UnzipInflate,
  Zip,
  ZipPassThrough
} from '../vendor/fflate/0.8.3/fflate.esm.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytes(value) {
  return typeof value === 'string' ? encoder.encode(value) : value.slice();
}

function concat(chunks) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function makeZip(entries) {
  const chunks = [];
  let failure;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk.slice());
  });
  for (const [name, payload] of entries) {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes(payload), true);
  }
  zip.end();
  if (failure) throw failure;
  return concat(chunks);
}

function manifest({ story = './stories/main.story.json', assets = {} } = {}) {
  return bytes(`${JSON.stringify({
    schemaVersion: '1.0',
    id: 'zip-fixture',
    title: 'ZIP fixture',
    locale: 'en-US',
    stories: { primary: 'main', items: [{ id: 'main', src: story }] },
    map: { basemap: 'openfreemap-dark', initialView: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } },
    datasets: {},
    assets,
    focusTargets: {},
    capabilities: [],
    attribution: {}
  }, null, 2)}\n`);
}

const story = bytes('{"schemaVersion":"1.1","id":"main","title":"Main","states":[]}\n');

async function unzipForTest(zipBytes) {
  const result = Object.create(null);
  const pending = [];
  const unzip = new Unzip((file) => {
    const chunks = [];
    pending.push(new Promise((resolve, reject) => {
      file.ondata = (error, chunk, final) => {
        if (error) reject(error);
        else {
          chunks.push(chunk.slice());
          if (final) {
            result[file.name] = concat(chunks);
            resolve();
          }
        }
      };
      file.start();
    }));
  });
  unzip.register(UnzipInflate);
  unzip.push(zipBytes, true);
  await Promise.all(pending);
  return result;
}

test('ZIP re-export preserves safe unknown payload bytes and managed edits', async () => {
  const unknown = new Uint8Array(await readFile(new URL('./fixtures/editor/zip-entries/README.txt', import.meta.url)));
  const input = makeZip([
    ['project.json', manifest()],
    ['stories/main.story.json', story],
    ['README.txt', unknown],
    ['editor-state.json', bytes('{"selection":"private"}')]
  ]);
  const adapter = createZipStorageAdapter({ zipBytes: input, label: 'fixture.zip' });
  const opened = await adapter.open();
  const store = createPackageStore(opened);
  const changed = bytes(`${decoder.decode(store.get('project.json').currentBytes).trim()}\n`);
  store.setCurrentBytes('project.json', changed);

  const exported = await adapter.export(store);
  const entries = await unzipForTest(exported);

  assert.deepEqual(entries['README.txt'], unknown);
  assert.deepEqual(entries['project.json'], changed);
  assert.equal(Object.hasOwn(entries, 'editor-state.json'), false);
  assert.deepEqual(store.list().filter(({ managed }) => !managed).map(({ path }) => path), [
    'editor-state.json',
    'README.txt'
  ]);
});

test('removed ZIP declaration becomes pass-through while folder-origin export stays managed-only', async () => {
  const adapter = createZipStorageAdapter({
    zipBytes: makeZip([
      ['project.json', manifest()],
      ['stories/main.story.json', story],
      ['README.txt', bytes('notes')]
    ])
  });
  const opened = await adapter.open();
  const zipStore = createPackageStore(opened);
  zipStore.removeManaged('stories/main.story.json');
  const zipExport = await unzipForTest(await adapter.export(zipStore));
  assert.deepEqual(zipExport['stories/main.story.json'], story);

  const folderStore = createPackageStore({
    origin: { kind: 'folder', label: 'Folder' },
    entries: [
      { path: 'project.json', bytes: manifest(), managed: true },
      { path: 'README.txt', bytes: bytes('must not export'), managed: false }
    ]
  });
  const folderExport = await unzipForTest(await createZipStorageAdapter().export(folderStore));
  assert.deepEqual(Object.keys(folderExport), ['project.json']);
});

test('ZIP import rejects unsafe and executable paths before package promotion', async () => {
  const cases = [
    ['../escape', '../escape'],
    ['/absolute', '/absolute'],
    ['drive path', 'C:\\secret.txt'],
    ['backslash', 'data\\secret.txt'],
    ['percent traversal', 'data/%252e%252e/secret.txt']
  ];
  for (const [label, path] of cases) {
    const adapter = createZipStorageAdapter({ zipBytes: makeZip([
      ['project.json', manifest()],
      ['stories/main.story.json', story],
      [path, bytes('unsafe')]
    ]) });
    await assert.rejects(adapter.open(), /package path/i, label);
  }

  const executable = createZipStorageAdapter({
    zipBytes: makeZip([
      ['project.json', manifest({ assets: { plugin: { type: 'image', src: './scripts/plugin.js', mediaType: 'image/png' } } })],
      ['stories/main.story.json', story],
      ['scripts/plugin.js', bytes('export default 1')]
    ])
  });
  await assert.rejects(executable.open(), /executable|resource path|package path/i);
});

test('ZIP import rejects exact and normalized duplicate paths before map collapse', async () => {
  for (const entries of [
    [
      ['project.json', manifest()],
      ['project.json', manifest()],
      ['stories/main.story.json', story]
    ],
    [
      ['./project.json', manifest()],
      ['project.json', manifest()],
      ['stories/main.story.json', story]
    ]
  ]) {
    await assert.rejects(
      createZipStorageAdapter({ zipBytes: makeZip(entries) }).open(),
      /duplicate.*package path/i
    );
  }
});

test('ZIP import enforces root manifest and the 2048-entry ceiling', async () => {
  await assert.rejects(
    createZipStorageAdapter({ zipBytes: makeZip([['README.txt', bytes('missing')]]) }).open(),
    /root project\.json/i
  );

  const tooMany = [['project.json', manifest()]];
  for (let index = 0; index < 2048; index += 1) tooMany.push([`notes/${index}.txt`, new Uint8Array()]);
  await assert.rejects(
    createZipStorageAdapter({ zipBytes: makeZip(tooMany) }).open(),
    /2048 entries/i
  );
});

test('fatal production validation blocks project ZIP export', async () => {
  const store = createPackageStore({
    origin: { kind: 'memory', label: 'Invalid' },
    entries: [{ path: 'project.json', bytes: manifest(), managed: true }]
  });
  await assert.rejects(
    exportPackageZip({
      packageStore: store,
      validation: { status: 'invalid', diagnostics: [{ message: 'Broken reference' }] }
    }),
    /production validation/i
  );
});
