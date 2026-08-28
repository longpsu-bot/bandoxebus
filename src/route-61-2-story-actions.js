import { createCoreMap10Normalizers } from './capabilities/core-map-v1.js';
import { ROUTE_COMPARISON_V1_NORMALIZERS } from './capabilities/route-comparison-v1.js';
import { URBAN_CONTEXT_V1_NORMALIZERS } from './capabilities/urban-context-v1.js';

const FOCUS_TARGETS = [
  'overview',
  'existing',
  'proposed',
  'changes',
  'service-area',
  'connections'
];

export const ROUTE_612_STORY_10_NORMALIZERS = Object.freeze([
  ...createCoreMap10Normalizers({ focusTargets: FOCUS_TARGETS }),
  ...ROUTE_COMPARISON_V1_NORMALIZERS,
  ...URBAN_CONTEXT_V1_NORMALIZERS
]);

export const ROUTE_612_STORY_ACTION_CONTRACTS = Object.freeze(Object.fromEntries(
  ROUTE_612_STORY_10_NORMALIZERS.map((normalizer) => [
    normalizer.legacyType,
    (action, path) => normalizer.validate(action, path)?.message ?? null
  ])
));

export const ROUTE_612_STORY_ACTION_TYPES = Object.freeze(
  Object.keys(ROUTE_612_STORY_ACTION_CONTRACTS)
);

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
      setPoiEmphasis(action.active);
    },
    'map.urban-context'(action) {
      setUrbanContext(action.mode);
    },
    'route.reveal'(action) {
      setRouteReveal(action.active, action.delayMs ?? 0);
    }
  });
}
