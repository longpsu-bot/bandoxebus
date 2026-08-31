import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  collectDeclaredPackageEntries,
  createPackageStore
} from '../editor/core/package-store.js';
import { createPackageFetch } from '../editor/preview/package-resolver.js';
import {
  createFolderStorageAdapter,
  createZipStorageAdapter
} from '../editor/storage/adapters.js';
import { exportPackageZip, savePackageChanges } from '../editor/editor.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import { loadProject } from '../src/project/project-loader.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const AUTHORED_MANIFEST = {
  schemaVersion: '1.0',
  id: 'story-12-persistence',
  title: 'Story 1.2 persistence fixture',
  locale: 'en-US',
  stories: {
    primary: 'main',
    items: [{ id: 'main', src: './stories/main.story.json' }]
  },
  map: {
    basemap: 'openfreemap-dark',
    initialView: { center: [106.63, 11.06], zoom: 10.5, pitch: 32, bearing: -12 }
  },
  datasets: {
    route: {
      type: 'geojson', geometry: 'line', src: './data/route.geojson', label: 'Route',
      render: { type: 'line', color: '#2BB7FF', width: 5, opacity: 0.9 }
    },
    stops: {
      type: 'geojson', geometry: 'point', src: './data/stops.geojson', label: 'Stops',
      render: { type: 'point', color: '#FFB547', radius: 6, strokeColor: '#07101C', strokeWidth: 2 }
    },
    ridership: {
      type: 'table-json', src: './data/ridership.json', label: 'Ridership by stop'
    }
  },
  assets: {
    'network-photo': {
      type: 'image', src: './assets/network.svg', mediaType: 'image/svg+xml', required: true,
      attribution: ['studio-source']
    }
  },
  focusTargets: {},
  metrics: { src: './data/metrics.json' },
  capabilities: [],
  attribution: {
    'studio-source': { name: 'Map Story Studio certification fixture', license: 'Test data' }
  }
};

const AUTHORED_STORY = {
  schemaVersion: '1.2',
  id: 'main',
  title: 'Two-scene persistence story',
  states: [
    {
      id: 'overview',
      content: {
        layout: 'freeform-16x9',
        presenterNote: 'Introduce the complete network.',
        blocks: [
          {
            id: 'overview-text',
            frame: { x: 0.04, y: 0.06, width: 0.38, height: 0.18, z: 30 },
            appearance: {
              box: { fill: '#07101CCC', opacity: 0.96, borderColor: '#FFFFFF22', borderWidth: 1, radius: 18, padding: 22 },
              text: { fontFamily: 'sans', fontSize: 30, bold: true, italic: false, color: '#F6F8FC', align: 'left', lineHeight: 1.2 }
            },
            block: { type: 'paragraph', text: 'A connected network for everyday trips.' }
          },
          {
            id: 'overview-metric',
            frame: { x: 0.04, y: 0.28, width: 0.25, height: 0.18, z: 20 },
            appearance: {
              box: { fill: '#12304CDD', opacity: 0.92, radius: 12, padding: 18 },
              text: { fontFamily: 'georgia', fontSize: 26, bold: true, color: '#FFFFFF', align: 'center', lineHeight: 1.1 }
            },
            block: {
              type: 'stat-group',
              items: [{
                label: 'Daily riders', metric: 'daily-riders',
                format: { type: 'integer', unit: 'passengers' }, tone: 'added'
              }]
            }
          },
          {
            id: 'overview-chart',
            frame: { x: 0.56, y: 0.08, width: 0.4, height: 0.42, z: 10 },
            appearance: { box: { fill: '#FFFFFFEE', opacity: 1, borderColor: '#07101C44', borderWidth: 1, radius: 10, padding: 16 } },
            block: {
              type: 'chart', chartType: 'bar', title: 'Weekday ridership',
              description: 'Boardings by stop', source: 'studio-source', stacked: false,
              data: {
                dataset: 'ridership', x: 'stop',
                series: [{ y: 'riders', label: 'Riders', format: { type: 'integer' }, color: '#2BB7FF' }]
              }
            }
          }
        ]
      },
      map: {
        camera: { center: [106.63125, 11.0525], zoom: 11.25, pitch: 46, bearing: -18 },
        interaction: 'locked',
        transition: { type: 'fly', durationMs: 750 },
        layerVisibility: { route: true, stops: false },
        enter: [],
        exit: []
      }
    },
    {
      id: 'details',
      content: {
        layout: 'freeform-16x9',
        presenterNote: 'Compare stops and invite map exploration.',
        blocks: [
          {
            id: 'details-table',
            frame: { x: 0.04, y: 0.08, width: 0.44, height: 0.4, z: 15 },
            appearance: {
              box: { fill: '#F6F8FCF2', opacity: 1, borderColor: '#2BB7FF88', borderWidth: 2, radius: 8, padding: 14 },
              text: { fontFamily: 'arial', fontSize: 18, bold: false, italic: false, color: '#07101C', align: 'left', lineHeight: 1.35 }
            },
            block: {
              type: 'table', title: 'Busiest stops', caption: 'Average weekday', source: 'studio-source',
              data: {
                dataset: 'ridership',
                columns: [
                  { field: 'stop', header: 'Stop', align: 'start' },
                  { field: 'riders', header: 'Riders', align: 'end', format: { type: 'integer' } }
                ]
              }
            }
          },
          {
            id: 'details-image',
            frame: { x: 0.54, y: 0.08, width: 0.42, height: 0.44, z: 12 },
            appearance: { box: { fill: '#07101CEE', opacity: 0.98, radius: 14, padding: 12 } },
            block: {
              type: 'image', asset: 'network-photo', alt: 'Stylized transit network diagram', decorative: false,
              title: 'Network concept', caption: 'Illustrative test asset', source: 'studio-source'
            }
          },
          {
            id: 'details-legend',
            frame: { x: 0.64, y: 0.58, width: 0.3, height: 0.22, z: 25 },
            appearance: {
              box: { fill: '#07101CCC', opacity: 0.94, borderColor: '#FFFFFF33', borderWidth: 1, radius: 16, padding: 20 },
              text: { fontFamily: 'sans', fontSize: 20, bold: false, italic: false, color: '#F6F8FC', align: 'left', lineHeight: 1.25 }
            },
            block: {
              type: 'legend', title: 'Network layers', source: 'studio-source',
              items: [
                { label: 'Route', sample: 'line', color: '#2BB7FF' },
                { label: 'Stops', sample: 'swatch', color: '#FFB547' },
                { label: 'Network image', sample: 'icon', asset: 'network-photo' }
              ]
            }
          }
        ]
      },
      map: {
        camera: { center: [106.64775, 11.0715], zoom: 13.125, pitch: 28, bearing: 24 },
        interaction: 'explore',
        transition: { type: 'instant', durationMs: 0 },
        layerVisibility: { route: false, stops: true },
        enter: [],
        exit: []
      }
    }
  ]
};

const ROUTE = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', properties: { name: 'Route A' },
    geometry: { type: 'LineString', coordinates: [[106.62, 11.04], [106.66, 11.08]] }
  }]
};

const STOPS = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Central' }, geometry: { type: 'Point', coordinates: [106.63, 11.05] } },
    { type: 'Feature', properties: { name: 'Market' }, geometry: { type: 'Point', coordinates: [106.65, 11.07] } }
  ]
};

const RIDERSHIP = {
  schemaVersion: '1.0',
  columns: [
    { id: 'stop', label: 'Stop', type: 'text' },
    { id: 'riders', label: 'Riders', type: 'integer', unit: 'passengers' }
  ],
  rows: [{ stop: 'Central', riders: 8400 }, { stop: 'Market', riders: 6200 }]
};

const METRICS = {
  schemaVersion: '1.0',
  metrics: {
    'daily-riders': {
      label: 'Daily riders', value: 14600,
      format: { type: 'integer', unit: 'passengers' },
      attribution: ['studio-source']
    }
  }
};

const IMAGE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><title>Network</title><path d="M20 150 L120 70 L210 110 L300 25" fill="none" stroke="#2BB7FF" stroke-width="12"/><circle cx="120" cy="70" r="14" fill="#FFB547"/></svg>\n';

function jsonBytes(value) {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function fixtureEntries() {
  const values = new Map([
    ['project.json', jsonBytes(AUTHORED_MANIFEST)],
    ['stories/main.story.json', jsonBytes(AUTHORED_STORY)],
    ['data/route.geojson', jsonBytes(ROUTE)],
    ['data/stops.geojson', jsonBytes(STOPS)],
    ['data/ridership.json', jsonBytes(RIDERSHIP)],
    ['data/metrics.json', jsonBytes(METRICS)],
    ['assets/network.svg', encoder.encode(IMAGE)]
  ]);
  return [
    { path: 'project.json', bytes: values.get('project.json'), mediaType: 'application/json', kind: 'manifest', managed: true },
    ...collectDeclaredPackageEntries(AUTHORED_MANIFEST).map((descriptor) => ({
      ...descriptor,
      bytes: values.get(descriptor.path),
      managed: true
    }))
  ];
}

function packageStore(entries = fixtureEntries(), origin = { kind: 'memory', label: 'Story 1.2 persistence fixture' }) {
  return createPackageStore({ origin, entries });
}

async function loadStore(store) {
  const transport = createPackageFetch(store.snapshot());
  return loadProject(transport.manifestUrl, {
    fetchImpl: transport.fetchImpl,
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY
  });
}

function nodeDirectoryHandle(root, prefix = '') {
  return {
    name: prefix ? prefix.split('/').at(-2) : path.basename(root),
    async getDirectoryHandle(segment, options = {}) {
      const relative = `${prefix}${segment}/`;
      const filename = path.join(root, ...relative.split('/').filter(Boolean));
      let details = await stat(filename).catch(() => null);
      if (!details && options.create === true) {
        await mkdir(filename);
        details = await stat(filename);
      }
      if (!details?.isDirectory()) throw new DOMException(`Missing directory: ${relative}`, 'NotFoundError');
      return nodeDirectoryHandle(root, relative);
    },
    async getFileHandle(segment, options = {}) {
      const relative = `${prefix}${segment}`;
      const filename = path.join(root, ...relative.split('/'));
      const details = await stat(filename).catch(() => null);
      if (!details && options.create !== true) throw new DOMException(`Missing file: ${relative}`, 'NotFoundError');
      return {
        name: segment,
        async getFile() {
          const value = new Uint8Array(await readFile(filename));
          return { size: value.length, async arrayBuffer() { return value.slice().buffer; } };
        },
        async createWritable() {
          let staged;
          return {
            async write(value) { staged = new Uint8Array(value).slice(); },
            async close() { await writeFile(filename, staged); }
          };
        }
      };
    }
  };
}

async function withTempFolder(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'story-12-persistence-'));
  try { return await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

function authoredProjection(story) {
  return story.states.map((state) => ({
    camera: state.map.camera,
    layerVisibility: state.map.layerVisibility,
    interaction: state.map.interaction,
    transition: state.map.transition,
    blocks: state.content.blocks.map(({ id, frame, appearance, block }) => ({ id, frame, appearance, block }))
  }));
}

function assertProductionRoundTrip(project) {
  assert.deepEqual(project.story, AUTHORED_STORY);
  assert.deepEqual(authoredProjection(project.story), authoredProjection(AUTHORED_STORY));
  assert.deepEqual(project.manifest.datasets, AUTHORED_MANIFEST.datasets);
  assert.deepEqual(project.manifest.assets, AUTHORED_MANIFEST.assets);
  assert.deepEqual(project.manifest.metrics, AUTHORED_MANIFEST.metrics);
  assert.equal(project.resources.get('ridership').value.rows[1].riders, 6200);
  assert.equal(project.metrics.resolve('daily-riders').value, 14600);
}

function assertNoEditorState(store) {
  assert.deepEqual(
    store.list().map(({ path: entryPath }) => entryPath),
    fixtureEntries().map(({ path: entryPath }) => entryPath).sort()
  );
  const persisted = JSON.parse(decoder.decode(store.get('stories/main.story.json').currentBytes));
  const forbiddenKeys = new Set([
    'selection', 'selected', 'handles', 'guides', 'history', 'undoStack', 'redoStack',
    'previewMode', 'outputMode', 'workingCamera', 'uncapturedCamera'
  ]);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `editor-only key persisted: ${key}`);
      visit(nested);
    }
  };
  visit(persisted);
}

test('ordinary Story 1.2 fixture passes the unchanged production loader before persistence', async () => {
  const store = packageStore();
  const project = await loadStore(store);

  assertProductionRoundTrip(project);
  assertNoEditorState(store);
});

test('Folder save and reopen preserve exact authored Story 1.2 semantics without editor state', async () => {
  await withTempFolder(async (root) => {
    const entries = fixtureEntries();
    for (const entry of entries) {
      const filename = path.join(root, ...entry.path.split('/'));
      await mkdir(path.dirname(filename), { recursive: true });
      const placeholder = entry.path === 'project.json'
        ? encoder.encode(`${decoder.decode(entry.bytes).trimEnd()}  \n`)
        : encoder.encode('{}\n');
      await writeFile(filename, placeholder);
    }

    const adapter = createFolderStorageAdapter({ directoryHandle: nodeDirectoryHandle(root) });
    const opened = await adapter.open();
    const store = createPackageStore(opened);
    for (const entry of entries) store.setCurrentBytes(entry.path, entry.bytes);

    const saved = await savePackageChanges({
      adapter,
      packageStore: store,
      validation: { status: 'valid' }
    });
    assert.deepEqual(saved.failed, []);
    assert.equal(saved.written.length, entries.length);

    const reopenedStore = createPackageStore(await adapter.open());
    assertProductionRoundTrip(await loadStore(reopenedStore));
    assertNoEditorState(reopenedStore);
  });
});

test('ZIP export and import preserve exact authored Story 1.2 semantics without editor state', async () => {
  const sourceStore = packageStore();
  const zipBytes = await exportPackageZip({
    packageStore: sourceStore,
    validation: { status: 'valid' }
  });
  const importedStore = createPackageStore(await createZipStorageAdapter({ zipBytes }).open());

  assertProductionRoundTrip(await loadStore(importedStore));
  assertNoEditorState(importedStore);
});
