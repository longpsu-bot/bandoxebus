import { bootstrapProject } from './project/bootstrap.js';
import { loadProject } from './project/project-loader.js';

const activeStarts = new WeakMap();

function ownedSignal(owner, parentSignal, replaceExisting) {
  if (!owner) return { signal: parentSignal, cleanup() {} };
  if ((typeof owner !== 'object' && typeof owner !== 'function') || owner === null) {
    throw new TypeError('Application start owner must be an object.');
  }
  if (replaceExisting) {
    activeStarts.get(owner)?.abort(new DOMException('Application start replaced.', 'AbortError'));
  }
  const controller = new AbortController();
  const forward = () => controller.abort(parentSignal.reason);
  if (parentSignal?.aborted) controller.abort(parentSignal.reason);
  else parentSignal?.addEventListener('abort', forward, { once: true });
  activeStarts.set(owner, controller);
  return {
    controller,
    signal: controller.signal,
    cleanup() {
      parentSignal?.removeEventListener('abort', forward);
      if (activeStarts.get(owner) === controller) activeStarts.delete(owner);
    }
  };
}

export async function startApplication({
  manifestUrl = './project.json',
  loadProjectImpl = loadProject,
  bootstrapImpl = bootstrapProject,
  signal,
  owner,
  replaceExisting = false,
  ...context
} = {}) {
  const start = ownedSignal(owner, signal, replaceExisting);
  try {
    const project = await loadProjectImpl(manifestUrl, { ...context, signal: start.signal });
    start.signal?.throwIfAborted();
    return await bootstrapImpl({ ...context, project, signal: start.signal });
  } finally {
    start.cleanup();
  }
}
