import { resolvePackageUrl } from '../../src/project/path-resolver.js';
import { createBlankMapStoryTemplate } from './templates.js';

const encoder = new TextEncoder();
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const DRIVE_PREFIX = /^[A-Za-z]:[\\/]/;

function bytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (typeof value === 'string') return encoder.encode(value);
  throw new TypeError('Package entry bytes must be a Uint8Array, ArrayBuffer, or string.');
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function invalidPath(message) {
  throw new TypeError(`Invalid package path: ${message}`);
}

export function normalizePackagePath(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value) invalidPath('expected a non-empty relative string.');
  let decoded = value;
  try {
    for (let index = 0; index < 4; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    invalidPath('invalid percent encoding.');
  }
  while (decoded.startsWith('./')) decoded = decoded.slice(2);
  if (!decoded || decoded.startsWith('/') || decoded.startsWith('\\') || decoded.includes('\\')) invalidPath('absolute paths and backslashes are not allowed.');
  if (URL_SCHEME.test(decoded) || DRIVE_PREFIX.test(decoded)) invalidPath('URL schemes and drive paths are not allowed.');
  if (decoded.includes('?') || decoded.includes('#')) invalidPath('queries and fragments are not allowed.');
  const segments = decoded.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) invalidPath('empty, dot, and traversal segments are not allowed.');
  return segments.join('/');
}

function descriptorFromUrl(src, kind, mediaType) {
  const url = resolvePackageUrl('https://package.invalid/project.json', src, { kind });
  return { path: normalizePackagePath(url.pathname.slice(1)), kind, mediaType };
}

export function collectDeclaredPackageEntries(manifest) {
  const entries = [];
  for (const story of manifest.stories?.items ?? []) {
    entries.push(descriptorFromUrl(story.src, 'story', 'application/json'));
  }
  for (const descriptor of Object.values(manifest.datasets ?? {})) {
    const mediaType = descriptor.type === 'geojson' ? 'application/geo+json' : 'application/json';
    entries.push(descriptorFromUrl(descriptor.src, 'dataset', mediaType));
  }
  for (const descriptor of Object.values(manifest.assets ?? {})) {
    entries.push(descriptorFromUrl(descriptor.src, 'asset', descriptor.mediaType));
  }
  if (manifest.metrics) entries.push(descriptorFromUrl(manifest.metrics.src, 'metrics', 'application/json'));
  return entries;
}

export function createNewProjectEntries({
  id = 'untitled-project',
  title = 'Untitled project',
  locale = 'en-US'
} = {}) {
  return createBlankMapStoryTemplate({ id, title, locale });
}

export function createPackageStore({ origin, entries = [] }) {
  const records = new Map();
  let revision = 0;

  for (const input of entries) {
    const path = normalizePackagePath(input.path);
    if (records.has(path)) throw new TypeError(`Duplicate package path: ${path}`);
    if (input.file !== undefined) {
      if (['bytes', 'originalBytes', 'currentBytes'].some((key) => input[key] !== undefined)
        || input.mediaType !== 'application/vnd.pmtiles' || input.kind !== 'asset'
        || input.managed === false || !(input.file instanceof File)
        || !Number.isFinite(input.file.size) || input.file.size < 0) {
        throw new TypeError('Lazy file-backed package entries must be managed PMTiles assets without byte fields.');
      }
      records.set(path, {
        path,
        file: input.file,
        byteLength: input.file.size,
        mediaType: input.mediaType,
        kind: input.kind,
        managed: true,
        persisted: true
      });
      continue;
    }
    const originalBytes = bytes(input.originalBytes ?? input.currentBytes ?? input.bytes);
    const currentBytes = bytes(input.currentBytes ?? input.bytes ?? originalBytes);
    records.set(path, {
      path,
      originalBytes,
      currentBytes,
      mediaType: input.mediaType ?? 'application/octet-stream',
      kind: input.kind ?? 'resource',
      managed: input.managed !== false,
      persisted: true
    });
  }

  function get(path) {
    return records.get(normalizePackagePath(path));
  }

  function list() {
    return [...records.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  function setCurrentBytes(path, value) {
    const entry = get(path);
    if (!entry) throw new TypeError(`Unknown package path: ${path}`);
    if (entry.file) throw new TypeError('Cannot edit bytes of a lazy file-backed PMTiles entry.');
    const next = bytes(value);
    if (!equalBytes(entry.currentBytes, next)) {
      entry.currentBytes = next;
      revision += 1;
    }
    return entry;
  }

  function setManaged(path, descriptor = {}) {
    const normalized = normalizePackagePath(path);
    const existing = records.get(normalized);
    if (existing) {
      const persisted = existing.persisted;
      existing.managed = true;
      Object.assign(existing, descriptor, { path: normalized, managed: true });
      existing.persisted = persisted;
      revision += 1;
      return existing;
    }
    const entryBytes = bytes(descriptor.bytes ?? new Uint8Array());
    const entry = {
      path: normalized,
      originalBytes: entryBytes.slice(),
      currentBytes: entryBytes.slice(),
      mediaType: descriptor.mediaType ?? 'application/octet-stream',
      kind: descriptor.kind ?? 'resource',
      managed: true,
      persisted: false
    };
    records.set(normalized, entry);
    revision += 1;
    return entry;
  }

  function removeManaged(path) {
    const normalized = normalizePackagePath(path);
    const entry = records.get(normalized);
    if (!entry?.managed) return false;
    if (origin?.kind === 'zip') entry.managed = false;
    else records.delete(normalized);
    revision += 1;
    return true;
  }

  function snapshot({ managedOnly = true } = {}) {
    return {
      revision,
      entries: list()
        .filter((entry) => !managedOnly || entry.managed)
        .map((entry) => ({
          path: entry.path,
          ...(entry.file ? { file: entry.file } : { bytes: entry.currentBytes.slice() }),
          mediaType: entry.mediaType,
          kind: entry.kind
        }))
    };
  }

  function changeSet() {
    return list().filter((entry) => !entry.persisted
      || (!entry.file && !equalBytes(entry.originalBytes, entry.currentBytes)));
  }

  function markWritten(paths) {
    for (const path of paths) {
      const entry = records.get(normalizePackagePath(path));
      if (entry && !entry.file) {
        entry.originalBytes = entry.currentBytes.slice();
        entry.persisted = true;
      }
    }
  }

  return {
    origin: origin?.kind === 'folder' ? { ...origin } : structuredClone(origin),
    get,
    list,
    setCurrentBytes,
    setManaged,
    removeManaged,
    snapshot,
    changeSet,
    markWritten,
    get revision() { return revision; },
    get dirty() { return changeSet().length > 0; }
  };
}
