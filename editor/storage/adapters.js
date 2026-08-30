import { collectDeclaredPackageEntries, normalizePackagePath } from '../core/package-store.js';

const decoder = new TextDecoder();

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
      const handle = await getFileHandle(directoryHandle, change.path);
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
