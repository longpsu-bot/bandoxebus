export const ROUTE_612_STORY_ACTION_TYPES = Object.freeze([
  'map.mode',
  'map.focus',
  'map.poi-emphasis',
  'map.urban-context',
  'route.reveal'
]);

export function createRouteRevealController({
  start,
  cancel,
  schedule,
  clear,
  reducedMotion
}) {
  let timerId = null;

  return Object.freeze({
    setActive(active, delayMs = 0) {
      if (timerId !== null) {
        clear(timerId);
        timerId = null;
      }
      if (!active) {
        cancel();
        return;
      }
      timerId = schedule(() => {
        timerId = null;
        start();
      }, reducedMotion ? 0 : delayMs);
    }
  });
}

export function createRoute612StoryActionHandlers({
  setMode,
  focus,
  setPoiEmphasis,
  setUrbanContext,
  setRouteReveal
}) {
  return Object.freeze({
    'map.mode'(action) {
      setMode(action.mode);
    },
    'map.focus'(action) {
      focus(action.target, action.camera ?? {});
    },
    'map.poi-emphasis'(action) {
      setPoiEmphasis(Boolean(action.active));
    },
    'map.urban-context'(action) {
      setUrbanContext(action.mode);
    },
    'route.reveal'(action) {
      setRouteReveal(Boolean(action.active), action.delayMs ?? 0);
    }
  });
}
