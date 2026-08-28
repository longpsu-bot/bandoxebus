import { ProjectLoadError } from '../project/project-error.js';
import { deepFreeze, validateCapabilityDescriptor } from './descriptor-schema.js';

function entryError(path, message) {
  throw new ProjectLoadError('CAPABILITY_ENTRY_INVALID', path, message);
}

function cloneDescriptor(descriptor) {
  return deepFreeze(structuredClone(descriptor));
}

export function createCapabilityRegistry(entries) {
  if (!Array.isArray(entries)) entryError('$.entries', 'Capability registry entries must be an array.');
  const byId = new Map();
  entries.forEach((entry, index) => {
    const path = `$.entries[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) entryError(path, 'Capability registry entry must be an object.');
    if (typeof entry.createCapability !== 'function') entryError(`${path}.createCapability`, 'Trusted capability factory must be a function.');
    const story10Normalizers = entry.story10Normalizers ?? [];
    if (!Array.isArray(story10Normalizers) || story10Normalizers.some((normalizer) => (
      typeof normalizer?.legacyType !== 'string'
      || typeof normalizer.validate !== 'function'
      || typeof normalizer.normalize !== 'function'
    ))) {
      entryError(`${path}.story10Normalizers`, 'Story 1.0 normalizers must be trusted validator/normalizer entries.');
    }
    const descriptor = validateCapabilityDescriptor(entry.descriptor);
    if (byId.has(descriptor.id)) {
      throw new ProjectLoadError('CAPABILITY_DUPLICATE', `${path}.descriptor.id`, `Duplicate capability ID: ${descriptor.id}.`);
    }
    byId.set(descriptor.id, Object.freeze({
      descriptor: cloneDescriptor(descriptor),
      createCapability: entry.createCapability,
      story10Normalizers: Object.freeze([...story10Normalizers])
    }));
  });

  return Object.freeze({
    ids: Object.freeze([...byId.keys()]),
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    catalog: () => deepFreeze([...byId.values()].map(({ descriptor }) => structuredClone(descriptor)))
  });
}
