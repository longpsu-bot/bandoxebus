import { createDataImportWorkerRuntime } from './data-import-worker-runtime.js';
import { createWorkerVendorLoaders } from './vendor-loaders.js';

createDataImportWorkerRuntime({
  scope: globalThis,
  loaders: createWorkerVendorLoaders()
});
