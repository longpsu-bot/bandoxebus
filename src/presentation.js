export const VIEW_MODES = Object.freeze({
  DIFFERENCE: 'difference',
  EXISTING: 'existing',
  PROPOSED: 'proposed',
  COMPARE: 'compare'
});

export function buildPresentationCameraOptions({
  target,
  presentationActive,
  compactView,
  reducedMotion,
  camera = {}
}) {
  const defaults = {
    padding: {
      top: 58,
      right: 58,
      bottom: presentationActive ? 170 : 72,
      left: presentationActive ? 60 : (compactView ? 28 : 382)
    },
    duration: reducedMotion ? 0 : 1_050,
    maxZoom: target === 'connections' ? 12.2 : 12.8,
    pitch: target === 'overview' ? 42 : 50,
    bearing: target === 'connections' ? -8 : -18,
    essential: false
  };

  return { ...defaults, ...camera, padding: defaults.padding };
}
