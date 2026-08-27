const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8080/';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
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
      const listeners = this.events.get(message.method) ?? [];
      listeners.forEach((listener) => listener(message.params));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const listener = (params) => {
        this.events.set(method, (this.events.get(method) ?? []).filter((item) => item !== listener));
        resolve(params);
      };
      this.events.set(method, [...(this.events.get(method) ?? []), listener]);
    });
  }

  close() {
    this.socket.close();
  }
}

async function pageTarget() {
  const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
  const target = targets.find(({ type, url }) => type === 'page' && url.startsWith(APP_URL));
  if (!target) throw new Error(`No page target for ${APP_URL}`);
  return target;
}

async function evaluate(client, expression, { awaitPromise = true, returnByValue = true } = {}) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise, returnByValue });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

const PRELOAD = String.raw`(() => {
  if (window.__routePerf) return;
  const perf = window.__routePerf = {
    mapRenders: 0,
    triggerRepaints: 0,
    triggerStacks: {},
    rafScheduled: 0,
    rafExecuted: 0,
    busRafScheduled: 0,
    busRafExecuted: 0,
    pauseBus: false,
    pausedBusCallback: null,
    suppressBusMarkerUpdates: false,
    suppressStopPulseUpdates: false,
    markerSetLngLat: 0,
    sourceSetData: {},
    mapInstances: 0,
    layersAdded: 0,
    sourcesAdded: 0,
    console: [],
    resetCounters() {
      this.mapRenders = 0;
      this.triggerRepaints = 0;
      this.triggerStacks = {};
      this.rafScheduled = 0;
      this.rafExecuted = 0;
      this.busRafScheduled = 0;
      this.busRafExecuted = 0;
      this.markerSetLngLat = 0;
      this.sourceSetData = {};
    },
    resumeBus() {
      this.pauseBus = false;
      const callback = this.pausedBusCallback;
      this.pausedBusCallback = null;
      if (callback) nativeRaf(callback);
    }
  };

  const nativeRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    const stack = new Error().stack || '';
    const busCallback = callback?.name === 'animate' && stack.includes('/src/app.js');
    perf.rafScheduled += 1;
    if (busCallback) perf.busRafScheduled += 1;
    return nativeRaf((timestamp) => {
      perf.rafExecuted += 1;
      if (busCallback) {
        perf.busRafExecuted += 1;
        if (perf.pauseBus) {
          perf.pausedBusCallback = callback;
          return;
        }
      }
      callback(timestamp);
    });
  };

  let maplibreValue;
  Object.defineProperty(window, 'maplibregl', {
    configurable: true,
    get: () => maplibreValue,
    set(value) {
      maplibreValue = value;
      const NativeMap = value.Map;
      value.Map = class InstrumentedMap extends NativeMap {
        constructor(...args) {
          super(...args);
          const instance = this;
          perf.mapInstances += 1;
          window.__routeMap = instance;
          instance.on('render', () => { perf.mapRenders += 1; });

          const nativeTriggerRepaint = instance.triggerRepaint.bind(instance);
          instance.triggerRepaint = (...triggerArgs) => {
            perf.triggerRepaints += 1;
            const caller = (new Error().stack || '').split('\n').slice(2, 4).join(' | ');
            perf.triggerStacks[caller] = (perf.triggerStacks[caller] || 0) + 1;
            return nativeTriggerRepaint(...triggerArgs);
          };

          const nativeAddLayer = instance.addLayer.bind(instance);
          instance.addLayer = (...layerArgs) => {
            perf.layersAdded += 1;
            return nativeAddLayer(...layerArgs);
          };

          const nativeAddSource = instance.addSource.bind(instance);
          instance.addSource = (id, source, ...sourceArgs) => {
            perf.sourcesAdded += 1;
            const result = nativeAddSource(id, source, ...sourceArgs);
            const added = instance.getSource(id);
            if (added?.setData) {
              const nativeSetData = added.setData.bind(added);
              added.setData = (...dataArgs) => {
                perf.sourceSetData[id] = (perf.sourceSetData[id] || 0) + 1;
                if (id === 'stop-pulses' && perf.suppressStopPulseUpdates) return added;
                return nativeSetData(...dataArgs);
              };
            }
            return result;
          };
          return instance;
        }
      };

      const nativeSetLngLat = value.Marker.prototype.setLngLat;
      value.Marker.prototype.setLngLat = function (...args) {
        if (this.getElement?.().classList.contains('bus-marker')) {
          perf.markerSetLngLat += 1;
          if (perf.suppressBusMarkerUpdates && this._lngLat) return this;
        }
        return nativeSetLngLat.apply(this, args);
      };
    }
  });

  for (const method of ['error', 'warn']) {
    const native = console[method].bind(console);
    console[method] = (...args) => {
      perf.console.push({ method, text: args.map(String).join(' ') });
      native(...args);
    };
  }
})();`;

const CONTROL = String.raw`(() => {
  const map = window.__routeMap;
  const perf = window.__routePerf;
  const routeLayers = [
    'route-removed', 'route-retained', 'route-added-halo', 'route-added-core',
    'route-existing', 'route-proposed-halo', 'route-proposed',
    'stops-retained', 'stops-added-halo', 'stops-added', 'stops-removed',
    'stops-existing-raw', 'stops-proposed-raw', 'stop-pulse',
    'arrows-existing', 'arrows-proposed', 'route-endpoints', 'route-endpoint-labels',
    'route-road-labels'
  ];
  const contextLayers = ['industrial-context-ground', 'industrial-context-boundary'];
  const poiLayers = ['poi-halo', 'poi-core', 'poi-labels'];
  const overtureLayers = ['overture-industrial-buildings-3d'];
  const customLayers = ['synthetic-industrial-infill'];
  const setVisible = (ids, visible) => ids.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
  window.__routePerfControl = {
    setState(state) {
      perf.pauseBus = true;
      perf.suppressBusMarkerUpdates = false;
      perf.suppressStopPulseUpdates = false;
      document.getElementById('toggle-bus-existing').checked = false;
      document.getElementById('toggle-bus-proposed').checked = false;
      document.querySelectorAll('.bus-marker').forEach((element) => { element.style.display = 'none'; });
      setVisible(routeLayers, false);
      setVisible(contextLayers, false);
      setVisible(poiLayers, false);
      setVisible(overtureLayers, false);
      setVisible(customLayers, false);
      if (state !== 'A') setVisible([
        'route-proposed-halo', 'route-proposed', 'stops-proposed-raw', 'stop-pulse',
        'arrows-proposed', 'route-endpoints', 'route-endpoint-labels', 'route-road-labels'
      ], true);
      const fullStates = ['C', 'D', 'E', 'F', 'F-no-marker', 'F-no-pulses'];
      if (fullStates.includes(state)) setVisible(overtureLayers, true);
      if (['D', 'E', 'F', 'F-no-marker', 'F-no-pulses'].includes(state)) {
        setVisible(contextLayers, true);
        setVisible(poiLayers, true);
      }
      if (['E', 'F', 'F-no-marker', 'F-no-pulses'].includes(state)) {
        document.getElementById('toggle-bus-proposed').checked = true;
        document.querySelector('.bus-marker.proposed').style.display = 'grid';
      }
      if (state === 'F-no-marker') perf.suppressBusMarkerUpdates = true;
      if (state === 'F-no-pulses') perf.suppressStopPulseUpdates = true;
      if (['F', 'F-no-marker', 'F-no-pulses'].includes(state)) perf.resumeBus();
      map.triggerRepaint();
    },
    inventory() {
      const style = map.getStyle();
      return {
        sources: Object.keys(style.sources).sort(),
        layers: style.layers.map(({ id, type, layout }) => ({ id, type, visibility: layout?.visibility ?? 'visible' })),
        customLayerActive: Boolean(map.getLayer('synthetic-industrial-infill')),
        markers: [...document.querySelectorAll('.bus-marker')].map((element) => ({
          classes: element.className,
          display: getComputedStyle(element).display
        }))
      };
    }
  };
})();`;

const SAMPLE = String.raw`async ({ durationMs, label }) => {
  const perf = window.__routePerf;
  perf.resetCounters();
  const before = performance.now();
  const frames = [];
  let previous = before;
  await new Promise((resolve) => {
    function sample(timestamp) {
      frames.push(timestamp - previous);
      previous = timestamp;
      if (timestamp - before >= durationMs) resolve();
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const elapsed = previous - before;
  const over33 = frames.filter((value) => value > 33.34).length;
  const over50 = frames.filter((value) => value > 50).length;
  return {
    label,
    durationMs: Math.round(elapsed),
    frames: frames.length,
    typicalFps: Number((1000 / percentile(0.5)).toFixed(1)),
    sustainedLowFps: Number((1000 / percentile(0.95)).toFixed(1)),
    averageFps: Number((frames.length * 1000 / elapsed).toFixed(1)),
    p95FrameMs: Number(percentile(0.95).toFixed(2)),
    maxFrameMs: Number(Math.max(...frames).toFixed(2)),
    framesOver33ms: over33,
    framesOver50ms: over50,
    counters: {
      mapRenders: perf.mapRenders,
      triggerRepaints: perf.triggerRepaints,
      triggerStacks: perf.triggerStacks,
      rafScheduled: perf.rafScheduled,
      busRafScheduled: perf.busRafScheduled,
      markerSetLngLat: perf.markerSetLngLat,
      sourceSetData: perf.sourceSetData
    }
  };
}`;

async function installAndReload(client, width, height) {
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Performance.enable');
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  await client.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height
  });
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELOAD });
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.reload', { ignoreCache: true });
  await loaded;
  await evaluate(client, `new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (window.__routeMap?.loaded?.() && document.querySelectorAll('.bus-marker').length === 2) {
        clearInterval(timer); resolve(true);
      } else if (performance.now() - started > 30000) {
        clearInterval(timer); reject(new Error('Timed out waiting for map'));
      }
    }, 100);
  })`);
  await evaluate(client, CONTROL);
  await client.send('Page.bringToFront');
}

async function enterSlide05(client, transition = false) {
  await evaluate(client, `(() => {
    const open = document.getElementById('presentation-open');
    if (!document.body.classList.contains('is-presenting')) open.click();
    document.querySelectorAll('.chapter-dot')[4].click();
    return true;
  })()`);
  if (!transition) {
    await evaluate(client, `new Promise((resolve) => {
      const map = window.__routeMap;
      if (!map.isMoving()) return resolve(true);
      map.once('moveend', () => resolve(true));
    })`);
    await sleep(1500);
  }
}

async function goToSlide(client, index) {
  await evaluate(client, `(async () => {
    const map = window.__routeMap;
    document.querySelectorAll('.chapter-dot')[${index}].click();
    if (map.isMoving()) await new Promise((resolve) => map.once('moveend', resolve));
    return true;
  })()`);
  await sleep(300);
}

async function waitForStoryShellSettled(client, expectedIndex = 4) {
  return evaluate(client, `(async () => {
    const expectedIndex = ${expectedIndex};
    const map = window.__routeMap;
    const perf = window.__routePerf;
    const started = performance.now();
    let stableSince = 0;
    let lastScrollY = window.scrollY;
    let lastMutationTotal = Object.values(perf.sourceSetData).reduce((sum, count) => sum + count, 0);
    while (performance.now() - started < 45000) {
      const activeStep = document.querySelector('.story-step[aria-current="step"]');
      const activeIndex = Number(activeStep?.dataset.storyStateIndex);
      const mutationTotal = Object.values(perf.sourceSetData).reduce((sum, count) => sum + count, 0);
      const scrollStable = Math.abs(window.scrollY - lastScrollY) < 0.5;
      const mutationsStable = mutationTotal === lastMutationTotal;
      const ready = document.body.classList.contains('is-story-shell')
        && activeIndex === expectedIndex
        && activeStep?.dataset.storyStateId === 'service-area'
        && !map.isMoving()
        && scrollStable
        && mutationsStable
        && document.getElementById('map').dataset.urbanContextState === 'active'
        && document.getElementById('map').dataset.urbanOvertureDataState === 'loaded'
        && document.getElementById('map').dataset.urbanOvertureCount === '1299';
      if (ready) {
        if (!stableSince) stableSince = performance.now();
        if (performance.now() - stableSince >= 1500) {
          return {
            activeIndex,
            activeStateId: activeStep.dataset.storyStateId,
            cameraMoving: map.isMoving(),
            scrollY: window.scrollY,
            urbanState: document.getElementById('map').dataset.urbanContextState,
            overtureState: document.getElementById('map').dataset.urbanOvertureDataState,
            overtureCount: document.getElementById('map').dataset.urbanOvertureCount,
            warmupSourceSetData: { ...perf.sourceSetData }
          };
        }
      } else {
        stableSince = 0;
      }
      lastScrollY = window.scrollY;
      lastMutationTotal = mutationTotal;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for settled Story Shell service-area state');
  })()`);
}

async function waitForStoryNavigation(client, expectedIndex) {
  return evaluate(client, `(async () => {
    const expectedIndex = ${expectedIndex};
    const map = window.__routeMap;
    const started = performance.now();
    let stableSince = 0;
    let lastScrollY = window.scrollY;
    while (performance.now() - started < 15000) {
      const activeIndex = Number(document.querySelector('.story-step[aria-current="step"]')?.dataset.storyStateIndex);
      const scrollStable = Math.abs(window.scrollY - lastScrollY) < 0.5;
      if (activeIndex === expectedIndex && !map.isMoving() && scrollStable) {
        if (!stableSince) stableSince = performance.now();
        if (performance.now() - stableSince >= 500) return true;
      } else {
        stableSince = 0;
      }
      lastScrollY = window.scrollY;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Timed out settling Story Shell navigation at state ' + expectedIndex);
  })()`);
}

async function enterStoryShellServiceArea(client) {
  await evaluate(client, `(() => {
    if (!document.body.classList.contains('is-story-shell')) {
      document.getElementById('presentation-open').click();
    }
    return true;
  })()`);
  await waitForStoryNavigation(client, 0);
  for (let index = 1; index <= 4; index += 1) {
    await evaluate(client, `document.getElementById('story-next').click()`);
    await waitForStoryNavigation(client, index);
  }
  return waitForStoryShellSettled(client);
}

async function storyShellSetup(client, width, height) {
  await installAndReload(client, width, height);
  const settled = await enterStoryShellServiceArea(client);
  const setup = await evaluate(client, `(() => ({
    viewport: [innerWidth, innerHeight],
    storyShellActive: document.body.classList.contains('is-story-shell'),
    activeStateId: document.querySelector('.story-step[aria-current="step"]')?.dataset.storyStateId,
    mapInstances: window.__routePerf.mapInstances,
    provider: document.getElementById('map').dataset.urbanContextProvider,
    urbanState: document.getElementById('map').dataset.urbanContextState,
    overtureCount: document.getElementById('map').dataset.urbanOvertureCount,
    overtureDataState: document.getElementById('map').dataset.urbanOvertureDataState,
    busMarkers: document.querySelectorAll('.bus-marker').length,
    visibleBusMarkers: [...document.querySelectorAll('.bus-marker')]
      .filter((element) => getComputedStyle(element).display !== 'none').length,
    console: window.__routePerf.console
  }))()`);
  return { ...setup, settled };
}

async function sample(client, label, durationMs) {
  const before = await client.send('Performance.getMetrics');
  const result = await evaluate(client, `(${SAMPLE})(${JSON.stringify({ durationMs, label })})`);
  const after = await client.send('Performance.getMetrics');
  const wanted = new Set(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize']);
  const beforeValues = Object.fromEntries(before.metrics.filter(({ name }) => wanted.has(name)).map(({ name, value }) => [name, value]));
  result.performance = Object.fromEntries(after.metrics
    .filter(({ name }) => wanted.has(name))
    .map(({ name, value }) => [name, Number((value - (beforeValues[name] ?? 0)).toFixed(6))]));
  return result;
}

async function main() {
  const command = process.argv[2] || 'inspect';
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  try {
    if (command === 'regression') {
      await installAndReload(client, 1920, 1080);
      const result = await evaluate(client, `(async () => {
        const map = window.__routeMap;
        const waitForMove = async () => {
          if (map.isMoving()) await new Promise((resolve) => map.once('moveend', resolve));
          await new Promise((resolve) => setTimeout(resolve, 150));
        };
        document.getElementById('presentation-open').click();
        await waitForMove();
        const slideIds = [document.getElementById('presentation-content').dataset.slideId];
        for (let index = 1; index < 7; index += 1) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
          await waitForMove();
          slideIds.push(document.getElementById('presentation-content').dataset.slideId);
        }
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        await waitForMove();
        const backSlide = document.getElementById('presentation-content').dataset.slideId;

        document.querySelectorAll('.chapter-dot')[4].click();
        await waitForMove();
        const slide05 = {
          urbanState: document.getElementById('map').dataset.urbanContextState,
          overtureState: document.getElementById('map').dataset.urbanOvertureDataState,
          overtureVisibility: map.getLayoutProperty('overture-industrial-buildings-3d', 'visibility'),
          poiVisibility: ['poi-halo', 'poi-core', 'poi-labels'].map((id) => map.getLayoutProperty(id, 'visibility') || 'visible'),
          disclosureVisible: Boolean(document.querySelector('.presentation-content__source')?.getClientRects().length),
          disclosureText: document.querySelector('.presentation-content__source')?.textContent || ''
        };
        document.querySelectorAll('.chapter-dot')[5].click();
        await waitForMove();
        const slide06UrbanState = document.getElementById('map').dataset.urbanContextState;
        document.querySelectorAll('.chapter-dot')[4].click();
        await waitForMove();
        const cachedReentry = {
          urbanState: document.getElementById('map').dataset.urbanContextState,
          overtureState: document.getElementById('map').dataset.urbanOvertureDataState,
          overtureVisibility: map.getLayoutProperty('overture-industrial-buildings-3d', 'visibility')
        };

        const bus = document.querySelector('.bus-marker.proposed');
        const busBefore = bus.style.transform;
        await new Promise((resolve) => setTimeout(resolve, 700));
        const busAfter = bus.style.transform;
        const pulseObserved = await new Promise((resolve) => {
          if (document.querySelector('.stop-pulse-marker')) return resolve(true);
          const observer = new MutationObserver(() => {
            if (!document.querySelector('.stop-pulse-marker')) return;
            observer.disconnect(); resolve(true);
          });
          observer.observe(map.getContainer(), { childList: true, subtree: true });
          setTimeout(() => { observer.disconnect(); resolve(false); }, 8000);
        });

        const attribution = document.querySelector('.maplibregl-ctrl-attrib');
        const attributionVisible = Boolean(attribution?.getClientRects().length);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await waitForMove();
        return {
          slideIds,
          backSlide,
          slide05,
          slide06UrbanState,
          cachedReentry,
          busMoved: busBefore !== busAfter,
          pulseObserved,
          basemapVariant: document.getElementById('map').dataset.basemapVariant,
          attributionVisible,
          attributionText: attribution?.textContent?.replace(/\\s+/g, ' ').trim() || '',
          escaped: document.getElementById('presentation').hidden && document.getElementById('map').dataset.urbanContextState === 'off',
          console: window.__routePerf.console
        };
      })()`);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'reduced-motion') {
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await installAndReload(client, 1920, 1080);
      const result = await evaluate(client, `(async () => {
        document.getElementById('presentation-open').click();
        document.querySelectorAll('.chapter-dot')[4].click();
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          preference: matchMedia('(prefers-reduced-motion: reduce)').matches,
          cameraMoving: window.__routeMap.isMoving(),
          slideId: document.getElementById('presentation-content').dataset.slideId,
          urbanState: document.getElementById('map').dataset.urbanContextState,
          console: window.__routePerf.console
        };
      })()`);
      await client.send('Emulation.setEmulatedMedia', { features: [] });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'sample-current') {
      await client.send('Performance.enable');
      console.log(JSON.stringify(await sample(client, process.argv[3] || 'current', Number(process.argv[4] || 15000)), null, 2));
      return;
    }

    if (command === 'lifecycle') {
      await installAndReload(client, 1920, 1080);
      await enterSlide05(client);
      const fresh = await sample(client, 'fresh-slide-05', Number(process.env.SAMPLE_MS || 15000));
      for (const index of [5, 4, 3, 4]) await goToSlide(client, index);
      const reentry = await sample(client, 'reentered-slide-05', Number(process.env.SAMPLE_MS || 15000));
      const inventory = await evaluate(client, `(() => {
        const current = window.__routePerfControl.inventory();
        const listeners = Object.fromEntries(Object.entries(window.__routeMap._listeners || {}).map(([key, value]) => [key, value.length]));
        return {
          sources: current.sources,
          layers: current.layers.map(({ id }) => id),
          listeners,
          layersAdded: window.__routePerf.layersAdded,
          sourcesAdded: window.__routePerf.sourcesAdded,
          console: window.__routePerf.console
        };
      })()`);
      console.log(JSON.stringify({ fresh, reentry, inventory }, null, 2));
      return;
    }

    if (command === 'transition') {
      await installAndReload(client, 1920, 1080);
      await evaluate(client, `document.getElementById('presentation-open').click()`);
      await goToSlide(client, 3);
      const before = await sample(client, 'before-slide-05-transition', 5000);
      await evaluate(client, `document.querySelectorAll('.chapter-dot')[4].click()`);
      const during = await sample(client, 'during-slide-05-transition', 1600);
      await evaluate(client, `new Promise((resolve) => {
        const map = window.__routeMap;
        if (!map.isMoving()) resolve(true);
        else map.once('moveend', () => resolve(true));
      })`);
      await sleep(1000);
      const after = await sample(client, 'after-slide-05-transition', 10000);
      console.log(JSON.stringify({ before, during, after }, null, 2));
      return;
    }

    if (command === 'story-shell-benchmark') {
      const width = Number(process.argv[3] || 1920);
      const height = Number(process.argv[4] || 1080);
      const durationMs = Number(process.env.SAMPLE_MS || 15000);
      const repetitions = Number(process.env.REPETITIONS || 3);
      const setup = await storyShellSetup(client, width, height);
      console.log(JSON.stringify({ setup }, null, 2));
      console.log(JSON.stringify({ benchmarkConfig: { durationMs, repetitions } }));
      const results = [];
      for (let run = 1; run <= repetitions; run += 1) {
        const settled = await waitForStoryShellSettled(client);
        const result = await sample(client, `story-shell-${width}x${height}-${run}`, durationMs);
        results.push({ ...result, settled });
        console.log(JSON.stringify(results.at(-1)));
        await sleep(500);
      }
      console.log(JSON.stringify({ setup, results }, null, 2));
      return;
    }

    if (command === 'story-shell-lifecycle') {
      const durationMs = Number(process.env.SAMPLE_MS || 15000);
      const setup = await storyShellSetup(client, 1920, 1080);
      await evaluate(client, `document.getElementById('story-explore').click()`);
      await evaluate(client, `new Promise((resolve, reject) => {
        const started = performance.now();
        const timer = setInterval(() => {
          if (!document.body.classList.contains('is-story-shell')
            && document.getElementById('map').dataset.urbanContextState === 'off') {
            clearInterval(timer); resolve(true);
          } else if (performance.now() - started > 10000) {
            clearInterval(timer); reject(new Error('Timed out exiting Story Shell'));
          }
        }, 50);
      })`);
      const settled = await enterStoryShellServiceArea(client);
      const reentry = await sample(client, 'story-shell-reentry-1920x1080', durationMs);
      const lifecycle = await evaluate(client, `(() => ({
        mapInstances: window.__routePerf.mapInstances,
        activeStateId: document.querySelector('.story-step[aria-current="step"]')?.dataset.storyStateId,
        storyStepCount: document.querySelectorAll('.story-step').length,
        console: window.__routePerf.console
      }))()`);
      console.log(JSON.stringify({ setup, settled, reentry, lifecycle }, null, 2));
      return;
    }

    if (command === 'setup' || command === 'benchmark') {
      const width = Number(process.argv[3] || 1920);
      const height = Number(process.argv[4] || 1080);
      await installAndReload(client, width, height);
      await enterSlide05(client);
      const setup = await evaluate(client, `(() => {
        const inventory = window.__routePerfControl.inventory();
        return {
          viewport: [innerWidth, innerHeight],
          provider: document.getElementById('map').dataset.urbanContextProvider,
          state: document.getElementById('map').dataset.urbanContextState,
          overtureCount: document.getElementById('map').dataset.urbanOvertureCount,
          overtureDataState: document.getElementById('map').dataset.urbanOvertureDataState,
          sourceCount: inventory.sources.length,
          layerCount: inventory.layers.length,
          customLayerActive: inventory.customLayerActive,
          markers: inventory.markers,
          console: window.__routePerf.console
        };
      })()`);
      console.log(JSON.stringify({ setup }, null, 2));
      if (command === 'setup') return;

      const durationMs = Number(process.env.SAMPLE_MS || 15000);
      const repetitions = Number(process.env.REPETITIONS || 3);
      const results = [];
      const states = process.env.STATES?.split(',').map((state) => state.trim()).filter(Boolean)
        ?? ['A', 'B', 'C', 'D', 'E', 'F'];
      console.log(JSON.stringify({ benchmarkConfig: { durationMs, repetitions, states } }));
      for (const state of states) {
        await evaluate(client, `window.__routePerfControl.setState('${state}')`);
        await sleep(1200);
        for (let run = 1; run <= repetitions; run += 1) {
          const result = await sample(client, `${state}-${run}`, durationMs);
          results.push(result);
          console.log(JSON.stringify(result));
          await sleep(500);
        }
      }
      console.log(JSON.stringify({ results }, null, 2));
      return;
    }

    if (command === 'eval') {
      console.log(JSON.stringify(await evaluate(client, process.argv.slice(3).join(' ')), null, 2));
      return;
    }

    console.log(JSON.stringify(await evaluate(client, `({ url: location.href, title: document.title, ready: Boolean(window.__routeMap) })`), null, 2));
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
