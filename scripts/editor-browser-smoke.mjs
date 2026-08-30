const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=')];
}));
const GATE = args.get('--gate') ?? 'pr-a';
const APP_URL = args.get('--url') ?? 'http://127.0.0.1:8080/editor/';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = 30_000;

if (GATE !== 'pr-a') throw new Error(`Unsupported editor browser gate: ${GATE}`);

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
  await Promise.all([client.send('Runtime.enable'), client.send('Log.enable')]);
  await waitFor(client, `document.readyState === 'complete' && Boolean(document.getElementById('new-project'))`, 'editor shell');
  await evaluate(client, `document.getElementById('new-project').click()`);
  const firstRevisionState = await waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame.dataset.previewRevision);
    const child = frame.contentDocument;
    return revision >= 0 && child?.querySelectorAll('.maplibregl-canvas').length === 1 ? { revision } : null;
  })()`, 'first valid production preview');
  const firstRevision = firstRevisionState.revision;
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
    revisions: { first: firstRevision, heading: headingRevision, repaired: repairedRevision, secondNew: secondNewRevision }
  }));
} finally {
  client.close();
}
