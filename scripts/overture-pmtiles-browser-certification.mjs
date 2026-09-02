import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=')];
}));

const APP_URL = args.get('--url') ?? 'http://127.0.0.1:8080/';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = 90_000;
const ARCHIVE_URL = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles';
const SOURCE_ID = 'overture-industrial-buildings';
const FLAT_LAYER_ID = 'overture-industrial-buildings-flat';
const EXTRUSION_LAYER_ID = 'overture-industrial-buildings-3d';
const REVIEW_DIR = path.resolve('review/map-story-studio-v1-2/overture-pmtiles');
const MY_PHUOC_CAMERA = Object.freeze({ center: [106.59576775, 11.12942985], zoom: 15, pitch: 52, bearing: -10 });
const THU_DAU_MOT_CAMERA = Object.freeze({ center: [106.6500, 10.9800], zoom: 15, pitch: 48, bearing: -12 });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  close() { this.socket.close(); }
}

async function pageTarget() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
      const target = targets.find(({ type, url }) => type === 'page' && url.startsWith(APP_URL));
      if (target) return target;
    } catch {}
    await sleep(100);
  }
  throw new Error(`No Chromium page target for ${APP_URL}`);
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(client, expression, label, getAsyncError) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastValue;
  while (Date.now() < deadline) {
    const asyncError = getAsyncError?.();
    if (asyncError) throw asyncError;
    lastValue = await evaluate(client, expression);
    if (lastValue) return lastValue;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

function assertGate(condition, message, evidence) {
  if (!condition) throw new Error(`${message}${evidence === undefined ? '' : `: ${JSON.stringify(evidence)}`}`);
}

function headersRange(headers = {}) {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'range');
  return entry?.[1] ?? null;
}

function networkSummary(records) {
  const values = [...records.values()];
  return {
    requestCount: values.length,
    transferredBytes: values.every(({ encodedDataLength }) => Number.isFinite(encodedDataLength))
      ? values.reduce((sum, { encodedDataLength }) => sum + encodedDataLength, 0)
      : null,
    rangeHeaders: values.map(({ range }) => range).filter(Boolean),
    responseStatuses: values.map(({ status }) => status).filter(Number.isFinite),
    rangeOr206: values.some(({ range, status }) => Boolean(range) || status === 206)
  };
}

async function screenshot(client, filename, width, height) {
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await evaluate(client, `(() => { window.__C1_MAPS__?.[0]?.resize?.(); return true; })()`);
  await sleep(250);
  const { data } = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(path.join(REVIEW_DIR, filename), Buffer.from(data, 'base64'));
}

async function measureFps(client, durationMs = 4_000) {
  return evaluate(client, `(async () => {
    const duration = ${durationMs};
    const started = performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const sample = (timestamp) => {
        frames += 1;
        if (timestamp - started >= duration) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const elapsed = performance.now() - started;
    return { frames, elapsedMs: elapsed, averageFps: frames * 1000 / elapsed };
  })()`);
}

async function main() {
  await mkdir(REVIEW_DIR, { recursive: true });
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();

  let sourceMode = 'local-geojson';
  let failArchive = false;
  let asyncError = null;
  const archiveRecords = new Map();
  const consoleIssues = [];

  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    consoleIssues.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  client.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error' && !/favicon\.ico/i.test(`${entry.url ?? ''} ${entry.text}`)) consoleIssues.push(entry.text);
  });
  client.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (request.url !== ARCHIVE_URL) return;
    const record = {
      url: request.url,
      method: request.method,
      range: headersRange(request.headers),
      status: null,
      contentRange: null,
      encodedDataLength: null
    };
    archiveRecords.set(requestId, record);
  });
  client.on('Network.responseReceived', ({ requestId, response }) => {
    const record = archiveRecords.get(requestId);
    if (record) {
      record.status = response.status;
      record.contentRange = Object.entries(response.headers ?? {})
        .find(([name]) => name.toLowerCase() === 'content-range')?.[1] ?? null;
    }
  });
  client.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const record = archiveRecords.get(requestId);
    if (record) {
      record.encodedDataLength = encodedDataLength;
    }
  });
  client.on('Network.loadingFailed', ({ requestId }) => {
    const record = archiveRecords.get(requestId);
    if (record && record.encodedDataLength === null) record.encodedDataLength = 0;
  });
  client.on('Fetch.requestPaused', (params) => {
    void (async () => {
      if (params.request.url.endsWith('/project.json')) {
        const response = await fetch(params.request.url);
        const manifest = await response.json();
        const declaration = manifest.capabilities.find(({ id }) => id === 'urban-context-v1');
        declaration.settings = {
          adapter: 'route-61-2-current',
          buildingSource: sourceMode,
          overtureRelease: '2026-08-19.0'
        };
        const body = Buffer.from(`${JSON.stringify(manifest)}\n`);
        await client.send('Fetch.fulfillRequest', {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Content-Length', value: String(body.length) }
          ],
          body: body.toString('base64')
        });
      } else if (params.request.url === ARCHIVE_URL && failArchive) {
        await client.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' });
      } else {
        await client.send('Fetch.continueRequest', { requestId: params.requestId });
      }
    })().catch((error) => { asyncError = error; });
  });

  const instrumentation = `(() => {
    window.__C1_MAPS__ = [];
    window.__C1_PROTOCOL_ADDS__ = 0;
    window.__C1_MAP_ERRORS__ = [];
    let assigned;
    Object.defineProperty(window, 'maplibregl', {
      configurable: true,
      get() { return assigned; },
      set(value) {
        if (value?.Map && !value.Map.__c1Wrapped) {
          const OriginalMap = value.Map;
          class TrackedMap extends OriginalMap {
            static __c1Wrapped = true;
            constructor(...args) {
              super(...args);
              window.__C1_MAPS__.push(this);
            }
          }
          value.Map = TrackedMap;
        }
        if (typeof value?.addProtocol === 'function' && !value.addProtocol.__c1Wrapped) {
          const originalAddProtocol = value.addProtocol.bind(value);
          const trackedAddProtocol = function(name, handler) {
            if (name === 'pmtiles') window.__C1_PROTOCOL_ADDS__ += 1;
            return originalAddProtocol(name, handler);
          };
          trackedAddProtocol.__c1Wrapped = true;
          value.addProtocol = trackedAddProtocol;
        }
        assigned = value;
      }
    });
    window.__C1_START_TIMING__ = () => {
      const measurement = { active: true, startedAt: performance.now(), lastFrame: null, worstFrameGapMs: 0, worstLongTaskMs: 0 };
      const frame = (timestamp) => {
        if (!measurement.active) return;
        if (measurement.lastFrame !== null) measurement.worstFrameGapMs = Math.max(measurement.worstFrameGapMs, timestamp - measurement.lastFrame);
        measurement.lastFrame = timestamp;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        measurement.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) measurement.worstLongTaskMs = Math.max(measurement.worstLongTaskMs, entry.duration);
        });
        measurement.observer.observe({ entryTypes: ['longtask'] });
      }
      window.__C1_TIMING__ = measurement;
      return measurement.startedAt;
    };
    window.__C1_STOP_TIMING__ = () => {
      const measurement = window.__C1_TIMING__;
      measurement.active = false;
      measurement.observer?.disconnect();
      return {
        startedAt: measurement.startedAt,
        stoppedAt: performance.now(),
        worstFrameGapMs: measurement.worstFrameGapMs,
        worstLongTaskMs: measurement.worstLongTaskMs,
        worstFrameOrTaskGapMs: Math.max(measurement.worstFrameGapMs, measurement.worstLongTaskMs)
      };
    };
  })()`;

  const getAsyncError = () => asyncError;
  const reload = async (nextSource, failure = false) => {
    sourceMode = nextSource;
    failArchive = failure;
    asyncError = null;
    archiveRecords.clear();
    await client.send('Page.reload', { ignoreCache: true });
    return waitFor(client, `(() => {
      const map = window.__C1_MAPS__?.[0];
      const status = document.getElementById('runtime-status')?.textContent ?? '';
      return document.readyState === 'complete' && window.__C1_MAPS__?.length === 1 && /Scene 1 of 7/.test(status)
        && map?.loaded?.() ? { maps: window.__C1_MAPS__.length, status } : null;
    })()`, `${nextSource} application startup`, getAsyncError);
  };
  const advanceBeforeServiceArea = async () => {
    await evaluate(client, `(() => {
      const next = [...document.querySelectorAll('#runtime-navigation button')].find((button) => button.textContent.trim() === 'Next');
      if (!next) throw new Error('Next navigation is unavailable.');
      next.click(); next.click(); next.click();
      return true;
    })()`);
    await waitFor(client, `/Scene 4 of 7/.test(document.getElementById('runtime-status')?.textContent ?? '')`, 'Scene before service area', getAsyncError);
  };
  const activateServiceArea = () => evaluate(client, `(() => {
    window.__C1_START_TIMING__();
    const next = [...document.querySelectorAll('#runtime-navigation button')].find((button) => button.textContent.trim() === 'Next');
    next.click();
    return performance.now();
  })()`);
  const setCamera = (camera) => evaluate(client, `(() => {
    const map = window.__C1_MAPS__[0];
    map.jumpTo(${JSON.stringify(camera)});
    return true;
  })()`);
  const layerCounts = () => evaluate(client, `(() => {
    const map = window.__C1_MAPS__[0];
    const style = map.getStyle();
    return {
      mapsConstructed: window.__C1_MAPS__.length,
      mapCanvases: document.querySelectorAll('.maplibregl-canvas').length,
      protocolAdds: window.__C1_PROTOCOL_ADDS__,
      sources: Object.keys(style.sources).filter((id) => id === ${JSON.stringify(SOURCE_ID)}).length,
      flatLayers: style.layers.filter(({ id }) => id === ${JSON.stringify(FLAT_LAYER_ID)}).length,
      extrusionLayers: style.layers.filter(({ id }) => id === ${JSON.stringify(EXTRUSION_LAYER_ID)}).length
    };
  })()`);
  try {
    await Promise.all([
      client.send('Runtime.enable'),
      client.send('Log.enable'),
      client.send('Page.enable'),
      client.send('Network.enable'),
      client.send('Fetch.enable', { patterns: [
        { urlPattern: '*project.json', requestStage: 'Request' },
        { urlPattern: ARCHIVE_URL, requestStage: 'Request' }
      ] })
    ]);
    await client.send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    await reload('local-geojson');
    await advanceBeforeServiceArea();
    await activateServiceArea();
    await setCamera(MY_PHUOC_CAMERA);
    const localVisible = await waitFor(client, `(() => {
      const map = window.__C1_MAPS__[0];
      const root = map.getContainer();
      return root.dataset.urbanContextStatus === 'local-benchmark'
        && root.dataset.urbanOvertureCount === '1299'
        && map.getLayer(${JSON.stringify(EXTRUSION_LAYER_ID)})
        && map.getLayoutProperty(${JSON.stringify(EXTRUSION_LAYER_ID)}, 'visibility') === 'visible';
    })()`, 'local 1,299-building benchmark', getAsyncError);
    assertGate(localVisible, 'Local benchmark did not render');
    await sleep(500);
    const localFps = await measureFps(client);
    await screenshot(client, '01-my-phuoc-local-1440x900.png', 1440, 900);

    await reload('overture-pmtiles');
    const preActivation = networkSummary(archiveRecords);
    const startupState = await evaluate(client, `(() => {
      const map = window.__C1_MAPS__[0];
      const root = map.getContainer();
      return {
        status: root.dataset.urbanContextStatus,
        sourcePresent: Boolean(map.getSource(${JSON.stringify(SOURCE_ID)})),
        flatPresent: Boolean(map.getLayer(${JSON.stringify(FLAT_LAYER_ID)})),
        extrusionPresent: Boolean(map.getLayer(${JSON.stringify(EXTRUSION_LAYER_ID)})),
        protocolAdds: window.__C1_PROTOCOL_ADDS__
      };
    })()`);
    assertGate(preActivation.requestCount === 0, 'PMTiles requested before activation', preActivation);
    assertGate(startupState.status === 'not-requested'
      && !startupState.sourcePresent && !startupState.flatPresent && !startupState.extrusionPresent
      && startupState.protocolAdds === 0, 'Online startup was not lazy', startupState);

    await evaluate(client, `(() => {
      window.__C1_MAPS__[0].on('error', (event = {}) => {
        window.__C1_MAP_ERRORS__.push({
          sourceId: event.sourceId ?? null,
          message: String(event.error?.message ?? event.message ?? '')
        });
      });
      return true;
    })()`);

    await advanceBeforeServiceArea();
    const activationStartedAt = await activateServiceArea();
    await setCamera(MY_PHUOC_CAMERA);
    const onlineVisible = await waitFor(client, `(() => {
      const map = window.__C1_MAPS__[0];
      const root = map.getContainer();
      const sourcePresent = Boolean(map.getSource(${JSON.stringify(SOURCE_ID)}));
      const sourceLoaded = sourcePresent && map.isSourceLoaded(${JSON.stringify(SOURCE_ID)});
      const flatLayerPresent = Boolean(map.getLayer(${JSON.stringify(FLAT_LAYER_ID)}));
      const extrusionLayerPresent = Boolean(map.getLayer(${JSON.stringify(EXTRUSION_LAYER_ID)}));
      const extrusionVisibility = extrusionLayerPresent
        ? map.getLayoutProperty(${JSON.stringify(EXTRUSION_LAYER_ID)}, 'visibility') : null;
      const rendered = extrusionLayerPresent
        ? map.queryRenderedFeatures(undefined, { layers: [${JSON.stringify(EXTRUSION_LAYER_ID)}] }).length : 0;
      const sourceFeatures = sourcePresent
        ? map.querySourceFeatures(${JSON.stringify(SOURCE_ID)}, { sourceLayer: 'building' }).length : 0;
      return root.dataset.urbanContextStatus === 'available'
        && sourceLoaded && flatLayerPresent && extrusionLayerPresent
        && extrusionVisibility === 'visible' && rendered > 0 && sourceFeatures > 0
        ? {
            visibleAt: performance.now(), renderedFeatures: rendered, sourceFeatures,
            sourcePresent, sourceLoaded, flatLayerPresent, extrusionLayerPresent, extrusionVisibility,
            mapInstances: window.__C1_MAPS__.length, protocolRegistrations: window.__C1_PROTOCOL_ADDS__
          } : null;
    })()`, 'online Overture buildings at Mỹ Phước', getAsyncError);
    await sleep(500);
    const myPhuocMapErrors = await evaluate(client, `window.__C1_MAP_ERRORS__`);
    assertGate(!myPhuocMapErrors.some(({ message }) => /expression|unknown variable|layers\./i.test(message)),
      'MapLibre expression validation error observed', myPhuocMapErrors);
    const activationTiming = await evaluate(client, `window.__C1_STOP_TIMING__()`);
    const activationToVisibleMs = onlineVisible.visibleAt - activationStartedAt;
    const myPhuocNetwork = networkSummary(archiveRecords);
    assertGate(myPhuocNetwork.rangeOr206, 'No Range request or 206 response observed', myPhuocNetwork);
    assertGate(activationTiming.worstFrameOrTaskGapMs <= 250, 'Activation frame/task gap exceeded 250 ms', activationTiming);
    const onlineFps = await measureFps(client);
    const fpsRatio = onlineFps.averageFps / localFps.averageFps;
    assertGate(fpsRatio >= 0.9, 'Online FPS below 90% of local benchmark', { localFps, onlineFps, fpsRatio });
    await screenshot(client, '02-my-phuoc-online-1440x900.png', 1440, 900);
    await screenshot(client, '03-my-phuoc-online-1366x768.png', 1366, 768);

    const distantRequestIdsBefore = new Set(archiveRecords.keys());
    const countsBeforeDistant = await layerCounts();
    const mapErrorCountBeforeDistant = await evaluate(client, `window.__C1_MAP_ERRORS__.length`);
    const distantStartedAt = await evaluate(client, `(() => {
      const map = window.__C1_MAPS__[0];
      map.jumpTo(${JSON.stringify(THU_DAU_MOT_CAMERA)});
      return performance.now();
    })()`);
    const distantVisible = await waitFor(client, `(() => {
      const map = window.__C1_MAPS__[0];
      const root = map.getContainer();
      const target = new maplibregl.LngLat(106.65, 10.98);
      const targetDistanceM = map.getCenter().distanceTo(target);
      const renderedFeatures = map.queryRenderedFeatures(undefined, { layers: [${JSON.stringify(EXTRUSION_LAYER_ID)}] }).length;
      const sourceFeatures = map.querySourceFeatures(${JSON.stringify(SOURCE_ID)}, { sourceLayer: 'building' }).length;
      const counts = {
        maps: window.__C1_MAPS__.length,
        mapCanvases: document.querySelectorAll('.maplibregl-canvas').length,
        protocols: window.__C1_PROTOCOL_ADDS__,
        sources: Object.keys(map.getStyle().sources).filter((id) => id === ${JSON.stringify(SOURCE_ID)}).length,
        flatLayers: map.getStyle().layers.filter(({ id }) => id === ${JSON.stringify(FLAT_LAYER_ID)}).length,
        extrusionLayers: map.getStyle().layers.filter(({ id }) => id === ${JSON.stringify(EXTRUSION_LAYER_ID)}).length
      };
      return Number.isFinite(targetDistanceM) && targetDistanceM < 100
        && renderedFeatures > 0 && sourceFeatures > 0
        && root.dataset.urbanContextSource === 'overture-pmtiles'
        && root.dataset.urbanOvertureRelease === '2026-08-19.0'
        && counts.maps === 1 && counts.mapCanvases === 1 && counts.protocols === 1
        && counts.sources === 1 && counts.flatLayers === 1 && counts.extrusionLayers === 1
        ? { visibleAt: performance.now(), targetDistanceM, renderedFeatures, sourceFeatures, counts } : null;
    })()`, 'online Overture buildings at Thủ Dầu Một', getAsyncError);
    await sleep(500);
    const distantRecords = new Map([...archiveRecords].filter(([requestId]) => !distantRequestIdsBefore.has(requestId)));
    const thuDauMotNetwork = networkSummary(distantRecords);
    assertGate(thuDauMotNetwork.rangeOr206, 'No Thủ Dầu Một Range request or 206 response observed', thuDauMotNetwork);
    const distantMapErrors = await evaluate(client, `window.__C1_MAP_ERRORS__.slice(${mapErrorCountBeforeDistant})`);
    assertGate(distantMapErrors.length === 0, 'MapLibre error observed at Thủ Dầu Một', distantMapErrors);
    const distantActivationToVisibleMs = distantVisible.visibleAt - distantStartedAt;
    await screenshot(client, '04-thu-dau-mot-online-1440x900.png', 1440, 900);
    await setCamera(MY_PHUOC_CAMERA);
    await waitFor(client, `window.__C1_MAPS__[0].queryRenderedFeatures(undefined, { layers: [${JSON.stringify(EXTRUSION_LAYER_ID)}] }).length > 0`, 'return to Mỹ Phước', getAsyncError);

    await evaluate(client, `(() => {
      const next = [...document.querySelectorAll('#runtime-navigation button')].find((button) => button.textContent.trim() === 'Next');
      next.click();
      return true;
    })()`);
    await waitFor(client, `window.__C1_MAPS__[0].getContainer().dataset.urbanContext === 'off'`, 'context off', getAsyncError);
    await evaluate(client, `(() => {
      const previous = [...document.querySelectorAll('#runtime-navigation button')].find((button) => button.textContent.trim() === 'Previous');
      previous.click();
      return true;
    })()`);
    await waitFor(client, `window.__C1_MAPS__[0].getContainer().dataset.urbanContext === 'industrial-context'`, 'context back on', getAsyncError);
    const countsAfterReuse = await layerCounts();
    assertGate(JSON.stringify(countsAfterReuse) === JSON.stringify(countsBeforeDistant), 'PMTiles source/layer/protocol duplication detected', {
      before: countsBeforeDistant, after: countsAfterReuse
    });
    assertGate(countsAfterReuse.mapsConstructed === 1 && countsAfterReuse.mapCanvases === 1, 'One-MapLibre invariant failed', countsAfterReuse);

    await reload('overture-pmtiles', true);
    assertGate(networkSummary(archiveRecords).requestCount === 0, 'Failure scenario requested PMTiles before activation');
    await advanceBeforeServiceArea();
    await activateServiceArea();
    const failureState = await waitFor(client, `(() => {
      const map = window.__C1_MAPS__[0];
      const root = map.getContainer();
      if (root.dataset.urbanContextStatus !== 'unavailable') return null;
      const next = [...document.querySelectorAll('#runtime-navigation button')].find((button) => button.textContent.trim() === 'Next');
      next.click();
      return {
        status: root.dataset.urbanContextStatus,
        failureCategory: root.dataset.urbanContextFailure,
        maps: window.__C1_MAPS__.length,
        mapCanvases: document.querySelectorAll('.maplibregl-canvas').length,
        syntheticLayer: Boolean(map.getLayer('synthetic-industrial-infill')),
        sourceType: map.getStyle().sources[${JSON.stringify(SOURCE_ID)}]?.type ?? null,
        routeLayer: Boolean(map.getLayer('route-61-2-proposed')),
        storyAdvanced: /Scene 6 of 7/.test(document.getElementById('runtime-status')?.textContent ?? '')
      };
    })()`, 'bounded remote failure', getAsyncError);
    assertGate(failureState.routeLayer && failureState.storyAdvanced
      && !failureState.syntheticLayer && failureState.sourceType !== 'geojson'
      && failureState.maps === 1 && failureState.mapCanvases === 1, 'Remote failure disabled Story or installed fallback', failureState);

    const unexpectedConsole = consoleIssues.filter((message) => !/failed to fetch|networkerror|err_failed/i.test(message));
    assertGate(unexpectedConsole.length === 0, 'Unexpected Chromium console errors', unexpectedConsole);

    const result = {
      result: 'PASS',
      archiveUrl: ARCHIVE_URL,
      preActivationPmtilesRequests: preActivation.requestCount,
      myPhuoc: { ...myPhuocNetwork, ...onlineVisible, mapErrors: myPhuocMapErrors },
      thuDauMot: { ...thuDauMotNetwork, ...distantVisible, mapErrors: distantMapErrors, activationToVisibleMs: distantActivationToVisibleMs },
      activationToVisibleMs,
      activationTiming,
      localFps,
      onlineFps,
      fpsRegressionPercent: (1 - fpsRatio) * 100,
      reuse: countsAfterReuse,
      remoteFailure: failureState,
      localFixtureFeatures: 1299,
      screenshots: [
        '01-my-phuoc-local-1440x900.png',
        '02-my-phuoc-online-1440x900.png',
        '03-my-phuoc-online-1366x768.png',
        '04-thu-dau-mot-online-1440x900.png'
      ]
    };
    console.log(JSON.stringify(result, null, 2));
    console.log('OVERTURE_PMTILES_C1_BROWSER_RESULT: PASS');
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(`OVERTURE_PMTILES_C1_BROWSER_RESULT: FAIL\n${error.stack ?? error}`);
  process.exitCode = 1;
});
