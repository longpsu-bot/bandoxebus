import { createDraftStore } from './core/draft-store.js';
import { createNewProjectEntries, createPackageStore } from './core/package-store.js';
import { createValidationCoordinator } from './core/validation.js';
import { createPreviewBridge } from './preview/bridge.js';
import { renderEntityInspector } from './ui/inspectors.js';
import { createStoryEditor } from './ui/story-editor.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';

export function createEditor({
  documentRef = globalThis.document,
  windowRef = globalThis.window
} = {}) {
  const elements = {
    newProject: documentRef.getElementById('new-project'),
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
    mobile: documentRef.getElementById('preview-mobile')
  };
  elements.inspector = documentRef.querySelector?.('.editor-inspector') ?? null;
  elements.navigation = documentRef.querySelector?.('.editor-navigation') ?? null;
  let packageStore = null;
  let draftStore = null;
  let validation = null;
  let lastSentRevision = -1;
  let previewTelemetry = null;
  let primaryStoryPath = null;
  let activeSection = 'project';

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
    return renderEntityInspector({
      kind,
      manifest,
      telemetry: previewTelemetry,
      resources,
      assetBytes,
      stories,
      metricsFile: manifest.metrics ? draftStore.get(manifest.metrics.src.replace(/^\.\//, '')) : undefined,
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
    const selectedIds = new Set(['core-content-v1', 'core-map-v1', ...manifest.capabilities.map(({ id }) => id)]);
    const selectedDescriptors = INSTALLED_CAPABILITY_REGISTRY.catalog().filter(({ id }) => selectedIds.has(id));
    const tables = Object.entries(manifest.datasets)
      .filter(([, descriptor]) => descriptor.type === 'table-json')
      .map(([id, descriptor]) => ({ id, columns: draftStore.get(descriptor.src.replace(/^\.\//, ''))?.columns ?? [] }));
    const metricFile = manifest.metrics ? draftStore.get(manifest.metrics.src.replace(/^\.\//, '')) : null;
    const catalogs = {
      tables,
      assets: Object.keys(manifest.assets).map((id) => ({ id })),
      metrics: [
        ...Object.entries(metricFile?.metrics ?? {}).map(([id, metric]) => ({ id, label: metric.label, format: metric.format })),
        ...selectedDescriptors.flatMap(({ metrics }) => metrics)
      ],
      targets: [...new Set([...Object.keys(manifest.datasets), ...Object.keys(manifest.focusTargets)])].map((id) => ({ id })),
      attribution: Object.keys(manifest.attribution).map((id) => ({ id }))
    };
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
    label.append(control);
    panel.append(label);
    return control;
  }

  function authoringPanel(title) {
    elements.inspector.querySelector?.('.authoring-panel')?.remove();
    const panel = node('section', undefined, { className: 'authoring-panel' });
    panel.append(node('h3', title));
    const status = node('p', '', { role: 'status', 'aria-live': 'polite', className: 'authoring-status' });
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

  function renderDatasetPanel() {
    const { panel, status } = authoringPanel('Datasets');
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
        const ui = inspect('dataset');
        if (type.value === 'table') ui.command('add-table', id.value, { label: label.value, value });
        else {
          ui.command('add-geojson', id.value, { geometry: type.value, label: label.value, value });
          const entity = ui.entity(id.value);
          entity.control('render.type').set(type.value === 'polygon' ? 'fill' : type.value);
          entity.control('render.color').set(color.value.toUpperCase());
          const fields = entity.labelFields();
          if (fields.length) entity.control('render.label').set({ field: fields[0], placement: 'auto' });
        }
        status.textContent = `Added dataset ${id.value}.`;
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderAssetPanel() {
    const { panel, status } = authoringPanel('Images');
    const id = labeled(panel, 'Stable image ID', textInput('author-asset-id'));
    const file = labeled(panel, 'Image file', node('input', undefined, { type: 'file', id: 'author-asset-file' }));
    file.accept = 'image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp';
    const add = node('button', 'Add image', { type: 'button', id: 'author-asset-add' });
    add.addEventListener('click', async () => {
      try {
        const selected = file.files[0];
        inspect('asset').command('add-image', id.value, {
          bytes: new Uint8Array(await selected.arrayBuffer()), mediaType: selected.type
        });
        status.textContent = `Added image ${id.value}.`;
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderMetricPanel() {
    const { panel, status } = authoringPanel('Static metrics');
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
        inspect('metric').command('add-static', id.value, descriptor);
        status.textContent = `Added metric ${id.value}.`;
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderFocusPanel() {
    const { panel, status } = authoringPanel('Focus targets');
    const id = labeled(panel, 'Stable focus ID', textInput('author-focus-id'));
    const datasets = labeled(panel, 'Dataset IDs (comma separated)', textInput('author-focus-datasets'));
    const add = node('button', 'Add dataset focus', { type: 'button', id: 'author-focus-add' });
    add.addEventListener('click', () => {
      try {
        inspect('focus').command('add', id.value, {
          type: 'datasets', datasets: datasets.value.split(',').map((value) => value.trim()).filter(Boolean), camera: { padding: 24 }
        });
        status.textContent = `Added focus ${id.value}.`;
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderAttributionPanel() {
    const { panel, status } = authoringPanel('Attribution');
    const id = labeled(panel, 'Stable source ID', textInput('author-attribution-id'));
    const name = labeled(panel, 'Source name', textInput('author-attribution-name'));
    const url = labeled(panel, 'HTTPS URL', textInput('author-attribution-url'));
    const add = node('button', 'Add attribution', { type: 'button', id: 'author-attribution-add' });
    add.addEventListener('click', () => {
      try {
        inspect('attribution').command('add', id.value, { name: name.value, ...(url.value ? { url: url.value } : {}) });
        status.textContent = `Added attribution ${id.value}.`;
      } catch (error) { status.textContent = error.message; }
    });
    panel.append(add);
  }

  function renderStoryPanel() {
    const { panel, status } = authoringPanel('Story and states');
    const currentManifest = draftStore.get('project.json');
    const primaryId = currentManifest.stories.primary;
    const primaryStory = draftStore.get(currentManifest.stories.items.find(({ id }) => id === primaryId).src.replace(/^\.\//, ''));
    panel.append(node('p', `Primary Story: ${primaryId} · Schema ${primaryStory.schemaVersion}`));
    if (primaryStory.schemaVersion === '1.0') {
      for (const [stateIndex] of primaryStory.states.entries()) {
        for (const action of editStories().story(primaryId).legacyActions(stateIndex)) {
          const control = labeled(panel, `${action.phase} · ${action.type}`, node('input', undefined, { type: 'text', 'data-legacy-action': action.type }));
          control.value = action.parameters;
          control.disabled = true;
          control.readOnly = true;
        }
      }
      status.textContent = 'Story 1.0 legacy action parameters are preserved and read-only.';
      return;
    }
    const stateIndex = labeled(panel, 'State index', node('input', undefined, { type: 'number', id: 'author-state-index' }));
    stateIndex.min = '0'; stateIndex.value = '0';
    const title = labeled(panel, 'New state title', textInput('author-state-title', 'Details'));
    const addState = node('button', 'Add state', { type: 'button', id: 'author-state-add' });
    addState.addEventListener('click', () => {
      try {
        editStories().story(primaryId).command('add-state', { title: title.value });
        status.textContent = 'Added state.';
      } catch (error) { status.textContent = error.message; }
    });
    const blockType = labeled(panel, 'Content block', selectInput('author-block-type', [
      ['table'], ['chart'], ['image'], ['legend'], ['paragraph'], ['callout'], ['stat-group'], ['disclosure'], ['eyebrow'], ['heading']
    ]));
    const addBlock = node('button', 'Add content block', { type: 'button', id: 'author-block-add' });
    addBlock.addEventListener('click', () => {
      try {
        editStories().story(primaryId).authoring().command('add-block', { stateIndex: Number(stateIndex.value), type: blockType.value });
        status.textContent = `Added ${blockType.value} block.`;
      } catch (error) { status.textContent = error.message; }
    });
    const phase = labeled(panel, 'Action phase', selectInput('author-action-phase', [['enter', 'Enter'], ['exit', 'Exit']]));
    const actionType = labeled(panel, 'Map action', selectInput('author-action-type', [
      ['map.focus'], ['map.set-visibility'], ['map.set-emphasis'], ['map.clear-emphasis']
    ]));
    const target = labeled(panel, 'Semantic target ID', textInput('author-action-target'));
    const addAction = node('button', 'Add map action', { type: 'button', id: 'author-action-add' });
    addAction.addEventListener('click', () => {
      try {
        const values = actionType.value === 'map.focus' ? { target: target.value }
          : actionType.value === 'map.set-visibility' ? { target: target.value, visible: true }
            : actionType.value === 'map.set-emphasis' ? { target: target.value, active: true } : {};
        editStories().story(primaryId).authoring().command('add-action', {
          stateIndex: Number(stateIndex.value), phase: phase.value, type: actionType.value, values
        });
        status.textContent = `Added ${actionType.value}.`;
      } catch (error) { status.textContent = error.message; }
    });
    const moveUp = node('button', 'Move state up', { type: 'button', id: 'author-state-up' });
    moveUp.addEventListener('click', () => {
      const from = Number(stateIndex.value);
      if (from > 0) editStories().story(primaryId).command('move-state', { from, to: from - 1 });
    });
    panel.append(addState, addBlock, addAction, moveUp);
  }

  function renderCapabilityPanel() {
    const { panel, status } = authoringPanel('Capabilities');
    const ui = inspect('capability', { registry: INSTALLED_CAPABILITY_REGISTRY });
    panel.append(node('p', `Declared: ${ui.existingIds().join(', ') || 'none'}`));
    panel.append(node('p', `Explicitly addable: ${ui.addableIds().join(', ') || 'none'}`));
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
      } else if (event.type === 'editor-preview:loaded') {
        elements.iframe.dataset.previewRevision = String(event.revision);
        elements.previewStatus.textContent = `Preview revision ${event.revision}`;
      } else if (event.type === 'editor-preview:runtime-error') {
        elements.previewStatus.textContent = 'Preview runtime error';
        elements.paused.hidden = false;
      } else if (event.type === 'editor-preview:camera') {
        previewTelemetry = structuredClone(event.payload);
        if (activeSection === 'project') renderProjectInspector();
      }
    }
  });

  elements.iframe.src = elements.iframe.dataset.previewSrc;

  function renderDirty() {
    elements.dirtyStatus.textContent = packageStore?.dirty ? 'Unsaved changes' : 'No unsaved changes';
  }

  function renderDiagnostics(items) {
    elements.validationErrors.replaceChildren();
    for (const diagnostic of items) {
      const item = documentRef.createElement('li');
      item.textContent = `${diagnostic.packagePath} ${diagnostic.path}: ${diagnostic.message}`;
      elements.validationErrors.append(item);
    }
  }

  function handleValidationChange(state) {
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

  async function startEntries({ origin, entries }) {
    validation?.dispose();
    bridge.reset();
    packageStore = createPackageStore({
      origin,
      entries
    });
    draftStore = createDraftStore({ packageStore });
    validation = createValidationCoordinator({ draftStore, onChange: handleValidationChange });
    lastSentRevision = -1;
    previewTelemetry = null;
    const manifest = draftStore.get('project.json');
    primaryStoryPath = manifest.stories.items.find(({ id }) => id === manifest.stories.primary).src.replace(/^\.\//, '');
    const story = draftStore.get(primaryStoryPath);
    elements.locale.disabled = false;
    elements.heading.disabled = false;
    elements.validate.disabled = false;
    elements.locale.value = manifest.locale;
    elements.heading.value = story.states[0].content.blocks.find(({ type }) => type === 'heading')?.text ?? '';
    renderAuthoringNavigation();
    renderDirty();
    return validation.validateNow();
  }

  async function newProject() {
    return startEntries({
      origin: { kind: 'memory', label: 'New project' },
      entries: createNewProjectEntries({ id: 'new-project', title: 'New project', locale: 'en-US' })
    });
  }

  async function openEntries(entries, { label = 'Memory package' } = {}) {
    return startEntries({ origin: { kind: 'memory', label }, entries });
  }

  function setViewport(preset) {
    const mobile = preset === 'mobile';
    elements.frame.classList.toggle('preview-frame--desktop', !mobile);
    elements.frame.classList.toggle('preview-frame--mobile', mobile);
    elements.desktop.setAttribute('aria-pressed', String(!mobile));
    elements.mobile.setAttribute('aria-pressed', String(mobile));
  }

  elements.newProject.addEventListener('click', () => { void newProject(); });
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

  return { newProject, openEntries, setViewport, inspect, editStories, dispose };
}

const editor = createEditor();
if (globalThis.window) globalThis.window.__GUI_EDITOR__ = editor;
