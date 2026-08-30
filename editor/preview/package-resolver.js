const DEFAULT_PACKAGE_ORIGIN = globalThis.location?.origin ?? 'http://localhost';

export function createPackageFetch(snapshot, {
  baseUrl = new URL('/__editor_package__/', DEFAULT_PACKAGE_ORIGIN)
} = {}) {
  const packageBase = new URL(baseUrl);
  const entries = new Map(snapshot.entries.map((entry) => [entry.path, {
    ...entry,
    bytes: entry.bytes.slice()
  }]));
  const manifestUrl = new URL('project.json', packageBase);

  async function fetchImpl(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const signal = init.signal ?? request?.signal;
    signal?.throwIfAborted();
    const url = new URL(request?.url ?? input, packageBase);
    const basePath = packageBase.pathname.endsWith('/') ? packageBase.pathname : `${packageBase.pathname}/`;
    if (url.origin !== packageBase.origin || !url.pathname.startsWith(basePath)) {
      return new Response('Not found', { status: 404 });
    }
    const path = decodeURIComponent(url.pathname.slice(basePath.length));
    const entry = entries.get(path);
    if (!entry) return new Response('Not found', { status: 404 });
    return new Response(entry.bytes.slice(), {
      status: 200,
      headers: { 'content-type': entry.mediaType }
    });
  }

  return { manifestUrl, fetchImpl };
}
