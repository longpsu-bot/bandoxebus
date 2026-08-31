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

export function bindGenericStoryExperience({ runtime, map, sceneController, documentRef = document } = {}) {
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
  let started = false;

  function start() {
    if (started) return;
    started = true;
    experience.enter();
    if (status) status.textContent = 'Ready';
  }

  if (map?.loaded?.()) start();
  else if (map?.once) map.once('load', start);
  else start();

  return experience;
}
