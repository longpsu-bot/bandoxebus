export const DATA_WORKBENCH_REVIEW_READY_EVENT = 'data-workbench:review-ready';

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`Workbench completion is missing ${label}.`);
  return value;
}

function validCompletion(detail) {
  if (!detail || !Number.isInteger(detail.sessionId) || !Number.isInteger(detail.requestId)) return false;
  return Number.isFinite(detail.receivedAt)
    && Number.isFinite(detail.completedAt)
    && Number.isFinite(detail.postWorkerDurationMs);
}

export function waitForDataWorkbenchReviewReady(eventTarget, {
  sessionId,
  requestId,
  timeoutMs = 30_000,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
} = {}) {
  if (!eventTarget?.addEventListener || !eventTarget?.removeEventListener) {
    throw new TypeError('Benchmark requires a Workbench completion event target.');
  }
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      eventTarget.removeEventListener(DATA_WORKBENCH_REVIEW_READY_EVENT, onReady);
      if (timer !== undefined) clearTimer(timer);
    };
    const onReady = (event) => {
      const detail = event?.detail;
      if (!validCompletion(detail)) return;
      if (sessionId !== undefined && detail.sessionId !== sessionId) return;
      if (requestId !== undefined && detail.requestId !== requestId) return;
      cleanup();
      resolve(Object.freeze({ ...detail }));
    };
    eventTarget.addEventListener(DATA_WORKBENCH_REVIEW_READY_EVENT, onReady);
    timer = setTimer(() => {
      cleanup();
      reject(new Error('Timed out waiting for the matching explicit Workbench completion event.'));
    }, timeoutMs);
  });
}

export function assertPostWorkerGate(completion, maximumMs = 250) {
  const duration = finiteNumber(completion?.postWorkerDurationMs, 'postWorkerDurationMs');
  if (duration > maximumMs) {
    throw new Error(`Complete post-worker main-thread task took ${duration.toFixed(1)} ms; gate is ${maximumMs} ms.`);
  }
  return completion;
}

export async function runDataWorkbenchBenchmark({
  eventTarget,
  startImport,
  sessionId,
  requestId,
  timeoutMs = 30_000,
  now = () => globalThis.performance?.now?.() ?? Date.now()
} = {}) {
  if (typeof startImport !== 'function') throw new TypeError('Benchmark requires startImport().');
  const startedAt = now();
  const completionPromise = waitForDataWorkbenchReviewReady(eventTarget, {
    sessionId, requestId, timeoutMs
  });
  const [, completion] = await Promise.all([
    Promise.resolve().then(startImport),
    completionPromise
  ]);
  const finishedAt = now();
  return Object.freeze({
    ...completion,
    benchmarkStartedAt: startedAt,
    benchmarkFinishedAt: finishedAt,
    reviewReadyWallTimeMs: finishedAt - startedAt
  });
}
