import { buildRoadLabelModeCache } from './road-labels.js';

globalThis.addEventListener('message', (event) => {
  try {
    const cache = buildRoadLabelModeCache(event.data.input, event.data.options);
    globalThis.postMessage({ cache });
  } catch (error) {
    globalThis.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
