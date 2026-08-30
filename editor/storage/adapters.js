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
