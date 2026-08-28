import { ProjectLoadError } from './project-error.js';

function throwIfAborted(signal) {
  signal?.throwIfAborted();
}

function isAbort(error, signal) {
  return signal?.aborted || error?.name === 'AbortError';
}

async function parseJson(response, path, signal) {
  try {
    const value = await response.json();
    throwIfAborted(signal);
    return value;
  } catch (error) {
    if (isAbort(error, signal)) throw signal?.reason ?? error;
    throw new ProjectLoadError('RESOURCE_JSON_INVALID', path, 'Resource contains invalid JSON.', { cause: error });
  }
}

export async function loadJsonResource(url, {
  fetchImpl = fetch,
  signal,
  code = 'RESOURCE_VALIDATION_ERROR',
  path = '$.src',
  validate
} = {}) {
  throwIfAborted(signal);
  let response;
  try {
    response = await fetchImpl(url, { signal });
  } catch (error) {
    if (isAbort(error, signal)) throw signal?.reason ?? error;
    if (error instanceof ProjectLoadError) throw error;
    throw new ProjectLoadError('RESOURCE_FETCH_ERROR', path, 'Resource request failed.', { cause: error });
  }
  throwIfAborted(signal);
  if (!response?.ok) {
    throw new ProjectLoadError('RESOURCE_HTTP_ERROR', path, `Resource request failed (${response?.status ?? 0}).`);
  }
  const value = await parseJson(response, path, signal);
  if (!validate) return value;
  try {
    const validated = await validate(value, { path });
    throwIfAborted(signal);
    return validated;
  } catch (error) {
    if (isAbort(error, signal)) throw signal?.reason ?? error;
    if (error instanceof ProjectLoadError) throw error;
    throw new ProjectLoadError(code, path, 'Resource validation failed.', { cause: error });
  }
}

function createLinkedController(signal) {
  const controller = new AbortController();
  if (!signal) return { controller, cleanup() {} };
  if (signal.aborted) controller.abort(signal.reason);
  const forwardAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', forwardAbort, { once: true });
  return {
    controller,
    cleanup() { signal.removeEventListener('abort', forwardAbort); }
  };
}

export async function loadProjectResources(requests, { fetchImpl = fetch, signal } = {}) {
  const { controller, cleanup } = createLinkedController(signal);
  try {
    throwIfAborted(controller.signal);
    const outcomes = await Promise.all(requests.map(async (request) => {
      try {
        const value = await loadJsonResource(request.url, {
          fetchImpl,
          signal: controller.signal,
          code: request.code,
          path: request.path,
          validate: request.validate
        });
        return { id: request.id, value };
      } catch (error) {
        if (!request.required && !request.referenced && !controller.signal.aborted) {
          return { id: request.id, warning: error };
        }
        if (!controller.signal.aborted) controller.abort(error);
        throw error;
      }
    }));

    const values = new Map();
    const warnings = [];
    for (const outcome of outcomes) {
      if (outcome.warning) warnings.push(outcome.warning);
      else values.set(outcome.id, outcome.value);
    }
    return Object.freeze({ values, warnings: Object.freeze(warnings) });
  } finally {
    cleanup();
  }
}
