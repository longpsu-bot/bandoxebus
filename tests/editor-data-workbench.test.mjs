import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

class ClassList {
  constructor(owner) { this.owner = owner; this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); this.owner.className = [...this.values].join(' '); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); this.owner.className = [...this.values].join(' '); }
  contains(value) { return this.values.has(value); }
}

class Element {
  constructor(tagName = 'div', namespaceURI = 'http://www.w3.org/1999/xhtml') {
    this.tagName = tagName.toUpperCase();
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.open = false;
    this.files = [];
    this.className = '';
    this.classList = new ClassList(this);
  }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'id') this.id = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  async dispatch(type, values = {}) {
    const event = { type, target: this, key: values.key, dataTransfer: values.dataTransfer, preventDefault() {}, ...values };
    for (const listener of this.listeners.get(type) ?? []) await listener(event);
  }
  click() { return this.dispatch('click'); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function walk(node) {
  return [node, ...node.children.flatMap(walk)];
}

function text(root) {
  return walk(root).map((node) => node.textContent).filter(Boolean).join(' ');
}

function find(root, predicate) {
  return walk(root).find(predicate);
}

function documentHarness() {
  const byId = new Map();
  const body = new Element('body');
  const create = (tag, namespace) => {
    const node = new Element(tag, namespace);
    const set = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => { set(name, value); if (name === 'id') byId.set(String(value), node); };
    return node;
  };
  return {
    body,
    createElement: (tag) => create(tag),
    createElementNS: (namespace, tag) => create(tag, namespace),
    getElementById: (id) => byId.get(id) ?? null,
    activeElement: null
  };
}

function tableCandidate(rows = 25) {
  return {
    kind: 'table', id: 'demand', label: 'Demand', sourceFormat: 'CSV', warnings: [],
    value: {
      schemaVersion: '1.0',
      columns: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'count', label: 'Count', type: 'integer' }],
      rows: Array.from({ length: rows }, (_, index) => ({ name: `Row ${index + 1}`, count: index + 1 }))
    }
  };
}

function spatialCandidates() {
  return ['point', 'line'].map((geometry) => ({
    kind: 'spatial', geometry, id: `transport-${geometry}s`, label: `Transport · ${geometry === 'point' ? 'Points' : 'Lines'}`,
    sourceFormat: 'KML', sourceCrs: 'EPSG:4326', outputCrs: 'EPSG:4326', warnings: [],
    value: geometry === 'point'
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [106, 11] } }] }
      : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[106, 11], [107, 12]] } }] }
  }));
}

function sessionHarness({ candidates = [tableCandidate()], sourceItems = [{ id: 'source', label: 'Source' }], format = 'csv' } = {}) {
  const events = [];
  let selected;
  let config = {};
  return {
    events,
    session: {
      async read() { events.push('read'); return sourceItems; },
      selectSourceItem(id) { selected = id; events.push(['select', id]); },
      configure(patch) { config = { ...config, ...patch }; events.push(['configure', patch]); },
      async prepare() { events.push('prepare'); return candidates; },
      candidate(id) { return candidates.find((candidate) => candidate.id === id); },
      state() { return { format, sourceItems, selectedItemId: selected, config, disposed: false }; },
      dispose() { events.push('dispose'); }
    }
  };
}

test('Add Data begins with friendly supported formats, accessible drop/picker controls, and no technical fields', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const harness = sessionHarness();
  const returnFocus = new Element('button');
  const workbench = createDataWorkbench({ documentRef, createSession: () => harness.session, onConfirm() {} });
  await workbench.open({ mode: 'add', returnFocus });
  const dialog = find(documentRef.body, (node) => node.tagName === 'DIALOG');
  assert.equal(dialog.open, true);
  assert.match(text(dialog), /Add data.*Drop data files here.*GeoJSON.*KML\/KMZ.*Shapefile.*GeoPackage.*CSV.*Excel.*GPX/s);
  assert.doesNotMatch(text(dialog), /Stable dataset ID|table-json|geometry declaration/i);
  assert.equal(dialog.getAttribute('aria-labelledby'), 'data-workbench-title');
  const picker = find(dialog, (node) => node.tagName === 'INPUT' && node.getAttribute('type') === 'file');
  assert.equal(picker.getAttribute('multiple'), '');
  assert.equal(picker.getAttribute('accept'), '.geojson,.json,.kml,.kmz,.zip,.shp,.dbf,.prj,.cpg,.gpkg,.gpx,.csv,.xlsx');
  const status = find(dialog, (node) => node.getAttribute('role') === 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');

  await find(dialog, (node) => node.tagName === 'BUTTON' && node.textContent === 'Cancel').click();
  assert.equal(dialog.open, false);
  assert.equal(harness.events.includes('dispose'), false, 'blank open/cancel must not create a parser session or worker');
  assert.equal(returnFocus.focused, true);
});

test('Workbench passes existing dataset IDs into each transient import session', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const harness = sessionHarness();
  let createdWith;
  const workbench = createDataWorkbench({
    documentRef,
    createSession(options) { createdWith = options; return harness.session; }
  });
  await workbench.open({ mode: 'add', usedIds: ['demand', 'stops'], files: [new File(['x'], 'demand.csv')] });
  assert.deepEqual(createdWith.usedIds, ['demand', 'stops']);
  const editorSource = await readFile(new URL('../editor/editor.js', import.meta.url), 'utf8');
  assert.match(editorSource, /usedIds:\s*Object\.keys\(manifest\.datasets\)/);
});

test('workbench reads dropped files, exposes candidate choice and CRS, and renders SVG without MapLibre', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const harness = sessionHarness({ candidates: spatialCandidates(), format: 'kml' });
  let confirmed;
  const workbench = createDataWorkbench({ documentRef, createSession: () => harness.session, onConfirm: (candidate, context) => { confirmed = { candidate, context }; } });
  await workbench.open({ mode: 'add', files: [new File(['x'], 'mixed.kml')] });
  const dialog = find(documentRef.body, (node) => node.tagName === 'DIALOG');
  assert.deepEqual(harness.events.slice(0, 2), ['read', ['select', 'source']]);
  assert.equal(harness.events.includes('prepare'), true);
  assert.match(text(dialog), /Choose dataset.*Transport.*Source CRS.*EPSG:4326.*Output CRS/s);
  assert.ok(find(dialog, (node) => node.namespaceURI === 'http://www.w3.org/2000/svg' && node.tagName === 'SVG'));
  assert.equal(text(dialog).includes('MapLibre'), false);
  const sourceCrs = documentRef.getElementById('data-workbench-source-crs');
  assert.equal(sourceCrs.value, 'EPSG:4326');
  sourceCrs.value = 'EPSG:3857';
  await find(dialog, (node) => node.tagName === 'BUTTON' && node.textContent === 'Apply source CRS').click();
  assert.equal(harness.events.some((event) => Array.isArray(event) && event[0] === 'configure' && event[1].sourceCrs === 'EPSG:3857'), true);
  const chooser = documentRef.getElementById('data-workbench-candidate');
  chooser.value = 'transport-lines';
  await chooser.dispatch('change');
  await find(dialog, (node) => node.tagName === 'BUTTON' && node.textContent === 'Add data').click();
  assert.equal(confirmed.candidate.geometry, 'line');
  assert.equal(confirmed.context.mode, 'add');
});

test('spatial preview shares one global 4,000-vertex render budget across all features', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const features = Array.from({ length: 3 }, (_, featureIndex) => ({
    type: 'Feature', properties: {}, geometry: {
      type: 'MultiPoint',
      coordinates: Array.from({ length: 2500 }, (_, pointIndex) => [106 + featureIndex * 0.01, 10 + pointIndex * 0.000001])
    }
  }));
  const candidate = {
    kind: 'spatial', geometry: 'point', id: 'dense-points', label: 'Dense points',
    sourceFormat: 'GeoJSON', sourceCrs: 'EPSG:4326', outputCrs: 'EPSG:4326', warnings: [],
    value: { type: 'FeatureCollection', features }
  };
  const harness = sessionHarness({ candidates: [candidate], format: 'geojson' });
  const workbench = createDataWorkbench({
    documentRef,
    createSession: () => harness.session,
    requestFrame: (callback) => callback(0)
  });
  await workbench.open({ mode: 'add', files: [new File(['x'], 'dense.geojson')] });
  assert.equal(walk(documentRef.body).filter((node) => node.tagName === 'CIRCLE').length, 4000);
});

test('replacement validates and installs only candidates compatible with the existing dataset', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const harness = sessionHarness({ candidates: spatialCandidates(), format: 'kml' });
  const validated = [];
  const workbench = createDataWorkbench({
    documentRef,
    createSession: () => harness.session,
    validateCandidate(candidate) {
      validated.push(candidate.geometry);
      if (candidate.geometry !== 'line') throw new TypeError('incompatible geometry');
      return candidate;
    },
    requestFrame: (callback) => callback(0)
  });
  await workbench.open({
    mode: 'replace',
    existingDataset: { id: 'route', label: 'Route', type: 'geojson', geometry: 'line', src: './data/route.geojson' },
    files: [new File(['x'], 'mixed.kml')]
  });
  assert.deepEqual(validated, ['line']);
  assert.equal(workbench.state().selectedCandidateId, 'transport-lines');
  assert.equal(workbench.state().phase, 'review-ready');
});

test('table preview is bounded to the first 20 rows and Confirm is the only mutation boundary', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const harness = sessionHarness({ candidates: [tableCandidate(25)] });
  const confirmations = [];
  const workbench = createDataWorkbench({ documentRef, createSession: () => harness.session, onConfirm: (...args) => confirmations.push(args) });
  await workbench.open({ mode: 'replace', existingDataset: { id: 'demand', label: 'Demand', type: 'table-json', src: './data/demand.json' }, files: [new File(['x'], 'demand.csv')] });
  const dialog = find(documentRef.body, (node) => node.tagName === 'DIALOG');
  const tbody = find(dialog, (node) => node.tagName === 'TBODY');
  assert.equal(tbody.children.length, 20);
  assert.match(text(dialog), /Showing 20 of 25 rows/i);
  assert.equal(confirmations.length, 0);
  await find(dialog, (node) => node.tagName === 'BUTTON' && node.textContent === 'Replace data').click();
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0][1].existingDataset.id, 'demand');
});

test('Escape/cancel disposes transient state and a failed read stays visible without confirming', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const events = [];
  const session = {
    async read() { throw new TypeError('Unsupported JSON data shape'); },
    dispose() { events.push('dispose'); },
    state() { return { format: 'json' }; }
  };
  let confirmed = false;
  const workbench = createDataWorkbench({ documentRef, createSession: () => session, onConfirm: () => { confirmed = true; } });
  await workbench.open({ mode: 'add', files: [new File(['{}'], 'bad.json')] });
  const dialog = find(documentRef.body, (node) => node.tagName === 'DIALOG');
  assert.match(text(dialog), /Unsupported JSON data shape/);
  await dialog.dispatch('cancel');
  assert.equal(events.length, 1);
  assert.equal(confirmed, false);
});

test('superseded asynchronous reads cannot overwrite the current Workbench status', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  let rejectFirst;
  const firstRead = new Promise((resolve, reject) => { rejectFirst = reject; });
  const first = {
    read: () => firstRead,
    state: () => ({ format: 'json' }),
    dispose() {}
  };
  const secondHarness = sessionHarness();
  let count = 0;
  const workbench = createDataWorkbench({
    documentRef,
    createSession: () => (++count === 1 ? first : secondHarness.session),
    requestFrame: (callback) => callback(0)
  });
  const staleOpening = workbench.open({ mode: 'add', files: [new File(['x'], 'slow.json')] });
  await new Promise((resolve) => setImmediate(resolve));
  await workbench.open({ mode: 'add', files: [new File(['x'], 'current.csv')] });
  rejectFirst(new TypeError('late stale failure'));
  await staleOpening;
  assert.doesNotMatch(text(documentRef.body), /late stale failure/);
  assert.equal(workbench.state().phase, 'review-ready');
});

test('superseded preparation cannot install candidates into a newer Workbench session', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  let resolveFirstPrepare;
  const delayedPrepare = new Promise((resolve) => { resolveFirstPrepare = resolve; });
  const firstCandidate = tableCandidate(1);
  const first = {
    async read() { return [{ id: 'first', label: 'First' }]; },
    selectSourceItem() {}, configure() {},
    prepare: () => delayedPrepare,
    state: () => ({ format: 'csv', sourceItems: [{ id: 'first', label: 'First' }], config: { mode: 'table' } }),
    dispose() {}
  };
  const currentCandidate = { ...tableCandidate(1), id: 'current', label: 'Current' };
  const secondHarness = sessionHarness({ candidates: [currentCandidate] });
  let count = 0;
  const workbench = createDataWorkbench({
    documentRef,
    createSession: () => (++count === 1 ? first : secondHarness.session),
    requestFrame: (callback) => callback(0)
  });
  const staleOpening = workbench.open({ mode: 'add', files: [new File(['x'], 'first.csv')] });
  await new Promise((resolve) => setImmediate(resolve));
  await workbench.open({ mode: 'add', files: [new File(['x'], 'current.csv')] });
  resolveFirstPrepare([firstCandidate]);
  await staleOpening;
  assert.equal(workbench.state().selectedCandidateId, 'current');
  assert.match(text(documentRef.body), /Current/);
  assert.doesNotMatch(text(documentRef.body), /late stale failure|Demand/);
});

test('CSV point configuration exposes explicit axes and source CRS before reprojection', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const harness = sessionHarness({
    sourceItems: [{ id: 'points', label: 'Points', headings: ['name', 'x', 'y', 'z'], suggestedXColumn: 'x', suggestedYColumn: 'y' }],
    candidates: spatialCandidates().slice(0, 1),
    format: 'csv'
  });
  const workbench = createDataWorkbench({ documentRef, createSession: () => harness.session });
  await workbench.open({ mode: 'add', files: [new File(['x'], 'points.csv')] });
  const mode = documentRef.getElementById('data-workbench-csv-mode');
  mode.value = 'points';
  await mode.dispatch('change');
  assert.ok(documentRef.getElementById('data-workbench-x-column'));
  assert.ok(documentRef.getElementById('data-workbench-y-column'));
  const crs = documentRef.getElementById('data-workbench-config-crs');
  assert.equal(crs.value, '');
  crs.value = 'EPSG:32648';
  await find(documentRef.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Prepare map points').click();
  assert.equal(harness.events.some((event) => Array.isArray(event) && event[0] === 'configure'
    && event[1].sourceCrs === 'EPSG:32648' && event[1].xColumn === 'x' && event[1].yColumn === 'y'), true);
});

test('missing-PRJ Shapefile pauses for an explicit CRS decision and XLSX exposes bounded header override', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const shapeDocument = documentHarness();
  const shapeHarness = sessionHarness({
    sourceItems: [{ id: 'stops', label: 'Stops', hasPrj: false, hasDbf: true }], candidates: spatialCandidates().slice(0, 1), format: 'shapefile'
  });
  const shapeWorkbench = createDataWorkbench({ documentRef: shapeDocument, createSession: () => shapeHarness.session });
  await shapeWorkbench.open({ mode: 'add', files: [new File(['x'], 'stops.shp')] });
  assert.equal(shapeHarness.events.includes('prepare'), false);
  assert.match(text(shapeDocument.body), /no PRJ.*Source CRS.*Assume EPSG:4326.*Prepare projected data/is);
  const sourceCrs = shapeDocument.getElementById('data-workbench-config-crs');
  sourceCrs.value = 'EPSG:32648';
  await find(shapeDocument.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Prepare projected data').click();
  assert.equal(shapeHarness.events.some((event) => Array.isArray(event) && event[1]?.crsMode === 'manual'), true);

  const xlsxDocument = documentHarness();
  const xlsxHarness = sessionHarness({
    sourceItems: [{ id: 'sheet', label: 'Sheet', suggestedHeaderRow: 2 }], candidates: [tableCandidate()], format: 'xlsx'
  });
  const xlsxWorkbench = createDataWorkbench({ documentRef: xlsxDocument, createSession: () => xlsxHarness.session });
  await xlsxWorkbench.open({ mode: 'add', files: [new File(['x'], 'tables.xlsx')] });
  const header = xlsxDocument.getElementById('data-workbench-header-row');
  assert.equal(header.value, '3');
  assert.equal(header.getAttribute('max'), '50');
});

test('worker results are production-validated before install and signal review-ready only after paint', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const order = [];
  const frames = [];
  const completions = [];
  const candidate = tableCandidate(2);
  let selected;
  const session = {
    async read() { return [{ id: 'source', label: 'Source' }]; },
    selectSourceItem(id) { selected = id; },
    configure() {},
    async prepare() { order.push('worker-result'); return [candidate]; },
    candidate() { return candidate; },
    state() {
      return {
        format: 'csv', sourceItems: [{ id: 'source', label: 'Source' }], selectedItemId: selected,
        config: { mode: 'table' }, timing: { sessionId: 41, lastResultRequestId: 9, lastResultReceivedAt: 100 }
      };
    },
    dispose() {}
  };
  const workbench = createDataWorkbench({
    documentRef,
    createSession: () => session,
    validateCandidate(value) { order.push('production-validation'); return { ...value, value: structuredClone(value.value) }; },
    requestFrame(callback) { frames.push(callback); },
    now: () => 180,
    onCandidateInstalled() { order.push('state-install'); },
    onPreviewCommitted() { order.push('preview-commit'); },
    emitReviewReady(detail) { order.push('review-ready'); completions.push(detail); }
  });
  const opening = workbench.open({ mode: 'add', files: [new File(['x'], 'table.csv')] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['worker-result', 'production-validation', 'state-install', 'preview-commit']);
  assert.equal(workbench.state().phase, 'awaiting-paint');
  frames.shift()(150);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completions.length, 0);
  frames.shift()(166);
  await opening;
  assert.deepEqual(order, ['worker-result', 'production-validation', 'state-install', 'preview-commit', 'review-ready']);
  assert.equal(workbench.state().phase, 'review-ready');
  assert.deepEqual(completions, [{
    sessionId: 41, requestId: 9, receivedAt: 100, completedAt: 180, postWorkerDurationMs: 80
  }]);
});

test('production validation failure installs no candidate or preview', async () => {
  const { createDataWorkbench } = await import('../editor/ui/data-workbench.js');
  const documentRef = documentHarness();
  const harness = sessionHarness();
  const workbench = createDataWorkbench({
    documentRef,
    createSession: () => harness.session,
    validateCandidate() { throw new TypeError('Production candidate rejected'); },
    requestFrame() { throw new Error('paint must not be scheduled after failed validation'); }
  });
  await workbench.open({ mode: 'add', files: [new File(['x'], 'table.csv')] });
  assert.equal(workbench.state().selectedCandidateId, null);
  assert.equal(workbench.state().phase, 'error');
  assert.match(text(documentRef.body), /Production candidate rejected/);
  assert.equal(find(documentRef.body, (node) => node.tagName === 'BUTTON' && node.textContent === 'Add data'), undefined);
});
