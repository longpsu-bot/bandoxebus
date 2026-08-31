const args = new Map(process.argv.slice(2).map((argument) => {
  const [key, ...value] = argument.split('=');
  return [key, value.join('=')];
}));

const APP_URL = args.get('--url') ?? 'http://127.0.0.1:8080/editor/';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const TIMEOUT_MS = 30_000;

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

async function waitRevision(client, previous, label) {
  return waitFor(client, `(() => {
    const frame = document.getElementById('production-preview');
    const revision = Number(frame?.dataset.previewRevision);
    const maps = frame?.contentDocument?.querySelectorAll('.maplibregl-canvas').length ?? 0;
    return revision === ${previous + 1} && maps === 1 ? revision : 0;
  })()`, label);
}

async function previewFrame(client, id) {
  return evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    const overlay = frame?.contentDocument?.querySelector('[data-scene-overlay-id="${id}"]');
    if (!overlay) return null;
    return {
      x: Number(overlay.dataset.sceneFrameX), y: Number(overlay.dataset.sceneFrameY),
      width: Number(overlay.dataset.sceneFrameWidth), height: Number(overlay.dataset.sceneFrameHeight),
      z: Number(overlay.dataset.sceneFrameZ), text: overlay.textContent
    };
  })()`);
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
    const source = frame?.src ? new URL(frame.src) : null;
    const result = {
      revision: Number(frame?.dataset.previewRevision),
      maps: child?.querySelectorAll('.maplibregl-canvas').length ?? 0,
      scenes: document.querySelectorAll('.studio-scene-list button').length,
      generic: source?.pathname.endsWith('/src/runtime/') ?? false
    };
    return result.revision === 0 && result.maps === 1 && result.scenes === 1 && result.generic ? result : null;
  })()`, 'production-valid Story 1.2 Studio');
  let revision = initial.revision;

  await evaluate(client, clickButton('Add Heading'));
  revision = await waitRevision(client, revision, 'Add Heading revision');
  await waitFor(client,
    `Boolean(document.getElementById('studio-text-content')) && Boolean(document.getElementById('production-preview').contentDocument.querySelector('[data-scene-overlay-id="heading"]'))`,
    'Heading selection and preview');

  await evaluate(client, clickButton('Add Body Text'));
  revision = await waitRevision(client, revision, 'Add Body Text revision');
  await waitFor(client,
    `Boolean(document.getElementById('production-preview').contentDocument.querySelector('[data-scene-overlay-id="body-text"]'))`,
    'Body Text preview');

  await evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    const child = frame.contentDocument;
    const overlay = child.querySelector('[data-scene-overlay-id="heading"]');
    if (!overlay) throw new Error('Heading overlay missing for direct edit');
    overlay.dispatchEvent(new child.defaultView.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const target = [...overlay.children].find((item) => !item.dataset.sceneResizeHandle);
    if (!target || target.getAttribute('contenteditable') !== 'plaintext-only') throw new Error('Plain-text editor did not mount');
    target.textContent = 'Direct edited heading';
    target.dispatchEvent(new child.defaultView.Event('blur'));
    return true;
  })()`);
  revision = await waitRevision(client, revision, 'direct Text edit revision');
  await waitFor(client,
    `document.getElementById('studio-text-content')?.value === 'Direct edited heading'`,
    'direct Text edit reflected in Properties');

  await evaluate(client, `(() => {
    const input = document.getElementById('studio-text-font-size');
    input.value = '68';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  revision = await waitRevision(client, revision, 'font-size revision');
  await waitFor(client, `document.getElementById('studio-text-font-size')?.value === '68'`, 'font-size persistence');

  await evaluate(client, `(() => {
    const input = document.getElementById('studio-box-fill');
    input.value = '#112233AA';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  revision = await waitRevision(client, revision, 'fill revision');
  await waitFor(client, `document.getElementById('studio-box-fill')?.value === '#112233AA'`, 'fill persistence');

  const beforeDrag = await previewFrame(client, 'heading');
  await evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    const child = frame.contentDocument;
    const root = child.getElementById('scene-compositor');
    const overlay = child.querySelector('[data-scene-overlay-id="heading"]');
    const rect = root.getBoundingClientRect();
    const x = rect.left + (Number(overlay.dataset.sceneFrameX) + Number(overlay.dataset.sceneFrameWidth) / 2) * rect.width;
    const y = rect.top + (Number(overlay.dataset.sceneFrameY) + Number(overlay.dataset.sceneFrameHeight) / 2) * rect.height;
    const options = { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'mouse' };
    overlay.dispatchEvent(new child.defaultView.PointerEvent('pointerdown', { ...options, clientX: x, clientY: y }));
    overlay.dispatchEvent(new child.defaultView.PointerEvent('pointermove', { ...options, clientX: x + 123, clientY: y + 37 }));
    overlay.dispatchEvent(new child.defaultView.PointerEvent('pointerup', { ...options, clientX: x + 123, clientY: y + 37 }));
    return true;
  })()`);
  revision = await waitRevision(client, revision, 'drag revision');
  const afterDrag = await previewFrame(client, 'heading');
  if (!afterDrag || (afterDrag.x === beforeDrag.x && afterDrag.y === beforeDrag.y)) throw new Error('Drag did not change the Heading frame.');

  const beforeResize = afterDrag;
  await evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    const child = frame.contentDocument;
    const root = child.getElementById('scene-compositor');
    const overlay = child.querySelector('[data-scene-overlay-id="heading"]');
    const rect = root.getBoundingClientRect();
    const right = rect.left + (Number(overlay.dataset.sceneFrameX) + Number(overlay.dataset.sceneFrameWidth)) * rect.width;
    const bottom = rect.top + (Number(overlay.dataset.sceneFrameY) + Number(overlay.dataset.sceneFrameHeight)) * rect.height;
    const options = { bubbles: true, cancelable: true, pointerId: 42, pointerType: 'mouse' };
    overlay.dispatchEvent(new child.defaultView.PointerEvent('pointerdown', { ...options, clientX: right - 4, clientY: bottom - 4 }));
    const handle = overlay.querySelector('.scene-resize-handle');
    if (!handle) throw new Error('Resize handle did not mount');
    handle.dispatchEvent(new child.defaultView.PointerEvent('pointerdown', { ...options, clientX: right, clientY: bottom }));
    handle.dispatchEvent(new child.defaultView.PointerEvent('pointermove', { ...options, clientX: right + 105, clientY: bottom + 61 }));
    handle.dispatchEvent(new child.defaultView.PointerEvent('pointerup', { ...options, clientX: right + 105, clientY: bottom + 61 }));
    return true;
  })()`);
  revision = await waitRevision(client, revision, 'resize revision');
  const afterResize = await previewFrame(client, 'heading');
  if (!afterResize || (afterResize.width === beforeResize.width && afterResize.height === beforeResize.height)) throw new Error('Resize did not change the Heading frame.');

  await evaluate(client, clickButton('Duplicate'));
  revision = await waitRevision(client, revision, 'duplicate object revision');
  await waitFor(client,
    `Boolean(document.getElementById('production-preview').contentDocument.querySelector('[data-scene-overlay-id="heading-copy"]'))`,
    'duplicated Heading preview');

  await evaluate(client, `(() => {
    const objects = [...document.querySelectorAll('.studio-object-list button')];
    const heading = objects.find((button) => button.textContent.trim() === 'heading');
    const copy = objects.find((button) => button.textContent.trim() === 'heading-copy');
    heading.click();
    copy.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    const align = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Align Left');
    if (!align || align.disabled) throw new Error('Align Left unavailable for multi-selection');
    align.click();
    return true;
  })()`);
  revision = await waitRevision(client, revision, 'alignment revision');
  const aligned = await evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const a = child.querySelector('[data-scene-overlay-id="heading"]');
    const b = child.querySelector('[data-scene-overlay-id="heading-copy"]');
    return { a: Number(a.dataset.sceneFrameX), b: Number(b.dataset.sceneFrameX) };
  })()`);
  if (Math.abs(aligned.a - aligned.b) > 1e-9) throw new Error(`Alignment did not persist: ${JSON.stringify(aligned)}`);

  const zBefore = await evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const value = (id) => Number(child.querySelector('[data-scene-overlay-id="' + id + '"]').dataset.sceneFrameZ);
    return { heading: value('heading'), body: value('body-text'), copy: value('heading-copy') };
  })()`);
  await evaluate(client, `(() => {
    const heading = [...document.querySelectorAll('.studio-object-list button')].find((button) => button.textContent.trim() === 'heading');
    heading.click();
    const forward = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Bring Forward');
    if (!forward || forward.disabled) throw new Error('Bring Forward unavailable');
    forward.click();
    return true;
  })()`);
  revision = await waitRevision(client, revision, 'z-order revision');
  const zForward = await evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const value = (id) => Number(child.querySelector('[data-scene-overlay-id="' + id + '"]').dataset.sceneFrameZ);
    return { heading: value('heading'), body: value('body-text'), copy: value('heading-copy') };
  })()`);
  if (!(zForward.heading > zBefore.heading)) throw new Error(`Bring Forward did not advance one z-order step: ${JSON.stringify({ zBefore, zForward })}`);
  if (zForward.copy !== zBefore.copy) throw new Error(`Bring Forward incorrectly changed the top object: ${JSON.stringify({ zBefore, zForward })}`);

  await evaluate(client, clickButton('Undo'));
  revision = await waitRevision(client, revision, 'Undo revision');
  const zUndo = await evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const value = (id) => Number(child.querySelector('[data-scene-overlay-id="' + id + '"]').dataset.sceneFrameZ);
    return { heading: value('heading'), body: value('body-text'), copy: value('heading-copy') };
  })()`);
  if (JSON.stringify(zUndo) !== JSON.stringify(zBefore)) throw new Error(`Undo did not restore one-step z-order: ${JSON.stringify({ zBefore, zUndo })}`);

  await evaluate(client, clickButton('Redo'));
  revision = await waitRevision(client, revision, 'Redo revision');
  const zRedo = await evaluate(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const value = (id) => Number(child.querySelector('[data-scene-overlay-id="' + id + '"]').dataset.sceneFrameZ);
    return { heading: value('heading'), body: value('body-text'), copy: value('heading-copy') };
  })()`);
  if (JSON.stringify(zRedo) !== JSON.stringify(zForward)) throw new Error(`Redo did not restore one-step z-order: ${JSON.stringify({ zForward, zRedo })}`);

  const persistedFrame = await previewFrame(client, 'heading');
  await evaluate(client, clickButton('Add Scene'));
  revision = await waitRevision(client, revision, 'Add Scene revision');
  await waitFor(client, `document.querySelectorAll('.studio-scene-list button').length === 2`, 'two Scene buttons');
  await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const compositor = child?.getElementById('scene-compositor');
    return compositor?.dataset.sceneId === 'scene' && child.querySelectorAll('.scene-overlay').length === 0;
  })()`, 'new empty Scene activation');
  const beforeSwitch = await evaluate(client, `Number(document.getElementById('production-preview').dataset.previewRevision)`);
  if (beforeSwitch !== revision) throw new Error('Add Scene activation changed the certified revision unexpectedly.');

  await evaluate(client, `document.querySelectorAll('.studio-scene-list button')[0].click()`);
  await waitFor(client, `(() => {
    const child = document.getElementById('production-preview').contentDocument;
    const compositor = child?.getElementById('scene-compositor');
    return compositor?.dataset.sceneId === 'opening'
      && Boolean(child.querySelector('[data-scene-overlay-id="heading"]'));
  })()`, 'return to authored Scene');
  const switchRevision = await evaluate(client, `Number(document.getElementById('production-preview').dataset.previewRevision)`);
  if (switchRevision !== revision) throw new Error('Scene switching created a production revision.');
  const restoredFrame = await previewFrame(client, 'heading');
  for (const field of ['x', 'y', 'width', 'height', 'z']) {
    if (Math.abs(restoredFrame[field] - persistedFrame[field]) > 1e-9) throw new Error(`Scene switch changed ${field}.`);
  }

  const finalState = await evaluate(client, `(() => {
    const frame = document.getElementById('production-preview');
    return {
      maps: frame.contentDocument.querySelectorAll('.maplibregl-canvas').length,
      overlays: frame.contentDocument.querySelectorAll('.scene-overlay').length,
      undoEnabled: !document.getElementById('undo-command').disabled,
      redoEnabled: !document.getElementById('redo-command').disabled
    };
  })()`);
  if (finalState.maps !== 1) throw new Error(`Expected exactly one MapLibre map, got ${finalState.maps}.`);
  if (!finalState.undoEnabled) throw new Error('Undo history was lost before the PR B gate completed.');
  if (consoleIssues.length) throw new Error(`Unexpected browser console issues: ${JSON.stringify(consoleIssues)}`);

  console.log(JSON.stringify({
    gate: 'pr-b',
    text: ['heading', 'body', 'direct-edit', 'style'],
    composition: ['drag', 'resize', 'duplicate', 'align', 'z-order'],
    history: ['undo', 'redo'],
    scenePersistence: true,
    oneMap: true,
    console: 'clean'
  }));
  console.log('MAP_STORY_STUDIO_PR_B_RESULT: PASS');
} finally {
  client.close();
}
