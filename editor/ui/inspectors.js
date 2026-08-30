import { validateGeoJsonResource, validateMetricFile, validateTableData } from '../../src/project/resource-schemas.js';
import { createEditorDescriptorCatalog, renderSchemaControls } from '../core/descriptors.js';

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
    captureAvailable: telemetry !== null && telemetry !== undefined,
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
        delete manifest.attribution[id];
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
      manifest.attribution[id] = clone(value);
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
        manifest.focusTargets[id] = clone(value);
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
        manifest.focusTargets[id] = clone(captured);
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
    manifest.datasets[id] = clone(descriptor);
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

const IMAGE_EXTENSIONS = Object.freeze({
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp'
});

function storyAssetReferences(stories, assetId) {
  const references = [];
  for (const [storyId, story] of Object.entries(stories ?? {})) {
    for (const [stateIndex, state] of (story.states ?? []).entries()) {
      for (const [blockIndex, block] of (state.content?.blocks ?? []).entries()) {
        const base = `stories.${storyId}.states[${stateIndex}].content.blocks[${blockIndex}]`;
        if (block.type === 'image' && block.asset === assetId) references.push(`${base}.asset`);
        if (block.type === 'legend') {
          for (const [itemIndex, item] of (block.items ?? []).entries()) {
            if (item.sample === 'icon' && item.asset === assetId) references.push(`${base}.items[${itemIndex}].asset`);
          }
        }
      }
    }
  }
  return references;
}

function assetInspector({
  manifest,
  assetBytes = {},
  stories = {},
  mutate,
  writeBinary,
  removeResource,
  urlApi = globalThis.URL
}) {
  const objectUrls = new Map();
  function revoke(id) {
    const url = objectUrls.get(id);
    if (url) urlApi.revokeObjectURL(url);
    objectUrls.delete(id);
  }
  function entity(id) {
    const descriptor = manifest.assets[id];
    if (!descriptor) throw new TypeError(`Unknown asset ID: ${id}`);
    return {
      control(path) {
        if (!['id', 'type', 'src', 'mediaType', 'required', 'attribution'].includes(path)) {
          throw new TypeError(`Unsupported asset control: ${path}`);
        }
        return fieldControl({
          path,
          readOnly: ['id', 'type', 'src', 'mediaType'].includes(path),
          read: () => path === 'id' ? id : descriptor[path],
          write(value) { requireMutate(mutate)((draft) => writePath(draft.assets[id], path, value)); }
        });
      },
      thumbnailUrl() {
        if (objectUrls.has(id)) return objectUrls.get(id);
        const bytes = assetBytes[id];
        if (!(bytes instanceof Uint8Array)) throw new TypeError(`Image bytes are unavailable: ${id}`);
        const url = urlApi.createObjectURL(new Blob([bytes.slice()], { type: descriptor.mediaType }));
        objectUrls.set(id, url);
        return url;
      },
      command(name, value) {
        if (name === 'replace') {
          const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value);
          requireMutate(writeBinary)(descriptor.src.replace(/^\.\//, ''), bytes, { id, kind: 'asset', mediaType: descriptor.mediaType });
          assetBytes[id] = bytes.slice();
          revoke(id);
          return;
        }
        if (name === 'request-delete') {
          const brokenReferences = storyAssetReferences(stories, id);
          return { requiresConfirmation: brokenReferences.length > 0, brokenReferences };
        }
        if (name === 'confirm-delete') {
          const path = descriptor.src.replace(/^\.\//, '');
          requireMutate(mutate)((draft) => { delete draft.assets[id]; });
          requireMutate(removeResource)(path);
          delete assetBytes[id];
          delete manifest.assets[id];
          revoke(id);
          return;
        }
        throw new TypeError(`Unknown asset command: ${name}`);
      }
    };
  }
  return {
    kind: 'asset',
    entity,
    command(name, id, input) {
      if (name !== 'add-image') throw new TypeError(`Unknown asset command: ${name}`);
      assertStableId(id, 'Asset');
      if (manifest.assets[id]) throw new TypeError(`Asset ID already exists: ${id}`);
      const extension = IMAGE_EXTENSIONS[input.mediaType];
      if (!extension) throw new TypeError(`Unsupported image media type: ${input.mediaType}`);
      const descriptor = {
        type: 'image',
        src: `./assets/${id}.${extension}`,
        mediaType: input.mediaType,
        ...(input.required === undefined ? {} : { required: input.required }),
        ...(input.attribution === undefined ? {} : { attribution: clone(input.attribution) })
      };
      const bytes = input.bytes instanceof Uint8Array ? input.bytes.slice() : new Uint8Array(input.bytes);
      requireMutate(writeBinary)(descriptor.src.slice(2), bytes, { id, kind: 'asset', mediaType: descriptor.mediaType });
      assetBytes[id] = bytes.slice();
      requireMutate(mutate)((draft) => { draft.assets[id] = descriptor; });
      manifest.assets[id] = clone(descriptor);
      return entity(id);
    },
    dispose() {
      for (const id of [...objectUrls.keys()]) revoke(id);
    }
  };
}

function metricFormatControls(format) {
  if (format.type === 'decimal') return ['type', 'decimals', 'unit'];
  if (format.type === 'percentage' || format.type === 'distance') return ['type', 'decimals'];
  if (format.type === 'currency') return ['type', 'currency'];
  return ['type'];
}

function metricInspector({ manifest, metricsFile, computed = [], mutate, writeResource }) {
  let current = clone(metricsFile ?? { schemaVersion: '1.0', metrics: {} });
  const computedById = new Map(computed.map((descriptor) => [descriptor.id, clone(descriptor)]));
  function save(candidate) {
    validateMetricFile(candidate);
    current = clone(candidate);
    requireMutate(writeResource)(manifest.metrics?.src?.replace(/^\.\//, '') ?? 'data/metrics.json', current, {
      id: 'metrics', kind: 'metrics', mediaType: 'application/json'
    });
    return clone(current);
  }
  function metric(id) {
    const computedDescriptor = computedById.get(id);
    if (computedDescriptor) return {
      id,
      readOnly: true,
      descriptor: clone(computedDescriptor),
      control(path) {
        return {
          path,
          readOnly: true,
          get value() { return clone(readPath(computedDescriptor, path)); },
          set() { throw new TypeError(`Computed metric ${id} is read-only.`); }
        };
      },
      formatControls: () => metricFormatControls(computedDescriptor.format)
    };
    if (!current.metrics[id]) throw new TypeError(`Unknown metric ID: ${id}`);
    return {
      id,
      readOnly: false,
      control(path) {
        if (!['id', 'label', 'value', 'format.type', 'format.decimals', 'format.unit', 'format.currency', 'attribution'].includes(path)) {
          throw new TypeError(`Unsupported metric control: ${path}`);
        }
        return {
          path,
          readOnly: path === 'id',
          get value() { return path === 'id' ? id : clone(readPath(current.metrics[id], path)); },
          set(value) {
            if (path === 'id') throw new TypeError(`Metric ${id} ID is read-only.`);
            const candidate = clone(current);
            if (path === 'value') candidate.metrics[id].value = clone(value);
            else writePath(candidate.metrics[id], path, value);
            save(candidate);
          }
        };
      },
      formatControls: () => metricFormatControls(current.metrics[id].format)
    };
  }
  return {
    kind: 'metric',
    metric,
    metricOptions: () => [...new Set([...Object.keys(current.metrics), ...computedById.keys()])],
    replaceMetricsFile(value) { current = clone(value); },
    command(name, id, descriptor) {
      if (name !== 'add-static') throw new TypeError(`Unknown metric command: ${name}`);
      assertStableId(id, 'Metric');
      if (current.metrics[id] || computedById.has(id)) throw new TypeError(`Metric ID already exists: ${id}`);
      const candidate = clone(current);
      candidate.metrics[id] = clone(descriptor);
      validateMetricFile(candidate);
      if (!manifest.metrics) {
        requireMutate(mutate)((draft) => { draft.metrics = { src: './data/metrics.json' }; });
        manifest.metrics = { src: './data/metrics.json' };
      }
      save(candidate);
      return metric(id);
    }
  };
}

const IMPLICIT_CAPABILITIES = new Set(['core-content-v1', 'core-map-v1']);

function defaultSchemaValue(schema) {
  if (Object.hasOwn(schema, 'const')) return clone(schema.const);
  if (schema.default !== undefined) return clone(schema.default);
  if (schema.enum?.length) return clone(schema.enum[0]);
  if (schema.type === 'object') {
    return Object.fromEntries(Object.entries(schema.properties ?? {})
      .filter(([key, child]) => (schema.required ?? []).includes(key) || child.default !== undefined || Object.hasOwn(child, 'const'))
      .map(([key, child]) => [key, defaultSchemaValue(child)]));
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 0;
  return '';
}

function storyCapabilityImpact(stories, descriptor) {
  const actionTypes = new Set(descriptor.actions.map(({ type }) => type));
  const metricIds = new Set(descriptor.metrics.map(({ id }) => id));
  const impact = [];
  for (const [storyId, story] of Object.entries(stories ?? {})) {
    for (const [stateIndex, state] of (story.states ?? []).entries()) {
      for (const phase of ['enter', 'exit']) {
        for (const [actionIndex, action] of (state.map?.[phase] ?? []).entries()) {
          if (actionTypes.has(action.type)) impact.push(`stories.${storyId}.states[${stateIndex}].map.${phase}[${actionIndex}]`);
        }
      }
      for (const [blockIndex, block] of (state.content?.blocks ?? []).entries()) {
        if (block.type === 'stat-group' && block.items?.some(({ metric }) => metricIds.has(metric))) {
          impact.push(`stories.${storyId}.states[${stateIndex}].content.blocks[${blockIndex}]`);
        }
      }
    }
  }
  return impact;
}

function capabilityInspector({ manifest, registry, stories = {}, mutate }) {
  const installed = registry.catalog();
  const byId = new Map(installed.map((descriptor) => [descriptor.id, descriptor]));
  const catalog = () => createEditorDescriptorCatalog({ registry, declarations: manifest.capabilities });
  const declared = (id) => manifest.capabilities.find((item) => item.id === id);
  function selectedDescriptors() {
    const ids = new Set([...IMPLICIT_CAPABILITIES, ...manifest.capabilities.map(({ id }) => id)]);
    return installed.filter(({ id }) => ids.has(id));
  }
  function dependencyProblem(id, seen = new Set()) {
    if (seen.has(id)) return `Dependency cycle includes ${id}.`;
    seen.add(id);
    const descriptor = byId.get(id);
    for (const dependency of descriptor?.requires ?? []) {
      if (IMPLICIT_CAPABILITIES.has(dependency) || declared(dependency)) continue;
      const dependencyDescriptor = byId.get(dependency);
      if (!dependencyDescriptor) return `${id} requires missing installed capability ${dependency}.`;
      if (dependencyDescriptor.gui?.addable !== true) return `${id} requires ${dependency}, which is not explicitly addable.`;
      const nested = dependencyProblem(dependency, new Set(seen));
      if (nested) return nested;
    }
    return null;
  }
  function additionsFor(id, result = [], seen = new Set()) {
    if (seen.has(id) || declared(id) || IMPLICIT_CAPABILITIES.has(id)) return result;
    seen.add(id);
    const descriptor = byId.get(id);
    if (!descriptor || descriptor.gui?.addable !== true) {
      const error = Object.assign(new Error(dependencyProblem(id) ?? `${id} is not explicitly addable.`), {
        code: 'GUI_CAPABILITY_DEPENDENCY_UNAVAILABLE'
      });
      throw error;
    }
    for (const dependency of descriptor.requires) additionsFor(dependency, result, seen);
    result.push({ id, settings: defaultSchemaValue(descriptor.settingsSchema) });
    return result;
  }
  return {
    kind: 'capability',
    existingIds: () => manifest.capabilities.map(({ id }) => id),
    addableIds: () => catalog().addable.map(({ id }) => id),
    dependencyExplanation: (id) => dependencyProblem(id),
    details(id) {
      const descriptor = byId.get(id);
      if (!declared(id) || !descriptor) throw new TypeError(`Unknown declared capability: ${id}`);
      return {
        id: descriptor.id,
        label: descriptor.label,
        description: descriptor.description,
        requires: [...descriptor.requires],
        actions: descriptor.actions.map(({ type }) => type),
        targets: descriptor.targets.map(({ id: targetId }) => targetId),
        metrics: descriptor.metrics.map(({ id: metricId }) => metricId)
      };
    },
    settingsControls(id) {
      const declaration = declared(id);
      const descriptor = byId.get(id);
      if (!declaration || !descriptor) throw new TypeError(`Unknown declared capability: ${id}`);
      return renderSchemaControls(descriptor.settingsSchema, {
        value: declaration.settings ?? {},
        path: '$.settings',
        onChange(path, value) {
          const relative = path.replace(/^\$\.settings\.?/, '');
          requireMutate(mutate)((draft) => {
            const target = draft.capabilities.find((item) => item.id === id);
            target.settings ??= {};
            writePath(target.settings, relative, value);
            if (!Object.keys(target.settings).length) delete target.settings;
          });
        }
      });
    },
    settingsControl(id, field) {
      const result = this.settingsControls(id);
      if (!result.supported) return result;
      const control = result.controls.find(({ path }) => path === `$.settings.${field}`);
      if (!control) throw new TypeError(`Unsupported capability setting: ${field}`);
      return control;
    },
    roles(id) {
      const descriptor = byId.get(id);
      if (!descriptor) throw new TypeError(`Unknown capability: ${id}`);
      return descriptor.datasetRoles.map((role) => ({
        ...clone(role),
        compatibleDatasets: Object.entries(manifest.datasets)
          .filter(([, dataset]) => role.types.includes(dataset.type))
          .filter(([, dataset]) => !role.geometry?.length || role.geometry.includes(dataset.geometry))
          .map(([datasetId]) => datasetId)
      }));
    },
    bindRole(id, roleId, datasetId) {
      const role = this.roles(id).find(({ role }) => role === roleId);
      if (!role || !role.compatibleDatasets.includes(datasetId)) throw new TypeError(`Dataset ${datasetId} is incompatible with role ${roleId}.`);
      requireMutate(mutate)((draft) => { draft.datasets[datasetId].role = roleId; });
    },
    discovered() {
      const descriptors = selectedDescriptors();
      return {
        actions: descriptors.flatMap(({ actions }) => actions).map(({ type }) => type),
        targets: descriptors.flatMap(({ targets }) => targets).map(({ id }) => id),
        metrics: descriptors.flatMap(({ metrics }) => metrics).map(({ id }) => id)
      };
    },
    removeImpact(id) {
      const descriptor = byId.get(id);
      if (!declared(id) || !descriptor) throw new TypeError(`Unknown declared capability: ${id}`);
      return {
        requiredBy: manifest.capabilities.filter(({ id: otherId }) => byId.get(otherId)?.requires.includes(id)).map(({ id: otherId }) => otherId),
        boundDatasets: Object.entries(manifest.datasets).filter(([, dataset]) => descriptor.datasetRoles.some(({ role }) => role === dataset.role)).map(([datasetId]) => datasetId),
        storyReferences: storyCapabilityImpact(stories, descriptor)
      };
    },
    command(name, id) {
      if (name === 'add') {
        const problem = dependencyProblem(id);
        if (problem) throw Object.assign(new Error(problem), { code: 'GUI_CAPABILITY_DEPENDENCY_UNAVAILABLE' });
        const additions = additionsFor(id);
        requireMutate(mutate)((draft) => {
          for (const addition of additions) {
            const declaration = { id: addition.id };
            if (Object.keys(addition.settings).length) declaration.settings = addition.settings;
            draft.capabilities.push(declaration);
          }
        });
        for (const addition of additions) if (!declared(addition.id)) {
          manifest.capabilities.push({
            id: addition.id,
            ...(Object.keys(addition.settings).length ? { settings: clone(addition.settings) } : {})
          });
        }
        return additions.map(({ id: addedId }) => addedId);
      }
      if (name === 'confirm-remove') {
        const descriptor = byId.get(id);
        requireMutate(mutate)((draft) => {
          draft.capabilities = draft.capabilities.filter((item) => item.id !== id);
          const roles = new Set(descriptor.datasetRoles.map(({ role }) => role));
          for (const dataset of Object.values(draft.datasets)) if (roles.has(dataset.role)) delete dataset.role;
        });
        manifest.capabilities = manifest.capabilities.filter((item) => item.id !== id);
        const roles = new Set(descriptor.datasetRoles.map(({ role }) => role));
        for (const dataset of Object.values(manifest.datasets)) if (roles.has(dataset.role)) delete dataset.role;
        return;
      }
      throw new TypeError(`Unknown capability command: ${name}`);
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
    input.id = `author-project-${path.replaceAll('.', '-')}`;
    input.value = control.value ?? '';
    input.readOnly = control.readOnly;
    input.required = ['title', 'locale'].includes(path);
    input.setAttribute('aria-required', String(input.required));
    input.setAttribute('aria-describedby', 'validation-status');
    input.setAttribute('aria-errormessage', 'validation-status');
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
  capture.disabled = !model.captureAvailable;
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
  else if (kind === 'asset') model = assetInspector(options);
  else if (kind === 'metric') model = metricInspector(options);
  else if (kind === 'capability') model = capabilityInspector(options);
  else throw new TypeError(`Unknown inspector kind: ${kind}`);
  if (kind === 'project') renderProjectFields(model, { container, documentRef });
  return model;
}
