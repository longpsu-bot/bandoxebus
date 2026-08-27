import { PRESENTATION_SLIDES } from './presentation-content.js';

export const VIEW_MODES = Object.freeze({
  DIFFERENCE: 'difference',
  EXISTING: 'existing',
  PROPOSED: 'proposed',
  COMPARE: 'compare'
});

export const PRESENTATION_LAYOUTS = Object.freeze({
  HERO: 'hero',
  METRICS: 'metrics',
  NARRATIVE: 'narrative',
  MAP_FOCUS: 'map-focus'
});

export const initialPresentationState = Object.freeze({
  active: false,
  slideIndex: 0,
  mode: VIEW_MODES.DIFFERENCE
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

export function presentationReducer(state, action, slides = PRESENTATION_SLIDES) {
  const lastIndex = slides.length - 1;
  const stateForIndex = (slideIndex) => ({
    ...state,
    slideIndex,
    mode: slides[slideIndex].scene.mode
  });

  switch (action.type) {
    case 'OPEN':
      return { active: true, slideIndex: 0, mode: slides[0].scene.mode };
    case 'CLOSE':
      return { active: false, slideIndex: state.slideIndex, mode: VIEW_MODES.DIFFERENCE };
    case 'NEXT':
      return stateForIndex(Math.min(lastIndex, state.slideIndex + 1));
    case 'PREVIOUS':
      return stateForIndex(Math.max(0, state.slideIndex - 1));
    case 'GOTO': {
      const requestedIndex = Number.isFinite(Number(action.index)) ? Number(action.index) : 0;
      return stateForIndex(Math.max(0, Math.min(lastIndex, requestedIndex)));
    }
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    default:
      return state;
  }
}
