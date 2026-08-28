import { validateSchema } from '../contracts/schema-validator.js';
import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze } from './descriptor-schema.js';

const IMPLICIT_CORE_IDS = Object.freeze(['core-content-v1', 'core-map-v1']);
const RESERVED_CORE_IDS = new Set(IMPLICIT_CORE_IDS);

function fail(code, path, message) {
  throw new ProjectLoadError(code, path, message);
}

function validateDeclarations(registry, declarations) {
  if (!Array.isArray(declarations)) fail('CAPABILITY_DECLARATION_INVALID', '$.capabilities', 'Capability declarations must be an array.');
  const byId = new Map();
  declarations.forEach((declaration, index) => {
    const path = `$.capabilities[${index}]`;
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      fail('CAPABILITY_DECLARATION_INVALID', path, 'Capability declaration must be an object.');
    }
    for (const key of Object.keys(declaration)) {
      if (!['id', 'settings'].includes(key)) fail('CAPABILITY_DECLARATION_INVALID', `${path}.${key}`, 'Unknown or executable capability declaration field.');
    }
    if (RESERVED_CORE_IDS.has(declaration.id)) {
      fail('CAPABILITY_RESERVED', `${path}.id`, `${declaration.id} is composed implicitly and cannot be declared.`);
    }
    if (!registry.has(declaration.id)) fail('CAPABILITY_UNKNOWN', `${path}.id`, `Unknown capability ID: ${declaration.id}.`);
    if (byId.has(declaration.id)) fail('CAPABILITY_DUPLICATE_DECLARATION', `${path}.id`, `Duplicate capability declaration: ${declaration.id}.`);
    byId.set(declaration.id, { declaration, index });
  });
  return byId;
}

function resolveSelectedEntries(registry, declarationsById) {
  const selectedIds = new Set([...IMPLICIT_CORE_IDS, ...declarationsById.keys()]);
  const byId = new Map();
  for (const id of selectedIds) {
    const entry = registry.get(id);
    if (!entry) {
      const path = RESERVED_CORE_IDS.has(id) ? '$.capabilities' : `$.capabilities.${id}`;
      fail('CAPABILITY_UNKNOWN', path, `Trusted registry does not contain ${id}.`);
    }
    byId.set(id, entry);
  }
  for (const [id, entry] of byId) {
    for (const dependency of entry.descriptor.requires) {
      if (!selectedIds.has(dependency)) {
        fail('CAPABILITY_DEPENDENCY_MISSING', `$.capabilities.${id}.requires`, `${id} requires undeclared capability ${dependency}.`);
      }
    }
  }
  return byId;
}

function topologicalSort(registry, entries) {
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];

  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) fail('CAPABILITY_DEPENDENCY_CYCLE', `$.capabilities.${id}.requires`, `Capability dependency cycle includes ${id}.`);
    visiting.add(id);
    for (const dependency of entries.get(id).descriptor.requires) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(entries.get(id));
  }

  for (const id of IMPLICIT_CORE_IDS) visit(id);
  for (const id of registry.ids) if (entries.has(id) && !RESERVED_CORE_IDS.has(id)) visit(id);
  return Object.freeze(ordered);
}

function validateSettings(ordered, declarationsById) {
  const settings = {};
  for (const entry of ordered) {
    const id = entry.descriptor.id;
    const declared = declarationsById.get(id);
    const value = declared?.declaration.settings ?? {};
    const path = declared ? `$.capabilities[${declared.index}].settings` : `$.implicitCapabilities.${id}.settings`;
    const issues = validateSchema(value, entry.descriptor.settingsSchema, { path });
    if (issues.length) fail('CAPABILITY_SETTINGS_INVALID', issues[0].path, issues[0].message);
    settings[id] = structuredClone(value);
  }
  return deepFreeze(settings);
}

function validateDatasetRoles(ordered, datasets) {
  const roles = [];
  for (const entry of ordered) {
    for (const role of entry.descriptor.datasetRoles) {
      const descriptor = deepFreeze({ capabilityId: entry.descriptor.id, ...structuredClone(role) });
      roles.push(descriptor);
      const matches = Object.entries(datasets).filter(([, dataset]) => dataset.role === role.role);
      if (!matches.length) {
        if (role.required) fail('CAPABILITY_ROLE_MISSING', `$.datasets`, `${entry.descriptor.id} requires dataset role ${role.role}.`);
        continue;
      }
      if (matches.length > 1) fail('CAPABILITY_ROLE_DUPLICATE', '$.datasets', `Dataset role ${role.role} must resolve uniquely.`);
      const [datasetId, dataset] = matches[0];
      const path = `$.datasets.${datasetId}`;
      if (!role.types.includes(dataset.type)) {
        fail('CAPABILITY_ROLE_TYPE_MISMATCH', `${path}.type`, `Dataset role ${role.role} has an incompatible type.`);
      }
      if (role.geometry?.length && !role.geometry.includes(dataset.geometry)) {
        fail('CAPABILITY_ROLE_GEOMETRY_MISMATCH', `${path}.geometry`, `Dataset role ${role.role} has incompatible geometry.`);
      }
    }
  }
  return Object.freeze(roles);
}

function addOwned(target, key, value, code, label) {
  if (Object.hasOwn(target, key)) fail(code, `$.capabilityOwnership.${key}`, `Duplicate ${label} ownership: ${key}.`);
  target[key] = value;
}

function collectOwnership(ordered) {
  const actionDescriptors = {};
  const metricDescriptors = {};
  const targetDescriptors = {};
  const contentDescriptors = {};
  const legacyNormalizers = {};
  const renderResponsibilities = {};

  for (const entry of ordered) {
    const capabilityId = entry.descriptor.id;
    for (const descriptor of entry.descriptor.actions) {
      addOwned(actionDescriptors, descriptor.type, descriptor, 'CAPABILITY_ACTION_COLLISION', 'canonical action');
    }
    for (const descriptor of entry.descriptor.metrics) {
      addOwned(metricDescriptors, descriptor.id, descriptor, 'CAPABILITY_METRIC_COLLISION', 'metric');
    }
    for (const descriptor of entry.descriptor.targets) {
      addOwned(targetDescriptors, descriptor.id, descriptor, 'CAPABILITY_TARGET_COLLISION', 'target');
    }
    for (const descriptor of entry.descriptor.content) {
      addOwned(contentDescriptors, descriptor.type, descriptor, 'CAPABILITY_CONTENT_COLLISION', 'content');
    }
    for (const descriptor of entry.descriptor.legacyActions) {
      addOwned(
        legacyNormalizers,
        descriptor.type,
        deepFreeze({ capabilityId, ...structuredClone(descriptor) }),
        'CAPABILITY_LEGACY_COLLISION',
        'legacy normalizer'
      );
    }
    for (const role of entry.descriptor.datasetRoles.filter(({ render }) => render)) {
      addOwned(renderResponsibilities, role.role, capabilityId, 'CAPABILITY_RENDER_COLLISION', 'render responsibility');
    }
  }

  return {
    actionDescriptors: deepFreeze(actionDescriptors),
    metricDescriptors: deepFreeze(metricDescriptors),
    targetDescriptors: deepFreeze(targetDescriptors),
    contentDescriptors: deepFreeze(contentDescriptors),
    legacyNormalizers: deepFreeze(legacyNormalizers),
    renderResponsibilities: deepFreeze(renderResponsibilities)
  };
}

function createCatalog(ordered, ownership) {
  return deepFreeze({
    capabilities: ordered.map(({ descriptor }) => structuredClone(descriptor)),
    actions: Object.values(ownership.actionDescriptors).map((value) => structuredClone(value)),
    content: Object.values(ownership.contentDescriptors).map((value) => structuredClone(value)),
    metrics: Object.values(ownership.metricDescriptors).map((value) => structuredClone(value)),
    targets: Object.values(ownership.targetDescriptors).map((value) => structuredClone(value))
  });
}

export function composeCapabilities({ registry, declarations = [], datasets = {} }) {
  const declarationsById = validateDeclarations(registry, declarations);
  const selected = resolveSelectedEntries(registry, declarationsById);
  const ordered = topologicalSort(registry, selected);
  const settings = validateSettings(ordered, declarationsById);
  const datasetRoles = validateDatasetRoles(ordered, datasets);
  const ownership = collectOwnership(ordered);

  return deepFreeze({
    ordered,
    cleanup: ordered.toReversed(),
    settings,
    datasetRoles,
    ...ownership,
    catalog: createCatalog(ordered, ownership)
  });
}
