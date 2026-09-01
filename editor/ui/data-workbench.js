import { createDataImportSession } from '../import/data-import.js';

const ACCEPT = '.geojson,.json,.kml,.kmz,.zip,.shp,.dbf,.prj,.cpg,.gpkg,.gpx,.csv,.xlsx';
const SVG_NS = 'http://www.w3.org/2000/svg';

function element(documentRef, tag, text, attributes = {}) {
  const node = documentRef.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') node.className = value;
    else if (key === 'checked') node.checked = Boolean(value);
    else if (key === 'value') node.value = value;
    else if (key === 'hidden') node.hidden = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  return node;
}

function option(documentRef, value, label, selected = false) {
  const node = element(documentRef, 'option', label, { value });
  node.value = value;
  node.selected = selected;
  return node;
}

function positions(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'GeometryCollection') return (geometry.geometries ?? []).flatMap(positions);
  const depth = geometry.type === 'Point' ? 0
    : ['MultiPoint', 'LineString'].includes(geometry.type) ? 1
      : ['MultiLineString', 'Polygon'].includes(geometry.type) ? 2 : 3;
  function walk(value, remaining) {
    if (remaining === 0) return [value];
    if (!Array.isArray(value)) return [];
    return value.flatMap((child) => walk(child, remaining - 1));
  }
  return walk(geometry.coordinates, depth);
}

function spatialPreview(documentRef, candidate) {
  const features = candidate.value.features.slice(0, 200);
  const sampled = [];
  for (const feature of features) {
    const points = positions(feature.geometry);
    if (sampled.length + points.length > 4000) sampled.push(...points.slice(0, 4000 - sampled.length));
    else sampled.push(...points);
    if (sampled.length >= 4000) break;
  }
  const svg = documentRef.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 640 300');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${candidate.label} spatial sample`);
  svg.setAttribute('class', 'data-workbench-map-preview');
  if (!sampled.length) return svg;
  const xs = sampled.map((point) => point[0]);
  const ys = sampled.map((point) => point[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const project = ([x, y]) => [
    20 + ((x - minX) / (maxX - minX || 1)) * 600,
    280 - ((y - minY) / (maxY - minY || 1)) * 260
  ];
  for (const feature of features) {
    const points = positions(feature.geometry).slice(0, 4000);
    if (!points.length) continue;
    if (feature.geometry.type === 'Point' || feature.geometry.type === 'MultiPoint') {
      for (const point of points) {
        const [cx, cy] = project(point);
        const circle = documentRef.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', '4');
        svg.append(circle);
      }
    } else {
      const path = documentRef.createElementNS(SVG_NS, 'polyline');
      path.setAttribute('points', points.map((point) => project(point).join(',')).join(' '));
      path.setAttribute('fill', feature.geometry.type.includes('Polygon') ? 'rgba(83,200,232,.22)' : 'none');
      path.setAttribute('stroke', '#53c8e8');
      path.setAttribute('stroke-width', '2');
      svg.append(path);
    }
  }
  return svg;
}

function tablePreview(documentRef, candidate) {
  const wrapper = element(documentRef, 'div', undefined, { className: 'data-workbench-table-preview' });
  const table = element(documentRef, 'table');
  const head = element(documentRef, 'thead');
  const headingRow = element(documentRef, 'tr');
  candidate.value.columns.forEach(({ label }) => headingRow.append(element(documentRef, 'th', label, { scope: 'col' })));
  head.append(headingRow);
  const body = element(documentRef, 'tbody');
  candidate.value.rows.slice(0, 20).forEach((row) => {
    const tr = element(documentRef, 'tr');
    candidate.value.columns.forEach(({ id }) => tr.append(element(documentRef, 'td', row[id] === null ? '—' : String(row[id]))));
    body.append(tr);
  });
  table.append(head, body);
  wrapper.append(table, element(documentRef, 'p', `Showing ${Math.min(20, candidate.value.rows.length)} of ${candidate.value.rows.length} rows.`));
  return wrapper;
}

export function createDataWorkbench({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  createSession = createDataImportSession,
  onConfirm = () => {}
} = {}) {
  if (!documentRef?.createElement || !documentRef.body?.append) throw new TypeError('Data Workbench requires a document body.');
  const dialog = element(documentRef, 'dialog', undefined, {
    className: 'data-workbench',
    'aria-labelledby': 'data-workbench-title'
  });
  documentRef.body.append(dialog);
  let session = null;
  let options = null;
  let candidates = [];
  let selectedCandidateId = null;
  let returnFocus = null;
  let busy = false;

  function disposeSession() {
    session?.dispose?.();
    session = null;
    candidates = [];
    selectedCandidateId = null;
  }

  function close() {
    disposeSession();
    if (dialog.open) dialog.close();
    returnFocus?.focus?.();
  }

  function renderInitial() {
    const title = element(documentRef, 'h2', options.mode === 'replace' ? `Replace data · ${options.existingDataset?.label ?? options.existingDataset?.id}` : 'Add data', {
      id: 'data-workbench-title'
    });
    const intro = element(documentRef, 'p', 'GeoJSON, KML/KMZ, Shapefile, GeoPackage, CSV, Excel XLSX, JSON tables, and GPX are supported locally.');
    const drop = element(documentRef, 'div', undefined, { className: 'data-workbench-drop', tabindex: '0' });
    drop.append(element(documentRef, 'strong', 'Drop data files here'), element(documentRef, 'span', ' or browse from this device.'));
    const picker = element(documentRef, 'input', undefined, {
      id: 'data-workbench-files', type: 'file', accept: ACCEPT, multiple: '', className: 'visually-hidden'
    });
    const browse = element(documentRef, 'button', 'Browse files', { type: 'button' });
    browse.addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => beginFiles(Array.from(picker.files ?? [])));
    drop.addEventListener('dragover', (event) => event.preventDefault());
    drop.addEventListener('drop', (event) => {
      event.preventDefault();
      beginFiles(Array.from(event.dataTransfer?.files ?? []));
    });
    const body = element(documentRef, 'div', undefined, { className: 'data-workbench-body', id: 'data-workbench-body' });
    const status = element(documentRef, 'p', 'Choose one or more local files to begin.', {
      id: 'data-workbench-status', role: 'status', 'aria-live': 'polite', className: 'data-workbench-status'
    });
    const footer = element(documentRef, 'footer', undefined, { className: 'data-workbench-footer' });
    const cancel = element(documentRef, 'button', 'Cancel', { type: 'button' });
    cancel.addEventListener('click', close);
    footer.append(cancel);
    dialog.replaceChildren(title, drop, intro, picker, browse, status, body, footer);
  }

  function statusNode() { return documentRef.getElementById('data-workbench-status'); }
  function bodyNode() { return documentRef.getElementById('data-workbench-body'); }
  function setStatus(message, isError = false) {
    const node = statusNode();
    if (!node) return;
    node.textContent = message;
    node.className = `data-workbench-status${isError ? ' is-error' : ''}`;
  }

  function defaultConfig(state, item) {
    if (state.format === 'csv') return { mode: 'table', headerRow: 0 };
    if (state.format === 'xlsx') return { headerRow: item.suggestedHeaderRow ?? 0 };
    if (state.format === 'shapefile') return item.hasPrj === false ? {} : { crsMode: 'prj' };
    if (['geojson', 'kml', 'kmz', 'gpx'].includes(state.format)) {
      return { sourceCrs: item.defaultSourceCrs ?? 'EPSG:4326' };
    }
    return {};
  }

  async function prepareSelected(itemId) {
    session.selectSourceItem(itemId);
    const state = session.state();
    const item = state.sourceItems.find(({ id }) => id === itemId) ?? {};
    session.configure(defaultConfig(state, item));
    if (state.format === 'shapefile' && item.hasPrj === false) {
      candidates = [];
      selectedCandidateId = null;
      renderPrepared();
      setStatus('This Shapefile has no PRJ. Explicitly assume geographic coordinates or enter its Source CRS.');
      return;
    }
    setStatus('Preparing a local preview…');
    candidates = await session.prepare();
    selectedCandidateId = candidates[0]?.id ?? null;
    if (!selectedCandidateId) throw new TypeError('This source produced no importable dataset.');
    renderPrepared();
    setStatus('Review the preview. Nothing is written until you confirm.');
  }

  function renderConfiguration(container, state) {
    const item = state.sourceItems.find(({ id }) => id === state.selectedItemId) ?? {};
    if (state.format === 'xlsx') {
      const group = element(documentRef, 'fieldset', undefined, { className: 'data-workbench-config' });
      group.append(element(documentRef, 'legend', 'Worksheet header'));
      const headerLabel = element(documentRef, 'label', 'Header row (1–50)');
      const header = element(documentRef, 'input', undefined, {
        id: 'data-workbench-header-row', type: 'number', min: '1', max: '50', value: String((state.config?.headerRow ?? item.suggestedHeaderRow ?? 0) + 1)
      });
      header.value = String((state.config?.headerRow ?? item.suggestedHeaderRow ?? 0) + 1);
      headerLabel.append(header);
      const apply = element(documentRef, 'button', 'Apply header row', { type: 'button' });
      apply.addEventListener('click', async () => {
        try {
          session.configure({ headerRow: Number(header.value) - 1 });
          candidates = await session.prepare();
          selectedCandidateId = candidates[0]?.id;
          renderPrepared();
          setStatus('Review the selected worksheet preview.');
        } catch (error) { setStatus(error.message, true); }
      });
      group.append(headerLabel, apply);
      container.append(group);
      return;
    }
    if (state.format === 'shapefile' && item.hasPrj === false && !candidates.length) {
      const group = element(documentRef, 'fieldset', undefined, { className: 'data-workbench-config' });
      group.append(element(documentRef, 'legend', 'Shapefile has no PRJ'));
      const crsLabel = element(documentRef, 'label', 'Source CRS');
      const crs = element(documentRef, 'input', undefined, {
        id: 'data-workbench-config-crs', placeholder: 'For example EPSG:32648'
      });
      crs.value = state.config?.sourceCrs ?? '';
      crsLabel.append(crs);
      const prepare = async (patch, success) => {
        try {
          session.configure(patch);
          setStatus('Parsing and validating Shapefile geometry…');
          candidates = await session.prepare();
          selectedCandidateId = candidates[0]?.id;
          renderPrepared();
          setStatus(success);
        } catch (error) { setStatus(error.message, true); }
      };
      const assume = element(documentRef, 'button', 'Assume EPSG:4326', { type: 'button' });
      assume.addEventListener('click', () => prepare({ crsMode: 'assume-4326', sourceCrs: 'EPSG:4326' }, 'Review the preview and geographic-coordinate warning.'));
      const projected = element(documentRef, 'button', 'Prepare projected data', { type: 'button' });
      projected.addEventListener('click', () => prepare({ crsMode: 'manual', sourceCrs: crs.value.trim() }, 'Review the reprojected EPSG:4326 preview.'));
      group.append(crsLabel, assume, projected);
      container.append(group);
      return;
    }
    if (state.format !== 'csv') return;
    const group = element(documentRef, 'fieldset', undefined, { className: 'data-workbench-config' });
    group.append(element(documentRef, 'legend', 'CSV import as'));
    const mode = element(documentRef, 'select', undefined, { id: 'data-workbench-csv-mode' });
    mode.append(option(documentRef, 'table', 'Table', state.config?.mode !== 'points'), option(documentRef, 'points', 'Map points', state.config?.mode === 'points'));
    mode.value = state.config?.mode ?? 'table';
    mode.addEventListener('change', async () => {
      session.configure({ mode: mode.value });
      if (mode.value === 'points') {
        candidates = [];
        selectedCandidateId = null;
        renderPrepared();
        setStatus('Choose X and Y columns, then prepare the preview.');
        return;
      }
      try { candidates = await session.prepare(); selectedCandidateId = candidates[0]?.id; renderPrepared(); } catch (error) { setStatus(error.message, true); }
    });
    group.append(mode);
    if (state.config?.mode === 'points') {
      const headings = item.headings ?? [];
      const coordinateSelect = (id, selected, blankLabel) => {
        const select = element(documentRef, 'select', undefined, { id });
        select.append(option(documentRef, '', blankLabel, !selected));
        headings.forEach((heading) => select.append(option(documentRef, heading, heading, heading === selected)));
        select.value = selected ?? '';
        return select;
      };
      const xLabel = element(documentRef, 'label', 'X / longitude column');
      const x = coordinateSelect('data-workbench-x-column', state.config.xColumn ?? item.suggestedXColumn, 'Choose X');
      xLabel.append(x);
      const yLabel = element(documentRef, 'label', 'Y / latitude column');
      const y = coordinateSelect('data-workbench-y-column', state.config.yColumn ?? item.suggestedYColumn, 'Choose Y');
      yLabel.append(y);
      const zLabel = element(documentRef, 'label', 'Z column (optional)');
      const z = coordinateSelect('data-workbench-z-column', state.config.zColumn, 'No Z column');
      zLabel.append(z);
      const crsLabel = element(documentRef, 'label', 'Source CRS');
      const crs = element(documentRef, 'input', undefined, {
        id: 'data-workbench-config-crs', value: state.config.sourceCrs ?? item.defaultSourceCrs ?? '',
        placeholder: 'EPSG:4326 or EPSG:32648'
      });
      crs.value = state.config.sourceCrs ?? item.defaultSourceCrs ?? '';
      crsLabel.append(crs);
      const prepare = element(documentRef, 'button', 'Prepare map points', { type: 'button' });
      prepare.addEventListener('click', async () => {
        try {
          session.configure({
            mode: 'points',
            xColumn: x.value,
            yColumn: y.value,
            zColumn: z.value || undefined,
            sourceCrs: crs.value.trim()
          });
          setStatus('Reprojecting and validating local coordinates…');
          candidates = await session.prepare();
          selectedCandidateId = candidates[0]?.id;
          renderPrepared();
          setStatus('Review the preview. Stored output will be EPSG:4326.');
        } catch (error) { setStatus(error.message, true); }
      });
      group.append(xLabel, yLabel, zLabel, crsLabel, prepare);
    }
    container.append(group);
  }

  function renderPrepared() {
    const container = bodyNode();
    container.replaceChildren();
    const state = session.state();
    if (state.sourceItems.length > 1) {
      const label = element(documentRef, 'label', 'Source item');
      const select = element(documentRef, 'select', undefined, { id: 'data-workbench-source-item' });
      state.sourceItems.forEach((item) => select.append(option(documentRef, item.id, item.label, item.id === state.selectedItemId)));
      select.value = state.selectedItemId;
      select.addEventListener('change', async () => {
        try { await prepareSelected(select.value); } catch (error) { setStatus(error.message, true); }
      });
      label.append(select);
      container.append(label);
    }
    renderConfiguration(container, state);
    if (candidates.length > 1) {
      const label = element(documentRef, 'label', 'Choose dataset');
      const chooser = element(documentRef, 'select', undefined, { id: 'data-workbench-candidate' });
      candidates.forEach((candidate) => chooser.append(option(documentRef, candidate.id, candidate.label, candidate.id === selectedCandidateId)));
      chooser.value = selectedCandidateId;
      chooser.addEventListener('change', () => { selectedCandidateId = chooser.value; renderPrepared(); });
      label.append(chooser);
      container.append(label);
    }
    const candidate = candidates.find(({ id }) => id === selectedCandidateId) ?? candidates[0];
    if (!candidate) {
      const footer = Array.from(dialog.children).find((child) => child.tagName === 'FOOTER');
      const cancel = Array.from(footer.children).find((child) => child.textContent === 'Cancel');
      footer.replaceChildren(cancel);
      return;
    }
    container.append(element(documentRef, 'h3', candidate.label));
    if (candidate.kind === 'spatial') {
      const crs = element(documentRef, 'dl', undefined, { className: 'data-workbench-crs' });
      const sourceCrsValue = state.config?.sourceCrs
        ?? (candidate.sourceCrs?.startsWith?.('EPSG:') ? candidate.sourceCrs : 'EPSG:4326');
      const sourceCrs = element(documentRef, 'input', undefined, { id: 'data-workbench-source-crs', value: sourceCrsValue });
      sourceCrs.value = sourceCrsValue;
      crs.append(
        element(documentRef, 'dt', 'Source CRS'), element(documentRef, 'dd', candidate.sourceCrs ?? 'Not declared'),
        element(documentRef, 'dt', 'Output CRS'), element(documentRef, 'dd', candidate.outputCrs ?? 'EPSG:4326')
      );
      crs.children[1].append(sourceCrs);
      const applyCrs = element(documentRef, 'button', 'Apply source CRS', { type: 'button' });
      applyCrs.addEventListener('click', async () => {
        try {
          const patch = state.format === 'shapefile'
            ? { crsMode: 'manual', sourceCrs: sourceCrs.value.trim() }
            : { sourceCrs: sourceCrs.value.trim() };
          session.configure(patch);
          setStatus('Reprojecting and validating local coordinates…');
          candidates = await session.prepare();
          selectedCandidateId = candidates.find(({ geometry }) => geometry === candidate.geometry)?.id ?? candidates[0]?.id;
          renderPrepared();
          setStatus('Review the preview. Stored output will be EPSG:4326.');
        } catch (error) { setStatus(error.message, true); }
      });
      crs.children[1].append(applyCrs);
      container.append(crs, spatialPreview(documentRef, candidate));
    } else container.append(tablePreview(documentRef, candidate));
    if (candidate.warnings?.length) {
      const warnings = element(documentRef, 'ul', undefined, { className: 'data-workbench-warnings' });
      candidate.warnings.forEach((warning) => warnings.append(element(documentRef, 'li', warning)));
      container.append(warnings);
    }
    const advanced = element(documentRef, 'details', undefined, { className: 'data-workbench-advanced' });
    advanced.append(element(documentRef, 'summary', 'Advanced / Technical details'));
    const idLabel = element(documentRef, 'label', 'Stable dataset ID');
    const stableId = options.mode === 'replace' ? options.existingDataset.id : candidate.id;
    const id = element(documentRef, 'input', undefined, { id: 'data-workbench-id', value: stableId });
    id.value = stableId;
    id.readOnly = options.mode === 'replace';
    id.disabled = options.mode === 'replace';
    idLabel.append(id);
    const labelNode = element(documentRef, 'label', 'Dataset label');
    const labelValue = options.mode === 'replace' ? (options.existingDataset.label ?? stableId) : candidate.label;
    const humanLabel = element(documentRef, 'input', undefined, { id: 'data-workbench-label', value: labelValue });
    humanLabel.value = labelValue;
    labelNode.append(humanLabel);
    const path = options.mode === 'replace' ? options.existingDataset.src
      : candidate.kind === 'spatial' ? `./data/${candidate.id}.geojson` : `./data/${candidate.id}.json`;
    advanced.append(idLabel, labelNode, element(documentRef, 'p', `Managed path · ${path}`));
    container.append(advanced);

    const footer = dialog.children.find?.((child) => child.tagName === 'FOOTER')
      ?? Array.from(dialog.children).find((child) => child.tagName === 'FOOTER');
    const cancel = Array.from(footer.children).find((child) => child.textContent === 'Cancel');
    const confirm = element(documentRef, 'button', options.mode === 'replace' ? 'Replace data' : 'Add data', { type: 'button', className: 'primary' });
    confirm.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      confirm.disabled = true;
      setStatus('Validating with production contracts…');
      try {
        const selected = session.candidate(selectedCandidateId);
        const confirmed = { ...selected, id: id.value.trim(), label: humanLabel.value.trim() };
        await onConfirm(confirmed, { mode: options.mode, existingDataset: options.existingDataset });
        close();
      } catch (error) {
        setStatus(error.message, true);
        confirm.disabled = false;
      } finally {
        busy = false;
      }
    });
    footer.replaceChildren(cancel, confirm);
  }

  async function beginFiles(files) {
    disposeSession();
    session = createSession({ files, replacement: options.existingDataset });
    setStatus('Reading local files…');
    bodyNode().replaceChildren();
    try {
      const sourceItems = await session.read();
      if (!sourceItems.length) throw new TypeError('This source has no importable items.');
      await prepareSelected(sourceItems[0].id);
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });

  return Object.freeze({
    async open(nextOptions = {}) {
      close();
      options = { mode: 'add', ...nextOptions };
      returnFocus = nextOptions.returnFocus ?? documentRef.activeElement;
      session = nextOptions.files?.length ? null : createSession({ files: [], replacement: options.existingDataset });
      renderInitial();
      dialog.showModal();
      if (nextOptions.files?.length) await beginFiles(nextOptions.files);
      return this.state();
    },
    close,
    state() {
      return Object.freeze({
        open: Boolean(dialog.open),
        mode: options?.mode,
        busy,
        selectedCandidateId,
        session: session?.state?.()
      });
    }
  });
}
