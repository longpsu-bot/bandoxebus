import { INSTALLED_CAPABILITY_REGISTRY } from '../../src/capabilities/installed-capabilities.js';
import { loadProject } from '../../src/project/project-loader.js';
import { createPackageFetch } from '../preview/package-resolver.js';

const decoder = new TextDecoder();

function deepFreeze(value) {
  if (ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function toProductionDiagnostic(error, {
  packagePath = error?.packagePath ?? 'project.json',
  revision
} = {}) {
  return Object.freeze({
    code: error?.code ?? 'PROJECT_LOAD_FAILED',
    path: error?.path ?? '$',
    message: error?.message ?? String(error),
    packagePath,
    revision
  });
}

function isPathPrefix(prefix, path) {
  return prefix === '$'
    || path === prefix
    || path.startsWith(`${prefix}.`)
    || path.startsWith(`${prefix}[`);
}

export function createValidationNavigationIndex(records = []) {
  const entries = records.map(({ packagePath, path, selection, controlId }) => Object.freeze({
    packagePath,
    path,
    selection: structuredClone(selection),
    controlId
  })).sort((left, right) => right.path.length - left.path.length);
  return Object.freeze({
    resolve(diagnostic) {
      const match = entries.find((entry) => (
        entry.packagePath === diagnostic.packagePath
        && isPathPrefix(entry.path, diagnostic.path)
      ));
      return match ? {
        selection: structuredClone(match.selection),
        controlId: match.controlId
      } : null;
    }
  });
}

export function createSourceRepairModel({ packageStore, draftStore, packagePath }) {
  const entry = packageStore.get(packagePath);
  if (!entry?.managed || !(
    entry.mediaType === 'application/json'
    || entry.mediaType === 'application/geo+json'
    || entry.path.endsWith('.json')
    || entry.path.endsWith('.geojson')
  )) {
    throw new TypeError(`Source repair requires a known managed JSON file: ${packagePath}`);
  }
  return Object.freeze({
    get text() { return decoder.decode(packageStore.get(packagePath).currentBytes); },
    get parseable() { return draftStore.get(packagePath) !== undefined; },
    replace(text) {
      const value = draftStore.replaceText(packagePath, text);
      return { parseable: value !== undefined, value };
    }
  });
}

export function createValidationCoordinator({
  draftStore,
  capabilityRegistry = INSTALLED_CAPABILITY_REGISTRY,
  loadProjectImpl = loadProject,
  debounceMs = 250,
  onChange = () => {}
}) {
  let status = 'idle';
  let diagnostics = Object.freeze([]);
  let lastValid = null;
  let activeController = null;
  let timer = null;
  let currentToken = 0;
  let disposed = false;

  function state() {
    return Object.freeze({ status, diagnostics, lastValid });
  }

  function announce() {
    onChange(state());
  }

  function abortActive() {
    if (activeController && !activeController.signal.aborted) {
      activeController.abort(new DOMException('Validation replaced.', 'AbortError'));
    }
    activeController = null;
  }

  async function run(revision, token) {
    if (disposed || token !== currentToken) return;
    abortActive();
    const controller = new AbortController();
    activeController = controller;
    const snapshot = structuredClone(draftStore.snapshot());
    const { manifestUrl, fetchImpl } = createPackageFetch(snapshot);
    status = 'validating';
    announce();
    try {
      const project = await loadProjectImpl(manifestUrl, {
        fetchImpl,
        capabilityRegistry,
        signal: controller.signal
      });
      if (controller.signal.aborted || disposed || token !== currentToken || revision !== draftStore.revision) return;
      const parseDiagnostics = draftStore.diagnostics ?? [];
      if (parseDiagnostics.length) {
        diagnostics = Object.freeze(parseDiagnostics.map((diagnostic) => Object.freeze({ ...diagnostic, revision })));
        status = 'invalid';
      } else {
        lastValid = Object.freeze({ revision, snapshot: deepFreeze(snapshot), project });
        diagnostics = Object.freeze([]);
        status = 'valid';
      }
    } catch (error) {
      if (controller.signal.aborted || disposed || token !== currentToken || revision !== draftStore.revision) return;
      const parseDiagnostics = (draftStore.diagnostics ?? [])
        .map((diagnostic) => Object.freeze({ ...diagnostic, revision }));
      diagnostics = Object.freeze([
        ...parseDiagnostics,
        toProductionDiagnostic(error, { revision })
      ]);
      status = 'invalid';
    } finally {
      if (activeController === controller) activeController = null;
    }
    announce();
  }

  function schedule() {
    if (disposed) return;
    if (timer !== null) clearTimeout(timer);
    abortActive();
    const token = ++currentToken;
    const revision = draftStore.revision;
    timer = setTimeout(() => {
      timer = null;
      void run(revision, token);
    }, debounceMs);
  }

  function validateNow() {
    if (disposed) return Promise.resolve();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    abortActive();
    const token = ++currentToken;
    return run(draftStore.revision, token);
  }

  const unsubscribe = draftStore.subscribe(schedule);

  function dispose() {
    if (disposed) return;
    disposed = true;
    currentToken += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    abortActive();
    unsubscribe();
  }

  return {
    schedule,
    validateNow,
    dispose,
    get status() { return status; },
    get diagnostics() { return diagnostics; },
    get lastValid() { return lastValid; }
  };
}
