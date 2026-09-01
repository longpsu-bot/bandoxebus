import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function benchmarkModule() {
  try {
    return await import('../scripts/map-story-studio-data-workbench-benchmark.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  }
}

function reviewReady(detail) {
  const event = new Event('data-workbench:review-ready');
  Object.defineProperty(event, 'detail', { value: detail });
  return event;
}

test('benchmark waits for the matching explicit Workbench completion event', async () => {
  const { waitForDataWorkbenchReviewReady } = await benchmarkModule();
  assert.equal(typeof waitForDataWorkbenchReviewReady, 'function');
  const target = new EventTarget();
  const waiting = waitForDataWorkbenchReviewReady(target, { sessionId: 4, requestId: 7, timeoutMs: 1000 });
  target.dispatchEvent(reviewReady({ sessionId: 99, requestId: 7, postWorkerDurationMs: 1 }));
  target.dispatchEvent(reviewReady({
    sessionId: 4, requestId: 7, receivedAt: 100, completedAt: 220, postWorkerDurationMs: 120
  }));
  assert.deepEqual(await waiting, {
    sessionId: 4, requestId: 7, receivedAt: 100, completedAt: 220, postWorkerDurationMs: 120
  });
});

test('benchmark listener is installed before import starts and enforces the complete 250 ms gate', async () => {
  const { runDataWorkbenchBenchmark, assertPostWorkerGate } = await benchmarkModule();
  assert.equal(typeof runDataWorkbenchBenchmark, 'function');
  const target = new EventTarget();
  const result = await runDataWorkbenchBenchmark({
    eventTarget: target,
    sessionId: 8,
    requestId: 3,
    startImport() {
      target.dispatchEvent(reviewReady({
        sessionId: 8, requestId: 3, receivedAt: 20, completedAt: 249, postWorkerDurationMs: 229
      }));
    }
  });
  assert.equal(result.postWorkerDurationMs, 229);
  assert.doesNotThrow(() => assertPostWorkerGate(result, 250));
  assert.throws(() => assertPostWorkerGate({ ...result, postWorkerDurationMs: 251 }, 250), /complete post-worker.*251.*250/i);
});

test('benchmark fails closed on missing explicit completion and contains no DOM polling fallback', async () => {
  const { waitForDataWorkbenchReviewReady } = await benchmarkModule();
  const target = new EventTarget();
  await assert.rejects(
    waitForDataWorkbenchReviewReady(target, { sessionId: 1, requestId: 2, timeoutMs: 5 }),
    /explicit Workbench.*completion/i
  );
  const source = await readFile(new URL('../scripts/map-story-studio-data-workbench-benchmark.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getAttribute\s*\(/);
  assert.doesNotMatch(source, /textContent|innerText|querySelector|classList/);
});
