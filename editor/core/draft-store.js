const decoder = new TextDecoder();
const encoder = new TextEncoder();

function isJsonEntry(entry) {
  return entry.managed && (
    entry.mediaType === 'application/json'
    || entry.mediaType === 'application/geo+json'
    || entry.path.endsWith('.json')
    || entry.path.endsWith('.geojson')
  );
}

function parseEntry(entry) {
  try {
    return { value: JSON.parse(decoder.decode(entry.currentBytes)), diagnostic: null };
  } catch (error) {
    return {
      value: undefined,
      diagnostic: Object.freeze({
        code: 'PACKAGE_JSON_PARSE_ERROR',
        path: '$',
        packagePath: entry.path,
        message: error.message
      })
    };
  }
}

export function createStableId(label, used = []) {
  const base = String(label).toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  const occupied = new Set(used);
  if (!occupied.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) if (!occupied.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
}

export function moveArrayItem(items, fromIndex, toIndex) {
  const next = items.slice();
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)
    || fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length
    || fromIndex === toIndex) return next;
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function createDraftStore({ packageStore }) {
  const values = new Map();
  const parseDiagnostics = new Map();
  const listeners = new Set();

  function refresh(path) {
    const entry = packageStore.get(path);
    if (!entry || !isJsonEntry(entry)) return;
    const parsed = parseEntry(entry);
    if (parsed.diagnostic) {
      values.delete(entry.path);
      parseDiagnostics.set(entry.path, parsed.diagnostic);
    } else {
      values.set(entry.path, parsed.value);
      parseDiagnostics.delete(entry.path);
    }
  }

  for (const entry of packageStore.list()) refresh(entry.path);

  function notify(path) {
    const state = { path, revision: packageStore.revision };
    for (const listener of listeners) listener(state);
  }

  function get(path) {
    const value = values.get(path);
    return value === undefined ? undefined : structuredClone(value);
  }

  function replaceText(path, text) {
    const entry = packageStore.get(path);
    if (!entry || !isJsonEntry(entry)) throw new TypeError(`Unknown JSON package path: ${path}`);
    packageStore.setCurrentBytes(path, encoder.encode(String(text)));
    refresh(path);
    notify(path);
    return get(path);
  }

  function mutate(path, updater) {
    const current = get(path);
    if (current === undefined) throw new TypeError(`Package JSON is not parseable: ${path}`);
    const candidate = structuredClone(current);
    const returned = updater(candidate);
    const next = returned === undefined ? candidate : returned;
    return replaceText(path, `${JSON.stringify(next, null, 2)}\n`);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    get,
    mutate,
    replaceText,
    snapshot: () => packageStore.snapshot(),
    subscribe,
    get revision() { return packageStore.revision; },
    get diagnostics() { return [...parseDiagnostics.values()]; }
  };
}
