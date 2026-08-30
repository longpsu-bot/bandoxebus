import { ProjectLoadError } from '../project/project-error.js';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const ROLE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const ACTION_PATTERN = ROLE_PATTERN;
const DATASET_TYPES = new Set(['geojson', 'table-json']);
const GEOMETRY_TYPES = new Set(['line', 'point', 'polygon', 'mixed']);
const METRIC_VALUE_TYPES = new Set(['string', 'number', 'boolean']);
const LIFECYCLE_NAMES = new Set(['initialize', 'activate', 'reset', 'destroy']);
const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'id',
  'label',
  'description',
  'requires',
  'datasetRoles',
  'actions',
  'content',
  'targets',
  'metrics',
  'legacyActions',
  'lifecycle',
  'settingsSchema',
  'gui'
]);

function fail(path, message) {
  throw new ProjectLoadError('CAPABILITY_DESCRIPTOR_INVALID', path, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isExecutableKey(key) {
  const lower = key.toLowerCase();
  if (['src', 'module', 'script', 'plugin', 'url'].includes(lower)) return true;
  return /(factory|module|script|plugin|src).*url|url.*(factory|module|script|plugin|src)/.test(lower);
}

function assertSerializable(value, path, stack = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'Descriptor numbers must be finite and serializable.');
    return;
  }
  if (typeof value !== 'object') fail(path, 'Descriptor values must be serializable plain data, not functions or undefined values.');
  if (!Array.isArray(value) && !isPlainObject(value)) fail(path, 'Descriptor objects must be serializable plain objects.');
  if (stack.has(value)) fail(path, 'Descriptor values must be serializable and cannot be cyclic.');
  stack.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSerializable(item, `${path}[${index}]`, stack));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (isExecutableKey(key)) fail(`${path}.${key}`, 'Executable module, script, plugin, source, or URL fields are not allowed.');
      assertSerializable(child, `${path}.${key}`, stack);
    }
  }
  stack.delete(value);
}

function requireString(value, path, label) {
  if (typeof value !== 'string' || !value.trim()) fail(path, `${label} must be a non-empty string.`);
}

function requireArray(value, path) {
  if (!Array.isArray(value)) fail(path, 'Value must be an array.');
}

function assertUnique(items, key, path, label) {
  const seen = new Set();
  items.forEach((item, index) => {
    const value = item[key];
    if (seen.has(value)) fail(`${path}[${index}].${key}`, `Duplicate ${label}: ${value}.`);
    seen.add(value);
  });
}

function validateRequires(requires) {
  requireArray(requires, '$.requires');
  const seen = new Set();
  requires.forEach((id, index) => {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) fail(`$.requires[${index}]`, 'Capability dependency ID is invalid.');
    if (seen.has(id)) fail(`$.requires[${index}]`, `Duplicate capability dependency: ${id}.`);
    seen.add(id);
  });
}

function validateDatasetRoles(roles) {
  requireArray(roles, '$.datasetRoles');
  assertUnique(roles, 'role', '$.datasetRoles', 'dataset role');
  roles.forEach((role, index) => {
    const path = `$.datasetRoles[${index}]`;
    if (!isPlainObject(role)) fail(path, 'Dataset role declaration must be an object.');
    if (typeof role.role !== 'string' || !ROLE_PATTERN.test(role.role)) fail(`${path}.role`, 'Dataset role is invalid.');
    requireArray(role.types, `${path}.types`);
    if (!role.types.length) fail(`${path}.types`, 'Dataset role must allow at least one dataset type.');
    role.types.forEach((type, typeIndex) => {
      if (!DATASET_TYPES.has(type)) fail(`${path}.types[${typeIndex}]`, 'Unsupported dataset type declaration.');
    });
    if (role.geometry !== undefined) {
      requireArray(role.geometry, `${path}.geometry`);
      role.geometry.forEach((geometry, geometryIndex) => {
        if (!GEOMETRY_TYPES.has(geometry)) fail(`${path}.geometry[${geometryIndex}]`, 'Unsupported dataset geometry declaration.');
      });
    }
    if (typeof role.required !== 'boolean') fail(`${path}.required`, 'Dataset role required flag must be boolean.');
    if (role.render !== undefined && typeof role.render !== 'boolean') fail(`${path}.render`, 'Dataset role render flag must be boolean.');
  });
}

function validateSchemaFragment(schema, path, canonicalType) {
  if (!isPlainObject(schema) || schema.type !== 'object') fail(path, 'Canonical parameter schema must describe an object.');
  if (schema.additionalProperties !== false) fail(`${path}.additionalProperties`, 'Canonical parameter schemas must set additionalProperties to false.');
  if (!isPlainObject(schema.properties)) fail(`${path}.properties`, 'Canonical parameter schema properties are required.');
  if (canonicalType !== undefined && schema.properties.type?.const !== canonicalType) {
    fail(`${path}.properties.type.const`, 'Schema type constant must match the canonical action type.');
  }
}

function validateActions(actions) {
  requireArray(actions, '$.actions');
  assertUnique(actions, 'type', '$.actions', 'action type');
  actions.forEach((action, index) => {
    const path = `$.actions[${index}]`;
    if (!isPlainObject(action)) fail(path, 'Action descriptor must be an object.');
    if (typeof action.type !== 'string' || !ACTION_PATTERN.test(action.type)) fail(`${path}.type`, 'Canonical action type is invalid.');
    requireString(action.label, `${path}.label`, 'Action label');
    requireString(action.description, `${path}.description`, 'Action description');
    validateSchemaFragment(action.parameters, `${path}.parameters`, action.type);
  });
}

function validateContent(content) {
  requireArray(content, '$.content');
  assertUnique(content, 'type', '$.content', 'content type');
  content.forEach((descriptor, index) => {
    const path = `$.content[${index}]`;
    if (!isPlainObject(descriptor)) fail(path, 'Content descriptor must be an object.');
    if (typeof descriptor.type !== 'string' || !ID_PATTERN.test(descriptor.type)) fail(`${path}.type`, 'Content type is invalid.');
    requireString(descriptor.label, `${path}.label`, 'Content label');
    requireString(descriptor.description, `${path}.description`, 'Content description');
    validateSchemaFragment(descriptor.schema, `${path}.schema`);
  });
}

function validateTargets(targets) {
  requireArray(targets, '$.targets');
  assertUnique(targets, 'id', '$.targets', 'target ID');
  targets.forEach((target, index) => {
    const path = `$.targets[${index}]`;
    if (!isPlainObject(target) || typeof target.id !== 'string' || !ID_PATTERN.test(target.id)) fail(`${path}.id`, 'Target ID is invalid.');
    requireString(target.label, `${path}.label`, 'Target label');
    if (!['focus', 'map'].includes(target.kind)) fail(`${path}.kind`, 'Target kind must be focus or map.');
  });
}

function validateMetrics(metrics) {
  requireArray(metrics, '$.metrics');
  assertUnique(metrics, 'id', '$.metrics', 'metric ID');
  metrics.forEach((metric, index) => {
    const path = `$.metrics[${index}]`;
    if (!isPlainObject(metric) || typeof metric.id !== 'string' || !ID_PATTERN.test(metric.id)) fail(`${path}.id`, 'Metric ID is invalid.');
    requireString(metric.label, `${path}.label`, 'Metric label');
    if (!METRIC_VALUE_TYPES.has(metric.valueType)) fail(`${path}.valueType`, 'Metric value type is invalid.');
    if (!isPlainObject(metric.format) || typeof metric.format.type !== 'string') fail(`${path}.format`, 'Metric format descriptor is invalid.');
  });
}

function validateLegacyActions(actions) {
  requireArray(actions, '$.legacyActions');
  assertUnique(actions, 'type', '$.legacyActions', 'legacy action type');
  actions.forEach((action, index) => {
    const path = `$.legacyActions[${index}]`;
    if (!isPlainObject(action) || typeof action.type !== 'string' || !ACTION_PATTERN.test(action.type)) fail(`${path}.type`, 'Legacy action type is invalid.');
    if (typeof action.canonicalType !== 'string' || !ACTION_PATTERN.test(action.canonicalType)) fail(`${path}.canonicalType`, 'Canonical action type is invalid.');
  });
}

function validateLifecycle(lifecycle) {
  requireArray(lifecycle, '$.lifecycle');
  const seen = new Set();
  lifecycle.forEach((name, index) => {
    if (!LIFECYCLE_NAMES.has(name)) fail(`$.lifecycle[${index}]`, 'Lifecycle declaration is invalid.');
    if (seen.has(name)) fail(`$.lifecycle[${index}]`, `Duplicate lifecycle declaration: ${name}.`);
    seen.add(name);
  });
}

function validateGui(gui) {
  if (gui === undefined) return;
  if (!isPlainObject(gui)) fail('$.gui', 'GUI metadata must be a serializable object.');
  if (gui.addable !== undefined && typeof gui.addable !== 'boolean') {
    fail('$.gui.addable', 'GUI addable metadata must be boolean.');
  }
}

export function validateCapabilityDescriptor(descriptor) {
  assertSerializable(descriptor, '$');
  if (!isPlainObject(descriptor)) fail('$', 'Capability descriptor must be a plain object.');
  for (const key of Object.keys(descriptor)) {
    if (!TOP_LEVEL_FIELDS.has(key)) fail(`$.${key}`, 'Unknown capability descriptor property.');
  }
  if (descriptor.schemaVersion !== '1.0') fail('$.schemaVersion', 'Capability descriptor version must be 1.0.');
  if (typeof descriptor.id !== 'string' || !ID_PATTERN.test(descriptor.id)) fail('$.id', 'Capability ID is invalid.');
  requireString(descriptor.label, '$.label', 'Capability label');
  requireString(descriptor.description, '$.description', 'Capability description');
  validateRequires(descriptor.requires);
  validateDatasetRoles(descriptor.datasetRoles);
  validateActions(descriptor.actions);
  validateContent(descriptor.content);
  validateTargets(descriptor.targets);
  validateMetrics(descriptor.metrics);
  validateLegacyActions(descriptor.legacyActions);
  validateLifecycle(descriptor.lifecycle);
  validateSchemaFragment(descriptor.settingsSchema, '$.settingsSchema');
  validateGui(descriptor.gui);
  return descriptor;
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
