import { validateGeoJsonResource, validateTableData } from '../../src/project/resource-schemas.js';

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

const RENDER_KEYS = Object.freeze({
  line: ['type', 'color', 'width', 'opacity', 'lineStyle', 'label'],
  point: ['type', 'color', 'radius', 'strokeColor', 'strokeWidth', 'label'],
  polygon: ['type', 'color', 'opacity', 'outlineColor', 'outlineWidth', 'label'],
  mixed: []
});

function observedTopLevelProperties(collection) {
  const fields = new Set();
  for (const feature of collection.features) {
    for (const [field, value] of Object.entries(feature.properties ?? {})) {
      if (value !== null && ['string', 'number', 'boolean'].includes(typeof value)) fields.add(field);
    }
  }
  return [...fields].sort();
}

export function importGeoJson(value, descriptor) {
  validateGeoJsonResource(value, descriptor, { path: descriptor.path ?? '$' });
  return {
    value: clone(value),
    observedFields: observedTopLevelProperties(value),
    allowedRenderKeys: [...RENDER_KEYS[descriptor.geometry]]
  };
}

export function importNormalizedTable(value, { path = '$' } = {}) {
  validateTableData(value, { path });
  const copied = clone(value);
  return { value: copied, columns: clone(copied.columns) };
}

function assertStableId(id, label) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new TypeError(`${label} ID must be a stable lowercase ID.`);
}

function compatibleRoles(roleCatalog, descriptor) {
  return roleCatalog
    .filter((role) => role.types?.includes(descriptor.type))
    .filter((role) => !role.geometry?.length || role.geometry.includes(descriptor.geometry))
    .map(({ role }) => role);
}

function tableInputValue(value, type) {
  if (value === '' || value === null || value === undefined) return null;
  if (type === 'integer' || type === 'number') return Number(value);
  return value;
}

function datasetControl({ manifest, id, path, mutate, allowedRenderKeys }) {
  const fullPath = path.startsWith('render.') ? path : path;
  const renderKey = path.startsWith('render.') ? path.slice('render.'.length).split('.')[0] : null;
  if (renderKey && !allowedRenderKeys.includes(renderKey)) return null;
  return fieldControl({
    path,
    inputType: ['width', 'opacity', 'radius', 'strokeWidth', 'outlineWidth', 'minZoom'].some((field) => path.endsWith(field)) ? 'number' : 'text',
    readOnly: path === 'id' || path === 'src' || path === 'type' || path === 'geometry',
    read: () => path === 'id' ? id : readPath(manifest.datasets[id], fullPath),
    write(value) {
      requireMutate(mutate)((draft) => writePath(draft.datasets[id], fullPath, value));
    }
  });
}

function writeValidatedResource({ id, descriptor, value, resources, writeResource }) {
  const path = descriptor.src.replace(/^\.\//, '');
  const mediaType = descriptor.type === 'geojson' ? 'application/geo+json' : 'application/json';
  requireMutate(writeResource)(path, clone(value), { id, kind: 'dataset', mediaType });
  if (resources && typeof resources === 'object') resources[id] = clone(value);
}

function datasetEntity({ manifest, resources, id, mutate, writeResource, roleCatalog }) {
  const descriptor = manifest.datasets[id];
  const geometry = descriptor.geometry ?? 'mixed';
  const allowedRenderKeys = descriptor.type === 'geojson' ? RENDER_KEYS[geometry] : [];
  const resource = () => resources?.[id];
  function saveResource(candidate) {
    if (descriptor.type === 'geojson') validateGeoJsonResource(candidate, descriptor, { path: `$.datasets.${id}` });
    else validateTableData(candidate, { path: `$.datasets.${id}` });
    writeValidatedResource({ id, descriptor, value: candidate, resources, writeResource });
  }
  return {
    control(path) {
      const control = datasetControl({ manifest, id, path, mutate, allowedRenderKeys });
      if (!control) throw new TypeError(`Unsupported dataset control: ${path}`);
      return control;
    },
    hasControl(path) {
      if (['csv', 'formula', 'join', 'pivot', 'geometry', 'defaultVisibility'].includes(path)) return false;
      if (path.startsWith('render.')) return allowedRenderKeys.includes(path.slice(7).split('.')[0]);
      return ['id', 'type', 'src', 'label', 'required', 'role'].includes(path);
    },
    labelFields: () => descriptor.type === 'geojson' ? observedTopLevelProperties(resource()) : [],
    labelPlacements: () => geometry === 'mixed' ? ['auto'] : ['auto', geometry === 'polygon' ? 'centroid' : geometry],
    roleOptions: () => compatibleRoles(roleCatalog, descriptor),
    column(columnId) {
      const column = resource()?.columns?.find(({ id: candidate }) => candidate === columnId);
      if (!column) throw new TypeError(`Unknown table column: ${columnId}`);
      return {
        control(path) {
          if (!['id', 'label', 'type', 'unit'].includes(path)) throw new TypeError(`Unknown column control: ${path}`);
          return fieldControl({
            path,
            readOnly: path === 'id',
            read: () => column[path],
            write(value) {
              const candidate = clone(resource());
              writePath(candidate.columns.find(({ id: candidateId }) => candidateId === columnId), path, value);
              saveResource(candidate);
            }
          });
        }
      };
    },
    command(name, value) {
      if (name === 'replace') {
        const imported = descriptor.type === 'geojson'
          ? importGeoJson(value, { ...descriptor, path: `$.datasets.${id}` }).value
          : importNormalizedTable(value, { path: `$.datasets.${id}` }).value;
        saveResource(imported);
        return imported;
      }
      if (descriptor.type !== 'table-json') throw new TypeError(`Unknown dataset command: ${name}`);
      const candidate = clone(resource());
      if (name === 'add-row') {
        const row = Object.fromEntries(candidate.columns.map((column) => [column.id, tableInputValue(value[column.id], column.type)]));
        candidate.rows.push(row);
      } else if (name === 'edit-cell') {
        const column = candidate.columns.find(({ id: columnId }) => columnId === value.column);
        if (!column || !candidate.rows[value.row]) throw new TypeError('Unknown table cell.');
        candidate.rows[value.row][value.column] = tableInputValue(value.value, column.type);
      } else if (name === 'remove-row') {
        candidate.rows.splice(value, 1);
      } else throw new TypeError(`Unknown dataset command: ${name}`);
      saveResource(candidate);
      return candidate;
    }
  };
}

function datasetInspector({ manifest, resources = {}, mutate, writeResource, roleCatalog = [] }) {
  function add(id, input, type) {
    assertStableId(id, 'Dataset');
    if (manifest.datasets[id]) throw new TypeError(`Dataset ID already exists: ${id}`);
    const src = type === 'geojson' ? `./data/${id}.geojson` : `./data/${id}.json`;
    const descriptor = type === 'geojson'
      ? { type, geometry: input.geometry, src, label: input.label }
      : { type, src, label: input.label };
    const imported = type === 'geojson'
      ? importGeoJson(input.value, { ...descriptor, path: `$.datasets.${id}` }).value
      : importNormalizedTable(input.value, { path: `$.datasets.${id}` }).value;
    writeValidatedResource({ id, descriptor, value: imported, resources, writeResource });
    requireMutate(mutate)((draft) => { draft.datasets[id] = descriptor; });
    return datasetEntity({ manifest, resources, id, mutate, writeResource, roleCatalog });
  }
  return {
    kind: 'dataset',
    entity(id) {
      if (!manifest.datasets[id]) throw new TypeError(`Unknown dataset ID: ${id}`);
      return datasetEntity({ manifest, resources, id, mutate, writeResource, roleCatalog });
    },
    command(name, id, input) {
      if (name === 'add-geojson') return add(id, input, 'geojson');
      if (name === 'add-table') return add(id, input, 'table-json');
      throw new TypeError(`Unknown dataset command: ${name}`);
    }
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
  else if (kind === 'dataset') model = datasetInspector(options);
  else throw new TypeError(`Unknown inspector kind: ${kind}`);
  if (kind === 'project') renderProjectFields(model, { container, documentRef });
  return model;
}
