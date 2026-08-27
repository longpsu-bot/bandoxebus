export const GUIDED_HANDLER_NAMES = Object.freeze([
  'scrollZoom',
  'dragPan',
  'touchZoomRotate',
  'boxZoom',
  'doubleClickZoom'
]);

export function createGuidedMapInteractionPolicy(map, handlerNames = GUIDED_HANDLER_NAMES) {
  let savedStates = null;

  function enter() {
    if (savedStates) return;
    savedStates = new Map();
    for (const name of handlerNames) {
      const handler = map?.[name];
      if (
        typeof handler?.isEnabled !== 'function'
        || typeof handler?.disable !== 'function'
        || typeof handler?.enable !== 'function'
      ) continue;
      const enabled = handler.isEnabled();
      savedStates.set(name, enabled);
      if (enabled) handler.disable();
    }
  }

  function exit() {
    if (!savedStates) return;
    for (const [name, wasEnabled] of savedStates) {
      const handler = map[name];
      const enabled = handler.isEnabled();
      if (wasEnabled && !enabled) handler.enable();
      if (!wasEnabled && enabled) handler.disable();
    }
    savedStates = null;
  }

  return { enter, exit };
}
