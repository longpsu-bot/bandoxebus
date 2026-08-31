import { createDraftStore } from './core/draft-store.js';
import { createNewProjectEntries, createPackageStore } from './core/package-store.js';
import {
  createSourceRepairModel,
  createValidationCoordinator,
  createValidationNavigationIndex
} from './core/validation.js';
import { createPreviewBridge } from './preview/bridge.js';
import { renderEntityInspector } from './ui/inspectors.js';
import { createStoryEditor } from './ui/story-editor.js';
import {
  applyStudioStoryCommand,
  getStudioAuthoringMode,
  mountStudioShell,
  resetStudioAuthoringSession
} from './ui/studio-shell.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import { STORY_10_CONTENT_TYPES } from '../src/content/content-descriptors.js';
import {
  canOpenFolder,
  createFolderStorageAdapter,
  createMemoryStorageAdapter,
  createZipStorageAdapter
} from './storage/adapters.js';

const decoder = new TextDecoder();

export async function savePackageChanges({
  adapter,
  packageStore,
  validation,
  confirmInvalid = async () => false
}) {
  if (!adapter?.writeChanges) throw new TypeError('The active project cannot be saved in place.');
  const changeSet = packageStore.changeSet();
  if (!changeSet.length) return { written: [], failed: [], skipped: [] };
  if (validation?.status === 'invalid') {
    const approved = await confirmInvalid(validation.diagnostics ?? []);
    if (!approved) {
      return { written: [], failed: [], skipped: changeSet.map(({ path }) => path) };
    }
  }
  const result = await adapter.writeChanges(changeSet);
  packageStore.markWritten(result.written);
  return result;
}

export async function exportPackageZip({ packageStore, validation }) {
  if (validation?.status === 'invalid') {
    throw new TypeError('Project ZIP export is blocked by fatal production validation errors.');
  }
  return createZipStorageAdapter().export(packageStore);
}

export function createEditor({
  documentRef = globalThis.document,
  windowRef = globalThis.window
} = {}) {
  const elements = {
    newProject: documentRef.getElementById('new-project'),
    openFolder: documentRef.getElementById('open-folder'),
    importZip: documentRef.getElementById('import-zip'),
    save: documentRef.getElementById('save-project'),
    exportZip: documentRef.getElementById('export-project-zip'),
    validate: documentRef.getElementById('validate-project'),
    previewStatus: documentRef.getElementById('preview-status'),
    dirtyStatus: documentRef.getElementById('dirty-status'),
    validationStatus: documentRef.getElementById('validation-status'),
    validationErrors: documentRef.getElementById('validation-errors'),
    locale: documentRef.getElementById('project-locale'),
    heading: documentRef.getElementById('story-heading'),
    iframe: documentRef.getElementById('production-preview'),
    frame: documentRef.getElementById('preview-frame'),
    paused: documentRef.getElementById('preview-paused'),
    desktop: documentRef.getElementById('preview-desktop'),
    mobile: documentRef.getElementById('preview-mobile'),
    orderingAnnouncements: documentRef.getElementById('ordering-announcements')
  };
  elements.inspector = documentRef.querySelector?.('.editor-inspector') ?? null;
  elements.navigation = documentRef.querySelector?.('.editor-navigation') ?? null;
  elements.layout = documentRef.querySelector?.('.editor-layout') ?? null;
  elements.previewToolbar = documentRef.querySelector?.('.preview-toolbar') ?? null;
  elements.studioScenes = documentRef.getElementById('studio-scenes');
  let packageStore = null;
  let storageAdapter = null;
  let draftStore = null;
  let validation = null;
  let navigationIndex = createValidationNavigationIndex();
  let lastSentRevision = -1;
  let previewTelemetry = null;
  let primaryStoryPath = null;
  let activeSection = 'project';
  let storySelection = null;
  let stateSelection = 0;
  let actionPhaseSelection = 'enter';
  let blockSelection = 0;
  let actionSelection = '';
  let viewportPreset = 'desktop';

  function primaryStory() {
    const manifest = draftStore?.get('project.json');
    const item = manifest?.stories?.items?.find(({ id }) => id === manifest.stories.primary);
    const path = item?.src?.replace(/^\.\//, '') ?? null;
    return { manifest, item, path, story: path ? draftStore?.get(path) : null };
  }

  function productionContentCatalogs(manifest) {
    const selectedIds = new Set(['core-content-v1', 'core-map-v1', ...manifest.capabilities.map(({ id }) => id)]);
    const selectedDescriptors = INSTALLED_CAPABILITY_REGISTRY.catalog().filter(({ id }) => selectedIds.has(id));
    const tables = Object.entries(manifest.datasets)
      .filter(([, descriptor]) => descriptor.type === 'table-json')
      .map(([id, descriptor]) => ({ id, columns: draftStore.get(descriptor.src.replace(/^\.\//, ''))?.columns ?? [] }));
    const metricFile = manifest.metrics ? draftStore.get(manifest.metrics.src.replace(/^\.\//, '')) : null;
    const catalogs = {
      tables,
      datasets: Object.entries(manifest.datasets).map(([id, descriptor]) => ({ id, label: descriptor.label ?? id })),
      assets: Object.keys(manifest.assets).map((id) => ({ id })),
      metrics: [
        ...Object.entries(metricFile?.metrics ?? {}).map(([id, metric]) => ({ id, label: metric.label, format: metric.format })),
        ...selectedDescriptors.flatMap(({ metrics }) => metrics)
      ],
      capabilityTargets: selectedDescriptors.flatMap(({ targets }) => targets.map(({ id, label }) => ({ id, label }))),
      attribution: Object.keys(manifest.attribution).map((id) => ({ id }))
    };
    const datasetTargets = catalogs.datasets;
    const focusTargets = Object.keys(manifest.focusTargets).map((id) => ({ id }));
    catalogs.actionTargets = {
      'map.focus': [...datasetTargets, ...focusTargets, ...catalogs.capabilityTargets],
      'map.set-visibility': datasetTargets,
      'map.set-emphasis': datasetTargets
    };
    return { catalogs, selectedDescriptors };
  }

  function renderStudioWorkspace() {
    const current = primaryStory();
    if (current.story?.schemaVersion !== '1.2' || !elements.studioScenes) return false;
    stateSelection = Math.max(0, Math.min(stateSelection, current.story.states.length - 1));
    elements.layout?.classList?.add('is-studio');
    elements.mobile.hidden = true;
    elements.desktop.hidden = true;
    mountStudioShell({
      documentRef,
      navigation: elements.navigation,
      inspector: elements.inspector,
      scenesHost: elements.studioScenes,
      previewToolbar: elements.previewToolbar,
      manifest: current.manifest,
      catalogs: productionContentCatalogs(current.manifest).catalogs,
      story: current.story,
      sceneIndex: stateSelection,
      workingCamera: previewTelemetry,
      onSelectScene(index) {
        stateSelection = index;
        bridge.command('activate-scene', { index, animate: false });
        renderStudioWorkspace();
      },
      onStoryCommand(name, payload) {
        const next = applyStudioStoryCommand(current.story, name, payload);
        if (name === 'add-scene') stateSelection = next.states.length - 1;
        else if (name === 'duplicate-scene') stateSelection = payload.sceneIndex + 1;
        else if (name === 'delete-scene') stateSelection = Math.min(payload.sceneIndex, next.states.length - 1);
        else if (name === 'move-scene') stateSelection = payload.to;
        draftStore.mutate(current.path, () => next);
        renderDirty();
        renderStudioWorkspace();
      },
      onPreviewCommand(name, payload) { bridge.command(name, payload); }
    });
    return true;
  }

  function addLayerToPrimaryStory12(datasetId) {
    const current = primaryStory();
    if (current.story?.schemaVersion !== '1.2') return;
    const next = applyStudioStoryCommand(current.story, 'add-project-layer', {
      sceneIndex: stateSelection,
      datasetId
    });
    draftStore.mutate(current.path, () => next);
  }

  function inspect(kind, options = {}) {
    if (!draftStore || !packageStore) throw new TypeError('Create or open a project before authoring.');
    const manifest = draftStore.get('project.json');
    const resources = Object.fromEntries(Object.entries(manifest.datasets ?? {}).map(([id, descriptor]) => [
      id,
      draftStore.get(descriptor.src.replace(/^\.\//, ''))
    ]));
    const assetBytes = Object.fromEntries(Object.entries(manifest.assets ?? {}).map(([id, descriptor]) => [
      id,
      packageStore.get(descriptor.src.replace(/^\.\//, ''))?.currentBytes.slice()
    ]));
    const stories = Object.fromEntries((manifest.stories?.items ?? []).map(({ id, src }) => [
      id,
      draftStore.get(src.replace(/^\.\//, ''))
    ]));
    const selectedIds = new Set(['core-content-v1', 'core-map-v1', ...(manifest.capabilities ?? []).map(({ id }) => id)]);
    const selectedDescriptors = INSTALLED_CAPABILITY_REGISTRY.catalog().filter(({ id }) => selectedIds.has(id));
    return renderEntityInspector({
      kind,
      manifest,
      telemetry: previewTelemetry,
      resources,
      assetBytes,
      stories,
      metricsFile: manifest.metrics ? draftStore.get(manifest.metrics.src.replace(/^\.\//, '')) : undefined,
      computed: selectedDescriptors.flatMap(({ metrics }) => metrics),
      roleCatalog: selectedDescriptors.flatMap(({ datasetRoles }) => datasetRoles),
      mutate(updater) {
        draftStore.mutate('project.json', updater);
        renderDirty();
      },
      writeResource(path, value, descriptor) {
        const text = `${JSON.stringify(value, null, 2)}\n`;
        const entry = packageStore.get(path);
        if (!entry) packageStore.setManaged(path, { ...descriptor, bytes: text, managed: true });
        draftStore.replaceText(path, text);
        renderDirty();
      },
      writeBinary(path, bytes, descriptor) {
        const entry = packageStore.get(path);
        if (entry) packageStore.setCurrentBytes(path, bytes);
        else packageStore.setManaged(path, { ...descriptor, bytes, managed: true });
        validation?.schedule();
        renderDirty();
      },
      removeResource(path) {
        packageStore.removeManaged(path);
        validation?.schedule();
        renderDirty();
      },
      ...options
    });
  }

  function renderProjectInspector() {
    if (!draftStore || !elements.inspector) return;
    elements.inspector.querySelector?.('.authoring-panel')?.remove();
    elements.inspector.querySelector?.('.tailored-inspector')?.remove();
    inspect('project', {
      container: elements.inspector,
      documentRef
    });
  }

  function editStories(options = {}) {
    if (!draftStore || !packageStore) throw new TypeError('Create or open a project before authoring.');
    const manifest = draftStore.get('project.json');
    const stories = Object.fromEntries(manifest.stories.items.map(({ id, src }) => [
      id,
      draftStore.get(src.replace(/^\.\//, ''))
    ]));
    const { catalogs, selectedDescriptors } = productionContentCatalogs(manifest);
    return createStoryEditor({
      manifest,
      stories,
      contentDescriptors: selectedDescriptors.flatMap(({ content }) => content),
      actionDescriptors: selectedDescriptors.flatMap(({ actions }) => actions),
      catalogs,
      mutateManifest(updater) {
        draftStore.mutate('project.json', updater);
        renderDirty();
      },
      writeStory(id, story, metadata = {}) {
        const path = metadata.path ?? manifest.stories.items.find((item) => item.id === id)?.src.replace(/^\.\//, '');
        const text = `${JSON.stringify(story, null, 2)}\n`;
        if (metadata.create || !packageStore.get(path)) {
          packageStore.setManaged(path, { bytes: text, mediaType: 'application/json', kind: 'story', managed: true });
          draftStore.replaceText(path, text);
        } else {
          draftStore.mutate(path, () => story);
        }
        renderDirty();
      },
      removeStory(_id, path) {
        packageStore.removeManaged(path);
        validation?.schedule();
        renderDirty();
      },
      announce(message) {
        elements.validationStatus.textContent = message;
        if (elements.orderingAnnouncements) elements.orderingAnnouncements.textContent = message;
      },
      ...options
    });
  }

  function node(tag, text, attributes = {}) {
    const element = documentRef.createElement(tag);
    if (text !== undefined) element.textContent = text;
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'className') element.className = value;
      else if (name === 'type') element.type = value;
      else element.setAttribute(name, value);
    }
    return element;
  }

  function labeled(panel, text, control) {
    const label = node('label', text);
    const status = panel.querySelector?.('.authoring-status')
      ?? elements.inspector.querySelector?.('.authoring-status');
    const requiredIds = new Set([
      'author-dataset-id', 'author-dataset-label', 'author-dataset-file',
      'author-asset-id', 'author-asset-file', 'author-metric-id', 'author-metric-label',
      'author-focus-id', 'author-attribution-id', 'author-attribution-name',
      'author-story-title', 'author-state-title'
    ]);
    if (requiredIds.has(control.id)) control.required = true;
    if (status?.id) {
      control.setAttribute('aria-describedby', status.id);
      control.setAttribute('aria-errormessage', status.id);
    }
    if (!control.hasAttribute?.('aria-required')) control.setAttribute('aria-required', String(Boolean(control.required)));
    label.append(control);
    panel.append(label);
    return control;
  }

  function authoringPanel(title) {
    elements.inspector.querySelector?.('.authoring-panel')?.remove();
    const panel = node('section', undefined, { className: 'authoring-panel' });
    panel.append(node('h3', title));
    const status = node('p', '', { id: 'authoring-status', role: 'status', 'aria-live': 'polite', className: 'authoring-status' });
    panel.append(status);
    elements.inspector.append(panel);
    return { panel, status };
  }

  function textInput(id, value = '') {
    const input = node('input', undefined, { type: 'text', id });
    input.value = value;
    return input;
  }

  function selectInput(id, options) {
    const select = node('select', undefined, { id });
    for (const [value, label = value] of options) {
      const option = node('option', label);
      option.value = value;
      select.append(option);
    }
    return select;
  }

  function checkboxInput(id, checked = false) {
    const input = node('input', undefined, { type: 'checkbox', id });
    input.checked = checked;
    return input;
  }

  function button(text, id, action) {
    const result = node('button', text, { type: 'button', ...(id ? { id } : {}) });
    result.addEventListener('click', action);
    return result;
  }

  function setStatus(status, message, error) {
    status.textContent = error ? error.message : message;
  }

  function focusControl(id) {
    if (!id) return;
    documentRef.getElementById(id)?.focus?.();
  }

  function refreshPanel(render, message, { focusId } = {}) {
    render();
    const status = elements.inspector.querySelector?.('.authoring-status');
    if (status) status.textContent = message;
    focusControl(focusId);
  }

  function scalarControl(panel, labelText, id, value, onChange, {
    type = 'text', options, readOnly = false, required = false
  } = {}) {
    const control = options
      ? selectInput(id, options.map((item) => [item.value ?? item, item.label ?? item.value ?? item]))
      : type === 'checkbox' ? checkboxInput(id, Boolean(value))
        : node('input', undefined, { type, id });
    if (type !== 'checkbox') control.value = value ?? '';
    control.readOnly = readOnly;
    control.disabled = readOnly;
    control.required = required;
    control.setAttribute('aria-required', String(required));
    if (!readOnly) control.addEventListener('change', () => {
      const next = type === 'checkbox' ? control.checked
        : ['number', 'integer'].includes(type) && control.value !== '' ? Number(control.value) : control.value;
      onChange(next);
    });
    return labeled(panel, labelText, control);
  }

  function writeNested(target, path, value) {
    const parts = path.split('.');
    const field = parts.pop();
    const parent = parts.reduce((current, part) => (current[part] ??= {}), target);
    if (value === '' || value === undefined) delete parent[field];
    else parent[field] = value;
  }

  function renderBoundedControls(container, controls, prefix, onChange = () => {}) {
    const inputs = [];
    for (const control of controls.filter(({ readOnly }) => !readOnly)) {
      const relative = control.path.replace(/^\$\.action\.?/, '');
      const id = relative === 'target' ? 'author-action-target' : `${prefix}-${relative.replaceAll('.', '-')}`;
      const type = control.kind === 'checkbox' ? 'checkbox'
        : control.kind === 'integer' || control.kind === 'number' ? 'number' : 'text';
      const input = scalarControl(container, relative, id, control.kind === 'array' ? (control.value ?? []).join(', ') : control.value, (value) => {
        const normalized = control.kind === 'array' ? value.split(',').map((item) => item.trim()).filter(Boolean) : value;
        onChange(relative, normalized);
      }, { type, options: control.options, required: control.required === true });
      inputs.push({ control, relative, input });
    }
    return {
      values() {
        const result = {};
        for (const { control, relative, input } of inputs) {
          let value = control.kind === 'checkbox' ? input.checked : input.value;
          if (['number', 'integer'].includes(control.kind) && value !== '') value = Number(value);
          if (control.kind === 'array') value = value.split(',').map((item) => item.trim()).filter(Boolean);
          writeNested(result, relative, value);
        }
        return result;
      }
    };
  }

  function renderDatasetPanel() {
    const { panel, status } = authoringPanel('Datasets');
    const manifest = draftStore.get('project.json');
    const ui = inspect('dataset');
    const existingIds = Object.keys(manifest.datasets);
    const existing = labeled(panel, 'Existing dataset', selectInput('author-dataset-existing', [
      ['', 'Select dataset'], ...existingIds.map((item) => [item, manifest.datasets[item].label ?? item])
    ]));
    const inspectorPanel = node('section', undefined, { className: 'entity-inspector', id: 'author-dataset-inspector' });
    panel.append(inspectorPanel);
    function renderExisting() {
      inspectorPanel.replaceChildren();
      if (!existing.value) return;
      const descriptor = manifest.datasets[existing.value];
      const entity = ui.entity(existing.value);
      inspectorPanel.append(node('h4', descriptor.label ?? existing.value));
      scalarControl(inspectorPanel, 'Label', 'author-dataset-edit-label', entity.control('label').value, (value) => entity.control('label').set(value));
      if (entity.hasControl('required')) scalarControl(inspectorPanel, 'Required', 'author-dataset-edit-required', entity.control('required').value, (value) => entity.control('required').set(value), { type: 'checkbox' });
      const roles = entity.roleOptions();
      if (roles.length) scalarControl(inspectorPanel, 'Compatible role', 'author-dataset-edit-role', entity.control('role').value, (value) => entity.control('role').set(value), { options: [{ value: '', label: 'No role' }, ...roles.map((value) => ({ value, label: value }))] });
      if (descriptor.type === 'geojson') {
        for (const field of ['type', 'color', 'width', 'opacity', 'radius', 'strokeColor', 'strokeWidth', 'outlineColor', 'outlineWidth', 'lineStyle']) {
          if (!entity.hasControl(`render.${field}`)) continue;
          const control = entity.control(`render.${field}`);
          scalarControl(inspectorPanel, `Renderer ${field}`, `author-dataset-render-${field}`, control.value, (value) => control.set(value), { type: control.inputType });
        }
        const fields = entity.labelFields();
        if (fields.length) {
          const labelValue = descriptor.render?.label ?? {};
          scalarControl(inspectorPanel, 'Feature label field', 'author-dataset-label-field', labelValue.field, (value) => entity.control('render.label').set({ ...labelValue, field: value }), { options: fields.map((value) => ({ value, label: value })) });
          scalarControl(inspectorPanel, 'Feature label placement', 'author-dataset-label-placement', labelValue.placement ?? 'auto', (value) => entity.control('render.label').set({ ...labelValue, placement: value }), { options: entity.labelPlacements().map((value) => ({ value, label: value })) });
        }
      } else {
        const table = draftStore.get(descriptor.src.replace(/^\.\//, ''));
        const tableSection = node('section', undefined, { className: 'table-editor', id: 'author-table-editor' });
        tableSection.append(node('h4', 'Normalized table'));
        for (const column of table.columns) {
          const columnModel = entity.column(column.id);
          scalarControl(tableSection, `${column.id} column label`, `author-table-column-${column.id}-label`, column.label ?? '', (value) => columnModel.control('label').set(value));
          scalarControl(tableSection, `${column.id} column unit`, `author-table-column-${column.id}-unit`, column.unit ?? '', (value) => columnModel.control('unit').set(value));
        }
        table.rows.forEach((row, rowIndex) => {
          const rowSection = node('div', undefined, { className: 'table-row' });
          for (const column of table.columns) {
            scalarControl(rowSection, `Row ${rowIndex + 1} ${column.label ?? column.id}`, `author-table-cell-${rowIndex}-${column.id}`, row[column.id] ?? '', (value) => {
              entity.command('edit-cell', { row: rowIndex, column: column.id, value });
            }, { type: ['integer', 'number'].includes(column.type) ? 'number' : 'text' });
          }
          rowSection.append(button('Remove row', `author-table-row-${rowIndex}-remove`, () => {
            try { entity.command('remove-row', rowIndex); refreshPanel(renderDatasetPanel, 'Removed table row.'); } catch (error) { setStatus(status, '', error); }
          }));
          tableSection.append(rowSection);
        });
        tableSection.append(button('Add row', 'author-table-row-add', () => {
          try { entity.command('add-row', {}); refreshPanel(renderDatasetPanel, 'Added table row.'); } catch (error) { setStatus(status, '', error); }
        }));
        inspectorPanel.append(tableSection);
      }
      const replace = node('input', undefined, { type: 'file', id: 'author-dataset-replace' });
      replace.accept = '.json,.geojson,application/json,application/geo+json';
      labeled(inspectorPanel, 'Replace resource', replace);
      inspectorPanel.append(button('Replace dataset resource', 'author-dataset-replace-button', async () => {
        try {
          entity.command('replace', JSON.parse(await replace.files[0].text()));
          refreshPanel(renderDatasetPanel, `Replaced dataset ${existing.value}.`);
        } catch (error) { setStatus(status, '', error); }
      }));
    }
    existing.addEventListener('change', renderExisting);
    const id = labeled(panel, 'Stable dataset ID', textInput('author-dataset-id'));
    const label = labeled(panel, 'Label', textInput('author-dataset-label'));
    const type = labeled(panel, 'Data type', selectInput('author-dataset-type', [
      ['line', 'Line GeoJSON'], ['point', 'Point GeoJSON'], ['polygon', 'Polygon GeoJSON'], ['table', 'Normalized table JSON']
    ]));
    const color = labeled(panel, 'Renderer color', node('input', undefined, { type: 'color', id: 'author-dataset-color' }));
    color.value = '#00aaff';
    const file = labeled(panel, 'Import file', node('input', undefined, { type: 'file', id: 'author-dataset-file' }));
    file.accept = '.json,.geojson,application/json,application/geo+json';
    const add = node('button', 'Import dataset', { type: 'button', id: 'author-dataset-add' });
    add.addEventListener('click', async () => {
      try {
        const value = JSON.parse(await file.files[0].text());
        if (type.value === 'table') ui.command('add-table', id.value, { label: label.value, value });
        else {
          ui.command('add-geojson', id.value, { geometry: type.value, label: label.value, value });
          addLayerToPrimaryStory12(id.value);
          const entity = ui.entity(id.value);
          entity.control('render.type').set(type.value === 'polygon' ? 'fill' : type.value);
          entity.control('render.color').set(color.value.toUpperCase());
          const fields = entity.labelFields();
          if (fields.length) entity.control('render.label').set({ field: fields[0], placement: 'auto' });
        }
        refreshPanel(renderDatasetPanel, `Added dataset ${id.value}.`);
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderAssetPanel() {
    const { panel, status } = authoringPanel('Images');
    const manifest = draftStore.get('project.json');
    const ui = inspect('asset');
    const existing = labeled(panel, 'Existing image', selectInput('author-asset-existing', [
      ['', 'Select image'], ...Object.keys(manifest.assets).map((item) => [item, item])
    ]));
    const inspectorPanel = node('section', undefined, { className: 'entity-inspector', id: 'author-asset-inspector' });
    panel.append(inspectorPanel);
    existing.addEventListener('change', () => {
      inspectorPanel.replaceChildren();
      if (!existing.value) return;
      const entity = ui.entity(existing.value);
      inspectorPanel.append(node('h4', existing.value));
      scalarControl(inspectorPanel, 'Required', 'author-asset-required', entity.control('required').value, (value) => entity.control('required').set(value), { type: 'checkbox' });
      scalarControl(inspectorPanel, 'Attribution IDs', 'author-asset-attribution', (entity.control('attribution').value ?? []).join(', '), (value) => entity.control('attribution').set(value.split(',').map((item) => item.trim()).filter(Boolean)));
      const replace = node('input', undefined, { type: 'file', id: 'author-asset-replace' });
      replace.accept = 'image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp';
      labeled(inspectorPanel, 'Replace image', replace);
      inspectorPanel.append(button('Replace image', 'author-asset-replace-button', async () => {
        try { entity.command('replace', new Uint8Array(await replace.files[0].arrayBuffer())); setStatus(status, `Replaced image ${existing.value}.`); } catch (error) { setStatus(status, '', error); }
      }));
      inspectorPanel.append(button('Review removal impact', 'author-asset-remove-review', () => {
        const impact = entity.command('request-delete');
        inspectorPanel.append(node('p', impact.brokenReferences.length ? `References: ${impact.brokenReferences.join(', ')}` : 'No references.'));
        inspectorPanel.append(button('Confirm remove image', 'author-asset-remove-confirm', () => {
          entity.command('confirm-delete');
          refreshPanel(renderAssetPanel, `Removed image ${existing.value}.`);
        }));
      }));
    });
    const id = labeled(panel, 'Stable image ID', textInput('author-asset-id'));
    const file = labeled(panel, 'Image file', node('input', undefined, { type: 'file', id: 'author-asset-file' }));
    file.accept = 'image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp';
    const add = node('button', 'Add image', { type: 'button', id: 'author-asset-add' });
    add.addEventListener('click', async () => {
      try {
        const selected = file.files[0];
        ui.command('add-image', id.value, {
          bytes: new Uint8Array(await selected.arrayBuffer()), mediaType: selected.type
        });
        refreshPanel(renderAssetPanel, `Added image ${id.value}.`);
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderMetricPanel() {
    const { panel, status } = authoringPanel('Metrics');
    const ui = inspect('metric');
    const existing = labeled(panel, 'Existing metric', selectInput('author-metric-existing', [
      ['', 'Select metric'], ...ui.metricOptions().map((item) => [item, item])
    ]));
    const inspectorPanel = node('section', undefined, { className: 'entity-inspector', id: 'author-metric-inspector' });
    panel.append(inspectorPanel);
    existing.addEventListener('change', () => {
      inspectorPanel.replaceChildren();
      if (!existing.value) return;
      const metric = ui.metric(existing.value);
      inspectorPanel.append(node('h4', existing.value));
      if (metric.readOnly) inspectorPanel.append(node('p', 'Computed metric descriptor · read-only'));
      for (const path of ['label', 'value', ...metric.formatControls().map((field) => `format.${field}`)]) {
        const control = metric.control(path);
        const type = path === 'value' && typeof control.value === 'number' || path.endsWith('decimals') ? 'number' : 'text';
        scalarControl(inspectorPanel, path, `author-metric-edit-${path.replace('.', '-')}`, control.value, (value) => control.set(value), { type, readOnly: metric.readOnly || control.readOnly });
      }
    });
    const id = labeled(panel, 'Stable metric ID', textInput('author-metric-id'));
    const label = labeled(panel, 'Label', textInput('author-metric-label'));
    const value = labeled(panel, 'Value', textInput('author-metric-value'));
    const format = labeled(panel, 'Format', selectInput('author-metric-format', [
      ['integer'], ['decimal'], ['percentage'], ['distance'], ['currency'], ['text']
    ]));
    const add = node('button', 'Add static metric', { type: 'button', id: 'author-metric-add' });
    add.addEventListener('click', () => {
      try {
        const scalar = value.value === '' ? null : format.value === 'text' ? value.value : Number(value.value);
        const descriptor = { label: label.value, value: scalar, format: { type: format.value } };
        if (format.value === 'currency') descriptor.format.currency = 'USD';
        ui.command('add-static', id.value, descriptor);
        refreshPanel(renderMetricPanel, `Added metric ${id.value}.`);
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderFocusPanel() {
    const { panel, status } = authoringPanel('Focus targets');
    const manifest = draftStore.get('project.json');
    const ui = inspect('focus');
    const existing = labeled(panel, 'Existing focus target', selectInput('author-focus-existing', [
      ['', 'Select focus target'], ...Object.keys(manifest.focusTargets).map((item) => [item, item])
    ]));
    const inspectorPanel = node('section', undefined, { className: 'entity-inspector', id: 'author-focus-inspector' });
    panel.append(inspectorPanel);
    existing.addEventListener('change', () => {
      inspectorPanel.replaceChildren();
      if (!existing.value) return;
      const value = manifest.focusTargets[existing.value];
      const entity = ui.entity(existing.value);
      inspectorPanel.append(node('h4', `${existing.value} · ${value.type}`));
      if (value.type === 'datasets') {
        scalarControl(inspectorPanel, 'Dataset IDs', 'author-focus-edit-datasets', value.datasets.join(', '), (next) => entity.control('datasets').set(next.split(',').map((item) => item.trim()).filter(Boolean)));
      } else if (value.type === 'coordinate') {
        scalarControl(inspectorPanel, 'Longitude', 'author-focus-edit-longitude', value.center[0], (next) => entity.control('center.0').set(next), { type: 'number' });
        scalarControl(inspectorPanel, 'Latitude', 'author-focus-edit-latitude', value.center[1], (next) => entity.control('center.1').set(next), { type: 'number' });
        scalarControl(inspectorPanel, 'Zoom', 'author-focus-edit-zoom', value.zoom, (next) => entity.control('zoom').set(next), { type: 'number' });
      } else if (value.type === 'bounds') {
        ['west', 'south', 'east', 'north'].forEach((label, index) => scalarControl(inspectorPanel, label, `author-focus-edit-${label}`, value.bounds[index], (next) => entity.control(`bounds.${index}`).set(next), { type: 'number' }));
      }
      for (const hint of ['maxZoom', 'pitch', 'bearing', 'padding']) {
        scalarControl(inspectorPanel, `Camera ${hint}`, `author-focus-edit-camera-${hint}`, value.camera?.[hint], (next) => entity.control(`camera.${hint}`).set(next), { type: 'number' });
      }
    });
    const id = labeled(panel, 'Stable focus ID', textInput('author-focus-id'));
    const form = labeled(panel, 'Focus form', selectInput('author-focus-type', [['datasets'], ['coordinate'], ['bounds']]));
    const datasets = labeled(panel, 'Dataset IDs (comma separated)', textInput('author-focus-datasets'));
    const longitude = scalarControl(panel, 'Longitude', 'author-focus-longitude', '106.6', () => {}, { type: 'number' });
    const latitude = scalarControl(panel, 'Latitude', 'author-focus-latitude', '11', () => {}, { type: 'number' });
    const zoom = scalarControl(panel, 'Zoom', 'author-focus-zoom', '12', () => {}, { type: 'number' });
    const west = scalarControl(panel, 'West', 'author-focus-west', '106.5', () => {}, { type: 'number' });
    const south = scalarControl(panel, 'South', 'author-focus-south', '10.9', () => {}, { type: 'number' });
    const east = scalarControl(panel, 'East', 'author-focus-east', '106.7', () => {}, { type: 'number' });
    const north = scalarControl(panel, 'North', 'author-focus-north', '11.1', () => {}, { type: 'number' });
    const pitch = scalarControl(panel, 'Optional pitch', 'author-focus-pitch', '', () => {}, { type: 'number' });
    const bearing = scalarControl(panel, 'Optional bearing', 'author-focus-bearing', '', () => {}, { type: 'number' });
    const padding = scalarControl(panel, 'Optional padding', 'author-focus-padding', '24', () => {}, { type: 'number' });
    const inputLabels = [datasets, longitude, latitude, zoom, west, south, east, north].map((control) => control.parentElement);
    function updateFocusForm() {
      inputLabels.forEach((label) => { label.hidden = true; });
      if (form.value === 'datasets') datasets.parentElement.hidden = false;
      else if (form.value === 'coordinate') [longitude, latitude, zoom].forEach((control) => { control.parentElement.hidden = false; });
      else [west, south, east, north].forEach((control) => { control.parentElement.hidden = false; });
    }
    form.addEventListener('change', updateFocusForm);
    updateFocusForm();
    const add = node('button', 'Add focus target', { type: 'button', id: 'author-focus-add' });
    add.addEventListener('click', () => {
      try {
        const camera = Object.fromEntries([['pitch', pitch], ['bearing', bearing], ['padding', padding]].filter(([, control]) => control.value !== '').map(([key, control]) => [key, Number(control.value)]));
        const value = form.value === 'datasets'
          ? { type: 'datasets', datasets: datasets.value.split(',').map((item) => item.trim()).filter(Boolean), ...(Object.keys(camera).length ? { camera } : {}) }
          : form.value === 'coordinate'
            ? { type: 'coordinate', center: [Number(longitude.value), Number(latitude.value)], zoom: Number(zoom.value), ...(Object.keys(camera).length ? { camera } : {}) }
            : { type: 'bounds', bounds: [Number(west.value), Number(south.value), Number(east.value), Number(north.value)], ...(Object.keys(camera).length ? { camera } : {}) };
        ui.command('add', id.value, value);
        refreshPanel(renderFocusPanel, `Added focus ${id.value}.`);
      } catch (error) { status.textContent = error.message; }
    });
    const captured = node('output', '', { id: 'author-focus-captured' });
    const confirmCapture = button('Confirm captured focus', 'author-focus-capture-confirm', () => {
      try { ui.command('confirm-capture', id.value); refreshPanel(renderFocusPanel, `Added captured focus ${id.value}.`); } catch (error) { setStatus(status, '', error); }
    });
    confirmCapture.hidden = true;
    function capture(kind) {
      try {
        const value = ui.command('capture', kind);
        captured.textContent = `Captured ${kind}: ${JSON.stringify(value)}`;
        confirmCapture.hidden = false;
      } catch (error) { setStatus(status, '', error); }
    }
    panel.append(add, button('Capture current coordinate', 'author-focus-capture-coordinate', () => capture('coordinate')), button('Capture current bounds', 'author-focus-capture-bounds', () => capture('bounds')), captured, confirmCapture);
  }

  function renderAttributionPanel() {
    const { panel, status } = authoringPanel('Attribution');
    const manifest = draftStore.get('project.json');
    const ui = inspect('attribution');
    const existing = labeled(panel, 'Existing attribution', selectInput('author-attribution-existing', [
      ['', 'Select attribution'], ...Object.keys(manifest.attribution).map((item) => [item, manifest.attribution[item].name ?? item])
    ]));
    const inspectorPanel = node('section', undefined, { className: 'entity-inspector', id: 'author-attribution-inspector' });
    panel.append(inspectorPanel);
    existing.addEventListener('change', () => {
      inspectorPanel.replaceChildren();
      if (!existing.value) return;
      const entity = ui.entity(existing.value);
      for (const field of ['name', 'url', 'license', 'updated', 'notes']) {
        const control = entity.control(field);
        scalarControl(inspectorPanel, field, `author-attribution-edit-${field}`, control.value, (value) => control.set(value), { type: control.inputType });
      }
      inspectorPanel.append(button('Review removal impact', 'author-attribution-remove-review', () => {
        const impact = entity.command('request-delete');
        inspectorPanel.append(node('p', impact.brokenReferences.length ? `References: ${impact.brokenReferences.join(', ')}` : 'No references.'));
        inspectorPanel.append(button('Confirm remove attribution', 'author-attribution-remove-confirm', () => {
          entity.command('confirm-delete');
          refreshPanel(renderAttributionPanel, `Removed attribution ${existing.value}.`);
        }));
      }));
    });
    const id = labeled(panel, 'Stable source ID', textInput('author-attribution-id'));
    const name = labeled(panel, 'Source name', textInput('author-attribution-name'));
    const url = labeled(panel, 'HTTPS URL', textInput('author-attribution-url'));
    const add = node('button', 'Add attribution', { type: 'button', id: 'author-attribution-add' });
    add.addEventListener('click', () => {
      try {
        ui.command('add', id.value, { name: name.value, ...(url.value ? { url: url.value } : {}) });
        refreshPanel(renderAttributionPanel, `Added attribution ${id.value}.`);
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderStoryPanel() {
    const { panel, status } = authoringPanel('Story and states');
    const currentManifest = draftStore.get('project.json');
    const editor = editStories();
    const storyItems = editor.list();
    const storySelect = labeled(panel, 'Story', selectInput('author-story-select', storyItems.map(({ id }) => [id, id])));
    storySelect.value = storyItems.some(({ id }) => id === storySelection) ? storySelection : currentManifest.stories.primary;
    storySelection = storySelect.value;
    const selectedItem = storyItems.find(({ id }) => id === storySelect.value);
    const selectedStoryPath = selectedItem.src.replace(/^\.\//, '');
    const selectedStory = draftStore.get(selectedStoryPath);
    if (!selectedStory) {
      renderSourceRepair(selectedStoryPath);
      return;
    }
    const storyModel = editor.story(storySelect.value);
    panel.append(node('p', `Primary Story: ${currentManifest.stories.primary} · Selected schema ${selectedStory.schemaVersion}`));
    storySelect.addEventListener('change', () => {
      storySelection = storySelect.value;
      stateSelection = 0;
      blockSelection = 0;
      actionSelection = '';
      refreshPanel(renderStoryPanel, `Selected Story ${storySelect.value}.`);
    });
    const storyTitle = labeled(panel, 'New Story title', textInput('author-story-title', 'New Story'));
    panel.append(
      button('Add Story', 'author-story-add', () => {
        try {
          const created = editor.command('add-story', { title: storyTitle.value });
          storySelection = created.id;
          stateSelection = 0;
          refreshPanel(renderStoryPanel, 'Added Story.', { focusId: 'author-state-layout' });
        } catch (error) { setStatus(status, '', error); }
      }),
      button('Remove Story', 'author-story-remove', () => {
        try {
          const neighbor = storyItems[storyPosition + 1] ?? storyItems[storyPosition - 1];
          editor.command('remove-story', storySelect.value);
          storySelection = neighbor?.id ?? null;
          refreshPanel(renderStoryPanel, 'Removed Story.', { focusId: 'author-story-select' });
        } catch (error) { setStatus(status, '', error); }
      }),
      button('Set primary', 'author-story-primary', () => {
        editor.command('set-primary', storySelect.value); refreshPanel(renderStoryPanel, `Set ${storySelect.value} primary.`);
      })
    );
    const storyPosition = storyItems.findIndex(({ id }) => id === storySelect.value);
    panel.append(
      button('Move Story Up', 'author-story-up', () => { if (storyPosition > 0) { editor.command('move-story', { from: storyPosition, to: storyPosition - 1 }); refreshPanel(renderStoryPanel, 'Moved Story up.', { focusId: 'author-story-up' }); } }),
      button('Move Story Down', 'author-story-down', () => { if (storyPosition < storyItems.length - 1) { editor.command('move-story', { from: storyPosition, to: storyPosition + 1 }); refreshPanel(renderStoryPanel, 'Moved Story down.', { focusId: 'author-story-down' }); } })
    );

    const stateIndex = labeled(panel, 'State', selectInput('author-state-index', selectedStory.states.map((state, index) => [String(index), `${index + 1}. ${state.id}`])));
    stateSelection = Math.min(stateSelection, selectedStory.states.length - 1);
    stateIndex.value = String(stateSelection);
    stateIndex.addEventListener('change', () => {
      stateSelection = Number(stateIndex.value);
      blockSelection = 0;
      actionSelection = '';
      refreshPanel(renderStoryPanel, `Selected state ${stateSelection + 1}.`);
    });
    const state = selectedStory.states[Number(stateIndex.value)];
    const title = labeled(panel, 'New state title', textInput('author-state-title', 'Details'));
    panel.append(button('Add state', 'author-state-add', () => {
      try {
        storyModel.command('add-state', { title: title.value });
        stateSelection = selectedStory.states.length;
        refreshPanel(renderStoryPanel, 'Added state.', { focusId: 'author-state-layout' });
      } catch (error) { setStatus(status, '', error); }
    }));
    if (selectedStory.schemaVersion === '1.1') panel.append(
      button('Duplicate state', 'author-state-duplicate', () => { stateSelection = Number(stateIndex.value) + 1; storyModel.command('duplicate-state', Number(stateIndex.value)); refreshPanel(renderStoryPanel, 'Duplicated state.', { focusId: 'author-state-layout' }); }),
      button('Delete state', 'author-state-delete', () => { try { stateSelection = Math.min(Number(stateIndex.value), selectedStory.states.length - 2); storyModel.command('delete-state', Number(stateIndex.value)); refreshPanel(renderStoryPanel, 'Deleted state.', { focusId: 'author-state-index' }); } catch (error) { setStatus(status, '', error); } }),
      button('Move state up', 'author-state-up', () => { const from = Number(stateIndex.value); if (from > 0) { stateSelection = from - 1; storyModel.command('move-state', { from, to: from - 1 }); refreshPanel(renderStoryPanel, 'Moved state up.', { focusId: 'author-state-up' }); } }),
      button('Move state down', 'author-state-down', () => { const from = Number(stateIndex.value); if (from < selectedStory.states.length - 1) { stateSelection = from + 1; storyModel.command('move-state', { from, to: from + 1 }); refreshPanel(renderStoryPanel, 'Moved state down.', { focusId: 'author-state-down' }); } })
    );
    scalarControl(panel, 'Layout', 'author-state-layout', state.content.layout, (layout) => storyModel.command('set-layout', { stateIndex: Number(stateIndex.value), layout }), { options: storyModel.layoutOptions().map((value) => ({ value, label: value })) });
    scalarControl(panel, 'Presenter note', 'author-state-note', state.content.presenterNote ?? '', (note) => storyModel.command('set-presenter-note', { stateIndex: Number(stateIndex.value), note }));

    const authoring = selectedStory.schemaVersion === '1.1' ? storyModel.authoring() : null;
    const availableBlockTypes = (authoring?.contentTypes() ?? STORY_10_CONTENT_TYPES).filter((type) => selectedStory.schemaVersion === '1.1' || STORY_10_CONTENT_TYPES.includes(type));
    if (authoring) {
      const blockType = labeled(panel, 'Add Block', selectInput('author-block-type', availableBlockTypes.map((type) => [type, type])));
      panel.append(button('Add content block', 'author-block-add', () => {
        try {
          authoring.command('add-block', { stateIndex: Number(stateIndex.value), type: blockType.value });
          blockSelection = state.content.blocks.length;
          refreshPanel(renderStoryPanel, `Added ${blockType.value} block.`, { focusId: 'author-block-existing' });
        } catch (error) { setStatus(status, '', error); }
      }));
    }
    const blockSelect = labeled(panel, 'Current blocks', selectInput('author-block-existing', state.content.blocks.map((block, index) => [String(index), `${index + 1}. ${block.type}`])));
    blockSelection = Math.min(blockSelection, state.content.blocks.length - 1);
    blockSelect.value = String(blockSelection);
    blockSelect.addEventListener('change', () => { blockSelection = Number(blockSelect.value); refreshPanel(renderStoryPanel, `Selected block ${blockSelection + 1}.`); });
    const blockIndex = blockSelection;
    const block = state.content.blocks[blockIndex];
    const blockInspector = node('section', undefined, { className: 'entity-inspector', id: 'author-block-inspector' });
    panel.append(blockInspector);
    const editBlock = (path, value) => {
      if (authoring) authoring.command('edit-block', { stateIndex: Number(stateIndex.value), blockIndex, path, value });
      else storyModel.command('edit-block', { stateIndex: Number(stateIndex.value), blockIndex, path, value });
    };
    const blockFields = {
      eyebrow: [['text']], heading: [['text']], paragraph: [['text']], disclosure: [['text']],
      'stat-group': [['items.0.label'], ['items.0.metric']],
      callout: [['items.0.text'], ['items.0.tone']],
      table: [['caption'], ['source'], ['data.dataset']],
      chart: [['chartType'], ['title'], ['description'], ['source'], ['data.dataset'], ['data.x'], ['data.series.0.y'], ['data.series.0.label']],
      image: [['asset'], ['alt'], ['decorative', 'checkbox'], ['caption'], ['source']],
      legend: [['title'], ['items.0.label'], ['items.0.sample'], ['items.0.color'], ['items.0.asset']]
    };
    const readBlockPath = (path) => path.split('.').reduce((value, part) => value?.[part], block);
    for (const [path, kind] of blockFields[block.type] ?? []) {
      let options;
      if (path === 'asset' || path.endsWith('.asset')) options = Object.keys(currentManifest.assets).map((value) => ({ value, label: value }));
      if (path === 'chartType') options = authoring?.chartTypeOptions().map((value) => ({ value, label: value }));
      scalarControl(blockInspector, path, `author-block-edit-${path.replaceAll('.', '-')}`, readBlockPath(path), (value) => editBlock(path, value), { type: kind ?? 'text', options });
    }
    if (authoring) blockInspector.append(
      button('Duplicate block', 'author-block-duplicate', () => { authoring.command('duplicate-block', { stateIndex: Number(stateIndex.value), blockIndex }); refreshPanel(renderStoryPanel, 'Duplicated block.'); }),
      button('Delete block', 'author-block-delete', () => { try { blockSelection = Math.max(0, Math.min(blockIndex, state.content.blocks.length - 2)); authoring.command('delete-block', { stateIndex: Number(stateIndex.value), blockIndex }); refreshPanel(renderStoryPanel, 'Deleted block.', { focusId: 'author-block-existing' }); } catch (error) { setStatus(status, '', error); } }),
      button('Move Block Up', 'author-block-up', () => { if (blockIndex > 0) { blockSelection = blockIndex - 1; authoring.command('move-block', { stateIndex: Number(stateIndex.value), from: blockIndex, to: blockIndex - 1 }); refreshPanel(renderStoryPanel, 'Moved block up.', { focusId: 'author-block-up' }); } }),
      button('Move Block Down', 'author-block-down', () => { if (blockIndex < state.content.blocks.length - 1) { blockSelection = blockIndex + 1; authoring.command('move-block', { stateIndex: Number(stateIndex.value), from: blockIndex, to: blockIndex + 1 }); refreshPanel(renderStoryPanel, 'Moved block down.', { focusId: 'author-block-down' }); } })
    );

    if (selectedStory.schemaVersion === '1.0') {
      for (const [legacyStateIndex] of selectedStory.states.entries()) {
        for (const action of storyModel.legacyActions(legacyStateIndex)) {
          const control = labeled(panel, `${action.phase} · ${action.type}`, node('input', undefined, { type: 'text', 'data-legacy-action': action.type }));
          control.value = action.parameters;
          control.disabled = true;
          control.readOnly = true;
        }
      }
      status.textContent = 'Story 1.0 legacy action parameters are preserved and read-only.';
      return;
    }
    const phase = labeled(panel, 'Action phase', selectInput('author-action-phase', [['enter', 'Enter'], ['exit', 'Exit']]));
    phase.value = actionPhaseSelection;
    phase.addEventListener('change', () => { actionPhaseSelection = phase.value; actionSelection = ''; refreshPanel(renderStoryPanel, `Selected ${phase.value} actions.`); });
    const actionType = labeled(panel, 'Add Action', selectInput('author-action-type', authoring.actionTypes().map((type) => [type, type])));
    const actionParameters = node('section', undefined, { className: 'action-parameters', id: 'author-action-parameters' });
    panel.append(actionParameters);
    let addValues;
    const renderAddParameters = () => {
      actionParameters.replaceChildren();
      const rendered = authoring.actionControls(actionType.value);
      if (!rendered.supported) {
        actionParameters.append(node('p', `${rendered.code}: ${rendered.message}`));
        addValues = null;
        return;
      }
      addValues = renderBoundedControls(actionParameters, rendered.controls, 'author-action');
    };
    actionType.addEventListener('change', renderAddParameters);
    renderAddParameters();
    panel.append(button('Add action', 'author-action-add', () => {
      try {
        if (!addValues) throw Object.assign(new Error('The selected action has no safe GUI schema.'), { code: 'GUI_SCHEMA_UNSUPPORTED' });
        authoring.command('add-action', { stateIndex: Number(stateIndex.value), phase: phase.value, type: actionType.value, values: addValues.values() });
        actionSelection = String(state.map[phase.value].length);
        refreshPanel(renderStoryPanel, `Added ${actionType.value}.`, { focusId: 'author-action-existing' });
      } catch (error) { setStatus(status, '', error); }
    }));
    const actions = state.map[phase.value];
    const actionSelect = labeled(panel, 'Current actions', selectInput('author-action-existing', [['', actions.length ? 'Select action' : 'No actions'], ...actions.map((action, index) => [String(index), `${index + 1}. ${action.type}`])]));
    actionSelect.value = actions[Number(actionSelection)] ? actionSelection : '';
    const actionInspector = node('section', undefined, { className: 'entity-inspector', id: 'author-action-inspector' });
    panel.append(actionInspector);
    function renderExistingAction() {
      actionInspector.replaceChildren();
      if (actionSelect.value === '') return;
      const actionIndex = Number(actionSelect.value);
      const action = state.map[phase.value][actionIndex];
      const rendered = authoring.actionControls(action.type, action);
      if (!rendered.supported) { actionInspector.append(node('p', `${rendered.code}: ${rendered.message}`)); return; }
      renderBoundedControls(actionInspector, rendered.controls, 'author-action-edit', (path, value) => {
        authoring.command('edit-action', { stateIndex: Number(stateIndex.value), phase: phase.value, actionIndex, path, value });
      });
      actionInspector.append(
        button('Duplicate action', 'author-action-duplicate', () => { authoring.command('duplicate-action', { stateIndex: Number(stateIndex.value), phase: phase.value, actionIndex }); refreshPanel(renderStoryPanel, 'Duplicated action.'); }),
        button('Delete action', 'author-action-delete', () => { actionSelection = state.map[phase.value].length > 1 ? String(Math.min(actionIndex, state.map[phase.value].length - 2)) : ''; authoring.command('delete-action', { stateIndex: Number(stateIndex.value), phase: phase.value, actionIndex }); refreshPanel(renderStoryPanel, 'Deleted action.', { focusId: 'author-action-existing' }); }),
        button('Move Action Up', 'author-action-up', () => { if (actionIndex > 0) { actionSelection = String(actionIndex - 1); authoring.command('move-action', { stateIndex: Number(stateIndex.value), phase: phase.value, from: actionIndex, to: actionIndex - 1 }); refreshPanel(renderStoryPanel, 'Moved action up.', { focusId: 'author-action-up' }); } }),
        button('Move Action Down', 'author-action-down', () => { if (actionIndex < state.map[phase.value].length - 1) { actionSelection = String(actionIndex + 1); authoring.command('move-action', { stateIndex: Number(stateIndex.value), phase: phase.value, from: actionIndex, to: actionIndex + 1 }); refreshPanel(renderStoryPanel, 'Moved action down.', { focusId: 'author-action-down' }); } })
      );
    }
    actionSelect.addEventListener('change', () => { actionSelection = actionSelect.value; refreshPanel(renderStoryPanel, actionSelection === '' ? 'No action selected.' : `Selected action ${Number(actionSelection) + 1}.`); });
    renderExistingAction();
  }

  function renderCapabilityPanel() {
    const { panel, status } = authoringPanel('Capabilities');
    const ui = inspect('capability', { registry: INSTALLED_CAPABILITY_REGISTRY });
    const existingIds = ui.existingIds();
    const existing = labeled(panel, 'Existing declaration', selectInput('author-capability-existing', [
      ['', existingIds.length ? 'Select capability' : 'No declared capabilities'], ...existingIds.map((item) => [item, item])
    ]));
    const inspectorPanel = node('section', undefined, { className: 'entity-inspector', id: 'author-capability-inspector' });
    panel.append(inspectorPanel);
    existing.addEventListener('change', () => {
      inspectorPanel.replaceChildren();
      if (!existing.value) return;
      const details = ui.details(existing.value);
      inspectorPanel.append(node('h4', details.label), node('p', details.description));
      inspectorPanel.append(node('p', `Dependencies: ${details.requires.join(', ') || 'none'}`));
      const settings = ui.settingsControls(existing.value);
      if (!settings.supported) inspectorPanel.append(node('p', `${settings.code}: ${settings.message}`));
      else if (!settings.controls.length) inspectorPanel.append(node('p', 'No editable settings.'));
      else for (const control of settings.controls.filter(({ readOnly }) => !readOnly)) {
        scalarControl(inspectorPanel, control.path.replace('$.settings.', ''), `author-capability-setting-${control.path.split('.').at(-1)}`, control.value, (value) => control.set(value), {
          type: control.kind === 'checkbox' ? 'checkbox' : control.kind,
          options: control.options
        });
      }
      for (const role of ui.roles(existing.value)) {
        const roleSection = node('section', undefined, { className: 'capability-role' });
        roleSection.append(node('p', `${role.required ? 'Required' : 'Optional'} role: ${role.role}`));
        const bound = Object.entries(draftStore.get('project.json').datasets).find(([, descriptor]) => descriptor.role === role.role)?.[0] ?? '';
        const selector = scalarControl(roleSection, 'Compatible dataset', `author-capability-role-${role.role}`, bound, () => {}, {
          options: [{ value: '', label: 'Unbound' }, ...role.compatibleDatasets.map((value) => ({ value, label: value }))]
        });
        roleSection.append(button('Bind role', `author-capability-bind-${role.role}`, () => {
          try { ui.bindRole(existing.value, role.role, selector.value); setStatus(status, `Bound ${role.role} to ${selector.value}.`); } catch (error) { setStatus(status, '', error); }
        }));
        inspectorPanel.append(roleSection);
      }
      inspectorPanel.append(node('p', `Owned actions: ${details.actions.join(', ') || 'none'}`));
      inspectorPanel.append(node('p', `Owned targets: ${details.targets.join(', ') || 'none'}`));
      inspectorPanel.append(node('p', `Owned metrics: ${details.metrics.join(', ') || 'none'}`));
      inspectorPanel.append(button('Review removal impact', 'author-capability-remove-review', () => {
        const impact = ui.removeImpact(existing.value);
        inspectorPanel.append(node('p', `Required by: ${impact.requiredBy.join(', ') || 'none'}; bound datasets: ${impact.boundDatasets.join(', ') || 'none'}; Story references: ${impact.storyReferences.join(', ') || 'none'}`));
        inspectorPanel.append(button('Confirm remove capability', 'author-capability-remove-confirm', () => {
          ui.command('confirm-remove', existing.value);
          refreshPanel(renderCapabilityPanel, `Removed capability ${existing.value}.`);
        }));
      }));
    });
    const addable = ui.addableIds();
    const add = labeled(panel, 'Add capability', selectInput('author-capability-add-select', [
      ['', addable.length ? 'Select explicitly addable capability' : 'No installed capabilities are explicitly addable'],
      ...addable.map((item) => [item, item])
    ]));
    const addButton = button('Add capability', 'author-capability-add', () => {
      try { ui.command('add', add.value); refreshPanel(renderCapabilityPanel, `Added capability ${add.value}.`); } catch (error) { setStatus(status, `${error.code}: ${error.message}`, error); }
    });
    addButton.disabled = !addable.length;
    panel.append(addButton);
    status.textContent = 'Only descriptors with gui.addable: true can be added.';
  }

  function renderAuthoringNavigation() {
    if (!elements.navigation || !elements.inspector) return;
    elements.navigation.replaceChildren(node('h2', 'Project'));
    const sections = [
      ['project', 'Overview', renderProjectInspector],
      ['attribution', 'Attribution', renderAttributionPanel],
      ['datasets', 'Datasets', renderDatasetPanel],
      ['assets', 'Images', renderAssetPanel],
      ['metrics', 'Metrics', renderMetricPanel],
      ['focus', 'Focus targets', renderFocusPanel],
      ['stories', 'Stories', renderStoryPanel],
      ['capabilities', 'Capabilities', renderCapabilityPanel]
    ];
    for (const [id, label, render] of sections) {
      const button = node('button', label, { type: 'button', className: 'navigation-item', 'data-section': id });
      button.addEventListener('click', () => {
        activeSection = id;
        for (const item of elements.navigation.querySelectorAll?.('.navigation-item') ?? []) {
          item.classList.toggle('is-current', item === button);
          item.removeAttribute('aria-current');
        }
        button.setAttribute('aria-current', 'page');
        render();
      });
      elements.navigation.append(button);
    }
    elements.navigation.querySelector?.('[data-section="project"]')?.click();
  }

  const bridge = createPreviewBridge({
    iframe: elements.iframe,
    origin: windowRef.location.origin,
    windowRef,
    onEvent(event) {
      if (event.type === 'editor-preview:ready') {
        if (!packageStore) elements.previewStatus.textContent = 'Preview ready';
        setViewport(viewportPreset);
      } else if (event.type === 'editor-preview:loaded') {
        elements.iframe.dataset.previewRevision = String(event.revision);
        elements.previewStatus.textContent = `Preview revision ${event.revision}`;
        if (primaryStory().story?.schemaVersion === '1.2') {
          bridge.command('activate-scene', { index: stateSelection, animate: false });
          bridge.command('authoring-mode', { mode: getStudioAuthoringMode() });
        }
      } else if (event.type === 'editor-preview:runtime-error') {
        elements.previewStatus.textContent = 'Preview runtime error';
        elements.paused.hidden = false;
      } else if (event.type === 'editor-preview:camera') {
        previewTelemetry = structuredClone(event.payload);
        if (!renderStudioWorkspace() && activeSection === 'project') renderProjectInspector();
      }
    }
  });

  elements.iframe.src = elements.iframe.dataset.previewSrc;

  function renderDirty() {
    elements.dirtyStatus.textContent = packageStore?.dirty ? 'Unsaved changes' : 'No unsaved changes';
  }

  function buildNavigationIndex() {
    const manifest = draftStore?.get('project.json');
    const records = [{
      packagePath: 'project.json', path: '$', selection: { section: 'project' }, controlId: 'author-project-title'
    }];
    if (!manifest) return createValidationNavigationIndex(records);
    records.push({
      packagePath: 'project.json', path: '$.locale', selection: { section: 'project' }, controlId: 'project-locale'
    });
    for (const [registry, section, controlId] of [
      ['datasets', 'datasets', 'author-dataset-existing'],
      ['assets', 'assets', 'author-asset-existing'],
      ['focusTargets', 'focus', 'author-focus-existing'],
      ['attribution', 'attribution', 'author-attribution-existing']
    ]) {
      for (const id of Object.keys(manifest[registry] ?? {})) records.push({
        packagePath: 'project.json',
        path: `$.${registry}.${id}`,
        selection: { section, entityId: id },
        controlId
      });
    }
    for (const item of manifest.stories?.items ?? []) {
      const packagePath = item.src.replace(/^\.\//, '');
      const story = draftStore.get(packagePath);
      records.push({
        packagePath, path: '$', selection: { section: 'stories', storyId: item.id }, controlId: 'author-story-select'
      });
      for (const [stateIndex, state] of (story?.states ?? []).entries()) {
        records.push({
          packagePath,
          path: `$.states[${stateIndex}]`,
          selection: { section: 'stories', storyId: item.id, stateIndex },
          controlId: 'author-state-index'
        });
        for (const [blockIndex] of (state.content?.blocks ?? []).entries()) records.push({
          packagePath,
          path: `$.states[${stateIndex}].content.blocks[${blockIndex}]`,
          selection: { section: 'stories', storyId: item.id, stateIndex, blockIndex },
          controlId: 'author-block-existing'
        });
        for (const phase of ['enter', 'exit']) {
          for (const [actionIndex] of (state.map?.[phase] ?? []).entries()) records.push({
            packagePath,
            path: `$.states[${stateIndex}].map.${phase}[${actionIndex}]`,
            selection: { section: 'stories', storyId: item.id, stateIndex, phase, actionIndex },
            controlId: 'author-action-existing'
          });
        }
      }
    }
    return createValidationNavigationIndex(records);
  }

  function renderSourceRepair(packagePath) {
    const model = createSourceRepairModel({ packageStore, draftStore, packagePath });
    const { panel, status } = authoringPanel(`Repair ${packagePath}`);
    const textarea = node('textarea', undefined, {
      id: 'source-repair-text',
      spellcheck: 'false',
      'aria-describedby': 'source-repair-help authoring-status',
      'aria-errormessage': 'authoring-status',
      'aria-required': 'true'
    });
    textarea.value = model.text;
    const label = node('label', `Production JSON source for ${packagePath}`);
    label.append(textarea);
    panel.append(label, node('p', 'Repair only this known production JSON file. Tailored controls return when it parses.', { id: 'source-repair-help' }));
    status.textContent = 'JSON syntax must be repaired before tailored controls are available.';
    textarea.addEventListener('input', () => {
      const result = model.replace(textarea.value);
      renderDirty();
      if (!result.parseable) {
        status.textContent = 'JSON syntax is still invalid.';
        return;
      }
      validation?.schedule();
      initializeDraftControls();
      focusControl(packagePath === 'project.json' ? 'project-locale' : 'author-story-select');
    });
    textarea.focus?.();
  }

  function navigateDiagnostic(diagnostic) {
    if (!draftStore.get(diagnostic.packagePath)) {
      renderSourceRepair(diagnostic.packagePath);
      return;
    }
    const target = navigationIndex.resolve(diagnostic);
    if (!target) return;
    const selection = target.selection;
    activeSection = selection.section;
    if (selection.storyId) storySelection = selection.storyId;
    if (Number.isInteger(selection.stateIndex)) stateSelection = selection.stateIndex;
    if (Number.isInteger(selection.blockIndex)) blockSelection = selection.blockIndex;
    if (selection.phase) actionPhaseSelection = selection.phase;
    if (Number.isInteger(selection.actionIndex)) actionSelection = String(selection.actionIndex);
    const navigation = elements.navigation.querySelector?.(`[data-section="${selection.section}"]`);
    navigation?.click();
    const control = documentRef.getElementById(target.controlId);
    if (selection.entityId && control) {
      control.value = selection.entityId;
      control.dispatchEvent?.(new windowRef.Event('change', { bubbles: true }));
    }
    focusControl(target.controlId);
  }

  function renderDiagnostics(items) {
    elements.validationErrors.replaceChildren();
    for (const diagnostic of items) {
      const item = documentRef.createElement('li');
      const control = node('button', `${diagnostic.code} · ${diagnostic.packagePath} ${diagnostic.path}: ${diagnostic.message}`, {
        type: 'button',
        'aria-label': `Open ${diagnostic.code} at ${diagnostic.packagePath} ${diagnostic.path}`
      });
      control.addEventListener('click', () => navigateDiagnostic(diagnostic));
      item.append(control);
      elements.validationErrors.append(item);
    }
    elements.locale.setAttribute('aria-invalid', String(items.some(({ packagePath, path }) => packagePath === 'project.json' && path === '$.locale')));
    elements.heading.setAttribute('aria-invalid', String(items.some(({ packagePath, path }) => packagePath === primaryStoryPath && path.includes('.content'))));
  }

  function handleValidationChange(state) {
    navigationIndex = buildNavigationIndex();
    renderDirty();
    renderDiagnostics(state.diagnostics);
    if (state.status === 'validating') {
      elements.validationStatus.textContent = 'Validating through the production loader…';
      return;
    }
    if (state.status === 'invalid') {
      elements.validationStatus.textContent = state.diagnostics[0]?.path === '$.locale'
        ? 'Invalid project locale.'
        : 'Project draft is invalid.';
      elements.previewStatus.textContent = state.lastValid
        ? `Paused at valid revision ${state.lastValid.revision}`
        : 'Preview paused — no valid revision';
      elements.paused.hidden = false;
      return;
    }
    if (state.status === 'valid' && state.lastValid) {
      elements.validationStatus.textContent = `Valid production project · revision ${state.lastValid.revision}`;
      elements.paused.hidden = true;
      if (state.lastValid.revision !== lastSentRevision) {
        lastSentRevision = state.lastValid.revision;
        bridge.start(state.lastValid);
      }
    }
  }

  function initializeDraftControls() {
    const manifest = draftStore.get('project.json');
    elements.locale.disabled = !manifest;
    elements.validate.disabled = false;
    elements.exportZip.disabled = !manifest;
    elements.save.disabled = !storageAdapter?.capabilities?.writeInPlace;
    elements.save.textContent = storageAdapter?.capabilities?.writeInPlace ? 'Save' : 'Use Export Project ZIP';
    if (!manifest) {
      primaryStoryPath = null;
      elements.heading.disabled = true;
      elements.locale.value = '';
      elements.heading.value = '';
      renderSourceRepair('project.json');
      return false;
    }
    elements.locale.value = manifest.locale ?? '';
    const primary = manifest.stories?.items?.find(({ id }) => id === manifest.stories.primary);
    primaryStoryPath = primary?.src?.replace(/^\.\//, '') ?? null;
    const primaryStory = primaryStoryPath ? draftStore.get(primaryStoryPath) : undefined;
    elements.heading.disabled = !primaryStory;
    elements.heading.value = primaryStory?.states?.[0]?.content?.blocks?.find(({ type }) => type === 'heading')?.text ?? '';
    if (primaryStory?.schemaVersion === '1.2') {
      elements.heading.disabled = true;
      renderStudioWorkspace();
    } else {
      elements.layout?.classList?.remove('is-studio');
      if (elements.studioScenes) elements.studioScenes.hidden = true;
      elements.desktop.hidden = false;
      elements.mobile.hidden = false;
      elements.previewToolbar?.replaceChildren?.(elements.desktop, elements.mobile);
      renderAuthoringNavigation();
    }
    if (primaryStoryPath && !primaryStory) renderSourceRepair(primaryStoryPath);
    return true;
  }

  async function startEntries({ origin, capabilities, entries, adapter = null }) {
    validation?.dispose();
    resetStudioAuthoringSession();
    packageStore = createPackageStore({
      origin,
      entries
    });
    storageAdapter = adapter;
    draftStore = createDraftStore({ packageStore });
    bridge.reset();
    validation = createValidationCoordinator({ draftStore, onChange: handleValidationChange });
    lastSentRevision = -1;
    previewTelemetry = null;
    storySelection = null;
    stateSelection = 0;
    actionPhaseSelection = 'enter';
    blockSelection = 0;
    actionSelection = '';
    if (storageAdapter && !storageAdapter.capabilities && capabilities) {
      storageAdapter = { ...storageAdapter, capabilities };
    }
    initializeDraftControls();
    navigationIndex = buildNavigationIndex();
    renderDirty();
    return validation.validateNow();
  }

  async function newProject() {
    const adapter = createMemoryStorageAdapter({
      label: 'New project',
      entries: createNewProjectEntries({ id: 'new-project', title: 'New project', locale: 'en-US' })
    });
    return openStorage(adapter);
  }

  async function openEntries(entries, { label = 'Memory package' } = {}) {
    return openStorage(createMemoryStorageAdapter({ entries, label }));
  }

  async function openStorage(adapter) {
    const opened = await adapter.open();
    return startEntries({ ...opened, adapter });
  }

  async function openFolder(directoryHandle) {
    let selected = directoryHandle;
    if (!selected) {
      if (!canOpenFolder(windowRef)) throw new TypeError('Folder Open is unavailable in this browser.');
      selected = await windowRef.showDirectoryPicker({ mode: 'readwrite' });
    }
    return openStorage(createFolderStorageAdapter({ directoryHandle: selected }));
  }

  async function importZip(zipBytes, { label = zipBytes?.name ?? 'Imported project.zip' } = {}) {
    return openStorage(createZipStorageAdapter({ zipBytes, label }));
  }

  async function save({ confirmInvalid } = {}) {
    const result = await savePackageChanges({
      adapter: storageAdapter,
      packageStore,
      validation,
      confirmInvalid: confirmInvalid ?? (async () => windowRef.confirm(
        'This project has production validation errors. Save the invalid draft to the selected folder anyway?'
      ))
    });
    renderDirty();
    return result;
  }

  async function exportZip() {
    return exportPackageZip({ packageStore, validation });
  }

  function setViewport(preset) {
    const mobile = preset === 'mobile';
    viewportPreset = mobile ? 'mobile' : 'desktop';
    elements.frame.classList.toggle('preview-frame--desktop', !mobile);
    elements.frame.classList.toggle('preview-frame--mobile', mobile);
    elements.desktop.setAttribute('aria-pressed', String(!mobile));
    elements.mobile.setAttribute('aria-pressed', String(mobile));
    bridge.command('viewport', {
      preset: viewportPreset,
      reducedMotion: Boolean(windowRef.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    });
  }

  elements.newProject.addEventListener('click', () => { void newProject(); });
  elements.openFolder.disabled = !canOpenFolder(windowRef);
  elements.openFolder.addEventListener('click', () => {
    void openFolder().catch((error) => { elements.validationStatus.textContent = error.message; });
  });
  elements.importZip.addEventListener('change', () => {
    const file = elements.importZip.files?.[0];
    if (!file) return;
    void importZip(file, { label: file.name }).catch((error) => {
      elements.validationStatus.textContent = error.message;
    });
  });
  elements.save.addEventListener('click', () => {
    void save().then((result) => {
      const failed = result.failed.length;
      elements.validationStatus.textContent = failed
        ? `Save wrote ${result.written.length} file(s); ${failed} failed; ${result.skipped.length} skipped.`
        : `Saved ${result.written.length} changed file(s).`;
    }).catch((error) => { elements.validationStatus.textContent = error.message; });
  });
  elements.exportZip.addEventListener('click', () => {
    void exportZip().then((zipBytes) => {
      const urlApi = windowRef.URL ?? globalThis.URL;
      const url = urlApi.createObjectURL(new Blob([zipBytes], { type: 'application/zip' }));
      const link = documentRef.createElement('a');
      link.href = url;
      link.download = 'project.zip';
      link.textContent = 'Download project ZIP';
      link.hidden = true;
      documentRef.body.append(link);
      link.click();
      link.remove();
      urlApi.revokeObjectURL(url);
      elements.validationStatus.textContent = 'Exported production project ZIP.';
    }).catch((error) => { elements.validationStatus.textContent = error.message; });
  });
  elements.validate.addEventListener('click', () => { void validation?.validateNow(); });
  elements.heading.addEventListener('input', () => {
    if (!draftStore || !primaryStoryPath) return;
    draftStore.mutate(primaryStoryPath, (story) => {
      const heading = story.states[0].content.blocks.find(({ type }) => type === 'heading');
      if (heading) heading.text = elements.heading.value;
    });
    renderDirty();
  });
  elements.locale.addEventListener('input', () => {
    if (!draftStore) return;
    draftStore.mutate('project.json', (manifest) => { manifest.locale = elements.locale.value; });
    renderDirty();
  });
  elements.desktop.addEventListener('click', () => setViewport('desktop'));
  elements.mobile.addEventListener('click', () => setViewport('mobile'));

  function dispose() {
    validation?.dispose();
    bridge.dispose();
  }

  return {
    newProject,
    openEntries,
    openFolder,
    importZip,
    save,
    exportZip,
    setViewport,
    inspect,
    editStories,
    dispose
  };
}

if (globalThis.document && globalThis.window) {
  globalThis.window.__GUI_EDITOR__ = createEditor();
}
