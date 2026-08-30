const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=')];
}));

const GATE = args.get('--gate') ?? 'pr-a';
const APP_URL = args.get('--url') ?? 'http://127.0.0.1:8080/editor/';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = 30_000;

if (GATE !== 'pr-a') throw new Error(`Unsupported Map Story Studio browser gate: ${GATE}`);

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
