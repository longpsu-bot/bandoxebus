import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=')];
}));

const GATE = args.get('--gate') ?? 'pr-a';
const APP_URL = args.get('--url') ?? 'http://127.0.0.1:8080/editor/';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = 30_000;

if (GATE === 'pr-c') {
  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('./map-story-studio-pr-c-browser-smoke.mjs', import.meta.url)),
    ...process.argv.slice(2)
  ], { stdio: 'inherit', env: process.env });
  process.exit(result.status ?? 1);
}
if (GATE !== 'pr-a' && GATE !== 'pr-d') throw new Error(`Unsupported Map Story Studio browser gate: ${GATE}`);

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
  throw new Error(`No browser page target for ${APP_URL}`);
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

async function waitFor(client, expression, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluate(client, expression);
    if (lastValue) return lastValue;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}. Last value: ${JSON.stringify(lastValue)}`);
}

function clickButton(label) {
  return `(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)});
    if (!button || button.disabled) throw new Error('Unavailable button: ' + ${JSON.stringify(label)});
    button.click();
    return true;
  })()`;
}

async function waitForRevision(client, previous, sceneCount, label) {
  return waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame?.dataset.previewRevision);
    const scenes = document.querySelectorAll('.studio-scene-list button').length;
    const maps = frame?.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
    return revision === ${previous + 1} && scenes === ${sceneCount} && maps === 1 ? revision : 0;
  })()`, label);
}

async function wheelMap(client, deltaY) {
  const point = await evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    const iframe = frame.getBoundingClientRect();
    const canvas = frame.contentDocument.querySelector('.maplibregl-canvas').getBoundingClientRect();
    return { x: iframe.left + canvas.left + canvas.width / 2, y: iframe.top + canvas.top + canvas.height / 2 };
  })()`);
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY
  });
}

async function runPrDGate() {
  const target = await pageTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.open();
  const consoleIssues = [];
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    consoleIssues.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  client.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error' && !/favicon\.ico/i.test(`${entry.url ?? ''} ${entry.text}`)) consoleIssues.push(entry.text);
  });

  const setViewport = async (width, height, mobile = false) => {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await evaluate(client, `(() => {
      const frame = document.getElementById('production-preview');
      Object.assign(frame.style, {
        position: 'fixed', left: '0', top: '0', width: '${width}px', height: '${height}px',
        maxWidth: 'none', maxHeight: 'none', border: '0', zIndex: '2147483647'
      });
      return true;
    })()`);
    return waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      return innerWidth === ${width} && innerHeight === ${height}
        && frame?.contentWindow?.innerWidth === ${width} && frame.contentWindow.innerHeight === ${height};
    })()`, `${width} x ${height} production viewport`);
  };

  const instrumentRuntime = () => evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentWindow;
    const proto = child.maplibregl.Map.prototype;
    child.__PR_D_RUNTIME_CALLS__ = [];
    if (!proto.__prDOriginals) {
      proto.__prDOriginals = {};
      for (const name of ['flyTo', 'easeTo', 'jumpTo', 'setLayoutProperty', 'setCooperativeGestures']) {
        const original = proto[name];
        if (typeof original !== 'function') continue;
        proto.__prDOriginals[name] = original;
        proto[name] = function(...args) {
          this.__prDCallDepth ??= 0;
          if (this.__prDCallDepth === 0) {
            child.__PR_D_RUNTIME_CALLS__.push({ name, args: structuredClone(args) });
          }
          this.__prDCallDepth += 1;
          try { return original.apply(this, args); }
          finally { this.__prDCallDepth -= 1; }
        };
      }
    }
    return true;
  })()`);

  const clearRuntimeCalls = () => evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentWindow;
    child.__PR_D_RUNTIME_CALLS__ = [];
    return true;
  })()`);

  const runtimeCalls = () => evaluate(client, `document.getElementById('production-preview').contentWindow.__PR_D_RUNTIME_CALLS__`);

  try {
    await Promise.all([client.send('Runtime.enable'), client.send('Log.enable'), client.send('Page.enable')]);
    await client.send('Page.reload', { ignoreCache: true });
    await waitFor(client,
      `document.readyState === 'complete' && Boolean(window.__GUI_EDITOR__) && Boolean(document.getElementById('production-preview'))`,
      'Map Story Studio PR D shell');

    await evaluate(client, `(async () => {
      const manifest = {
        schemaVersion: '1.0', id: 'pr-d-browser', title: 'PR D browser certification', locale: 'en-US',
        stories: { primary: 'main', items: [{ id: 'main', src: './stories/main.story.json' }] },
        map: { basemap: 'openfreemap-dark', initialView: { center: [106.63, 11.06], zoom: 10.5, pitch: 24, bearing: -8 } },
        datasets: {
          route: { type: 'geojson', geometry: 'line', src: './data/route.geojson', label: 'Route',
            render: { type: 'line', color: '#2BB7FF', width: 5 } },
          stops: { type: 'geojson', geometry: 'point', src: './data/stops.geojson', label: 'Stops',
            render: { type: 'point', color: '#FFB547', radius: 6, strokeColor: '#07101C', strokeWidth: 2 } },
          demand: { type: 'table-json', src: './data/demand.json', label: 'Demand' }
        },
        assets: { photo: { type: 'image', src: './assets/photo.svg', mediaType: 'image/svg+xml', required: true } },
        focusTargets: {}, metrics: { src: './data/metrics.json' }, capabilities: [],
        attribution: { studio: { name: 'PR D browser fixture', license: 'Test data' } }
      };
      const blocks = [
        { id: 'story-text', frame: { x: .03, y: .04, width: .36, height: .12, z: 30 },
          appearance: { box: { fill: '#07101CCC', opacity: .96, radius: 14, padding: 18 },
            text: { fontFamily: 'sans', fontSize: 30, bold: true, color: '#FFFFFF', align: 'left', lineHeight: 1.15 } },
          block: { type: 'heading', text: 'PR D persistence and output certification', subtitle: 'Shared production composition' } },
        { id: 'story-metric', frame: { x: .03, y: .19, width: .25, height: .18, z: 20 },
          block: { type: 'stat-group', items: [{ label: 'Daily riders', metric: 'daily-riders', format: { type: 'integer' }, tone: 'added' }] } },
        { id: 'story-chart', frame: { x: .31, y: .19, width: .32, height: .3, z: 10 },
          block: { type: 'chart', chartType: 'bar', title: 'Ridership', description: 'Riders by stop', source: 'studio',
            data: { dataset: 'demand', x: 'stop', series: [{ y: 'riders', label: 'Riders', format: { type: 'integer' }, color: '#2BB7FF' }] } } },
        { id: 'story-table', frame: { x: .66, y: .08, width: .31, height: .32, z: 12 },
          block: { type: 'table', title: 'Stop demand', caption: 'Average weekday', source: 'studio',
            data: { dataset: 'demand', columns: [{ field: 'stop', header: 'Stop' }, { field: 'riders', header: 'Riders', align: 'end', format: { type: 'integer' } }] } } },
        { id: 'story-image', frame: { x: .65, y: .44, width: .31, height: .28, z: 14 },
          block: { type: 'image', asset: 'photo', alt: 'Stylized blue route with an amber stop', decorative: false,
            title: 'Network image', caption: 'Declared package asset', source: 'studio' } },
        { id: 'story-legend', frame: { x: .34, y: .56, width: .27, height: .24, z: 25 },
          block: { type: 'legend', title: 'Network layers', items: [
            { label: 'Route', sample: 'line', color: '#2BB7FF' },
            { label: 'Stops', sample: 'swatch', color: '#FFB547' },
            { label: 'Network image', sample: 'icon', asset: 'photo' }
          ] } }
      ];
      const scene = (id, camera, interaction, transition, layerVisibility) => ({
        id, content: { layout: 'freeform-16x9', blocks: structuredClone(blocks), presenterNote: 'PR D browser evidence' },
        map: { camera, interaction, transition, layerVisibility, enter: [], exit: [] }
      });
      const story = { schemaVersion: '1.2', id: 'main', title: 'PR D output story', states: [
        scene('alpha', { center: [106.631, 11.052], zoom: 11.25, pitch: 40, bearing: -16 }, 'locked', { type: 'instant', durationMs: 0 }, { route: true, stops: false }),
        scene('beta', { center: [106.646, 11.069], zoom: 12.5, pitch: 32, bearing: 18 }, 'explore', { type: 'fly', durationMs: 160 }, { route: false, stops: true }),
        scene('gamma', { center: [106.658, 11.081], zoom: 13.25, pitch: 20, bearing: 30 }, 'zoom-only', { type: 'ease', durationMs: 120 }, { route: true, stops: true })
      ] };
      const route = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Route' },
        geometry: { type: 'LineString', coordinates: [[106.62, 11.04], [106.67, 11.09]] } }] };
      const stops = { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { name: 'Central' }, geometry: { type: 'Point', coordinates: [106.631, 11.052] } },
        { type: 'Feature', properties: { name: 'Market' }, geometry: { type: 'Point', coordinates: [106.646, 11.069] } }
      ] };
      const demand = { schemaVersion: '1.0', columns: [
        { id: 'stop', label: 'Stop', type: 'text' }, { id: 'riders', label: 'Riders', type: 'integer' }
      ], rows: [{ stop: 'Central', riders: 8400 }, { stop: 'Market', riders: 6200 }] };
      const metrics = { schemaVersion: '1.0', metrics: {
        'daily-riders': { label: 'Daily riders', value: 14600, format: { type: 'integer' }, attribution: ['studio'] }
      } };
      const encoder = new TextEncoder();
      const json = (value) => encoder.encode(JSON.stringify(value) + '\\n');
      const entries = [
        { path: 'project.json', bytes: json(manifest), kind: 'manifest', mediaType: 'application/json', managed: true },
        { path: 'stories/main.story.json', bytes: json(story), kind: 'story', mediaType: 'application/json', managed: true },
        { path: 'data/route.geojson', bytes: json(route), kind: 'dataset', mediaType: 'application/geo+json', managed: true },
        { path: 'data/stops.geojson', bytes: json(stops), kind: 'dataset', mediaType: 'application/geo+json', managed: true },
        { path: 'data/demand.json', bytes: json(demand), kind: 'dataset', mediaType: 'application/json', managed: true },
        { path: 'data/metrics.json', bytes: json(metrics), kind: 'metrics', mediaType: 'application/json', managed: true },
        { path: 'assets/photo.svg', bytes: encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><path d="M20 150 L140 70 L300 25" fill="none" stroke="#2BB7FF" stroke-width="12"/><circle cx="140" cy="70" r="14" fill="#FFB547"/></svg>'), kind: 'asset', mediaType: 'image/svg+xml', managed: true }
      ];
      window.__PR_D_PACKAGE__ = entries.map((entry) => ({ ...entry, bytes: entry.bytes.slice() }));
      const files = new Map(entries.map((entry) => [entry.path, entry.bytes.slice()]));
      const directory = (prefix = '') => ({
        name: prefix ? prefix.split('/').at(-2) : 'pr-d-folder',
        async getDirectoryHandle(segment) { return directory(prefix + segment + '/'); },
        async getFileHandle(segment) {
          const path = prefix + segment;
          if (!files.has(path)) throw new DOMException('Missing ' + path, 'NotFoundError');
          return { name: segment, async getFile() {
            const value = files.get(path).slice();
            return { size: value.length, async arrayBuffer() { return value.slice().buffer; } };
          } };
        }
      });
      await window.__GUI_EDITOR__.openFolder(directory());
      return true;
    })()`);

    const folderReopen = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview'); const child = frame?.contentDocument;
      return /Valid production project/.test(document.getElementById('validation-status')?.textContent ?? '')
        && Number(frame?.dataset.previewRevision) === 0
        && child?.querySelectorAll('.maplibregl-canvas').length === 1
        && child?.getElementById('scene-compositor')?.textContent.includes('PR D persistence')
        ? { maps: 1, representativeValue: 'PR D persistence and output certification' } : null;
    })()`, 'Folder reopen through production preview');

    const zipBytes = await evaluate(client, `(async () => {
      const bytes = await window.__GUI_EDITOR__.exportZip();
      await window.__GUI_EDITOR__.importZip(bytes, { label: 'PR D persistence.zip' });
      return bytes.length;
    })()`);
    if (!(zipBytes > 0)) throw new Error('PR D ZIP export produced no bytes.');
    const zipReopen = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview'); const child = frame?.contentDocument;
      return /Valid production project/.test(document.getElementById('validation-status')?.textContent ?? '')
        && Number(frame?.dataset.previewRevision) === 0
        && child?.querySelectorAll('.maplibregl-canvas').length === 1
        && child?.getElementById('scene-compositor')?.textContent.includes('PR D persistence')
        ? { maps: 1, bytes: ${zipBytes} } : null;
    })()`, 'ZIP import and production reopen');

    await evaluate(client, `(() => {
      const scene = document.querySelector('.studio-scene-list button'); scene?.click();
      const interaction = document.getElementById('studio-scene-interaction');
      if (!interaction) throw new Error('Scene interaction control unavailable.');
      interaction.value = 'zoom-only';
      interaction.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(client, `document.getElementById('validation-status')?.textContent === 'Valid production project · revision 1'`, 'valid unsaved Story 1.2 revision');
    const saveDisabled = await evaluate(client, `document.getElementById('save-project').disabled`);
    if (!saveDisabled) throw new Error('Memory package unexpectedly required or allowed Save for output preview.');

    await evaluate(client, clickButton('Preview Story'));
    const validUnsavedScroll = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      return new URL(frame.src).searchParams.get('outputMode') === 'scroll'
        && Number(frame.dataset.previewRevision) === 1
        && document.getElementById('preview-status')?.textContent === 'Preview Story revision 1'
        && frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1
        ? { revision: 1, mode: 'scroll' } : null;
    })()`, 'valid unsaved Scroll output');
    await evaluate(client, clickButton('Present'));
    const validUnsavedPresentation = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      return new URL(frame.src).searchParams.get('outputMode') === 'presentation'
        && Number(frame.dataset.previewRevision) === 1
        && document.getElementById('preview-status')?.textContent === 'Present revision 1'
        && frame.contentDocument?.getElementById('scene-compositor')?.dataset.outputMode === 'presentation'
        ? { revision: 1, mode: 'presentation' } : null;
    })()`, 'valid unsaved Presentation output');

    await evaluate(client, `(() => {
      const locale = window.__GUI_EDITOR__.inspect('project').control('locale');
      locale.set('x');
      return true;
    })()`);
    await waitFor(client, `document.getElementById('validation-status')?.textContent === 'Invalid project locale.'
      && document.getElementById('preview-status')?.textContent === 'Paused at valid revision 1'`, 'fatal invalid draft with previous valid revision');
    await evaluate(client, clickButton('Preview Story'));
    const invalidLastValidScroll = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      return window.__GUI_EDITOR__.inspect('project').control('locale').value === 'x'
        && Number(frame.dataset.previewRevision) === 1
        && frame.contentDocument?.documentElement?.lang === 'en-US'
        && document.getElementById('preview-status')?.textContent === 'Preview Story using previous valid revision 1'
        ? { revision: 1, invalidLocale: 'x', launchedLocale: 'en-US' } : null;
    })()`, 'invalid draft Scroll previous valid output');
    await evaluate(client, clickButton('Present'));
    const invalidLastValidPresentation = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      return window.__GUI_EDITOR__.inspect('project').control('locale').value === 'x'
        && Number(frame.dataset.previewRevision) === 1
        && frame.contentDocument?.documentElement?.lang === 'en-US'
        && document.getElementById('preview-status')?.textContent === 'Present using previous valid revision 1'
        ? { revision: 1, invalidLocale: 'x', launchedLocale: 'en-US' } : null;
    })()`, 'invalid draft Presentation previous valid output');

    await evaluate(client, `(() => {
      window.__GUI_EDITOR__.inspect('project').control('locale').set('en-US');
      return true;
    })()`);
    await waitFor(client, `document.getElementById('validation-status')?.textContent === 'Valid production project · revision 3'
      && Number(document.getElementById('production-preview').dataset.previewRevision) === 3`, 'repaired current revision');

    await setViewport(1920, 1080);
    const desktop1920 = await waitFor(client, `(() => {
      const child = document.getElementById('production-preview').contentDocument;
      const stage = child?.getElementById('scene-compositor'); const rect = stage?.getBoundingClientRect();
      const overlays = [...(stage?.querySelectorAll('.scene-overlay') ?? [])];
      const dimensions = Object.fromEntries(overlays.map((overlay) => {
        const value = overlay.getBoundingClientRect();
        return [overlay.dataset.semanticType, { width: value.width, height: value.height }];
      }));
      const contained = overlays.every((overlay) => { const value = overlay.getBoundingClientRect();
        return value.left >= rect.left - 1 && value.top >= rect.top - 1 && value.right <= rect.right + 1 && value.bottom <= rect.bottom + 1; });
      const expected = ['heading', 'stat-group', 'chart', 'table', 'image', 'legend'];
      return child?.defaultView.innerWidth === 1920 && child.defaultView.innerHeight === 1080
        && stage?.dataset.sceneId === 'alpha' && rect.width === 1920 && rect.height === 1080
        && contained && expected.every((type) => dimensions[type]?.width > 0 && dimensions[type]?.height > 0)
        && child.querySelectorAll('.maplibregl-canvas').length === 1
        ? { viewport: [1920, 1080], stage: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, dimensions } : null;
    })()`, '1920 x 1080 rich 16:9 composition');

    await instrumentRuntime();
    const activateExplore = async (buttonLabel, sceneId, expectedCamera) => {
      await clearRuntimeCalls();
      await evaluate(client, `(() => {
        const child = document.getElementById('production-preview').contentDocument;
        const button = [...child.querySelectorAll('#runtime-navigation button')].find((item) => item.textContent.trim() === ${JSON.stringify(buttonLabel)});
        if (!button || button.disabled) throw new Error('Unavailable runtime button: ${buttonLabel}');
        button.click(); return true;
      })()`);
      await waitFor(client, `document.getElementById('production-preview').contentDocument
        ?.getElementById('scene-compositor')?.dataset.sceneId === ${JSON.stringify(sceneId)}`, `activate ${sceneId}`);
      const calls = await runtimeCalls();
      const camera = calls.filter(({ name }) => ['flyTo', 'easeTo', 'jumpTo'].includes(name));
      const layers = calls.filter(({ name }) => name === 'setLayoutProperty');
      if (camera.length !== 1 || camera[0].name !== expectedCamera || layers.length !== 2) {
        throw new Error(`Unexpected ${sceneId} activation calls: ${JSON.stringify(calls)}`);
      }
      return { sceneId, camera: camera[0], layers };
    };
    const layerSequence = [
      await activateExplore('Next', 'beta', 'flyTo'),
      await activateExplore('Previous', 'alpha', 'jumpTo'),
      await activateExplore('Next', 'beta', 'flyTo'),
      await activateExplore('Next', 'gamma', 'easeTo'),
      await activateExplore('Previous', 'beta', 'flyTo'),
      await activateExplore('Previous', 'alpha', 'jumpTo')
    ];
    const layerExpected = {
      alpha: [['project-route', 'visibility', 'visible'], ['project-stops', 'visibility', 'none']],
      beta: [['project-route', 'visibility', 'none'], ['project-stops', 'visibility', 'visible']],
      gamma: [['project-route', 'visibility', 'visible'], ['project-stops', 'visibility', 'visible']]
    };
    for (const activation of layerSequence) {
      const actual = activation.layers.map(({ args }) => args);
      if (JSON.stringify(actual) !== JSON.stringify(layerExpected[activation.sceneId])) {
        throw new Error(`Layer snapshot mismatch for ${activation.sceneId}: ${JSON.stringify(actual)}`);
      }
    }
    const transitionEvidence = Object.fromEntries(layerSequence.map(({ sceneId, camera }) => [sceneId, camera]));
    if (transitionEvidence.beta.args[0].duration !== 160 || transitionEvidence.gamma.args[0].duration !== 120
      || Object.hasOwn(transitionEvidence.alpha.args[0], 'duration')) {
      throw new Error(`Authored camera transitions were not preserved: ${JSON.stringify(transitionEvidence)}`);
    }

    await client.send('Emulation.setEmulatedMedia', {
      media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    await evaluate(client, clickButton('Preview Story'));
    await setViewport(1366, 768);
    const scrollInitial = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview'); const child = frame?.contentDocument;
      const map = child?.getElementById('map')?.getBoundingClientRect();
      const stage = child?.getElementById('scene-compositor')?.getBoundingClientRect();
      const steps = [...(child?.querySelectorAll('.scroll-story__step') ?? [])];
      const layoutWidth = child?.documentElement.clientWidth;
      return new URL(frame.src).searchParams.get('outputMode') === 'scroll'
        && Number(frame.dataset.previewRevision) === 3 && child?.defaultView.innerWidth === 1366 && child.defaultView.innerHeight === 768
        && steps.length === 3 && steps.every((step) => child.defaultView.getComputedStyle(step).pointerEvents === 'none')
        && map.left === 0 && map.top === 0 && map.width === layoutWidth && map.height === 768
        && Math.abs(stage.width / stage.height - 16 / 9) < .001 && Math.abs(stage.left - (1366 - stage.width) / 2) < 1
        && child.documentElement.scrollHeight >= 768 * 3 && child.querySelectorAll('.maplibregl-canvas').length === 1
        ? { viewport: [1366, 768], layoutViewport: [layoutWidth, 768], map: { left: map.left, top: map.top, width: map.width, height: map.height },
          stage: { left: stage.left, top: stage.top, width: stage.width, height: stage.height }, steps: steps.length,
          documentScrollHeight: child.documentElement.scrollHeight } : null;
    })()`, '1366 x 768 Scroll Story layout');
    await instrumentRuntime();
    const scrollActivate = async (index, sceneId, certifyCooperative = false) => {
      await clearRuntimeCalls();
      const before = await evaluate(client, `document.getElementById('production-preview').contentWindow.scrollY`);
      await evaluate(client, `(() => {
        const child = document.getElementById('production-preview').contentWindow;
        const step = child.document.querySelectorAll('.scroll-story__step')[${index}];
        child.scrollTo({ top: step.offsetTop, behavior: 'auto' }); return true;
      })()`);
      await waitFor(client, `(() => {
        const child = document.getElementById('production-preview').contentDocument;
        return child.getElementById('scene-compositor')?.dataset.sceneId === ${JSON.stringify(sceneId)}
          && child.querySelector('.scroll-story__step[aria-current="step"]')?.dataset.sceneIndex === '${index}';
      })()`, `Scroll Story ${sceneId}`);
      const after = await evaluate(client, `document.getElementById('production-preview').contentWindow.scrollY`);
      const calls = await runtimeCalls();
      const camera = calls.filter(({ name }) => ['flyTo', 'easeTo', 'jumpTo'].includes(name));
      if (camera.length !== 1 || camera[0].name !== 'jumpTo') {
        throw new Error(`Reduced-motion cooperative Scroll activation failed: ${JSON.stringify(calls)}`);
      }
      let cooperativeScroll = null;
      if (certifyCooperative) {
        await wheelMap(client, 80);
        cooperativeScroll = await waitFor(client, `(() => {
          const child = document.getElementById('production-preview').contentWindow;
          return child.scrollY > ${after} && child.document.getElementById('scene-compositor')?.dataset.sceneId === ${JSON.stringify(sceneId)}
            ? { before: ${after}, after: child.scrollY, sceneId: ${JSON.stringify(sceneId)} } : null;
        })()`, 'native cooperative map-wheel scrolling');
        const wheelCalls = await runtimeCalls();
        if (wheelCalls.filter(({ name }) => ['flyTo', 'easeTo', 'jumpTo'].includes(name)).length !== 1) {
          throw new Error(`Cooperative map wheel duplicated Scene execution: ${JSON.stringify(wheelCalls)}`);
        }
      }
      return { sceneId, before, after, camera: camera[0].name, cooperativeScroll };
    };
    const scrollNavigation = [
      await scrollActivate(1, 'beta', true),
      await scrollActivate(0, 'alpha'),
      await scrollActivate(1, 'beta')
    ];
    if (!(scrollNavigation[0].after > scrollNavigation[0].before
      && scrollNavigation[1].after < scrollNavigation[1].before
      && scrollNavigation[2].after > scrollNavigation[2].before)) {
      throw new Error(`Scroll direction evidence failed: ${JSON.stringify(scrollNavigation)}`);
    }
    const richAccessibility = await evaluate(client, `(() => {
      const child = document.getElementById('production-preview').contentDocument;
      const image = child.querySelector('.content-image img'); const decorativeIcon = child.querySelector('.content-legend img');
      const table = child.querySelector('.content-table table'); const chart = child.querySelector('.content-chart canvas');
      const fallback = child.querySelector('.content-chart__data'); const text = child.querySelector('[data-semantic-type="heading"]');
      const nodes = [image, table, chart, fallback, text, child.querySelector('.content-legend'), child.querySelector('.presentation-metrics')];
      const dimensions = nodes.map((node) => { const rect = node?.getBoundingClientRect(); return [rect?.width ?? 0, rect?.height ?? 0]; });
      return { imageAlt: image?.alt, decorativeAlt: decorativeIcon?.alt, tableHeadings: table?.querySelectorAll('th[scope="col"]').length,
        chartRole: chart?.getAttribute('role'), chartLabel: chart?.getAttribute('aria-label'), fallbackRows: fallback?.querySelectorAll('tbody tr').length,
        visibleText: text?.textContent, dimensions };
    })()`);
    if (richAccessibility.imageAlt !== 'Stylized blue route with an amber stop' || richAccessibility.decorativeAlt !== ''
      || richAccessibility.tableHeadings !== 2 || richAccessibility.chartRole !== 'img'
      || !/Ridership/.test(richAccessibility.chartLabel) || richAccessibility.fallbackRows !== 2
      || !/PR D persistence/.test(richAccessibility.visibleText)
      || richAccessibility.dimensions.some(([width, height]) => width <= 0 || height <= 0)) {
      throw new Error(`Rich accessibility certification failed: ${JSON.stringify(richAccessibility)}`);
    }

    await client.send('Emulation.setEmulatedMedia', {
      media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
    });
    await setViewport(1920, 1080);
    await evaluate(client, clickButton('Present'));
    const presentation1920 = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview'); const child = frame?.contentDocument;
      const map = child?.getElementById('map')?.getBoundingClientRect(); const stage = child?.getElementById('scene-compositor')?.getBoundingClientRect();
      if (!map || !stage || child.getElementById('scene-compositor').dataset.outputMode !== 'presentation'
        || !child.getElementById('scene-compositor').classList.contains('presentation-stage')) return null;
      child.defaultView.__PR_D_PRESENTATION_CANVAS__ = child.querySelector('.maplibregl-canvas');
      return map.left === stage.left && map.top === stage.top && map.width === stage.width && map.height === stage.height
        && stage.left === 0 && stage.top === 0 && stage.width === 1920 && stage.height === 1080
        && child.querySelectorAll('.maplibregl-canvas').length === 1
        ? { viewport: [1920, 1080], map: { left: map.left, top: map.top, width: map.width, height: map.height },
          stage: { left: stage.left, top: stage.top, width: stage.width, height: stage.height } } : null;
    })()`, 'Presentation exact 1920 x 1080 same stage');
    await instrumentRuntime();
    const presentationNavigate = async (operation, sceneId) => {
      await clearRuntimeCalls();
      await evaluate(client, operation);
      await waitFor(client, `document.getElementById('production-preview').contentDocument
        ?.getElementById('scene-compositor')?.dataset.sceneId === ${JSON.stringify(sceneId)}`, `Presentation ${sceneId}`);
      const calls = await runtimeCalls();
      const cameras = calls.filter(({ name }) => ['flyTo', 'easeTo', 'jumpTo'].includes(name));
      if (cameras.length !== 1) throw new Error(`Duplicate Presentation activation: ${JSON.stringify(calls)}`);
      return { sceneId, camera: cameras[0].name };
    };
    const presentationNavigation = [];
    presentationNavigation.push(await presentationNavigate(`(() => {
      const child = document.getElementById('production-preview').contentDocument;
      [...child.querySelectorAll('#runtime-navigation button')].find((button) => button.textContent === 'Next').click(); return true;
    })()`, 'beta'));
    presentationNavigation.push(await presentationNavigate(`(() => {
      const child = document.getElementById('production-preview').contentDocument;
      [...child.querySelectorAll('#runtime-navigation button')].find((button) => button.textContent === 'Previous').click(); return true;
    })()`, 'alpha'));
    presentationNavigation.push(await presentationNavigate(`(() => {
      const child = document.getElementById('production-preview').contentWindow;
      child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); return true;
    })()`, 'beta'));
    presentationNavigation.push(await presentationNavigate(`(() => {
      const child = document.getElementById('production-preview').contentWindow;
      child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })); return true;
    })()`, 'gamma'));
    presentationNavigation.push(await presentationNavigate(`(() => {
      const child = document.getElementById('production-preview').contentWindow;
      child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true })); return true;
    })()`, 'beta'));
    const presentationSameCanvasNavigation = await evaluate(client, `(() => {
      const child = document.getElementById('production-preview').contentDocument;
      return child.querySelector('.maplibregl-canvas') === child.defaultView.__PR_D_PRESENTATION_CANVAS__
        && child.querySelectorAll('.maplibregl-canvas').length === 1;
    })()`);
    if (!presentationSameCanvasNavigation) throw new Error('Presentation navigation replaced the active MapLibre map.');

    await setViewport(1200, 900);
    await evaluate(client, clickButton('Present'));
    const presentationLetterbox = await waitFor(client, `(() => {
      const child = document.getElementById('production-preview').contentDocument;
      const map = child?.getElementById('map')?.getBoundingClientRect(); const stage = child?.getElementById('scene-compositor')?.getBoundingClientRect();
      if (child?.getElementById('scene-compositor')?.dataset.outputMode !== 'presentation') return null;
      child.defaultView.__PR_D_PRESENTATION_CANVAS__ = child.querySelector('.maplibregl-canvas');
      const sameCanvas = Boolean(child.defaultView.__PR_D_PRESENTATION_CANVAS__);
      return map && stage && map.left === stage.left && map.top === stage.top && map.width === stage.width && map.height === stage.height
        && Math.abs(stage.width - 1200) < 1 && Math.abs(stage.height - 675) < 1 && Math.abs(stage.top - 112.5) < 1
        && sameCanvas && child.querySelectorAll('.maplibregl-canvas').length === 1
        ? { viewport: [1200, 900], map: { left: map.left, top: map.top, width: map.width, height: map.height },
          stage: { left: stage.left, top: stage.top, width: stage.width, height: stage.height }, sameCanvas } : null;
    })()`, 'Presentation neutral letterbox');
    await evaluate(client, `(() => {
      const child = document.getElementById('production-preview').contentWindow;
      child.dispatchEvent(new child.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true;
    })()`);
    const presentationEscape = await waitFor(client, `(() => {
      const child = document.getElementById('production-preview').contentDocument;
      const stage = child?.getElementById('scene-compositor'); const canvas = child?.querySelector('.maplibregl-canvas');
      return stage && !Object.hasOwn(stage.dataset, 'outputMode') && child.getElementById('runtime-navigation').hidden
        && canvas === child.defaultView.__PR_D_PRESENTATION_CANVAS__ && canvas.getBoundingClientRect().width > 0
        && child.querySelectorAll('.maplibregl-canvas').length === 1
        ? { exited: true, sameCanvas: true, maps: 1 } : null;
    })()`, 'Presentation Escape and resize lifecycle');

    await client.send('Emulation.clearDeviceMetricsOverride');
    await evaluate(client, `(() => {
      const frame = document.getElementById('production-preview');
      Object.assign(frame.style, { position: '', left: '', top: '', width: '', height: '', maxWidth: '', maxHeight: '', border: '', zIndex: '' });
      return true;
    })()`);
    await evaluate(client, `(async () => {
      const manifest = await fetch('../project.json').then((response) => response.json());
      const declared = [
        ...manifest.stories.items.map((item) => ({ path: item.src.slice(2), kind: 'story', mediaType: 'application/json' })),
        ...Object.values(manifest.datasets).map((item) => ({ path: item.src.slice(2), kind: 'dataset', mediaType: item.type === 'geojson' ? 'application/geo+json' : 'application/json' })),
        ...Object.values(manifest.assets).map((item) => ({ path: item.src.slice(2), kind: 'asset', mediaType: item.mediaType })),
        ...(manifest.metrics ? [{ path: manifest.metrics.src.slice(2), kind: 'metrics', mediaType: 'application/json' }] : [])
      ];
      const encoder = new TextEncoder();
      const entries = [{ path: 'project.json', bytes: encoder.encode(JSON.stringify(manifest)), kind: 'manifest', mediaType: 'application/json', managed: true }];
      for (const item of declared) entries.push({ ...item,
        bytes: new Uint8Array(await fetch('../' + item.path).then((response) => response.arrayBuffer())), managed: true });
      await window.__GUI_EDITOR__.openEntries(entries, { label: 'Route 61-2 performance benchmark' });
      return true;
    })()`);
    await waitFor(client, `(() => {
      const child = document.getElementById('production-preview').contentDocument;
      return child?.querySelectorAll('.maplibregl-canvas').length === 1
        && child.getElementById('capability-controls')?.textContent.includes('Compare');
    })()`, 'Route 61-2 benchmark content');

    const performanceSample = async (width, height) => {
      await setViewport(width, height);
      return evaluate(client, `(async () => {
        const frame = document.getElementById('production-preview'); const child = frame.contentWindow;
        const sampleDurationMs = 1000; let observedFrameCount = 0; const started = child.performance.now();
        let ended = started;
        await new Promise((resolve) => {
          const tick = (now) => {
            observedFrameCount += 1; ended = now;
            if (now - started >= sampleDurationMs) resolve();
            else child.requestAnimationFrame(tick);
          };
          child.requestAnimationFrame(tick);
        });
        const observedDurationMs = ended - started;
        const rawApproximateFps = observedFrameCount * 1000 / observedDurationMs;
        const canvas = child.document.querySelector('.maplibregl-canvas');
        const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
        return { viewport: { width: ${width}, height: ${height} }, sampleDurationMs, observedDurationMs,
          observedFrameCount, rawApproximateFps, mapCanvasCount: child.document.querySelectorAll('.maplibregl-canvas').length,
          outputMode: 'explore', environment: { userAgent: child.navigator.userAgent, platform: child.navigator.platform,
            devicePixelRatio: child.devicePixelRatio, webglRenderer: gl?.getParameter(gl.RENDERER) ?? 'unavailable' } };
      })()`);
    };
    const performance = {
      '1920x1080': await performanceSample(1920, 1080),
      '1366x768': await performanceSample(1366, 768)
    };
    for (const sample of Object.values(performance)) {
      if (sample.mapCanvasCount !== 1 || sample.observedFrameCount <= 0 || sample.observedDurationMs < sample.sampleDurationMs) {
        throw new Error(`Invalid raw performance sample: ${JSON.stringify(sample)}`);
      }
    }
    if (consoleIssues.length) throw new Error(`Unexpected browser console issues: ${JSON.stringify(consoleIssues)}`);

    const result = {
      gate: 'pr-d', folderReopen, zipReopen, validUnsaved: { scroll: validUnsavedScroll, presentation: validUnsavedPresentation },
      invalidLastValid: { scroll: invalidLastValidScroll, presentation: invalidLastValidPresentation },
      desktopGeometry: { '1920x1080': desktop1920, '1366x768': scrollInitial },
      transitions: transitionEvidence, layerSequence: layerSequence.map(({ sceneId, layers }) => ({ sceneId, layers })),
      richAccessibility, scrollNavigation,
      presentation: { exactStage: presentation1920, navigation: presentationNavigation, letterbox: presentationLetterbox, escape: presentationEscape },
      performance, oneMap: true, console: 'clean'
    };

    const prC = spawnSync(process.execPath, [
      fileURLToPath(new URL('./map-story-studio-pr-c-browser-smoke.mjs', import.meta.url)),
      ...process.argv.slice(2)
    ], { stdio: 'inherit', env: process.env });
    if ((prC.status ?? 1) !== 0) throw new Error(`PR C compatibility gate failed with exit code ${prC.status}.`);
    result.prCMarker = 'MAP_STORY_STUDIO_PR_C_RESULT: PASS';
    console.log(JSON.stringify(result));
    console.log('MAP_STORY_STUDIO_PR_D_RESULT: PASS');
    return;
  } finally {
    await client.send('Emulation.setEmulatedMedia', { media: '', features: [] }).catch(() => {});
    await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    client.close();
  }
}

if (GATE === 'pr-d') {
  await runPrDGate();
  process.exit(0);
}

const target = await pageTarget();
const client = new CdpClient(target.webSocketDebuggerUrl);
await client.open();
const consoleIssues = [];
client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
  consoleIssues.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
});
client.on('Log.entryAdded', ({ entry }) => {
  if (entry.level === 'error' && !/favicon\.ico/i.test(`${entry.url ?? ''} ${entry.text}`)) consoleIssues.push(entry.text);
});

try {
  await Promise.all([client.send('Runtime.enable'), client.send('Log.enable'), client.send('Page.enable')]);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client,
    `document.readyState === 'complete' && Boolean(document.getElementById('new-project')) && Boolean(window.__GUI_EDITOR__)`,
    'Map Story Studio shell');
  await evaluate(client, `document.getElementById('new-project').click()`);

  const initial = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const child = frame?.contentDocument;
    const source = new URL(frame.src);
    const result = {
      revision: Number(frame?.dataset.previewRevision),
      maps: child?.querySelectorAll('.maplibregl-canvas').length ?? 0,
      scenes: document.querySelectorAll('.studio-scene-list button').length,
      neutral: child?.getElementById('scene-compositor')?.childElementCount === 0
        && child?.getElementById('runtime-navigation')?.hidden === true
        && child?.getElementById('capability-controls')?.hidden === true,
      generic: source.pathname.endsWith('/src/runtime/')
    };
    return result.revision === 0 && result.maps === 1 && result.scenes === 1 && result.neutral && result.generic ? result : null;
  })()`, 'production-valid neutral Story 1.2 New project');

  await evaluate(client, clickButton('Add Scene'));
  let revision = await waitForRevision(client, initial.revision, 2, 'add Scene revision');
  await evaluate(client, clickButton('Duplicate Scene'));
  revision = await waitForRevision(client, revision, 3, 'duplicate Scene revision');
  await evaluate(client, clickButton('Move Scene Up'));
  revision = await waitForRevision(client, revision, 3, 'reorder Scene revision');
  await evaluate(client, clickButton('Delete Scene'));
  revision = await waitForRevision(client, revision, 2, 'delete Scene revision');

  await evaluate(client, clickButton('Map'));
  await wheelMap(client, -360);
  await waitFor(client,
    `/Camera changed/.test(document.getElementById('studio-camera-status')?.textContent ?? '')`,
    'working camera movement');
  const movementRevision = await evaluate(client, `Number(document.getElementById('production-preview').dataset.previewRevision)`);
  if (movementRevision !== revision) throw new Error('Map movement created a Story revision.');

  await evaluate(client, clickButton('Capture Camera'));
  revision = await waitForRevision(client, revision, 2, 'Capture Camera single revision');
  await waitFor(client,
    `/matches saved Scene/.test(document.getElementById('studio-camera-status')?.textContent ?? '')`,
    'captured camera');

  await evaluate(client, clickButton('Map'));
  await wheelMap(client, 320);
  await waitFor(client,
    `/Camera changed/.test(document.getElementById('studio-camera-status')?.textContent ?? '')`,
    'second working camera movement');
  await evaluate(client, clickButton('Restore Saved Camera'));
  await waitFor(client,
    `/matches saved Scene/.test(document.getElementById('studio-camera-status')?.textContent ?? '')`,
    'saved camera restoration');
  const restoreRevision = await evaluate(client, `Number(document.getElementById('production-preview').dataset.previewRevision)`);
  if (restoreRevision !== revision) throw new Error('Restore Saved Camera created a Story revision.');

  const switchRestoration = await evaluate(client, `(() => {
    const buttons = [...document.querySelectorAll('.studio-scene-list button')];
    buttons[0].click();
    buttons[1].click();
    return Number(document.getElementById('production-preview').dataset.previewRevision);
  })()`);
  if (switchRestoration !== revision) throw new Error('Scene switching created a Story revision.');

  await evaluate(client, `(async () => {
    const manifest = {
      schemaVersion: '1.0', id: 'layer-restore', title: 'Layer restore', locale: 'en-US',
      stories: { primary: 'main', items: [{ id: 'main', src: './stories/main.story.json' }] },
      map: { basemap: 'openfreemap-dark', initialView: { center: [106.63, 11.06], zoom: 10, pitch: 0, bearing: 0 } },
      datasets: { route: { type: 'geojson', geometry: 'line', src: './data/route.geojson', label: 'Route', render: { type: 'line', color: '#2BB7FF', width: 4 } } },
      assets: {}, focusTargets: {}, capabilities: [], attribution: {}
    };
    const scene = (id, visible) => ({ id, content: { layout: 'freeform-16x9', blocks: [] }, map: {
      camera: { center: [106.63, 11.06], zoom: 10, pitch: 0, bearing: 0 }, interaction: 'locked',
      transition: { type: 'instant', durationMs: 0 }, layerVisibility: { route: visible }, enter: [], exit: []
    } });
    const story = { schemaVersion: '1.2', id: 'main', title: 'Layer restore', states: [scene('visible', true), scene('hidden', false)] };
    const route = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[106.6, 11], [106.7, 11.1]] } }] };
    const bytes = (value) => new TextEncoder().encode(JSON.stringify(value) + '\\n');
    await window.__GUI_EDITOR__.openEntries([
      { path: 'project.json', bytes: bytes(manifest), kind: 'manifest', mediaType: 'application/json', managed: true },
      { path: 'stories/main.story.json', bytes: bytes(story), kind: 'story', mediaType: 'application/json', managed: true },
      { path: 'data/route.geojson', bytes: bytes(route), kind: 'dataset', mediaType: 'application/geo+json', managed: true }
    ], { label: 'Scene layer restoration gate' });
    return true;
  })()`);
  await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const checkbox = document.querySelector('.studio-layer input[type="checkbox"]');
    return Number(frame.dataset.previewRevision) === 0
      && frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1
      && checkbox?.checked === true;
  })()`, 'visible saved layer Scene');
  const layerRestoration = await evaluate(client, `(() => {
    const scenes = [...document.querySelectorAll('.studio-scene-list button')];
    scenes[1].click();
    const hidden = document.querySelector('.studio-layer input[type="checkbox"]').checked === false;
    scenes[0].click();
    const visible = document.querySelector('.studio-layer input[type="checkbox"]').checked === true;
    return { hidden, visible, revision: Number(document.getElementById('production-preview').dataset.previewRevision) };
  })()`);
  if (!layerRestoration.hidden || !layerRestoration.visible || layerRestoration.revision !== 0) {
    throw new Error(`Saved layer restoration failed: ${JSON.stringify(layerRestoration)}`);
  }

  await evaluate(client, `(async () => {
    const manifest = await fetch('../project.json').then((response) => response.json());
    const declared = [
      ...manifest.stories.items.map((item) => ({ path: item.src.slice(2), kind: 'story', mediaType: 'application/json' })),
      ...Object.values(manifest.datasets).map((item) => ({ path: item.src.slice(2), kind: 'dataset', mediaType: item.type === 'geojson' ? 'application/geo+json' : 'application/json' })),
      ...Object.values(manifest.assets).map((item) => ({ path: item.src.slice(2), kind: 'asset', mediaType: item.mediaType })),
      ...(manifest.metrics ? [{ path: manifest.metrics.src.slice(2), kind: 'metrics', mediaType: 'application/json' }] : [])
    ];
    const entries = [{ path: 'project.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)), kind: 'manifest', mediaType: 'application/json', managed: true }];
    for (const item of declared) entries.push({ ...item, bytes: new Uint8Array(await fetch('../' + item.path).then((response) => response.arrayBuffer())), managed: true });
    await window.__GUI_EDITOR__.openEntries(entries, { label: 'Route 61-2 compatibility gate' });
    return true;
  })()`);
  const legacyRoute = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const child = frame.contentDocument;
    return Number(frame.dataset.previewRevision) === 0
      && child?.querySelectorAll('.maplibregl-canvas').length === 1
      && child?.getElementById('presentation-open')
      && new URL(frame.src).pathname.endsWith('/') ? { maps: 1 } : null;
  })()`, 'Route 61-2 legacy production preview');

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: true
  });
  await client.send('Page.navigate', { url: new URL('../', APP_URL).href });
  const mobile = await waitFor(client, `(() => {
    if (document.readyState !== 'complete') return null;
    const maps = document.querySelectorAll('.maplibregl-canvas').length;
    return maps === 1 && document.getElementById('presentation-open')
      ? { maps, width: innerWidth, height: innerHeight } : null;
  })()`, '390 x 844 Route 61-2 production smoke');
  if (mobile.width !== 390 || mobile.height !== 844) throw new Error(`Unexpected mobile viewport: ${JSON.stringify(mobile)}`);

  if (consoleIssues.length) throw new Error(`Unexpected browser console issues: ${JSON.stringify(consoleIssues)}`);

  console.log(JSON.stringify({
    gate: GATE,
    story12: 'valid',
    neutralShell: true,
    sceneLifecycle: ['add', 'duplicate', 'reorder', 'delete'],
    revisions: { movement: 0, capture: 1, restore: 0 },
    cameraRestoration: true,
    layerRestoration,
    oneMap: initial.maps === 1 && legacyRoute.maps === 1 && mobile.maps === 1,
    legacyRoute61_2: true,
    mobile: { width: 390, height: 844 },
    console: 'clean'
  }));
  console.log('MAP_STORY_STUDIO_PR_A_RESULT: PASS');
} finally {
  await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  client.close();
}
