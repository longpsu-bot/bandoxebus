const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=')];
}));

const APP_URL = args.get('--url') ?? 'http://127.0.0.1:8080/editor/';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = 90_000;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); this.listeners = new Map(); }
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
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
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
  on(method, listener) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]); }
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
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(client, expression, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression).catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const target = await pageTarget();
const client = new CdpClient(target.webSocketDebuggerUrl);
await client.open();
const consoleIssues = [];
client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => consoleIssues.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
client.on('Log.entryAdded', ({ entry }) => {
  if (entry.level === 'error' && !/favicon\.ico/i.test(`${entry.url ?? ''} ${entry.text}`)) consoleIssues.push(entry.text);
});

try {
  await Promise.all([client.send('Runtime.enable'), client.send('Log.enable'), client.send('Page.enable')]);
  await client.send('Page.reload', { ignoreCache: true });
  await waitFor(client, `document.readyState === 'complete' && Boolean(window.__GUI_EDITOR__)`, 'Studio');

  await evaluate(client, `window.__GUI_EDITOR__.newProject('blank')`);
  const blank = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview'); const child = frame?.contentDocument;
    return child?.querySelectorAll('.maplibregl-canvas').length === 1
      && child.getElementById('scene-compositor') && !child.getElementById('presentation-open')
      ? { maps: 1, path: new URL(frame.src).pathname, controlsHidden: child.getElementById('capability-controls').hidden,
        routeModules: child.defaultView.performance.getEntriesByType('resource').map(({ name }) => new URL(name).pathname)
          .filter((path) => path.startsWith('/src/route-61-2/')) } : null;
  })()`, 'neutral Blank root');
  if (/src\/runtime/.test(blank.path) || !blank.controlsHidden || blank.routeModules.length) {
    throw new Error(`Blank did not use a Route-independent neutral root: ${JSON.stringify(blank)}`);
  }

  const templates = {};
  for (const [id, scenes] of [['route-proposal', 5], ['network-service-plan', 3]]) {
    await evaluate(client, `window.__GUI_EDITOR__.newProject(${JSON.stringify(id)})`);
    templates[id] = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      const count = document.querySelectorAll('.studio-scene-list button').length;
      return count === ${scenes} && frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1
        ? { scenes: count, maps: 1 } : null;
    })()`, `${id} template`);
  }

  const importChoices = await evaluate(client, `(() => {
    document.getElementById('new-project').click(); document.getElementById('choose-import-existing').click();
    const area = document.getElementById('import-existing-choices');
    return !area.hidden && [...area.querySelectorAll('button')].map((button) => button.textContent.trim());
  })()`);
  if (!importChoices.includes('Open Folder') || !importChoices.includes('Import ZIP')) throw new Error('Import Existing did not reuse certified paths.');

  await evaluate(client, `(async () => {
    document.getElementById('project-template-chooser').close();
    const manifest = {
      schemaVersion: '1.0', id: 'rich-browser', title: 'Rich browser', locale: 'en-US',
      stories: { primary: 'main', items: [{ id: 'main', src: './stories/main.story.json' }] },
      map: { basemap: 'openfreemap-dark', initialView: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 } },
      datasets: { demand: { type: 'table-json', src: './data/demand.json', label: 'Demand' } },
      assets: { photo: { type: 'image', src: './assets/photo.svg', mediaType: 'image/svg+xml' } },
      focusTargets: {}, metrics: { src: './data/metrics.json' }, capabilities: [], attribution: {}
    };
    const story = { schemaVersion: '1.2', id: 'main', title: 'Rich browser', states: [{ id: 'opening',
      content: { layout: 'freeform-16x9', blocks: [] }, map: { camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 },
      interaction: 'locked', transition: { type: 'instant', durationMs: 0 }, layerVisibility: {}, enter: [], exit: [] } }] };
    const table = { schemaVersion: '1.0', columns: [{ id: 'period', label: 'Period', type: 'text' }, { id: 'trips', label: 'Trips', type: 'integer' }], rows: [{ period: 'Peak', trips: 12 }] };
    const metrics = { schemaVersion: '1.0', metrics: { ridership: { label: 'Ridership', value: 12, format: { type: 'integer' } } } };
    const encoder = new TextEncoder(); const json = (value) => encoder.encode(JSON.stringify(value) + '\\n');
    const svg = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>');
    await window.__GUI_EDITOR__.openEntries([
      { path: 'project.json', bytes: json(manifest), kind: 'manifest', mediaType: 'application/json', managed: true },
      { path: 'stories/main.story.json', bytes: json(story), kind: 'story', mediaType: 'application/json', managed: true },
      { path: 'data/demand.json', bytes: json(table), kind: 'dataset', mediaType: 'application/json', managed: true },
      { path: 'data/metrics.json', bytes: json(metrics), kind: 'metrics', mediaType: 'application/json', managed: true },
      { path: 'assets/photo.svg', bytes: svg, kind: 'asset', mediaType: 'image/svg+xml', managed: true }
    ], { label: 'Rich browser package' });
  })()`);
  await waitFor(client, `document.getElementById('production-preview').contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1`, 'rich package');
  for (const label of ['Metric', 'Chart', 'Table', 'Image', 'Legend']) {
    const confirmation = {
      Chart: 'studio-insert-chart-add', Table: 'studio-insert-table-add', Image: 'studio-insert-image-add'
    }[label];
    await evaluate(client, `(() => {
      const insert = [...document.querySelectorAll('button')].find((button) => button.textContent === ${JSON.stringify(label)});
      if (!insert) throw new Error('Unavailable rich Insert action: ' + ${JSON.stringify(label)});
      insert.click();
      const confirmation = ${JSON.stringify(confirmation)};
      if (confirmation) {
        const add = document.getElementById(confirmation);
        if (!add) throw new Error('Unavailable rich Insert confirmation: ' + confirmation);
        add.click();
      }
      return true;
    })()`);
  }
  const rich = await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const types = [...child.querySelectorAll('.scene-overlay')].map((node) => node.dataset.semanticType);
    return types.length === 5 ? { types, maps: child.querySelectorAll('.maplibregl-canvas').length } : null;
  })()`, 'rich semantic objects');
  for (const type of ['stat-group', 'chart', 'table', 'image', 'legend']) if (!rich.types.includes(type)) throw new Error(`Missing rich type ${type}.`);

  const zipSize = await evaluate(client, `(async () => {
    const bytes = await window.__GUI_EDITOR__.exportZip();
    await window.__GUI_EDITOR__.importZip(bytes, { label: 'Rich reopen.zip' });
    return bytes.length;
  })()`);
  if (!(zipSize > 0)) throw new Error('ZIP reopen produced no package bytes.');
  await waitFor(client, `document.getElementById('production-preview').contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1`, 'ZIP reopen');

  await evaluate(client, `(async () => {
    const manifest = await fetch('../project.json').then((response) => response.json());
    const declared = [
      ...manifest.stories.items.map((item) => ({ path: item.src.slice(2), kind: 'story', mediaType: 'application/json' })),
      ...Object.values(manifest.datasets).map((item) => ({ path: item.src.slice(2), kind: 'dataset', mediaType: item.type === 'geojson' ? 'application/geo+json' : 'application/json' }))
    ];
    const encoder = new TextEncoder();
    const entries = [{ path: 'project.json', bytes: encoder.encode(JSON.stringify(manifest)), kind: 'manifest', mediaType: 'application/json', managed: true }];
    for (const item of declared) entries.push({ ...item, bytes: new Uint8Array(await fetch('../' + item.path).then((response) => response.arrayBuffer())), managed: true });
    await window.__GUI_EDITOR__.openEntries(entries, { label: 'Route compatibility' });
  })()`);
  const route = await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const labels = [...child.querySelectorAll('#capability-controls button, #capability-controls label')].map((node) => node.textContent.trim());
    const beacons = child.querySelectorAll('.transport-poi-beacon').length;
    const buses = child.querySelectorAll('.bus-marker').length;
    return child.querySelectorAll('.maplibregl-canvas').length === 1 && labels.includes('Existing') && labels.includes('Compare')
      && labels.includes('Route reveal') && beacons === 3 && buses === 2
      ? { maps: 1, labels, beacons, buses } : null;
  })()`, 'trusted Route controls');
  for (const label of ['Difference', 'Existing', 'Proposed', 'Compare', 'Route reveal', 'POI emphasis', 'Urban context', 'Simulation']) {
    if (!route.labels.includes(label)) throw new Error(`Missing trusted Route control ${label}.`);
  }
  const routeBehavior = await evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const clickText = (selector, text) => [...child.querySelectorAll(selector)].find((node) => node.textContent.trim() === text).click();
    const map = child.getElementById('map'); const modes = {};
    for (const [label, mode] of [['Difference', 'difference'], ['Existing', 'existing'], ['Proposed', 'proposed'], ['Compare', 'compare']]) {
      clickText('#capability-controls button', label);
      modes[mode] = {
        mode: map.dataset.routeMode,
        existingVisible: map.dataset.routeExistingVisible,
        proposedVisible: map.dataset.routeProposedVisible,
        existingOffset: map.dataset.routeExistingOffset,
        proposedOffset: map.dataset.routeProposedOffset,
        stopMode: map.dataset.routeStopMode
      };
    }
    clickText('#capability-controls label', 'Route reveal');
    clickText('#capability-controls label', 'Route reveal');
    for (const label of ['POI emphasis', 'Urban context', 'Simulation']) clickText('#capability-controls label', label);
    return { mode: map.dataset.routeMode, modes, reveal: map.dataset.routeReveal, poi: map.dataset.poiEmphasis,
      urban: map.dataset.urbanContext, simulation: map.dataset.simulationActive };
  })()`);
  const expectedModes = {
    difference: { mode: 'difference', existingVisible: 'false', proposedVisible: 'false', existingOffset: '0', proposedOffset: '0', stopMode: 'difference' },
    existing: { mode: 'existing', existingVisible: 'true', proposedVisible: 'false', existingOffset: '0', proposedOffset: '0', stopMode: 'existing' },
    proposed: { mode: 'proposed', existingVisible: 'false', proposedVisible: 'true', existingOffset: '0', proposedOffset: '0', stopMode: 'proposed' },
    compare: { mode: 'compare', existingVisible: 'true', proposedVisible: 'true', existingOffset: '-4.5', proposedOffset: '4.5', stopMode: 'proposed' }
  };
  if (JSON.stringify(routeBehavior.modes) !== JSON.stringify(expectedModes)
    || routeBehavior.mode !== 'compare' || routeBehavior.reveal !== 'true' || routeBehavior.poi !== 'true'
    || routeBehavior.urban !== 'industrial-context' || routeBehavior.simulation !== 'true') {
    throw new Error(`Trusted Route behavior failed: ${JSON.stringify(routeBehavior)}`);
  }
  const routeVisuals = await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const map = child.getElementById('map');
    const beacons = [...child.querySelectorAll('.transport-poi-beacon')];
    const buses = [...child.querySelectorAll('.bus-marker:not([hidden])')];
    const movingBuses = buses.filter((node) => Number(node.dataset.simulationDistance) > 0);
    const provider = map.dataset.urbanContextProvider;
    return beacons.length === 3 && beacons.every((node) => node.classList.contains('is-emphasized'))
      && buses.length === 2 && movingBuses.length === 2 && map.dataset.urbanLayerVisible === 'true'
      && map.dataset.urbanGroundState === 'visible' && ['overture', 'synthetic-v2'].includes(provider)
      ? { emphasizedBeacons: beacons.length, visibleBuses: buses.length, movingBuses: movingBuses.length,
        urbanLayerVisible: true, urbanContextProvider: provider,
        urbanContextState: map.dataset.urbanContextState, urbanGroundState: map.dataset.urbanGroundState } : null;
  })()`, 'visible Route POI, urban, and simulation behavior');

  await evaluate(client, `(async () => {
    const fixtureBase = '../tests/fixtures/well-rounded-template-v1/';
    const manifest = await fetch(fixtureBase + 'project.json').then((response) => response.json());
    const declared = [
      ...manifest.stories.items.map((item) => ({ path: item.src.slice(2), kind: 'story', mediaType: 'application/json' })),
      ...Object.values(manifest.datasets).map((item) => ({ path: item.src.slice(2), kind: 'dataset',
        mediaType: item.type === 'geojson' ? 'application/geo+json' : 'application/json' })),
      ...Object.values(manifest.assets).map((item) => ({ path: item.src.slice(2), kind: 'asset', mediaType: item.mediaType })),
      ...(manifest.metrics ? [{ path: manifest.metrics.src.slice(2), kind: 'metrics', mediaType: 'application/json' }] : [])
    ];
    const encoder = new TextEncoder();
    const entries = [{ path: 'project.json', bytes: encoder.encode(JSON.stringify(manifest)),
      kind: 'manifest', mediaType: 'application/json', managed: true }];
    for (const item of declared) entries.push({ ...item,
      bytes: new Uint8Array(await fetch(fixtureBase + item.path).then((response) => response.arrayBuffer())), managed: true });
    await window.__GUI_EDITOR__.openEntries(entries, { label: 'Story 1.1 mobile regression' });
  })()`);
  await waitFor(client, `document.getElementById('production-preview').contentDocument
    ?.querySelectorAll('.maplibregl-canvas').length === 1`, 'Story 1.1 production preview');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    Object.assign(frame.style, { position: 'fixed', inset: '0', width: '390px', height: '844px', border: '0', zIndex: '2147483647' });
    return true;
  })()`);
  const legacy11Mobile = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview'); const child = frame?.contentDocument;
    const content = child?.querySelector('#scene-compositor.presentation-content');
    const heading = content?.querySelector('.presentation-content__title');
    const navigation = child?.querySelector('#runtime-navigation');
    if (!content || !heading || !navigation) return null;
    const contentRect = content.getBoundingClientRect(); const headingRect = heading.getBoundingClientRect();
    const headingStyle = frame.contentWindow.getComputedStyle(heading);
    const contentStyle = frame.contentWindow.getComputedStyle(content);
    const navigationRect = navigation.getBoundingClientRect();
    const visuallyUsable = headingRect.width > 0 && headingRect.height > 0
      && Number.parseFloat(headingStyle.fontSize) >= 20
      && headingStyle.visibility !== 'hidden' && headingStyle.color !== 'rgba(0, 0, 0, 0)'
      && Number.parseFloat(contentStyle.opacity) > 0 && contentRect.width >= 300 && contentRect.height >= 100
      && contentRect.left >= 0 && contentRect.top >= 0
      && contentRect.right <= frame.contentWindow.innerWidth + 1 && contentRect.bottom <= frame.contentWindow.innerHeight + 1
      && navigationRect.width > 0 && navigationRect.height > 0
      && child.documentElement.scrollWidth <= frame.contentWindow.innerWidth + 1;
    return frame?.contentWindow.innerWidth === 390 && frame.contentWindow.innerHeight === 844
      && child?.querySelectorAll('.maplibregl-canvas').length === 1
      && child.getElementById('runtime-status')?.textContent === 'Scene 1 of 6'
      && content.textContent.includes('Route realignment') && visuallyUsable
      ? { width: frame.contentWindow.innerWidth, height: frame.contentWindow.innerHeight, maps: 1, scenes: 6,
        headingFontSize: headingStyle.fontSize, contentWidth: contentRect.width, contentHeight: contentRect.height,
        horizontalOverflow: child.documentElement.scrollWidth - frame.contentWindow.innerWidth } : null;
  })()`, '390 x 844 Story 1.1 production regression');
  const legacy11Navigation = await evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const next = child.querySelector('#runtime-navigation button:last-child'); next.click();
    return { status: child.getElementById('runtime-status').textContent, disabled: next.disabled };
  })()`);
  if (legacy11Navigation.status !== 'Scene 2 of 6' || legacy11Navigation.disabled) {
    throw new Error(`Story 1.1 navigation is not operable: ${JSON.stringify(legacy11Navigation)}`);
  }
  await evaluate(client, `(() => {
    const next = document.getElementById('production-preview').contentDocument.querySelector('#runtime-navigation button:last-child');
    next.click(); next.click(); return true;
  })()`);
  const legacy11RichLayout = await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    if (child.getElementById('runtime-status')?.textContent !== 'Scene 4 of 6') return null;
    const metrics = child.querySelector('.presentation-metrics')?.getBoundingClientRect();
    const table = child.querySelector('.content-table')?.getBoundingClientRect();
    const chart = child.querySelector('.content-chart')?.getBoundingClientRect();
    return metrics?.width > 100 && metrics.height > 40 && table?.width > 100 && table.height > 40
      && chart?.width > 100 && chart.height >= 220
      ? { metrics: { width: metrics.width, height: metrics.height }, table: { width: table.width, height: table.height },
        chart: { width: chart.width, height: chart.height } } : null;
  })()`, 'Story 1.1 metric, table, and chart layout');

  await client.send('Page.navigate', { url: new URL('../', APP_URL).href });
  const legacy10Mobile = await waitFor(client, `(() => {
    if (document.readyState !== 'complete' || document.querySelectorAll('.maplibregl-canvas').length !== 1
      || document.getElementById('capability-controls')?.hidden !== false) return null;
    const content = document.querySelector('#scene-compositor.presentation-content');
    const heading = content?.querySelector('.presentation-content__title');
    const navigation = document.getElementById('runtime-navigation');
    if (!content || !heading || !navigation) return null;
    const contentRect = content.getBoundingClientRect(); const headingRect = heading.getBoundingClientRect();
    const headingStyle = getComputedStyle(heading); const contentStyle = getComputedStyle(content);
    const navigationRect = navigation.getBoundingClientRect();
    const visuallyUsable = headingRect.width > 0 && headingRect.height > 0
      && Number.parseFloat(headingStyle.fontSize) >= 20
      && headingStyle.visibility !== 'hidden' && headingStyle.color !== 'rgba(0, 0, 0, 0)'
      && Number.parseFloat(contentStyle.opacity) > 0 && contentRect.width >= 300 && contentRect.height >= 100
      && contentRect.left >= 0 && contentRect.top >= 0 && contentRect.right <= innerWidth + 1 && contentRect.bottom <= innerHeight + 1
      && navigationRect.width > 0 && navigationRect.height > 0 && document.documentElement.scrollWidth <= innerWidth + 1;
    return visuallyUsable ? { width: innerWidth, height: innerHeight, maps: 1,
      headingFontSize: headingStyle.fontSize, contentWidth: contentRect.width, contentHeight: contentRect.height,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth } : null;
  })()`, '390 x 844 legacy production regression');
  if (legacy10Mobile.width !== 390 || legacy10Mobile.height !== 844) {
    throw new Error(`Unexpected Story 1.0 viewport: ${JSON.stringify(legacy10Mobile)}`);
  }
  await evaluate(client, `document.querySelector('#runtime-navigation button:last-child').click()`);
  const legacy10Navigation = await waitFor(client, `(() => {
    const next = document.querySelector('#runtime-navigation button:last-child');
    const status = document.getElementById('runtime-status').textContent;
    return status === 'Scene 2 of 7' ? { status, disabled: next.disabled } : null;
  })()`, 'Story 1.0 next-scene navigation');
  if (legacy10Navigation.status !== 'Scene 2 of 7' || legacy10Navigation.disabled) {
    throw new Error(`Story 1.0 navigation is not operable: ${JSON.stringify(legacy10Navigation)}`);
  }
  if (consoleIssues.length) throw new Error(`Unexpected browser console issues: ${JSON.stringify(consoleIssues)}`);

  console.log(JSON.stringify({
    gate: 'pr-c', rich: rich.types, templates, importExisting: importChoices, zipReopen: true,
    neutralRoot: true, blankRouteModules: blank.routeModules, routeBehavior: { ...routeBehavior, ...routeVisuals },
    oneMap: blank.maps === 1 && rich.maps === 1 && route.maps === 1
      && legacy10Mobile.maps === 1 && legacy11Mobile.maps === 1,
    legacy390x844: {
      story10: { ...legacy10Mobile, navigation: legacy10Navigation },
      story11: { ...legacy11Mobile, navigation: legacy11Navigation, richLayout: legacy11RichLayout }
    }, console: 'clean'
  }));
  console.log('MAP_STORY_STUDIO_PR_C_RESULT: PASS');
} finally {
  await client.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  client.close();
}
