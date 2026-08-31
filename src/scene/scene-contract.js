function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const STORY_12_LAYOUT = 'freeform-16x9';
export const STORY_12_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
export const STORY_12_INTERACTIONS = Object.freeze(['locked', 'zoom-only', 'explore']);
export const STORY_12_TRANSITIONS = Object.freeze(['fly', 'ease', 'instant']);
export const STORY_12_FONT_FAMILIES = Object.freeze(['sans', 'arial', 'times-new-roman', 'georgia']);
export const STORY_12_CAMERA_BOUNDS = deepFreeze({
  longitude: [-180, 180],
  latitude: [-90, 90],
  zoom: [0, 24],
  pitch: [0, 72],
  bearing: [-360, 360]
});
export const STORY_12_FRAME_BOUNDS = deepFreeze({
  coordinate: [0, 1],
  size: [Number.MIN_VALUE, 1],
  z: [0, 9999]
});
export const STORY_12_APPEARANCE_BOUNDS = deepFreeze({
  opacity: [0, 1],
  borderWidth: [0, 16],
  radius: [0, 128],
  padding: [0, 160],
  fontSize: [8, 256],
  lineHeight: [0.8, 2.5]
});
export const STORY_12_COMPOSITOR_DEFAULTS = deepFreeze({
  box: {
    fill: '#00000000',
    opacity: 1,
    borderColor: '#00000000',
    borderWidth: 0,
    radius: 0,
    padding: 0
  },
  text: {
    fontFamily: 'sans',
    fontSize: 28,
    bold: false,
    italic: false,
    color: '#F6F8FC',
    align: 'left',
    lineHeight: 1.2
  },
  semanticText: {
    eyebrow: { fontSize: 18, bold: true },
    heading: { fontSize: 56, bold: true },
    paragraph: { fontSize: 30, bold: false },
    'stat-group': { fontSize: 28, bold: false },
    callout: { fontSize: 26, bold: false },
    disclosure: { fontSize: 18, bold: false },
    table: { fontSize: 22, bold: false },
    chart: { fontSize: 22, bold: false },
    image: { fontSize: 20, bold: false },
    legend: { fontSize: 22, bold: false }
  }
});

export function resolveStory12Appearance(envelope) {
  const semantic = STORY_12_COMPOSITOR_DEFAULTS.semanticText[envelope?.block?.type] ?? {};
  return deepFreeze({
    box: {
      ...STORY_12_COMPOSITOR_DEFAULTS.box,
      ...(envelope?.appearance?.box ?? {})
    },
    text: {
      ...STORY_12_COMPOSITOR_DEFAULTS.text,
      ...semantic,
      ...(envelope?.appearance?.text ?? {})
    }
  });
}
