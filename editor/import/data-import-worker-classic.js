importScripts('../../vendor/data-import/papaparse/5.7.0/papaparse.min.js');

const pendingMessages = [];
let bootstrapError;

function postBootstrapError(message, error) {
  if (!Number.isInteger(message?.sessionId) || !Number.isInteger(message?.requestId)) return;
  globalThis.postMessage({
    type: 'error',
    sessionId: message.sessionId,
    requestId: message.requestId,
    phase: 'Reading',
    code: 'WORKER_BOOTSTRAP_FAILED',
    message: String(error?.message || 'CSV worker failed to start.').slice(0, 1000),
    recoverable: true
  });
}

const bufferMessage = ({ data }) => {
  if (bootstrapError) postBootstrapError(data, bootstrapError);
  else pendingMessages.push(data);
};
globalThis.addEventListener('message', bufferMessage);

Promise.all([
  import('./data-import-worker-runtime.js'),
  import('./vendor-loaders.js')
]).then(([{ createDataImportWorkerRuntime }, { createWorkerVendorLoaders }]) => {
  const runtime = createDataImportWorkerRuntime({
    scope: globalThis,
    loaders: createWorkerVendorLoaders()
  });
  globalThis.removeEventListener('message', bufferMessage);
  for (const message of pendingMessages.splice(0)) runtime.handleMessage(message);
}).catch((error) => {
  bootstrapError = error;
  for (const message of pendingMessages.splice(0)) postBootstrapError(message, error);
});
