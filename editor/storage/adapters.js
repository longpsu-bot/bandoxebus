import { collectDeclaredPackageEntries, normalizePackagePath } from '../core/package-store.js';
import { Unzip, UnzipInflate, zipSync } from '../../vendor/fflate/0.8.3/fflate.esm.js';

const decoder = new TextDecoder();
const ZIP_MAX_ENTRIES = 2048;
const ZIP_MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

// Vendored from the official fflate@0.8.3 npm package (esm/browser.js, MIT).
export const FFLATE_VENDOR_VERSION = '0.8.3';

function cloneEntries(entries) {
  return entries.map((entry) => ({
    ...entry,
    bytes: entry.bytes?.slice(),
    originalBytes: entry.originalBytes?.slice(),
    currentBytes: entry.currentBytes?.slice()
  }));
}

export function createMemoryStorageAdapter({ entries = [], label = 'New project' } = {}) {
  const storedEntries = cloneEntries(entries);
  const origin = Object.freeze({ kind: 'memory', label });
  const capabilities = Object.freeze({ writeInPlace: false, exportZip: true });
  return Object.freeze({
    origin,
    capabilities,
    async open() {
      return { origin: { ...origin }, capabilities, entries: cloneEntries(storedEntries) };
    }
  });
}

export const MemoryStorageAdapter = createMemoryStorageAdapter;

export const canOpenFolder = (windowRef = globalThis.window) => (
  typeof windowRef?.showDirectoryPicker === 'function'
);

function folderOrigin(directoryHandle, label) {
  return Object.freeze({ kind: 'folder', label, directoryHandle });
}

function describeFolderOrigin(label) {
  return Object.freeze({ kind: 'folder', label });
}

async function getFileHandle(directoryHandle, path) {
  const segments = normalizePackagePath(path).split('/');
  const filename = segments.pop();
  let directory = directoryHandle;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create: false });
  }
  return directory.getFileHandle(filename, { create: false });
}

async function getWritableFileHandle(directoryHandle, path) {
  const segments = normalizePackagePath(path).split('/');
  const filename = segments.pop();
  let directory = directoryHandle;
  for (const segment of segments) {
    try {
      directory = await directory.getDirectoryHandle(segment, { create: false });
    } catch (error) {
      if (error?.name !== 'NotFoundError') throw error;
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
  }
  try {
    return await directory.getFileHandle(filename, { create: false });
  } catch (error) {
    if (error?.name !== 'NotFoundError') throw error;
    return directory.getFileHandle(filename, { create: true });
  }
}

async function readEntry(directoryHandle, descriptor) {
  const handle = await getFileHandle(directoryHandle, descriptor.path);
  const file = await handle.getFile();
  return {
    ...descriptor,
    bytes: new Uint8Array(await file.arrayBuffer()),
    managed: true
  };
}

function errorMessage(error) {
  return error instanceof Error || typeof error?.message === 'string'
    ? error.message
    : String(error);
}

export function createFolderStorageAdapter({
  directoryHandle,
  label = directoryHandle?.name ?? 'Project folder'
} = {}) {
  if (!directoryHandle) throw new TypeError('A directory handle is required.');
  const origin = folderOrigin(directoryHandle, label);
  const describedOrigin = describeFolderOrigin(label);
  const capabilities = Object.freeze({ writeInPlace: true, exportZip: true });

  async function open() {
    const manifestEntry = await readEntry(directoryHandle, {
      path: 'project.json',
      mediaType: 'application/json',
      kind: 'manifest'
    });
    let declared = [];
    try {
      declared = collectDeclaredPackageEntries(JSON.parse(decoder.decode(manifestEntry.bytes)));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const entries = [manifestEntry];
    const seen = new Set(['project.json']);
    for (const descriptor of declared) {
      if (seen.has(descriptor.path)) continue;
      seen.add(descriptor.path);
      try {
        entries.push(await readEntry(directoryHandle, descriptor));
      } catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
    }
    return { origin, capabilities, entries };
  }

  async function writeOne(change, result) {
    try {
      const handle = await getWritableFileHandle(directoryHandle, change.path);
      const writable = await handle.createWritable();
      await writable.write(change.currentBytes);
      await writable.close();
      result.written.push(change.path);
    } catch (error) {
      result.failed.push({ path: change.path, message: errorMessage(error) });
    }
  }

  async function writeChanges(changeSet) {
    const changes = [...changeSet].filter(({ managed }) => managed !== false);
    const resources = changes
      .filter(({ path }) => path !== 'project.json')
      .sort((left, right) => left.path.localeCompare(right.path));
    const manifest = changes.find(({ path }) => path === 'project.json');
    const result = { written: [], failed: [], skipped: [] };
    for (const change of resources) await writeOne(change, result);
    if (result.failed.length) {
      result.skipped.push('project.json');
    } else if (manifest) {
      await writeOne(manifest, result);
    }
    return result;
  }

  return Object.freeze({
    origin,
    capabilities,
    open,
    writeChanges,
    describeOrigin() { return { ...describedOrigin }; }
  });
}

export const FolderStorageAdapter = createFolderStorageAdapter;

function concatChunks(chunks, length) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function zipInputBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
  throw new TypeError('ZIP input must be a Uint8Array, ArrayBuffer, or Blob.');
}

function readZipEntries(archiveBytes) {
  const staged = [];
  const seen = new Set();
  let entryCount = 0;
  let totalBytes = 0;
  const unzip = new Unzip((file) => {
    entryCount += 1;
    if (entryCount > ZIP_MAX_ENTRIES) {
      throw new TypeError(`ZIP package exceeds the security ceiling of ${ZIP_MAX_ENTRIES} entries.`);
    }
    const path = normalizePackagePath(file.name);
    if (seen.has(path)) throw new TypeError(`Duplicate normalized package path: ${path}`);
    seen.add(path);
    if (file.originalSize > ZIP_MAX_ENTRY_BYTES) {
      throw new TypeError(`ZIP entry exceeds the 64 MiB decompressed ceiling: ${path}`);
    }
    const chunks = [];
    let entryBytes = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      entryBytes += chunk.length;
      totalBytes += chunk.length;
      if (entryBytes > ZIP_MAX_ENTRY_BYTES) {
        throw new TypeError(`ZIP entry exceeds the 64 MiB decompressed ceiling: ${path}`);
      }
      if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
        throw new TypeError('ZIP package exceeds the 256 MiB total decompressed ceiling.');
      }
      chunks.push(chunk.slice());
      if (final) staged.push({ path, bytes: concatChunks(chunks, entryBytes) });
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(archiveBytes, true);
  return staged;
}

function classifyZipEntries(staged) {
  const byPath = new Map(staged.map((entry) => [entry.path, entry]));
  const manifestEntry = byPath.get('project.json');
  if (!manifestEntry) throw new TypeError('ZIP package requires root project.json.');
  let declared = [];
  try {
    declared = collectDeclaredPackageEntries(JSON.parse(decoder.decode(manifestEntry.bytes)));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const descriptors = new Map([
    ['project.json', { kind: 'manifest', mediaType: 'application/json' }],
    ...declared.map((descriptor) => [descriptor.path, descriptor])
  ]);
  return staged.map((entry) => {
    const descriptor = descriptors.get(entry.path);
    return descriptor
      ? { ...entry, ...descriptor, managed: true }
      : { ...entry, kind: 'pass-through', mediaType: 'application/octet-stream', managed: false };
  });
}

function isPrivateExportPath(path) {
  return path === 'editor-state.json'
    || /^(?:editor|src|scripts|tests|review|vendor)\//.test(path);
}

export function exportProjectPackageZip(packageStore) {
  const includePassThrough = packageStore.origin?.kind === 'zip';
  const staged = Object.create(null);
  for (const entry of packageStore.list()) {
    if ((!entry.managed && !includePassThrough) || isPrivateExportPath(entry.path)) continue;
    staged[entry.path] = entry.currentBytes.slice();
  }
  if (!Object.hasOwn(staged, 'project.json')) {
    throw new TypeError('Project ZIP export requires root project.json.');
  }
  return zipSync(staged, { level: 6 });
}

export function createZipStorageAdapter({ zipBytes, label = 'Project ZIP' } = {}) {
  const origin = Object.freeze({ kind: 'zip', label });
  const capabilities = Object.freeze({ writeInPlace: false, exportZip: true });
  return Object.freeze({
    origin,
    capabilities,
    async open() {
      const entries = classifyZipEntries(readZipEntries(await zipInputBytes(zipBytes)));
      return { origin: { ...origin }, capabilities, entries };
    },
    async export(packageStore) {
      return exportProjectPackageZip(packageStore);
    },
    describeOrigin() { return { ...origin }; }
  });
}

export const ZipStorageAdapter = createZipStorageAdapter;
