import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGenericApplicationOptions, resolveHostedPmtilesOrigin } from '../src/runtime/generic-app.js';
import { startApplication } from '../src/application.js';
import { createPreviewPackageResolver, startEditorPreviewHost } from '../editor/preview/package-resolver.js';
import { createNewProjectEntries, createPackageStore } from '../editor/core/package-store.js';

const appUrl = new URL('../src/runtime/generic-app.js', import.meta.url);

test('normal and preview transports share the same production composition', async () => {
  const source = await readFile(appUrl, 'utf8');
  assert.match(source, /export function createGenericApplicationOptions\(/);
  assert.match(source, /export function startGenericProductionApplication\(/);
  assert.match(source, /startApplication\(createGenericApplicationOptions\(transport\)\)/);
  assert.match(source, /capabilityRegistry:\s*INSTALLED_CAPABILITY_REGISTRY/);
  assert.match(source, /createMap:\s*createGenericMap/);
  assert.match(source, /bindStoryExperience:\s*bindGenericStoryExperience/);
  assert.match(source, /startProductionApplication:\s*startGenericProductionApplication/);
  assert.match(source, /initialize\(\)[\s\S]*?startGenericProductionApplication\(\)/);
  assert.equal((source.match(/new maplibregl\.Map\(/g) ?? []).length, 1);
});

test('generic application carries the optional PMTiles File resolver to bootstrap context', async () => {
  const file = new File(['PMTiles'], 'archive.pmtiles');
  const options = createGenericApplicationOptions({ resolvePmtilesAssetFile: () => file });
  const result = await startApplication({
    ...options,
    loadProjectImpl: async () => ({}),
    bootstrapImpl: async (context) => context.resolvePmtilesAssetFile()
  });
  assert.equal(result, file);
});

function documentWithPmtilesOrigin(content) {
  return {
    querySelector(selector) {
      assert.equal(selector, 'meta[name="map-story-pmtiles-origin"]');
      return { content };
    }
  };
}

test('empty deployment meta leaves generic asset resolution unchanged', () => {
  const documentRef = documentWithPmtilesOrigin('  ');
  assert.equal(resolveHostedPmtilesOrigin(documentRef), null);
  assert.equal(createGenericApplicationOptions({ documentRef }).resolveAssetUrl, undefined);
});

test('HTTPS deployment meta installs the content-addressed PMTiles resolver', () => {
  const options = createGenericApplicationOptions({ documentRef: documentWithPmtilesOrigin('https://maps.example.test/') });
  assert.equal(typeof options.resolveAssetUrl, 'function');
  assert.equal(options.resolveAssetUrl(new URL('https://pages.example.test/assets/photo.png'), {
    id: 'photo', descriptor: { type: 'image', mediaType: 'image/png' }, manifest: { id: 'route-61-2', capabilities: [] }
  }).href, 'https://pages.example.test/assets/photo.png');
});

test('an explicit asset resolver overrides deployment metadata', () => {
  const explicit = () => 'blob:preview/photo';
  assert.equal(createGenericApplicationOptions({
    documentRef: documentWithPmtilesOrigin('https://maps.example.test/'), resolveAssetUrl: explicit
  }).resolveAssetUrl, explicit);
});

test('invalid deployment PMTiles origins fail loudly', () => {
  for (const value of ['http://maps.example.test/', 'not a URL']) {
    assert.throws(() => createGenericApplicationOptions({ documentRef: documentWithPmtilesOrigin(value) }), /HTTPS/i);
  }
});

test('preview host threads its PMTiles resolver through shared generic options into bootstrap', async () => {
  const path = 'assets/context/overture-buildings.pmtiles';
  const payload = new Uint8Array([80, 77, 84, 105, 108, 101, 115, 3]);
  const context = { id: 'overture-buildings-snapshot', descriptor: { type: 'pmtiles', mediaType: 'application/vnd.pmtiles' } };
  const windowRef = {
    location: { origin: 'https://editor.example' },
    parent: { postMessage() {} },
    addEventListener() {}, removeEventListener() {}
  };
  let resolvedFile;
  const host = startEditorPreviewHost({
    windowRef,
    startProductionApplication: (transport) => startApplication({
      ...createGenericApplicationOptions(transport),
      loadProjectImpl: async () => ({}),
      bootstrapImpl: async (options) => {
        resolvedFile = options.resolvePmtilesAssetFile(new URL(path, transport.manifestUrl), context);
        return { destroy() {} };
      }
    })
  });
  try {
    await host.start({ revision: 1, entries: [
      { path, bytes: payload, mediaType: 'application/vnd.pmtiles', kind: 'asset' }
    ] });
    assert.deepEqual(new Uint8Array(await resolvedFile.arrayBuffer()), payload);
  } finally {
    await host.dispose();
  }
});

test('real preview project loading preserves PMTiles URLs and only materializes image object URLs', async () => {
  const path = 'assets/context/overture-buildings.pmtiles';
  const entries = createNewProjectEntries();
  const manifest = JSON.parse(new TextDecoder().decode(entries[0].bytes));
  manifest.assets = {
    'overture-buildings-snapshot': { type: 'pmtiles', src: `./${path}`, mediaType: 'application/vnd.pmtiles' },
    photo: { type: 'image', src: './assets/photo.png', mediaType: 'image/png' }
  };
  entries[0].bytes = new TextEncoder().encode(JSON.stringify(manifest));
  entries.push(
    { path, file: new File(['PMTiles'], 'overture-buildings.pmtiles'), mediaType: 'application/vnd.pmtiles', kind: 'asset' },
    { path: 'assets/photo.png', bytes: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png', kind: 'asset' }
  );
  const snapshot = createPackageStore({ entries }).snapshot();
  const createdBlobs = [];
  const fetchedPaths = [];
  const revokedUrls = [];
  let project;
  const host = startEditorPreviewHost({
    windowRef: {
      location: { origin: 'https://editor.example' }, parent: { postMessage() {} },
      addEventListener() {}, removeEventListener() {}
    },
    createResolver(value) {
      value.entries.find((entry) => entry.path === path).file.arrayBuffer = () => {
        throw new Error('Project loading must not read the full PMTiles file.');
      };
      const resolver = createPreviewPackageResolver(value, { urlApi: {
        createObjectURL(blob) { createdBlobs.push(blob); return `blob:preview/${createdBlobs.length}`; },
        revokeObjectURL(url) { revokedUrls.push(url); }
      } });
      return { ...resolver, fetchImpl: (...args) => {
        fetchedPaths.push(new URL(args[0]).pathname);
        return resolver.fetchImpl(...args);
      } };
    },
    startProductionApplication: (transport) => startApplication({
      ...createGenericApplicationOptions(transport),
      bootstrapImpl: async (options) => {
        project = options.project;
        const resource = project.resources.get('overture-buildings-snapshot');
        assert.equal(resource.url.href, new URL(path, transport.manifestUrl).href);
        const file = options.resolvePmtilesAssetFile(resource.url, resource);
        assert.equal(await file.slice(0, 7).text(), 'PMTiles');
        return { project, destroy() {} };
      }
    })
  });
  try {
    await host.start(snapshot);
    assert.equal(project.resources.get('photo').url, 'blob:preview/1');
    assert.deepEqual(createdBlobs.map((blob) => blob.type), ['image/png']);
    assert.equal(fetchedPaths.some((value) => value.endsWith('.pmtiles')), false);
  } finally {
    await host.dispose();
  }
  assert.deepEqual(revokedUrls, ['blob:preview/1']);
});
