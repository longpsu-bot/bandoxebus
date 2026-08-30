const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=')];
}));
const GATE = args.get('--gate') ?? 'pr-a';
const APP_URL = args.get('--url') ?? 'http://127.0.0.1:8080/editor/';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = 30_000;

if (!['pr-a', 'pr-b'].includes(GATE)) throw new Error(`Unsupported editor browser gate: ${GATE}`);

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

function setInput(id, value) {
  return `(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
}

function setControl(id, value) {
  return `(() => { const input = document.getElementById(${JSON.stringify(id)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
}

function setFile(id, name, mediaType, contents) {
  return `(() => {
    const input = document.getElementById(${JSON.stringify(id)});
    const file = new File([${JSON.stringify(contents)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(mediaType)} });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    return true;
  })()`;
}

function openSection(id) {
  return `(() => { document.querySelector('[data-section="${id}"]').click(); return true; })()`;
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
  await waitFor(client, `document.readyState === 'complete' && Boolean(document.getElementById('new-project')) && Boolean(window.__GUI_EDITOR__)`, 'editor shell');
  await evaluate(client, `document.getElementById('new-project').click()`);
  const firstRevisionState = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    const child = frame.contentDocument;
    return revision >= 0 && child?.querySelectorAll('.maplibregl-canvas').length === 1 ? { revision } : null;
  })()`, 'first valid production preview');
  const firstRevision = firstRevisionState.revision;
  await waitFor(client, `Boolean(document.getElementById('production-preview').contentDocument?.getElementById('presentation-open'))`, 'first Story control');
  await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('presentation-open').click()`);
  await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    return child && child.getElementById('story-shell')?.hidden === false && /New project/.test(child.getElementById('story-shell-steps')?.textContent ?? '');
  })()`, 'visible New project Story');

  await evaluate(client, setInput('story-heading', 'Updated project'));
  const headingRevision = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    return revision > ${firstRevision} ? revision : 0;
  })()`, 'valid heading revision');
  await waitFor(client, `Boolean(document.getElementById('production-preview').contentDocument?.getElementById('presentation-open'))`, 'updated Story control');
  await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('presentation-open').click()`);
  await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    return child && child.getElementById('story-shell')?.hidden === false && /Updated project/.test(child.getElementById('story-shell-steps')?.textContent ?? '');
  })()`, 'updated Story heading');

  await evaluate(client, setInput('project-locale', ''));
  const invalidState = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const status = document.getElementById('validation-status')?.textContent ?? '';
    const errors = document.getElementById('validation-errors')?.textContent ?? '';
    const canvasCount = frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
    return /Invalid project locale/.test(status) && /\\$\\.locale/.test(errors)
      ? { revision: Number(frame.dataset.previewRevision), canvasCount, paused: !document.getElementById('preview-paused').hidden }
      : null;
  })()`, 'production-invalid empty locale');
  if (invalidState.revision !== headingRevision) throw new Error('Invalid snapshot reached the production iframe.');
  if (!invalidState.paused || invalidState.canvasCount !== 1) throw new Error('Last-valid preview was not retained while invalid.');

  await evaluate(client, setInput('project-locale', 'en-US'));
  const repairedRevision = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    const canvasCount = frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
    return revision > ${headingRevision} && canvasCount === 1 ? revision : 0;
  })()`, 'repaired production preview');

  const desktopWidth = await evaluate(client, `document.getElementById('preview-frame').getBoundingClientRect().width`);
  await evaluate(client, `document.getElementById('preview-mobile').click()`);
  const mobileWidth = await waitFor(client, `(() => {
    const frame = document.getElementById('preview-frame');
    const width = frame.getBoundingClientRect().width;
    return frame.classList.contains('preview-frame--mobile') && width < ${desktopWidth} ? width : 0;
  })()`, 'mobile preview preset');
  await evaluate(client, `document.getElementById('preview-desktop').click()`);
  await waitFor(client, `document.getElementById('preview-frame').classList.contains('preview-frame--desktop')`, 'desktop preview preset');

  await evaluate(client, `document.getElementById('new-project').click()`);
  const secondNewRevisionState = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    const canvasCount = frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
    return revision === 0 && canvasCount === 1 ? { revision } : null;
  })()`, 'second New production preview');
  const secondNewRevision = secondNewRevisionState.revision;
  await waitFor(client, `Boolean(document.getElementById('production-preview').contentDocument?.getElementById('presentation-open'))`, 'second New Story control');
  await evaluate(client, `document.getElementById('production-preview').contentDocument.getElementById('presentation-open').click()`);
  await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const storyText = child?.getElementById('story-shell-steps')?.textContent ?? '';
    return child?.getElementById('story-shell')?.hidden === false
      && /New project/.test(storyText) && !/Updated project/.test(storyText);
  })()`, 'fresh second New Story');

  const finalState = await evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    return {
      revision: Number(frame.dataset.previewRevision),
      canvasCount: frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0,
      locale: document.getElementById('project-locale').value,
      mobileWidth: ${mobileWidth},
      desktopWidth: document.getElementById('preview-frame').getBoundingClientRect().width
    };
  })()`);
  if (finalState.revision !== secondNewRevision || finalState.canvasCount !== 1 || finalState.locale !== 'en-US') {
    throw new Error(`Unexpected final editor state: ${JSON.stringify(finalState)}`);
  }

  let prB = null;
  if (GATE === 'pr-b') {
    await evaluate(client, openSection('project'));
    await evaluate(client, `(() => {
      const input = document.querySelector('.tailored-inspector input[data-path="title"]');
      input.value = 'PR B authored project';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(client, `(() => [...document.querySelectorAll('.tailored-inspector button')].some((button) => /Use current preview view/.test(button.textContent) && !button.disabled))()`, 'preview camera telemetry');
    await evaluate(client, `(() => { [...document.querySelectorAll('.tailored-inspector button')].find((button) => /Use current preview view/.test(button.textContent)).click(); return true; })()`);
    await evaluate(client, `(() => { [...document.querySelectorAll('.tailored-inspector button')].find((button) => /Confirm captured view/.test(button.textContent)).click(); return true; })()`);

    await evaluate(client, openSection('attribution'));
    await evaluate(client, setControl('author-attribution-id', 'planning-team'));
    await evaluate(client, setControl('author-attribution-name', 'Planning team'));
    await evaluate(client, setControl('author-attribution-url', 'https://example.com/source'));
    await evaluate(client, `document.getElementById('author-attribution-add').click()`);
    await waitFor(client, `/Added attribution/.test(document.querySelector('.authoring-status').textContent)`, 'attribution authoring');

    const imports = [
      {
        id: 'route', label: 'Route', type: 'line', name: 'route.geojson', mediaType: 'application/geo+json',
        value: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Route' }, geometry: { type: 'LineString', coordinates: [[106.5, 10.9], [106.7, 11.1]] } }] }
      },
      {
        id: 'stops', label: 'Stops', type: 'point', name: 'stops.geojson', mediaType: 'application/geo+json',
        value: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Stop' }, geometry: { type: 'Point', coordinates: [106.6, 11] } }] }
      },
      {
        id: 'demand', label: 'Demand', type: 'table', name: 'demand.json', mediaType: 'application/json',
        value: { schemaVersion: '1.0', columns: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'value', label: 'Value', type: 'number' }], rows: [{ name: 'A', value: 10 }] }
      }
    ];
    for (const imported of imports) {
      await evaluate(client, openSection('datasets'));
      await evaluate(client, setControl('author-dataset-id', imported.id));
      await evaluate(client, setControl('author-dataset-label', imported.label));
      await evaluate(client, setControl('author-dataset-type', imported.type));
      await evaluate(client, setFile('author-dataset-file', imported.name, imported.mediaType, JSON.stringify(imported.value)));
      await evaluate(client, `document.getElementById('author-dataset-add').click()`);
      await waitFor(client, `/Added dataset/.test(document.querySelector('.authoring-status').textContent)`, `${imported.id} import`);
    }

    await evaluate(client, openSection('assets'));
    await evaluate(client, setControl('author-asset-id', 'photo'));
    await evaluate(client, setFile('author-asset-file', 'photo.png', 'image/png', 'preview-image'));
    await evaluate(client, `document.getElementById('author-asset-add').click()`);
    await waitFor(client, `/Added image/.test(document.querySelector('.authoring-status').textContent)`, 'image authoring');

    await evaluate(client, openSection('metrics'));
    await evaluate(client, setControl('author-metric-id', 'total'));
    await evaluate(client, setControl('author-metric-label', 'Total'));
    await evaluate(client, setControl('author-metric-value', '10'));
    await evaluate(client, setControl('author-metric-format', 'integer'));
    await evaluate(client, `document.getElementById('author-metric-add').click()`);
    await waitFor(client, `/Added metric/.test(document.querySelector('.authoring-status').textContent)`, 'metric authoring');

    await evaluate(client, openSection('focus'));
    await evaluate(client, setControl('author-focus-id', 'overview'));
    await evaluate(client, setControl('author-focus-datasets', 'route,stops'));
    await evaluate(client, `document.getElementById('author-focus-add').click()`);
    await waitFor(client, `/Added focus/.test(document.querySelector('.authoring-status').textContent)`, 'focus authoring');

    await evaluate(client, openSection('stories'));
    await evaluate(client, setControl('author-state-title', 'Details'));
    await evaluate(client, `document.getElementById('author-state-add').click()`);
    await waitFor(client, `/Added state/.test(document.querySelector('.authoring-status').textContent)`, 'state authoring');
    await evaluate(client, setControl('author-state-index', '1'));
    for (const block of ['table', 'chart', 'image', 'legend']) {
      await evaluate(client, setControl('author-block-type', block));
      await evaluate(client, `document.getElementById('author-block-add').click()`);
      await waitFor(client, `document.querySelector('.authoring-status').textContent === ${JSON.stringify(`Added ${block} block.`)}`, `${block} block`);
    }
    await evaluate(client, setControl('author-state-index', '0'));
    for (const [type, semanticTarget] of [['map.focus', 'overview'], ['map.set-visibility', 'route'], ['map.set-emphasis', 'stops']]) {
      await evaluate(client, setControl('author-action-type', type));
      await evaluate(client, setControl('author-action-target', semanticTarget));
      await evaluate(client, `document.getElementById('author-action-add').click()`);
      await waitFor(client, `document.querySelector('.authoring-status').textContent === ${JSON.stringify(`Added ${type}.`)}`, `${type} action`);
    }
    await evaluate(client, setControl('author-state-index', '1'));
    await evaluate(client, `document.getElementById('author-state-up').click()`);

    const authoredRevision = await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      const revision = Number(frame.dataset.previewRevision);
      return revision > 0 && frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1 ? revision : 0;
    })()`, 'authored production preview');

    const legacyState = await evaluate(client, `(async () => {
      const manifestResponse = await fetch('../project.json');
      const manifest = await manifestResponse.json();
      const declared = [
        ...manifest.stories.items.map((item) => ({ path: item.src.slice(2), kind: 'story', mediaType: 'application/json' })),
        ...Object.values(manifest.datasets).map((item) => ({ path: item.src.slice(2), kind: 'dataset', mediaType: item.type === 'geojson' ? 'application/geo+json' : 'application/json' })),
        ...Object.values(manifest.assets).map((item) => ({ path: item.src.slice(2), kind: 'asset', mediaType: item.mediaType })),
        ...(manifest.metrics ? [{ path: manifest.metrics.src.slice(2), kind: 'metrics', mediaType: 'application/json' }] : [])
      ];
      const entries = [{ path: 'project.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)), kind: 'manifest', mediaType: 'application/json', managed: true }];
      for (const item of declared) {
        const response = await fetch('../' + item.path);
        entries.push({ ...item, bytes: new Uint8Array(await response.arrayBuffer()), managed: true });
      }
      await window.__GUI_EDITOR__.openEntries(entries, { label: 'Route 61-2 memory gate' });
      return true;
    })()`);
    if (!legacyState) throw new Error('Route 61-2 memory package did not open.');
    await waitFor(client, `(() => {
      const frame = document.getElementById('production-preview');
      return Number(frame.dataset.previewRevision) === 0 && frame.contentDocument?.querySelectorAll('.maplibregl-canvas').length === 1;
    })()`, 'Route 61-2 production preview');
    await evaluate(client, openSection('stories'));
    const legacyControls = await waitFor(client, `(() => {
      const controls = [...document.querySelectorAll('[data-legacy-action]')];
      return controls.length && controls.every((control) => control.disabled && control.readOnly && control.value.startsWith('{'))
        ? controls.length : 0;
    })()`, 'read-only Story 1.0 action controls');
    prB = { authoredRevision, legacyControls };
  }
  if (consoleIssues.length) throw new Error(`Unexpected browser console issues: ${JSON.stringify(consoleIssues)}`);

  console.log(JSON.stringify({
    gate: GATE,
    newProject: true,
    headingRefresh: true,
    emptyLocaleInvalid: true,
    invalidSnapshotSent: false,
    lastValidRetained: true,
    repairRefresh: true,
    secondNew: true,
    desktopMobilePresets: true,
    mapLibreInstances: finalState.canvasCount,
    console: 'clean',
    ...(prB ? {
      visibleAuthoring: true,
      cameraCapture: true,
      provenance: true,
      datasets: ['line', 'point', 'table'],
      image: true,
      metric: true,
      focusActions: true,
      storyReorder: true,
      contentBlocks: ['table', 'chart', 'image', 'legend'],
      legacyControls: prB.legacyControls
    } : {}),
    revisions: { first: firstRevision, heading: headingRevision, repaired: repairedRevision, secondNew: secondNewRevision }
  }));
} finally {
  client.close();
}
