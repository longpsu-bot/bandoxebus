import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createZipStorageAdapter } from '../editor/storage/adapters.js';
import { createFixtureServer } from './serve-project-fixture.mjs';
import { Zip, ZipPassThrough, unzipSync, zipSync } from '../vendor/fflate/0.8.3/fflate.esm.js';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=')];
}));
const GATE = args.get('--gate') ?? 'pr-a';
const APP_URL = args.get('--url') ?? 'http://127.0.0.1:8080/editor/';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = 30_000;

if (!['pr-a', 'pr-b', 'pr-c'].includes(GATE)) throw new Error(`Unsupported editor browser gate: ${GATE}`);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  close() { this.socket.close(); }
}

async function pageTarget() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
      const target = targets.find(({ type, url }) => type === 'page' && url.startsWith(APP_URL));
      if (target) return target;
    } catch {}
    await sleep(100);
  }
  throw new Error(`No browser page target for ${APP_URL}`);
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(client, expression, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluate(client, expression);
    if (lastValue) return lastValue;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

function setInput(id, value) {
  return `(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
}

function setControl(id, value) {
  return `(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
}

function setFile(id, name, mediaType, contents) {
  return `(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    const file = new File([${JSON.stringify(contents)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(mediaType)} });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    return true;
  })()`;
}

function openSection(id) {
  return `(() => { document.querySelector('[data-section="${id}"]').click(); return true; })()`;
}

function concatBytes(chunks) {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function duplicateZip(entries) {
  const chunks = [];
  let failure;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk.slice());
  });
  for (const [name, bytes] of entries) {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(bytes, true);
  }
  zip.end();
  if (failure) throw failure;
  return concatBytes(chunks);
}

function bytesExpression(value) {
  return `Uint8Array.from(atob(${JSON.stringify(Buffer.from(value).toString('base64'))}), character => character.charCodeAt(0))`;
}

async function mountZip(zipBytes, root) {
  const opened = await createZipStorageAdapter({ zipBytes }).open();
  for (const entry of opened.entries.filter(({ managed }) => managed)) {
    const filename = path.join(root, ...entry.path.split('/'));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, entry.bytes);
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

const target = await pageTarget();
const client = new CdpClient(target.webSocketDebuggerUrl);
await client.open();
let fixtureServer = null;
let fixtureTempRoot = null;
const consoleIssues = [];
client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
  consoleIssues.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
});
client.on('Log.entryAdded', ({ entry }) => {
  if (entry.level === 'error' && !/favicon\.ico/i.test(`${entry.url ?? ''} ${entry.text}`)) consoleIssues.push(entry.text);
});

try {
  await Promise.all([client.send('Runtime.enable'), client.send('Log.enable'), client.send('Page.enable')]);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.readyState === 'complete' && Boolean(document.getElementById('new-project')) && Boolean(window.__GUI_EDITOR__)`, 'editor shell');
  await evaluate(client, `document.getElementById('new-project').click()`);
  const firstRevisionState = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    const child = frame.contentDocument;
    return revision >= 0 && child?.querySelectorAll('.maplibregl-canvas').length === 1 ? { revision } : null;
  })()`, 'first valid production preview');
  const firstRevision = firstRevisionState.revision;
  await waitFor(client, `Boolean(document.getElementById('production-preview').contentDocument?.getElementById('presentation-open'))`, 'first Story control');
  await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('presentation-open').click()`);
  await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    return child && child.getElementById('story-shell')?.hidden === false && /New project/.test(child.getElementById('story-shell-steps')?.textContent ?? '');
  })()`, 'visible New project Story');

  await evaluate(client, setInput('story-heading', 'Updated project'));
  const headingRevision = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    return revision > ${firstRevision} ? revision : 0;
  })()`, 'valid heading revision');
  await waitFor(client, `Boolean(document.getElementById('production-preview').contentDocument?.getElementById('presentation-open'))`, 'updated Story control');
  await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('presentation-open').click()`);
  await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    return child && child.getElementById('story-shell')?.hidden === false && /Updated project/.test(child.getElementById('story-shell-steps')?.textContent ?? '');
  })()`, 'updated Story heading');

  await evaluate(client, setInput('project-locale', ''));
  const invalidState = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const status = document.getElementById('validation-status')?.textContent ?? '';
    const errors = document.getElementById('validation-errors')?.textContent ?? '';
    const canvasCount = frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
    return /Invalid project locale/.test(status) && /\\$\\.locale/.test(errors)
      ? { revision: Number(frame.dataset.previewRevision), canvasCount, paused: !document.getElementById('preview-paused').hidden }
      : null;
  })()`, 'production-invalid empty locale');
  if (invalidState.revision !== headingRevision) throw new Error('Invalid snapshot reached the production iframe.');
  if (!invalidState.paused || invalidState.canvasCount !== 1) throw new Error('Last-valid preview was not retained while invalid.');

  await evaluate(client, setInput('project-locale', 'en-US'));
  const repairedRevision = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    const canvasCount = frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
    return revision > ${headingRevision} && canvasCount === 1 ? revision : 0;
  })()`, 'repaired production preview');

  const desktopWidth = await evaluate(client, `document.getElementById('preview-frame').getBoundingClientRect().width`);
  await evaluate(client, `document.getElementById('preview-mobile').click()`);
  const mobileWidth = await waitFor(client, `(() => {
    const frame = document.getElementById('preview-frame');
    const width = frame.getBoundingClientRect().width;
    return frame.classList.contains('preview-frame--mobile') && width < ${desktopWidth} ? width : 0;
  })()`, 'mobile preview preset');
  await evaluate(client, `document.getElementById('preview-desktop').click()`);
  await waitFor(client, `document.getElementById('preview-frame').classList.contains('preview-frame--desktop')`, 'desktop preview preset');

  await evaluate(client, `document.getElementById('new-project').click()`);
  const secondNewRevisionState = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    const canvasCount = frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
    return revision === 0 && canvasCount === 1 ? { revision } : null;
  })()`, 'second New production preview');
  const secondNewRevision = secondNewRevisionState.revision;
  await waitFor(client, `Boolean(document.getElementById('production-preview').contentDocument?.getElementById('presentation-open'))`, 'second New Story control');
  await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('presentation-open').click()`);
  await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const storyText = child?.getElementById('story-shell-steps')?.textContent ?? '';
    return child?.getElementById('story-shell')?.hidden === false
      && /New project/.test(storyText) && !/Updated project/.test(storyText);
  })()`, 'fresh second New Story');

  const finalState = await evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    return {
      revision: Number(frame.dataset.previewRevision),
      canvasCount: frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0,
      locale: document.getElementById('project-locale').value,
      mobileWidth: ${mobileWidth},
      desktopWidth: document.getElementById('preview-frame').getBoundingClientRect().width
    };
  })()`);
  if (finalState.revision !== secondNewRevision || finalState.canvasCount !== 1 || finalState.locale !== 'en-US') {
    throw new Error(`Unexpected final editor state: ${JSON.stringify(finalState)}`);
  }

  let prB = null;
  let prC = null;
  let exportedOrdinaryZip = null;
  if (GATE === 'pr-b' || GATE === 'pr-c') {
    await evaluate(client, openSection('project'));
    await evaluate(client, `(() => {
      const input = document.querySelector('.tailored-inspector input[data-path="title"]');
      input.value = 'PR B authored project';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(client, `(() => [...document.querySelectorAll('.tailored-inspector button')].some((button) => /Use current preview view/.test(button.textContent) && !button.disabled))()`, 'preview camera telemetry');
    await evaluate(client, `(() => { [...document.querySelectorAll('.tailored-inspector button')].find((button) => /Use current preview view/.test(button.textContent)).click(); return true; })()`);
    await evaluate(client, `(() => { [...document.querySelectorAll('.tailored-inspector button')].find((button) => /Confirm captured view/.test(button.textContent)).click(); return true; })()`);

    await evaluate(client, openSection('attribution'));
    await evaluate(client, setControl('author-attribution-id', 'planning-team'));
    await evaluate(client, setControl('author-attribution-name', 'Planning team'));
    await evaluate(client, setControl('author-attribution-url', 'https://example.com/source'));
    await evaluate(client, `document.getElementById('author-attribution-add').click()`);
    await waitFor(client, `/Added attribution/.test(document.querySelector('.authoring-status').textContent)`, 'attribution authoring');

    const imports = [
      {
        id: 'route', label: 'Route', type: 'line', name: 'route.geojson', mediaType: 'application/geo+json',
        value: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Route' }, geometry: { type: 'LineString', coordinates: [[106.5, 10.9], [106.7, 11.1]] } }] }
      },
      {
        id: 'stops', label: 'Stops', type: 'point', name: 'stops.geojson', mediaType: 'application/geo+json',
        value: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Stop' }, geometry: { type: 'Point', coordinates: [106.6, 11] } }] }
      },
      ...(GATE === 'pr-c' ? [{
        id: 'service-area', label: 'Service area', type: 'polygon', name: 'service-area.geojson', mediaType: 'application/geo+json',
        value: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Area' }, geometry: { type: 'Polygon', coordinates: [[[106.5, 10.9], [106.7, 10.9], [106.7, 11.1], [106.5, 10.9]]] } }] }
      }] : []),
      {
        id: 'demand', label: 'Demand', type: 'table', name: 'demand.json', mediaType: 'application/json',
        value: { schemaVersion: '1.0', columns: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'value', label: 'Value', type: 'number' }], rows: [{ name: 'A', value: 10 }] }
      }
    ];
    for (const imported of imports) {
      await evaluate(client, openSection('datasets'));
      await evaluate(client, setControl('author-dataset-id', imported.id));
      await evaluate(client, setControl('author-dataset-label', imported.label));
      await evaluate(client, setControl('author-dataset-type', imported.type));
      await evaluate(client, setFile('author-dataset-file', imported.name, imported.mediaType, JSON.stringify(imported.value)));
      await evaluate(client, `document.getElementById('author-dataset-add').click()`);
      await waitFor(client, `/Added dataset/.test(document.querySelector('.authoring-status').textContent)`, `${imported.id} import`);
    }

    await evaluate(client, openSection('datasets'));
    await evaluate(client, setControl('author-dataset-existing', 'route'));
    await waitFor(client, `Boolean(document.getElementById('author-dataset-render-color'))`, 'existing dataset inspector');
    await evaluate(client, setControl('author-dataset-render-color', '#336699'));
    await evaluate(client, setControl('author-dataset-label-field', 'name'));
    const datasetEdited = await evaluate(client, `document.getElementById('author-dataset-render-color').value === '#336699' && document.getElementById('author-dataset-label-field').value === 'name'`);
    if (!datasetEdited) throw new Error('Existing dataset was not edited through visible controls.');

    await evaluate(client, setControl('author-dataset-existing', 'demand'));
    await waitFor(client, `Boolean(document.getElementById('author-table-cell-0-value'))`, 'normalized table cell');
    await evaluate(client, setControl('author-table-cell-0-value', '12'));
    const tableCellEdited = await evaluate(client, `document.getElementById('author-table-cell-0-value').value === '12'`);
    if (!tableCellEdited) throw new Error('Normalized table cell was not edited through visible controls.');

    await evaluate(client, openSection('assets'));
    await evaluate(client, setControl('author-asset-id', 'photo'));
    await evaluate(client, setFile(
      'author-asset-file',
      GATE === 'pr-c' ? 'photo.svg' : 'photo.png',
      GATE === 'pr-c' ? 'image/svg+xml' : 'image/png',
      GATE === 'pr-c' ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#336699"/></svg>' : 'preview-image'
    ));
    await evaluate(client, `document.getElementById('author-asset-add').click()`);
    await waitFor(client, `/Added image/.test(document.querySelector('.authoring-status').textContent)`, 'image authoring');

    await evaluate(client, openSection('metrics'));
    await evaluate(client, setControl('author-metric-id', 'total'));
    await evaluate(client, setControl('author-metric-label', 'Total'));
    await evaluate(client, setControl('author-metric-value', '10'));
    await evaluate(client, setControl('author-metric-format', 'integer'));
    await evaluate(client, `document.getElementById('author-metric-add').click()`);
    await waitFor(client, `/Added metric/.test(document.querySelector('.authoring-status').textContent)`, 'metric authoring');

    await evaluate(client, openSection('focus'));
    await evaluate(client, setControl('author-focus-id', 'overview'));
    await evaluate(client, setControl('author-focus-datasets', 'route,stops'));
    await evaluate(client, `document.getElementById('author-focus-add').click()`);
    await waitFor(client, `/Added focus/.test(document.querySelector('.authoring-status').textContent)`, 'focus authoring');
    await evaluate(client, setControl('author-focus-id', 'town-center'));
    await evaluate(client, setControl('author-focus-type', 'coordinate'));
    await evaluate(client, setControl('author-focus-longitude', '106.61'));
    await evaluate(client, setControl('author-focus-latitude', '11.01'));
    await evaluate(client, setControl('author-focus-zoom', '13'));
    await evaluate(client, `document.getElementById('author-focus-add').click()`);
    await waitFor(client, `/Added focus town-center/.test(document.querySelector('.authoring-status').textContent)`, 'coordinate focus authoring');

    await evaluate(client, openSection('stories'));
    await evaluate(client, setControl('author-state-title', 'Details'));
    await evaluate(client, `document.getElementById('author-state-add').click()`);
    await waitFor(client, `/Added state/.test(document.querySelector('.authoring-status').textContent)`, 'state authoring');
    await evaluate(client, setControl('author-state-index', '1'));
    for (const block of ['table', 'chart', 'image', 'legend']) {
      await evaluate(client, setControl('author-block-type', block));
      await evaluate(client, `document.getElementById('author-block-add').click()`);
      await waitFor(client, `document.querySelector('.authoring-status').textContent === ${JSON.stringify(`Added ${block} block.`)}`, `${block} block`);
    }
    await evaluate(client, setControl('author-block-existing', '4'));
    await evaluate(client, `document.getElementById('author-block-up').click()`);
    await waitFor(client, `/Moved block up/.test(document.querySelector('.authoring-status').textContent)`, 'visible block reorder');
    await evaluate(client, setControl('author-state-index', '0'));
    for (const [type, semanticTarget] of [['map.focus', 'overview'], ['map.set-visibility', 'route'], ['map.set-emphasis', 'stops']]) {
      await evaluate(client, setControl('author-action-type', type));
      const targetSafety = await evaluate(client, `(() => {
        const target = document.getElementById('author-action-target');
        return target?.tagName === 'SELECT' && ![...target.options].some(({ value }) => value === 'layer-private');
      })()`);
      if (!targetSafety) throw new Error(`${type} did not expose a safe semantic target select.`);
      await evaluate(client, setControl('author-action-target', semanticTarget));
      await evaluate(client, `document.getElementById('author-action-add').click()`);
      await waitFor(client, `document.querySelector('.authoring-status').textContent === ${JSON.stringify(`Added ${type}.`)}`, `${type} action`);
    }
    await evaluate(client, setControl('author-action-existing', '2'));
    await evaluate(client, `document.getElementById('author-action-up').click()`);
    await waitFor(client, `/Moved action up/.test(document.querySelector('.authoring-status').textContent)`, 'visible action reorder');
    await evaluate(client, setControl('author-state-index', '1'));
    await evaluate(client, `document.getElementById('author-state-up').click()`);

    const authoredRevision = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      const revision = Number(frame.dataset.previewRevision);
      return revision > 0 && frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1 ? revision : 0;
    })()`, 'authored production preview');

    if (GATE === 'pr-c') {
      await waitFor(client, `Boolean(document.getElementById('production-preview').contentDocument?.getElementById('presentation-open'))`, 'ordinary authored Story launcher');
      await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('presentation-open').click()`);
      const ordinarySurfaces = await waitFor(client, `(() => {
        const child = document.getElementById('production-preview').contentDocument;
        const result = {
          maps: child?.querySelectorAll('.maplibregl-canvas').length ?? 0,
          table: child?.querySelectorAll('.content-table table').length ?? 0,
          chart: child?.querySelectorAll('.content-chart canvas[role="img"]').length ?? 0,
          image: child?.querySelectorAll('.content-image img[alt]').length ?? 0,
          legend: child?.querySelectorAll('.content-legend ul').length ?? 0
        };
        return result.maps === 1 && result.table && result.chart && result.image && result.legend ? result : null;
      })()`, 'ordinary authored production content surfaces');
      await evaluate(client, `document.getElementById('preview-mobile').click()`);
      const ordinaryMobileMap = await waitFor(client, `document.getElementById('production-preview').contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1`, 'ordinary mobile one-map preview');
      await evaluate(client, `document.getElementById('preview-desktop').click()`);
      const exportedBase64 = await evaluate(client, `(async () => {
        const bytes = await window.__GUI_EDITOR__.exportZip();
        let binary = '';
        for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
        return btoa(binary);
      })()`);
      exportedOrdinaryZip = new Uint8Array(Buffer.from(exportedBase64, 'base64'));
      prC = { ordinarySurfaces, ordinaryMobileMap: Boolean(ordinaryMobileMap) };
    }

    const legacyState = await evaluate(client, `(async () => {
      const manifestResponse = await fetch('../project.json');
      const manifest = await manifestResponse.json();
      const declared = [
        ...manifest.stories.items.map((item) => ({ path: item.src.slice(2), kind: 'story', mediaType: 'application/json' })),
        ...Object.values(manifest.datasets).map((item) => ({ path: item.src.slice(2), kind: 'dataset', mediaType: item.type === 'geojson' ? 'application/geo+json' : 'application/json' })),
        ...Object.values(manifest.assets).map((item) => ({ path: item.src.slice(2), kind: 'asset', mediaType: item.mediaType })),
        ...(manifest.metrics ? [{ path: manifest.metrics.src.slice(2), kind: 'metrics', mediaType: 'application/json' }] : [])
      ];
      const entries = [{ path: 'project.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)), kind: 'manifest', mediaType: 'application/json', managed: true }];
      for (const item of declared) {
        const response = await fetch('../' + item.path);
        entries.push({ ...item, bytes: new Uint8Array(await response.arrayBuffer()), managed: true });
      }
      await window.__GUI_EDITOR__.openEntries(entries, { label: 'Route 61-2 memory gate' });
      return true;
    })()`);
    if (!legacyState) throw new Error('Route 61-2 memory package did not open.');
    await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      return Number(frame.dataset.previewRevision) === 0 && frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1;
    })()`, 'Route 61-2 production preview');
    await evaluate(client, openSection('stories'));
    const legacyControls = await waitFor(client, `(() => {
      const controls = [...document.querySelectorAll('[data-legacy-action]')];
      return controls.length && controls.every((control) => control.disabled && control.readOnly && control.value.startsWith('{'))
        ? controls.length : 0;
    })()`, 'read-only Story 1.0 action controls');
    await evaluate(client, openSection('capabilities'));
    const routeCapabilityInspection = await waitFor(client, `(() => {
      const existing = document.getElementById('author-capability-existing');
      const add = document.getElementById('author-capability-add-select');
      const existingValues = [...existing.options].map(({ value }) => value);
      const addValues = [...add.options].map(({ value }) => value);
      if (!existingValues.includes('route-comparison-v1') || addValues.includes('route-comparison-v1') || addValues.includes('urban-context-v1')) return null;
      existing.value = 'route-comparison-v1';
      existing.dispatchEvent(new Event('change', { bubbles: true }));
      return Boolean(document.getElementById('author-capability-setting-adapter'))
        && Boolean(document.querySelector('[id^="author-capability-role-"]'));
    })()`, 'Route capability inspection');

    if (GATE === 'pr-c') {
      const routeFolder = await evaluate(client, `(async () => {
        const manifest = await fetch('../project.json').then((response) => response.json());
        const declared = [
          ...manifest.stories.items.map((item) => item.src.slice(2)),
          ...Object.values(manifest.datasets).map((item) => item.src.slice(2)),
          ...Object.values(manifest.assets).map((item) => item.src.slice(2)),
          ...(manifest.metrics ? [manifest.metrics.src.slice(2)] : [])
        ];
        const files = new Map();
        files.set('project.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\\n'));
        for (const path of declared) files.set(path, new Uint8Array(await fetch('../' + path).then((response) => response.arrayBuffer())));
        files.set('secret.txt', new TextEncoder().encode('unknown sentinel'));
        const access = { reads: [], writes: [], enumerations: 0 };
        const directory = (prefix = '') => ({
          name: prefix ? prefix.split('/').filter(Boolean).at(-1) : 'route-fixture',
          async getDirectoryHandle(segment, options) {
            if (options?.create !== false) throw new Error('Directory creation is forbidden.');
            const next = prefix + segment + '/';
            if (![...files.keys()].some((path) => path.startsWith(next))) throw new DOMException('Missing directory', 'NotFoundError');
            return directory(next);
          },
          async getFileHandle(segment, options) {
            if (options?.create !== false) throw new Error('File creation is forbidden.');
            const path = prefix + segment;
            if (!files.has(path)) throw new DOMException('Missing file', 'NotFoundError');
            return {
              async getFile() {
                access.reads.push(path);
                return new File([files.get(path)], segment);
              },
              async createWritable() {
                let staged;
                return {
                  async write(value) { staged = new Uint8Array(value).slice(); },
                  async close() { files.set(path, staged); access.writes.push(path); }
                };
              }
            };
          },
          values() { access.enumerations += 1; throw new Error('Enumeration forbidden'); },
          entries() { access.enumerations += 1; throw new Error('Enumeration forbidden'); }
        });
        await window.__GUI_EDITOR__.openFolder(directory());
        const digest = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
          .map((value) => value.toString(16).padStart(2, '0')).join('');
        const before = await digest(files.get('data/stories/route-61-2.story.json'));
        document.querySelector('[data-section="project"]').click();
        const subtitle = document.querySelector('.tailored-inspector input[data-path="subtitle"]');
        subtitle.value += ' ';
        subtitle.dispatchEvent(new Event('change', { bubbles: true }));
        const save = await window.__GUI_EDITOR__.save({ confirmInvalid: async () => true });
        const after = await digest(files.get('data/stories/route-61-2.story.json'));
        return { before, after, access, save };
      })()`);
      if (routeFolder.before !== '29597ee58773b13ff9db6eaf3c328240f6bfa85f9bf7161cdca7b20ad55b373a'
        || routeFolder.after !== routeFolder.before
        || routeFolder.access.enumerations !== 0
        || routeFolder.access.reads.includes('secret.txt')
        || JSON.stringify(routeFolder.access.writes) !== JSON.stringify(['project.json'])) {
        throw new Error(`Route folder byte/boundary certification failed: ${JSON.stringify(routeFolder)}`);
      }
      await waitFor(client, `(() => {
        const frame = document.getElementById('production-preview');
        const child = frame.contentDocument;
        return Number(frame.dataset.previewRevision) >= 1
          && child?.querySelectorAll('.maplibregl-canvas').length === 1
          && child.querySelectorAll('.transport-poi-beacon').length >= 3
          && child.getElementById('presentation-open');
      })()`, 'Route folder production preview');
      await evaluate(client, `(() => {
        const child = document.getElementById('production-preview').contentDocument;
        child.getElementById('presentation-open').click();
        return true;
      })()`);
      await waitFor(client, `document.getElementById('production-preview').contentDocument?.getElementById('story-shell')?.hidden === false`, 'Route Story entry');
      await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('story-explore').click()`);
      await waitFor(client, `document.getElementById('production-preview').contentDocument?.getElementById('story-shell')?.hidden === true`, 'Route Explore exit');
      await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('presentation-open').click()`);
      await waitFor(client, `document.getElementById('production-preview').contentDocument?.getElementById('story-shell')?.hidden === false`, 'Route Story re-entry');
      const routeExperience = await evaluate(client, `(() => {
        const child = document.getElementById('production-preview').contentDocument;
        return {
          entered: true,
          explored: true,
          reentered: true,
          maps: child.querySelectorAll('.maplibregl-canvas').length,
          poiMarkers: child.querySelectorAll('.transport-poi-beacon').length
        };
      })()`);
      if (!routeExperience.entered || !routeExperience.explored || !routeExperience.reentered
        || routeExperience.maps !== 1 || routeExperience.poiMarkers < 3) {
        throw new Error(`Route Story/Explore/POI certification failed: ${JSON.stringify(routeExperience)}`);
      }
      const aliases = await evaluate(client, `(async () => {
        async function inspect(query) {
          const frame = document.createElement('iframe');
          frame.hidden = true;
          frame.src = '../?' + query;
          document.body.append(frame);
          await new Promise((resolve, reject) => {
            const deadline = Date.now() + 30000;
            const poll = () => {
              const child = frame.contentDocument;
              if (child?.querySelectorAll('.maplibregl-canvas').length === 1
                && child.querySelectorAll('.transport-poi-beacon').length >= 3
                && child.getElementById('presentation-open')) resolve();
              else if (Date.now() > deadline) reject(new Error('Alias iframe timed out: ' + query));
              else setTimeout(poll, 100);
            };
            poll();
          });
          const child = frame.contentDocument;
          child.getElementById('presentation-open').click();
          const result = {
            maps: child.querySelectorAll('.maplibregl-canvas').length,
            storyVisible: child.getElementById('story-shell').hidden === false,
            legacyVisible: child.getElementById('presentation').hidden === false
          };
          frame.remove();
          return result;
        }
        return { legacy: await inspect('storyShell=legacy'), poc: await inspect('storyShell=poc') };
      })()`);
      if (aliases.legacy.maps !== 1 || !aliases.legacy.legacyVisible || aliases.legacy.storyVisible
        || aliases.poc.maps !== 1 || aliases.poc.legacyVisible || !aliases.poc.storyVisible) {
        throw new Error(`Story Shell alias certification failed: ${JSON.stringify(aliases)}`);
      }
      Object.assign(prC, { routeFolder, routeExperience, aliases, capabilityPolicy: routeCapabilityInspection });
    }
    prB = { authoredRevision, legacyControls, datasetEdited, tableCellEdited, routeCapabilityInspection };
  }

  if (GATE === 'pr-c') {
    if (!exportedOrdinaryZip || !prC) throw new Error('Ordinary project export evidence is missing.');

    const repairManifest = {
      schemaVersion: '1.0', id: 'repair-project', title: 'Repair project', locale: 'en-US',
      stories: { primary: 'main', items: [{ id: 'main', src: './stories/main.story.json' }] },
      map: { basemap: 'openfreemap-dark', initialView: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } },
      datasets: {}, assets: {}, focusTargets: {}, capabilities: [], attribution: {}
    };
    const repairStory = {
      schemaVersion: '1.1', id: 'main', title: 'Repair project',
      states: [{ id: 'opening', content: { layout: 'hero', blocks: [{ type: 'heading', text: 'Repair project' }] }, map: { enter: [], exit: [] } }]
    };
    await evaluate(client, `(async () => {
      await window.__GUI_EDITOR__.openEntries([
        { path: 'project.json', bytes: new TextEncoder().encode('{ invalid json'), mediaType: 'application/json', kind: 'manifest', managed: true },
        { path: 'stories/main.story.json', bytes: new TextEncoder().encode(${JSON.stringify(`${JSON.stringify(repairStory)}\n`)}), mediaType: 'application/json', kind: 'story', managed: true }
      ], { label: 'First invalid project' });
      return true;
    })()`);
    const firstInvalid = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      const source = document.getElementById('source-repair-text');
      const paused = !document.getElementById('preview-paused').hidden;
      const maps = frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
      return source && paused && maps === 0 ? { maps, paused } : null;
    })()`, 'first-invalid neutral paused preview');
    await evaluate(client, `(() => {
      const source = document.getElementById('source-repair-text');
      source.value = ${JSON.stringify(`${JSON.stringify(repairManifest, null, 2)}\n`)};
      source.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const repairedSource = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      const maps = frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
      return !document.getElementById('source-repair-text') && maps === 1 && Number(frame.dataset.previewRevision) > 0
        ? { revision: Number(frame.dataset.previewRevision), maps } : null;
    })()`, 'source repair production preview');

    const ordinaryEntries = unzipSync(exportedOrdinaryZip);
    const unknownPayload = new TextEncoder().encode('browser pass-through payload\r\n');
    const zipWithUnknown = zipSync({
      ...ordinaryEntries,
      'README.txt': unknownPayload,
      'editor-state.json': new TextEncoder().encode('{"private":true}')
    });
    const safeRoundTripBase64 = await evaluate(client, `(async () => {
      await window.__GUI_EDITOR__.importZip(${bytesExpression(zipWithUnknown)}, { label: 'Pass-through browser.zip' });
      const bytes = await window.__GUI_EDITOR__.exportZip();
      let binary = '';
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      return btoa(binary);
    })()`);
    const safeRoundTrip = new Uint8Array(Buffer.from(safeRoundTripBase64, 'base64'));
    const roundTripEntries = unzipSync(safeRoundTrip);
    if (!roundTripEntries['README.txt']
      || Buffer.compare(Buffer.from(roundTripEntries['README.txt']), Buffer.from(unknownPayload)) !== 0
      || roundTripEntries['editor-state.json']) {
      throw new Error('ZIP pass-through or private-entry export certification failed.');
    }
    const manifestBytes = ordinaryEntries['project.json'];
    const traversalZip = zipSync({
      'project.json': manifestBytes,
      '../escape': new TextEncoder().encode('escape')
    });
    const duplicate = duplicateZip([
      ['./project.json', manifestBytes],
      ['project.json', manifestBytes]
    ]);
    const zipRejections = await evaluate(client, `(async () => {
      const messages = [];
      for (const bytes of [${bytesExpression(traversalZip)}, ${bytesExpression(duplicate)}]) {
        try { await window.__GUI_EDITOR__.importZip(bytes); messages.push('accepted'); }
        catch (error) { messages.push(error.message); }
      }
      return messages;
    })()`);
    if (!/package path/i.test(zipRejections[0]) || !/duplicate.*package path/i.test(zipRejections[1])) {
      throw new Error(`ZIP rejection certification failed: ${JSON.stringify(zipRejections)}`);
    }
    const passThroughHash = createHash('sha256').update(unknownPayload).digest('hex');

    fixtureTempRoot = await mkdtemp(path.join(tmpdir(), 'gui-editor-browser-export-'));
    await mountZip(exportedOrdinaryZip, fixtureTempRoot);
    fixtureServer = createFixtureServer({ fixtureRoot: fixtureTempRoot, applicationRoot: process.cwd() });
    const fixtureUrl = await listen(fixtureServer);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false
    });
    await client.send('Page.navigate', { url: fixtureUrl });
    const desktopRuntime = await waitFor(client, `(() => {
      if (document.readyState !== 'complete' || document.querySelectorAll('.maplibregl-canvas').length !== 1) return null;
      const open = document.getElementById('presentation-open');
      if (!open) return null;
      open.click();
      const result = {
        maps: document.querySelectorAll('.maplibregl-canvas').length,
        table: document.querySelectorAll('.content-table table').length,
        chart: document.querySelectorAll('.content-chart canvas[role="img"][aria-label]').length,
        image: document.querySelectorAll('.content-image img[alt]').length,
        legend: document.querySelectorAll('.content-legend ul').length,
        shell: document.getElementById('story-shell')?.hidden === false
      };
      return result.table && result.chart && result.image && result.legend && result.shell ? result : null;
    })()`, 'exported desktop normal production runtime');
    const exploreReentry = await evaluate(client, `(() => {
      document.getElementById('story-explore').click();
      const explored = document.getElementById('story-shell').hidden;
      document.getElementById('presentation-open').click();
      return explored && document.getElementById('story-shell').hidden === false;
    })()`);
    if (!exploreReentry) throw new Error('Exported Story Explore/re-entry failed.');

    const aliasResults = {};
    for (const alias of ['legacy', 'poc']) {
      await client.send('Page.navigate', { url: `${fixtureUrl}?storyShell=${alias}` });
      aliasResults[alias] = await waitFor(client, `(() => {
        if (document.readyState !== 'complete' || document.querySelectorAll('.maplibregl-canvas').length !== 1) return null;
        if (!/Ready|Sẵn sàng/.test(document.getElementById('map-status')?.textContent ?? '')) return null;
        document.getElementById('presentation-open')?.click();
        return {
          maps: 1,
          storyVisible: document.getElementById('story-shell')?.hidden === false,
          legacyVisible: document.getElementById('presentation')?.hidden === false
        };
      })()`, `exported ${alias} alias`);
    }
    if (aliasResults.legacy.maps !== 1 || !aliasResults.legacy.storyVisible || aliasResults.legacy.legacyVisible
      || aliasResults.poc.maps !== 1 || !aliasResults.poc.storyVisible || aliasResults.poc.legacyVisible) {
      throw new Error(`Exported alias behavior failed: ${JSON.stringify(aliasResults)}`);
    }

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true
    });
    await client.send('Page.navigate', { url: fixtureUrl });
    const mobileRuntime = await waitFor(client, `(() => {
      if (document.readyState !== 'complete' || document.querySelectorAll('.maplibregl-canvas').length !== 1) return null;
      document.getElementById('presentation-open')?.click();
      const result = {
        maps: document.querySelectorAll('.maplibregl-canvas').length,
        table: document.querySelectorAll('.content-table table').length,
        chart: document.querySelectorAll('.content-chart canvas[role="img"][aria-label]').length,
        image: document.querySelectorAll('.content-image img[alt]').length,
        legend: document.querySelectorAll('.content-legend ul').length
      };
      return result.table && result.chart && result.image && result.legend ? result : null;
    })()`, 'exported mobile normal production runtime');

    Object.assign(prC, {
      firstInvalid,
      repairedSource,
      zipRejections,
      passThroughHash,
      desktopRuntime,
      mobileRuntime,
      aliasResults,
      exportedFixtureUrl: fixtureUrl
    });
  }
  if (consoleIssues.length) throw new Error(`Unexpected browser console issues: ${JSON.stringify(consoleIssues)}`);

  console.log(JSON.stringify({
    gate: GATE,
    newProject: true,
    headingRefresh: true,
    emptyLocaleInvalid: true,
    invalidSnapshotSent: false,
    lastValidRetained: true,
    repairRefresh: true,
    secondNew: true,
    desktopMobilePresets: true,
    mapLibreInstances: finalState.canvasCount,
    console: 'clean',
    ...(prB ? {
      visibleAuthoring: true,
      cameraCapture: true,
      provenance: true,
      datasets: ['line', 'point', 'table'],
      image: true,
      metric: true,
      focusActions: true,
      coordinateFocus: true,
      semanticActionTargets: true,
      privateTargetUnavailable: true,
      storyReorder: true,
      blockActionReorder: true,
      existingDatasetEdited: prB.datasetEdited,
      tableCellEdited: prB.tableCellEdited,
      routeCapabilityInspection: prB.routeCapabilityInspection,
      contentBlocks: ['table', 'chart', 'image', 'legend'],
      legacyControls: prB.legacyControls
    } : {}),
    ...(prC ? {
      scenarios: 7,
      ordinaryProject: prC.ordinarySurfaces,
      capabilityPolicy: prC.capabilityPolicy,
      route61_2: prC.routeExperience,
      validInvalidRepair: { firstInvalid: prC.firstInvalid, repaired: prC.repairedSource },
      folderBoundary: prC.routeFolder.access,
      zip: { rejections: prC.zipRejections, passThroughHash: prC.passThroughHash },
      exportedDesktop: prC.desktopRuntime,
      exportedMobile: prC.mobileRuntime,
      aliases: prC.aliasResults
    } : {}),
    revisions: { first: firstRevision, heading: headingRevision, repaired: repairedRevision, secondNew: secondNewRevision }
  }));
  if (GATE === 'pr-c') console.log('GUI_EDITOR_V1_BROWSER_RESULT: PASS');
} finally {
  client.close();
  if (fixtureServer?.listening) await new Promise((resolve) => fixtureServer.close(resolve));
  if (fixtureTempRoot) await rm(fixtureTempRoot, { recursive: true, force: true });
}
