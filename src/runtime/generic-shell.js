export function createGenericStoryExperience({ runtime } = {}) {
  if (!runtime?.activate || !runtime?.goTo || !runtime?.deactivate) {
    throw new TypeError('Generic Story experience requires the production Story runtime.');
  }

  function enter() {
    if (runtime.active) return runtime.currentState;
    return runtime.activate(0);
  }

  function activateScene(index) {
    return runtime.active ? runtime.goTo(index) : runtime.activate(index);
  }

  function exit() {
    if (!runtime.active) return runtime.currentState;
    return runtime.deactivate();
  }

  return Object.freeze({
    enter,
    activateScene,
    exit,
    destroy: exit
  });
}

export function bindGenericStoryExperience({ runtime, map, documentRef = document } = {}) {
  const experience = createGenericStoryExperience({ runtime });
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
