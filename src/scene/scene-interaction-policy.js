const HANDLERS = Object.freeze([
  'scrollZoom',
  'dragPan',
  'dragRotate',
  'touchZoomRotate',
  'boxZoom',
  'doubleClickZoom',
  'keyboard'
]);

function setEnabled(handler, enabled) {
  if (!handler) return;
  const current = handler.isEnabled?.();
  if (enabled && current !== true) handler.enable?.();
  if (!enabled && current !== false) handler.disable?.();
}

function setTouchRotation(handler, enabled) {
  if (!handler) return;
  if (enabled) handler.enableRotation?.();
  else handler.disableRotation?.();
}

export function createSceneInteractionPolicy(map, { cooperativeScroll = false } = {}) {
  if (!map || typeof map !== 'object') throw new TypeError('Scene interaction policy requires a map.');

  function apply(mode) {
    if (!['locked', 'zoom-only', 'explore'].includes(mode)) {
      throw new TypeError(`Unsupported Scene interaction policy: ${mode}.`);
    }

    if (mode === 'locked') {
      for (const name of HANDLERS) setEnabled(map[name], false);
      map.setCooperativeGestures?.(false);
      return;
    }

    if (mode === 'zoom-only') {
      setEnabled(map.scrollZoom, true);
      setEnabled(map.doubleClickZoom, true);
      setEnabled(map.touchZoomRotate, true);
      setTouchRotation(map.touchZoomRotate, false);
      for (const name of ['dragPan', 'dragRotate', 'boxZoom', 'keyboard']) setEnabled(map[name], false);
      map.setCooperativeGestures?.(cooperativeScroll);
      return;
    }

    for (const name of HANDLERS) setEnabled(map[name], true);
    setTouchRotation(map.touchZoomRotate, true);
    map.setCooperativeGestures?.(cooperativeScroll);
  }

  return Object.freeze({ apply });
}
