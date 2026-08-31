import { createScrollStoryNavigation } from './scroll-story.js';
import { createPresentationMode } from './presentation-mode.js';

const OUTPUT_MODES = new Set(['explore', 'scroll', 'presentation']);

function resolveOutputMode(explicitMode, windowRef) {
  const requested = explicitMode
    ?? new URLSearchParams(windowRef?.location?.search ?? '').get('outputMode')
    ?? 'explore';
  return OUTPUT_MODES.has(requested) ? requested : 'explore';
}

export function createGenericStoryExperience({ runtime, sceneController, authoringPolicy } = {}) {
  if (!runtime?.activate || !runtime?.goTo || !runtime?.deactivate) {
    throw new TypeError('Generic Story experience requires the production Story runtime.');
  }

  function enter() {
    if (runtime.active) return runtime.currentState;
    return runtime.activate(0);
  }

  function activateScene(index, { animate = true } = {}) {
    return runtime.active
      ? runtime.goTo(index, { animate })
      : runtime.activate(index, { animate });
  }

  function setAuthoringMode(mode) {
    if (!['select', 'map'].includes(mode)) throw new TypeError(`Unsupported authoring mode: ${mode}.`);
    authoringPolicy?.apply?.(mode === 'select' ? 'locked' : 'explore');
    return mode;
  }

  function restoreSceneCamera(index = runtime.currentIndex) {
    const state = runtime.definition.states[index];
    if (!state) throw new RangeError(`Unknown Scene index: ${index}.`);
    sceneController?.restoreCamera?.(state);
    return state;
  }

  function exit() {
    if (!runtime.active) return runtime.currentState;
    return runtime.deactivate();
  }

  return Object.freeze({
    enter,
    activateScene,
    setAuthoringMode,
    restoreSceneCamera,
    exit,
    destroy: exit
  });
}

export function bindGenericStoryExperience({
  runtime,
  map,
  sceneController,
  contentRenderer,
  documentRef = document,
  windowRef = window,
  outputMode,
  observerFactory
} = {}) {
  const authoringPolicy = {
    apply(mode) {
      const enabled = mode === 'explore';
      for (const name of ['scrollZoom', 'dragPan', 'dragRotate', 'touchZoomRotate', 'boxZoom', 'doubleClickZoom', 'keyboard']) {
        const handler = map?.[name];
        if (enabled) handler?.enable?.();
        else handler?.disable?.();
      }
    }
  };
  const experience = createGenericStoryExperience({ runtime, sceneController, authoringPolicy });
  const status = documentRef.getElementById?.('runtime-status');
  const navigation = documentRef.getElementById?.('runtime-navigation');
  const contentRoot = documentRef.getElementById?.('scene-compositor');
  const selectedOutputMode = resolveOutputMode(outputMode, windowRef);
  let started = false;
  let outputAdapter = null;

  function renderState(state) {
    if (!sceneController && contentRenderer && contentRoot && state) contentRenderer.render(contentRoot, state);
    if (status && state) status.textContent = `Scene ${runtime.currentIndex + 1} of ${runtime.definition.states.length}`;
  }

  function enterExplore() {
    const state = experience.enter();
    renderState(state);
    return state;
  }

  const shell = Object.freeze({
    get outputMode() { return selectedOutputMode; },
    enter() { return outputAdapter ? outputAdapter.enter() : enterExplore(); },
    activateScene(index, options) { const state = experience.activateScene(index, options); renderState(state); return state; },
    setAuthoringMode: experience.setAuthoringMode,
    restoreSceneCamera: experience.restoreSceneCamera,
    exit() { return outputAdapter ? outputAdapter.exit() : experience.exit(); },
    destroy() {
      outputAdapter?.destroy();
      navigation?.replaceChildren?.();
      return experience.destroy();
    }
  });

  if (selectedOutputMode === 'scroll') {
    outputAdapter = createScrollStoryNavigation({
      runtime,
      experience,
      root: navigation,
      documentRef,
      windowRef,
      ...(observerFactory ? { observerFactory } : {})
    });
  } else if (selectedOutputMode === 'presentation') {
    outputAdapter = createPresentationMode({
      runtime,
      experience,
      map,
      stage: contentRoot,
      navigation,
      documentRef,
      windowRef
    });
  } else if (navigation?.replaceChildren && runtime.definition.states.length > 1) {
    const previous = documentRef.createElement('button');
    previous.type = 'button'; previous.textContent = 'Previous';
    previous.addEventListener('click', () => shell.activateScene(Math.max(0, runtime.currentIndex - 1)));
    const next = documentRef.createElement('button');
    next.type = 'button'; next.textContent = 'Next';
    next.addEventListener('click', () => shell.activateScene(Math.min(runtime.definition.states.length - 1, runtime.currentIndex + 1)));
    navigation.replaceChildren(previous, next);
    navigation.hidden = false;
  }

  function start() {
    if (started) return;
    started = true;
    shell.enter();
  }

  if (map?.loaded?.()) start();
  else if (map?.once) map.once('load', start);
  else start();

  return shell;
}
