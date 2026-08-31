const OBSERVER_THRESHOLDS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

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
    return section;
  });
}

export function createScrollStoryNavigation({
  runtime,
  experience,
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
  if (!root?.replaceChildren || !root?.addEventListener || !root?.removeEventListener) {
    throw new TypeError('Scroll Story requires a navigation root.');
  }

  let active = false;
  let observer = null;
  let sections = [];
  const visibleEntries = new Map();

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

  function handleClick(event) {
    const target = event.target?.closest?.('[data-scene-index]') ?? event.target;
    const index = Number(target?.dataset?.sceneIndex);
    if (!Number.isInteger(index)) return;
    activate(index);
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
    sections = createSteps(runtime.definition.states, documentRef);
    root.replaceChildren(...sections);
    root.hidden = false;
    root.addEventListener('click', handleClick);
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
    root.removeEventListener('click', handleClick);
    root.hidden = true;
    return experience.exit();
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
