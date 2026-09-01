importScripts('../../vendor/data-import/papaparse/5.7.0/papaparse.min.js');

const pendingMessages = [];
const bufferMessage = ({ data }) => pendingMessages.push(data);
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
});
