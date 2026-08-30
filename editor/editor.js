import { createDraftStore } from './core/draft-store.js';
import { createNewProjectEntries, createPackageStore } from './core/package-store.js';
import { createValidationCoordinator } from './core/validation.js';
import { createPreviewBridge } from './preview/bridge.js';
import { renderEntityInspector } from './ui/inspectors.js';

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
  let packageStore = null;
  let draftStore = null;
  let validation = null;
  let lastSentRevision = -1;
  let previewTelemetry = null;

  function inspect(kind, options = {}) {
    if (!draftStore || !packageStore) throw new TypeError('Create or open a project before authoring.');
    const manifest = draftStore.get('project.json');
    const resources = Object.fromEntries(Object.entries(manifest.datasets ?? {}).map(([id, descriptor]) => [
      id,
      draftStore.get(descriptor.src.replace(/^\.\//, ''))
    ]));
    return renderEntityInspector({
      kind,
      manifest,
      telemetry: previewTelemetry,
      resources,
      mutate(updater) {
        draftStore.mutate('project.json', updater);
        renderDirty();
      },
      writeResource(path, value, descriptor) {
        const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
        const entry = packageStore.get(path);
        if (entry) packageStore.setCurrentBytes(path, bytes);
        else packageStore.setManaged(path, { ...descriptor, bytes, managed: true });
        validation?.schedule();
        renderDirty();
      },
      ...options
    });
  }

  function renderProjectInspector() {
    if (!draftStore || !elements.inspector) return;
    elements.inspector.querySelector?.('.tailored-inspector')?.remove();
    inspect('project', {
      container: elements.inspector,
      documentRef
    });
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
        renderProjectInspector();
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

  async function newProject() {
    validation?.dispose();
    bridge.reset();
    packageStore = createPackageStore({
      origin: { kind: 'memory', label: 'New project' },
      entries: createNewProjectEntries({ id: 'new-project', title: 'New project', locale: 'en-US' })
    });
    draftStore = createDraftStore({ packageStore });
    validation = createValidationCoordinator({ draftStore, onChange: handleValidationChange });
    lastSentRevision = -1;
    previewTelemetry = null;
    const manifest = draftStore.get('project.json');
    const story = draftStore.get('stories/main.story.json');
    elements.locale.disabled = false;
    elements.heading.disabled = false;
    elements.validate.disabled = false;
    elements.locale.value = manifest.locale;
    elements.heading.value = story.states[0].content.blocks.find(({ type }) => type === 'heading')?.text ?? '';
    renderProjectInspector();
    renderDirty();
    return validation.validateNow();
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
    if (!draftStore) return;
    draftStore.mutate('stories/main.story.json', (story) => {
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

  return { newProject, setViewport, inspect, dispose };
}

createEditor();
