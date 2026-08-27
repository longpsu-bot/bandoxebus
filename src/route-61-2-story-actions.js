const MAP_MODES = new Set(['difference', 'existing', 'proposed', 'compare']);
const FOCUS_TARGETS = new Set([
  'overview',
  'existing',
  'proposed',
  'changes',
  'service-area',
  'connections'
]);
const URBAN_CONTEXT_MODES = new Set(['off', 'industrial-context']);
const CAMERA_BOUNDS = Object.freeze({
  pitch: [0, 72],
  bearing: [-360, 360],
  maxZoom: [0, 24]
});

function unsupportedProperty(action, path, allowed) {
  const property = Object.keys(action).find((key) => !allowed.includes(key));
  return property ? `${path} has unsupported property "${property}".` : null;
}

function required(action, property, path) {
  return action[property] === undefined ? `${path}.${property} is required.` : null;
}

function enumIssue(action, property, path, allowed) {
  const missing = required(action, property, path);
  if (missing) return missing;
  if (typeof action[property] !== 'string' || !allowed.has(action[property])) {
    return `${path}.${property} has unsupported value "${action[property]}".`;
  }
  return null;
}

function booleanIssue(action, property, path) {
  const missing = required(action, property, path);
  if (missing) return missing;
  return typeof action[property] === 'boolean' ? null : `${path}.${property} must be a boolean.`;
}

function validateCamera(camera, path) {
  if (camera === null || typeof camera !== 'object' || Array.isArray(camera)) {
    return `${path} must be an object.`;
  }
  const extra = unsupportedProperty(camera, path, Object.keys(CAMERA_BOUNDS));
  if (extra) return extra;
  for (const [property, [minimum, maximum]] of Object.entries(CAMERA_BOUNDS)) {
    if (camera[property] === undefined) continue;
    if (typeof camera[property] !== 'number' || !Number.isFinite(camera[property])) {
      return `${path}.${property} must be a finite number.`;
    }
    if (camera[property] < minimum || camera[property] > maximum) {
      return `${path}.${property} must be between ${minimum} and ${maximum}.`;
    }
  }
  return null;
}

export const ROUTE_612_STORY_ACTION_CONTRACTS = Object.freeze({
  'map.mode'(action, path) {
    return unsupportedProperty(action, path, ['type', 'mode'])
      ?? enumIssue(action, 'mode', path, MAP_MODES);
  },
  'map.focus'(action, path) {
    const issue = unsupportedProperty(action, path, ['type', 'target', 'camera'])
      ?? enumIssue(action, 'target', path, FOCUS_TARGETS);
    if (issue || action.camera === undefined) return issue;
    return validateCamera(action.camera, `${path}.camera`);
  },
  'map.poi-emphasis'(action, path) {
    return unsupportedProperty(action, path, ['type', 'active'])
      ?? booleanIssue(action, 'active', path);
  },
  'map.urban-context'(action, path) {
    return unsupportedProperty(action, path, ['type', 'mode'])
      ?? enumIssue(action, 'mode', path, URBAN_CONTEXT_MODES);
  },
  'route.reveal'(action, path) {
    const issue = unsupportedProperty(action, path, ['type', 'active', 'delayMs'])
      ?? booleanIssue(action, 'active', path);
    if (issue || action.delayMs === undefined) return issue;
    return Number.isInteger(action.delayMs) && action.delayMs >= 0
      ? null
      : `${path}.delayMs must be a non-negative integer.`;
  }
});

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
