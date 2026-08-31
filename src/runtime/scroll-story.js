const OBSERVER_THRESHOLDS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
const ROOT_STYLE_PROPERTIES = Object.freeze([
  'position', 'inset', 'display', 'overflowY', 'width', 'height', 'pointerEvents'
]);
const DOCUMENT_STYLE_PROPERTIES = Object.freeze(['overflowY', 'height', 'minHeight']);
const MAP_STYLE_PROPERTIES = Object.freeze([
  'position', 'inset', 'width', 'height', 'left', 'top', 'margin'
]);
const COMPOSITOR_STYLE_PROPERTIES = Object.freeze([
  'position', 'inset', 'width', 'height', 'left', 'top', 'margin'
]);

function selectActiveIndex(entries, viewportHeight) {
  const activationLine = viewportHeight * 0.45;
  const candidates = entries.map((entry) => ({
    entry,
    index: Number(entry.target.dataset.sceneIndex),
    distance: Math.abs(
      ((entry.boundingClientRect.top + entry.boundingClientRect.bottom) / 2) - activationLine
    )
  }));
  candidates.sort((left, right) => (
    right.entry.intersectionRatio - left.entry.intersectionRatio
    || left.distance - right.distance
    || left.index - right.index
  ));
  return candidates[0]?.index ?? null;
}

function createSteps(states, documentRef) {
  return states.map((state, index) => {
    const section = documentRef.createElement('section');
    section.className = 'scroll-story__step';
    section.dataset.sceneId = state.id;
    section.dataset.sceneIndex = String(index);
    section.setAttribute('aria-label', `Scene ${index + 1} of ${states.length}`);
    section.setAttribute('aria-current', 'false');
    Object.assign(section.style, {
      minHeight: '100vh',
      scrollSnapAlign: 'center',
      pointerEvents: 'none'
    });
    return section;
  });
}

export function createScrollStoryNavigation({
  runtime,
  experience,
  map,
  stage,
  root,
  documentRef = document,
  windowRef = window,
  observerFactory = (callback, options) => new IntersectionObserver(callback, options)
} = {}) {
  if (!runtime?.definition?.states?.length) {
    throw new TypeError('Scroll Story requires the production Story runtime.');
  }
  if (!experience?.enter || !experience?.activateScene || !experience?.exit) {
    throw new TypeError('Scroll Story requires the shared generic Story experience.');
  }
  const mapContainer = map?.getContainer?.();
  if (!mapContainer?.style) {
    throw new TypeError('Scroll Story requires the existing MapLibre container.');
  }
  if (!stage?.style) {
    throw new TypeError('Scroll Story requires the existing Scene compositor.');
  }
  if (!documentRef?.documentElement?.style || !documentRef?.body?.style) {
    throw new TypeError('Scroll Story requires the production document scrolling roots.');
  }
  if (!root?.replaceChildren) {
    throw new TypeError('Scroll Story requires a navigation root.');
  }

  let active = false;
  let observer = null;
  let sections = [];
  let layoutSnapshot = null;
  const visibleEntries = new Map();

  function snapshotStyles(surface, properties) {
    return Object.fromEntries(properties.map((name) => [name, surface.style[name]]));
  }

  function updateCurrent(index) {
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
      sections[sectionIndex].setAttribute('aria-current', sectionIndex === index ? 'step' : 'false');
    }
  }

  function activate(index) {
    if (runtime.active && runtime.currentIndex === index) return runtime.currentState;
    const state = experience.activateScene(index);
    updateCurrent(index);
    return state;
  }

  function handleIntersection(entries) {
    for (const item of entries) {
      if (item.isIntersecting && item.intersectionRatio > 0) visibleEntries.set(item.target, item);
      else visibleEntries.delete(item.target);
    }
    const index = selectActiveIndex([...visibleEntries.values()], windowRef.innerHeight);
    if (index !== null) activate(index);
  }

  function enter() {
    if (active) return runtime.currentState;
    active = true;
    layoutSnapshot = {
      rootClassName: root.className,
      root: snapshotStyles(root, ROOT_STYLE_PROPERTIES),
      documentElement: snapshotStyles(documentRef.documentElement, DOCUMENT_STYLE_PROPERTIES),
      body: snapshotStyles(documentRef.body, DOCUMENT_STYLE_PROPERTIES),
      map: snapshotStyles(mapContainer, MAP_STYLE_PROPERTIES),
      compositor: snapshotStyles(stage, COMPOSITOR_STYLE_PROPERTIES)
    };
    sections = createSteps(runtime.definition.states, documentRef);
    root.replaceChildren(...sections);
    root.className = `${root.className} scroll-story-navigation`.trim();
    Object.assign(root.style, {
      position: 'relative',
      inset: 'auto',
      display: 'block',
      overflowY: 'visible',
      width: '100%',
      height: 'auto',
      pointerEvents: 'none'
    });
    Object.assign(documentRef.documentElement.style, { overflowY: 'auto', height: 'auto' });
    Object.assign(documentRef.body.style, { overflowY: 'auto', height: 'auto', minHeight: '100%' });
    Object.assign(mapContainer.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', left: 'auto', top: 'auto', margin: '0'
    });
    Object.assign(stage.style, { position: 'fixed', inset: '0' });
    root.hidden = false;
    observer = observerFactory(handleIntersection, { threshold: OBSERVER_THRESHOLDS });
    sections.forEach((section) => observer.observe(section));
    const state = experience.enter();
    updateCurrent(runtime.currentIndex);
    return state;
  }

  function exit() {
    if (!active) return runtime.currentState;
    active = false;
    observer?.disconnect();
    observer = null;
    visibleEntries.clear();
    root.replaceChildren();
    root.hidden = true;
    const state = experience.exit();
    root.className = layoutSnapshot.rootClassName;
    Object.assign(root.style, layoutSnapshot.root);
    Object.assign(documentRef.documentElement.style, layoutSnapshot.documentElement);
    Object.assign(documentRef.body.style, layoutSnapshot.body);
    Object.assign(mapContainer.style, layoutSnapshot.map);
    Object.assign(stage.style, layoutSnapshot.compositor);
    layoutSnapshot = null;
    return state;
  }

  return Object.freeze({
    runtime,
    get active() { return active; },
    get sections() { return sections; },
    enter,
    exit,
    destroy: exit
  });
}
