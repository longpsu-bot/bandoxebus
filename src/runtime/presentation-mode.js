const PRESENTATION_RATIO = 16 / 9;
const INTERACTIVE_SELECTOR = 'input, textarea, select, button, a, [contenteditable]';
const STAGE_STYLE_PROPERTIES = Object.freeze([
  'position', 'width', 'height', 'left', 'top', 'inset', 'margin', 'aspectRatio'
]);

export function fitPresentationStage({ viewportWidth, viewportHeight }) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0
    || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new RangeError('Presentation viewport dimensions must be positive finite numbers.');
  }
  const width = Math.min(viewportWidth, viewportHeight * PRESENTATION_RATIO);
  const height = width / PRESENTATION_RATIO;
  return Object.freeze({
    width,
    height,
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2
  });
}

function isInteractiveTarget(target) {
  if (target?.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target?.tagName?.toUpperCase?.())) return true;
  return Boolean(target?.closest?.(INTERACTIVE_SELECTOR));
}

export function createPresentationMode({
  runtime,
  experience,
  map,
  stage,
  navigation,
  documentRef = document,
  windowRef = window
} = {}) {
  if (!runtime?.definition?.states?.length) {
    throw new TypeError('Presentation requires the production Story runtime.');
  }
  if (!experience?.enter || !experience?.activateScene || !experience?.exit) {
    throw new TypeError('Presentation requires the shared generic Story experience.');
  }
  const mapContainer = map?.getContainer?.();
  if (!mapContainer?.style || typeof map.resize !== 'function') {
    throw new TypeError('Presentation requires the existing MapLibre map and container.');
  }
  if (!stage?.style || !navigation?.replaceChildren) {
    throw new TypeError('Presentation requires the existing compositor and navigation roots.');
  }

  let active = false;
  let previousButton = null;
  let nextButton = null;
  let stageSnapshot = null;
  let mapContainerSnapshot = null;

  function updateNavigation() {
    if (!previousButton || !nextButton) return;
    previousButton.disabled = runtime.currentIndex === 0;
    nextButton.disabled = runtime.currentIndex === runtime.definition.states.length - 1;
  }

  function activate(index) {
    const clamped = Math.max(0, Math.min(runtime.definition.states.length - 1, index));
    if (runtime.active && runtime.currentIndex === clamped) {
      updateNavigation();
      return runtime.currentState;
    }
    const state = experience.activateScene(clamped);
    updateNavigation();
    return state;
  }

  function previous() { return activate(runtime.currentIndex - 1); }
  function next() { return activate(runtime.currentIndex + 1); }

  function applyGeometry(surface, fitted) {
    Object.assign(surface.style, {
      position: 'fixed',
      inset: 'auto',
      width: `${fitted.width}px`,
      height: `${fitted.height}px`,
      left: `${fitted.left}px`,
      top: `${fitted.top}px`,
      margin: '0',
      aspectRatio: '16 / 9'
    });
  }

  function snapshotSurface(surface) {
    return Object.fromEntries(STAGE_STYLE_PROPERTIES.map((name) => [name, surface.style[name]]));
  }

  function fitStage() {
    const fitted = fitPresentationStage({
      viewportWidth: windowRef.innerWidth,
      viewportHeight: windowRef.innerHeight
    });
    applyGeometry(mapContainer, fitted);
    applyGeometry(stage, fitted);
    map.resize();
    return fitted;
  }

  function handleKeydown(event) {
    if (!active || isInteractiveTarget(event.target)) return;
    if (['ArrowRight', 'PageDown'].includes(event.key)) {
      event.preventDefault();
      next();
    } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      previous();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      exit();
    }
  }

  function enter() {
    if (active) return runtime.currentState;
    active = true;
    stageSnapshot = {
      className: stage.className,
      styles: snapshotSurface(stage),
      outputMode: stage.dataset.outputMode
    };
    mapContainerSnapshot = snapshotSurface(mapContainer);
    stage.classList?.add?.('presentation-stage');
    stage.dataset.outputMode = 'presentation';
    fitStage();

    previousButton = documentRef.createElement('button');
    previousButton.type = 'button';
    previousButton.textContent = 'Previous';
    previousButton.addEventListener('click', previous);
    nextButton = documentRef.createElement('button');
    nextButton.type = 'button';
    nextButton.textContent = 'Next';
    nextButton.addEventListener('click', next);
    const exitButton = documentRef.createElement('button');
    exitButton.type = 'button';
    exitButton.textContent = 'Exit';
    exitButton.addEventListener('click', exit);
    navigation.replaceChildren(previousButton, nextButton, exitButton);
    navigation.hidden = false;
    windowRef.addEventListener('keydown', handleKeydown);
    windowRef.addEventListener('resize', fitStage);
    const state = experience.enter();
    updateNavigation();
    return state;
  }

  function exit() {
    if (!active) return runtime.currentState;
    active = false;
    windowRef.removeEventListener('keydown', handleKeydown);
    windowRef.removeEventListener('resize', fitStage);
    navigation.replaceChildren();
    navigation.hidden = true;
    const state = experience.exit();
    stage.className = stageSnapshot.className;
    Object.assign(stage.style, stageSnapshot.styles);
    Object.assign(mapContainer.style, mapContainerSnapshot);
    if (stageSnapshot.outputMode === undefined) delete stage.dataset.outputMode;
    else stage.dataset.outputMode = stageSnapshot.outputMode;
    stageSnapshot = null;
    mapContainerSnapshot = null;
    previousButton = null;
    nextButton = null;
    map.resize();
    return state;
  }

  return Object.freeze({
    runtime,
    map,
    stage,
    get active() { return active; },
    enter,
    exit,
    previous,
    next,
    destroy: exit
  });
}
