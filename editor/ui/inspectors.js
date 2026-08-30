const PROJECT_FIELDS = Object.freeze([
  ['schemaVersion', 'Schema version', 'text', true],
  ['id', 'Project ID', 'text', true],
  ['title', 'Title', 'text', false],
  ['subtitle', 'Subtitle', 'text', false],
  ['description', 'Description', 'text', false],
  ['locale', 'Locale', 'text', false],
  ['organization', 'Organization', 'text', false],
  ['author', 'Author', 'text', false],
  ['projectDate', 'Project date', 'date', false],
  ['projectVersion', 'Project version', 'text', false],
  ['map.basemap', 'Basemap', 'text', true],
  ['map.minZoom', 'Minimum zoom', 'number', false],
  ['map.maxZoom', 'Maximum zoom', 'number', false]
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function pathParts(path) {
  return path.split('.');
}

function readPath(value, path) {
  return pathParts(path).reduce((current, part) => current?.[part], value);
}

function writePath(value, path, next) {
  const parts = pathParts(path);
  const field = parts.pop();
  const parent = parts.reduce((current, part) => (current[part] ??= {}), value);
  if (next === undefined || next === '') delete parent[field];
  else parent[field] = next;
}

function numericValue(inputType, value) {
  if (inputType !== 'number' || value === '' || value === undefined) return value;
  return Number(value);
}

function fieldControl({ path, inputType = 'text', readOnly = false, read, write }) {
  return {
    path,
    inputType,
    readOnly,
    get value() { return clone(read()); },
    set(value) {
      if (readOnly) throw new TypeError(`${path} is read-only.`);
      write(numericValue(inputType, value));
    }
  };
}

function requireMutate(mutate) {
  if (typeof mutate !== 'function') throw new TypeError('Inspector command requires a draft mutation function.');
  return mutate;
}

function projectInspector({ manifest, telemetry, mutate }) {
  let pendingCapture = null;
  const controls = new Map(PROJECT_FIELDS.map(([path, , inputType, readOnly]) => [
    path,
    fieldControl({
      path,
      inputType,
      readOnly,
      read: () => readPath(manifest, path),
      write(value) {
        requireMutate(mutate)((draft) => writePath(draft, path, value));
      }
    })
  ]));
  return {
    kind: 'project',
    fields: PROJECT_FIELDS,
    control(path) {
      const result = controls.get(path);
      if (!result) throw new TypeError(`Unknown Project control: ${path}`);
      return result;
    },
    command(name) {
      if (name === 'use-current-view') {
        pendingCapture = capturePreviewView('initial', telemetry);
        return clone(pendingCapture);
      }
      if (name === 'confirm-capture') {
        if (!pendingCapture) throw new TypeError('No captured preview view is awaiting confirmation.');
        const captured = pendingCapture;
        requireMutate(mutate)((draft) => { draft.map.initialView = clone(captured); });
        pendingCapture = null;
        return clone(captured);
      }
      throw new TypeError(`Unknown Project command: ${name}`);
    },
    get pendingCapture() { return clone(pendingCapture); }
  };
}

function attributionReferences(manifest, id) {
  const references = [];
  for (const registry of ['assets', 'datasets']) {
    for (const [entityId, descriptor] of Object.entries(manifest[registry] ?? {})) {
      if (descriptor.attribution?.includes(id)) references.push(`${registry}.${entityId}.attribution`);
    }
  }
  return references.sort();
}

function attributionEntity({ manifest, id, mutate }) {
  const fields = ['id', 'name', 'url', 'license', 'updated', 'notes'];
  return {
    control(path) {
      if (!fields.includes(path)) throw new TypeError(`Unknown attribution control: ${path}`);
      return fieldControl({
        path,
        inputType: path === 'updated' ? 'date' : 'text',
        readOnly: path === 'id',
        read: () => path === 'id' ? id : manifest.attribution[id]?.[path],
        write(value) {
          requireMutate(mutate)((draft) => writePath(draft.attribution[id], path, value));
        }
      });
    },
    command(name, options = {}) {
      if (name === 'add-reference') {
        const { registry, entityId } = options;
        if (!['datasets', 'assets'].includes(registry) || !manifest[registry]?.[entityId]) {
          throw new TypeError('Attribution references require an existing dataset or asset.');
        }
        requireMutate(mutate)((draft) => {
          const references = draft[registry][entityId].attribution ??= [];
          if (!references.includes(id)) references.push(id);
        });
        return;
      }
      if (name === 'remove-reference') {
        const { registry, entityId } = options;
        requireMutate(mutate)((draft) => {
          const descriptor = draft[registry]?.[entityId];
          if (descriptor?.attribution) descriptor.attribution = descriptor.attribution.filter((item) => item !== id);
        });
        return;
      }
      if (name === 'request-delete') {
        const brokenReferences = attributionReferences(manifest, id);
        return { requiresConfirmation: brokenReferences.length > 0, brokenReferences };
      }
      if (name === 'confirm-delete') {
        requireMutate(mutate)((draft) => {
          delete draft.attribution[id];
          for (const registry of ['assets', 'datasets']) {
            for (const descriptor of Object.values(draft[registry] ?? {})) {
              if (descriptor.attribution) descriptor.attribution = descriptor.attribution.filter((item) => item !== id);
            }
          }
        });
        return;
      }
      throw new TypeError(`Unknown attribution command: ${name}`);
    }
  };
}

function attributionInspector({ manifest, mutate }) {
  return {
    kind: 'attribution',
    entity(id) {
      if (!manifest.attribution[id]) throw new TypeError(`Unknown attribution ID: ${id}`);
      return attributionEntity({ manifest, id, mutate });
    },
    command(name, id, value) {
      if (name !== 'add') throw new TypeError(`Unknown attribution command: ${name}`);
      if (manifest.attribution[id]) throw new TypeError(`Attribution ID already exists: ${id}`);
      requireMutate(mutate)((draft) => { draft.attribution[id] = clone(value); });
      return attributionEntity({ manifest, id, mutate });
    }
  };
}

function focusEntity({ manifest, id, mutate }) {
  return {
    control(path) {
      return fieldControl({
        path,
        inputType: path === 'id' || path === 'type' ? 'text' : 'number',
        readOnly: path === 'id',
        read: () => path === 'id' ? id : readPath(manifest.focusTargets[id], path),
        write(value) {
          requireMutate(mutate)((draft) => writePath(draft.focusTargets[id], path, value));
        }
      });
    }
  };
}

function focusInspector({ manifest, telemetry, mutate }) {
  let pendingCapture = null;
  return {
    kind: 'focus',
    entity(id) {
      if (!manifest.focusTargets[id]) throw new TypeError(`Unknown focus target ID: ${id}`);
      return focusEntity({ manifest, id, mutate });
    },
    command(name, id, value) {
      if (name === 'add') {
        if (manifest.focusTargets[id]) throw new TypeError(`Focus target ID already exists: ${id}`);
        requireMutate(mutate)((draft) => { draft.focusTargets[id] = clone(value); });
        return focusEntity({ manifest, id, mutate });
      }
      if (name === 'capture') {
        pendingCapture = capturePreviewView(id, telemetry);
        return clone(pendingCapture);
      }
      if (name === 'confirm-capture') {
        if (!pendingCapture) throw new TypeError('No captured focus target is awaiting confirmation.');
        if (manifest.focusTargets[id]) throw new TypeError(`Focus target ID already exists: ${id}`);
        const captured = pendingCapture;
        requireMutate(mutate)((draft) => { draft.focusTargets[id] = clone(captured); });
        pendingCapture = null;
        return clone(captured);
      }
      throw new TypeError(`Unknown focus command: ${name}`);
    },
    get pendingCapture() { return clone(pendingCapture); }
  };
}

function renderProjectFields(model, { container, documentRef }) {
  if (!container || !documentRef?.createElement) return;
  const section = documentRef.createElement('section');
  section.className = 'tailored-inspector';
  const heading = documentRef.createElement('h3');
  heading.textContent = 'Project settings';
  section.append(heading);
  for (const [path, labelText] of PROJECT_FIELDS) {
    const control = model.control(path);
    const label = documentRef.createElement('label');
    label.textContent = labelText;
    const input = documentRef.createElement('input');
    input.type = control.inputType;
    input.value = control.value ?? '';
    input.readOnly = control.readOnly;
    input.dataset.path = path;
    if (path === 'map.minZoom' || path === 'map.maxZoom') {
      input.min = '0';
      input.max = '24';
      input.step = 'any';
    }
    if (!control.readOnly) input.addEventListener('change', () => control.set(input.value));
    label.append(input);
    section.append(label);
  }
  const capture = documentRef.createElement('button');
  capture.type = 'button';
  capture.textContent = 'Use current preview view';
  const confirm = documentRef.createElement('button');
  confirm.type = 'button';
  confirm.textContent = 'Confirm captured view';
  confirm.hidden = true;
  const captured = documentRef.createElement('output');
  captured.textContent = '';
  capture.addEventListener('click', () => {
    const value = model.command('use-current-view');
    captured.textContent = `Captured center ${value.center.join(', ')}, zoom ${value.zoom}, pitch ${value.pitch}, bearing ${value.bearing}`;
    confirm.hidden = false;
  });
  confirm.addEventListener('click', () => {
    model.command('confirm-capture');
    captured.textContent = 'Captured preview view applied.';
    confirm.hidden = true;
  });
  section.append(capture, confirm, captured);
  container.append(section);
}

export function capturePreviewView(kind, view) {
  if (!view) throw new TypeError('Preview camera telemetry is not available.');
  if (kind === 'initial') {
    return { center: [...view.center], zoom: view.zoom, pitch: view.pitch, bearing: view.bearing };
  }
  if (kind === 'coordinate') {
    return { type: 'coordinate', center: [...view.center], zoom: view.zoom, camera: { pitch: view.pitch, bearing: view.bearing } };
  }
  if (kind === 'bounds') {
    return { type: 'bounds', bounds: clone(view.bounds), camera: { maxZoom: view.zoom } };
  }
  throw new TypeError(`Unknown preview capture kind: ${kind}`);
}

export function renderEntityInspector(options) {
  const { kind, manifest, container, documentRef = globalThis.document } = options;
  if (!manifest) throw new TypeError('Inspector requires a Project manifest.');
  let model;
  if (kind === 'project') model = projectInspector(options);
  else if (kind === 'attribution') model = attributionInspector(options);
  else if (kind === 'focus') model = focusInspector(options);
  else throw new TypeError(`Unknown inspector kind: ${kind}`);
  if (kind === 'project') renderProjectFields(model, { container, documentRef });
  return model;
}
