function cameraOptions(camera) {
  return {
    center: [...camera.center],
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing
  };
}

export function createSceneStateController({
  map,
  layerRegistry,
  interactionPolicy,
  compositor,
  reducedMotion = false
} = {}) {
  if (!map || typeof map !== 'object') throw new TypeError('Scene state controller requires a map.');
  if (typeof layerRegistry?.applySnapshot !== 'function') throw new TypeError('Scene state controller requires a layer registry.');
  if (typeof interactionPolicy?.apply !== 'function') throw new TypeError('Scene state controller requires an interaction policy.');
  if (typeof compositor?.render !== 'function') throw new TypeError('Scene state controller requires a compositor.');

  function apply(state, { animate = true } = {}) {
    layerRegistry.applySnapshot(state.map.layerVisibility);
    interactionPolicy.apply(state.map.interaction);
    compositor.render(state);

    const camera = cameraOptions(state.map.camera);
    const transition = state.map.transition;
    if (!animate || reducedMotion || transition.type === 'instant') {
      map.jumpTo?.(camera);
      return state;
    }
    const options = { ...camera, duration: transition.durationMs, essential: false };
    if (transition.type === 'fly') map.flyTo?.(options);
    else map.easeTo?.(options);
    return state;
  }

  function beforeEnter(state, { animate = true } = {}) {
    return apply(state, { animate });
  }

  function restoreCamera(state) {
    map.jumpTo?.(cameraOptions(state.map.camera));
    return state;
  }

  function afterExit() {
    map.stop?.();
  }

  return Object.freeze({ apply, beforeEnter, restoreCamera, afterExit });
}
