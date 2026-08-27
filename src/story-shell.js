export const STORY_ACTIVATION_LINE_RATIO = 0.45;
export const STORY_RATIO_TIE_EPSILON = 0.01;
const INTERACTIVE_STORY_SELECTOR = 'input, textarea, select, button, a, [contenteditable]';

export function isStoryShellPocEnabled(search = '') {
  return new URLSearchParams(search).get('storyShell') === 'poc';
}

export function normalizeStoryIndex(index, stateCount) {
  if (!Number.isInteger(stateCount) || stateCount < 1) {
    throw new RangeError('Story state count must be a positive integer.');
  }
  const numericIndex = Number(index);
  if (!Number.isFinite(numericIndex)) throw new TypeError('Story index must be finite.');
  return Math.max(0, Math.min(stateCount - 1, Math.trunc(numericIndex)));
}

export function adjacentStoryIndex(index, direction, stateCount) {
  return normalizeStoryIndex(normalizeStoryIndex(index, stateCount) + Math.sign(direction), stateCount);
}

export function isInteractiveStoryTarget(target) {
  return Boolean(target?.closest?.(INTERACTIVE_STORY_SELECTOR));
}

export function storyNavigationIntent({ key }) {
  if (['ArrowRight', 'ArrowDown', ' '].includes(key)) return 'next';
  if (['ArrowLeft', 'ArrowUp'].includes(key)) return 'previous';
  if (key === 'Escape') return 'exit';
  return null;
}

export function selectActiveStoryStep(entries, {
  viewportHeight,
  activationLineRatio = STORY_ACTIVATION_LINE_RATIO,
  ratioTieEpsilon = STORY_RATIO_TIE_EPSILON
} = {}) {
  const activationLine = viewportHeight * activationLineRatio;
  const candidates = entries
    .filter(({ isIntersecting, intersectionRatio, target }) => (
      isIntersecting && intersectionRatio > 0
      && Number.isFinite(Number(target?.dataset?.storyStateIndex))
    ))
    .map((entry) => ({
      entry,
      index: Number(entry.target.dataset.storyStateIndex),
      distance: Math.abs(
        ((entry.boundingClientRect.top + entry.boundingClientRect.bottom) / 2) - activationLine
      )
    }))
    .sort((a, b) => {
      const ratioDelta = b.entry.intersectionRatio - a.entry.intersectionRatio;
      if (Math.abs(ratioDelta) > ratioTieEpsilon) return ratioDelta;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.index - b.index;
    });
  return candidates[0]?.index ?? null;
}

export function renderStorySteps({ container, states, metrics, renderContent, documentRef = document }) {
  const sections = states.map((state, index) => {
    const section = documentRef.createElement('section');
    section.className = 'story-step';
    section.dataset.storyStateId = state.id;
    section.dataset.storyStateIndex = String(index);
    section.setAttribute('aria-current', 'false');

    const content = documentRef.createElement('article');
    renderContent(content, state, metrics, documentRef);
    content.classList.add('story-step__content');
    section.append(content);
    return section;
  });
  container.replaceChildren(...sections);
  return sections;
}

export function createStoryShell({
  runtime,
  elements,
  renderContent,
  metrics,
  documentRef = document,
  windowRef = window,
  observerFactory = (callback, options) => new IntersectionObserver(callback, options),
  interactionPolicy = { enter() {}, exit() {} },
  onActivate = () => {},
  onExit = () => {},
  reducedMotion = false
}) {
  let active = false;
  let sections = [];
  let observer = null;
  const visibleEntries = new Map();

  function updateUi(index) {
    sections.forEach((section, sectionIndex) => {
      const current = sectionIndex === index;
      section.classList.toggle('is-active', current);
      section.setAttribute('aria-current', current ? 'step' : 'false');
    });
    elements.progressCurrent.textContent = String(index + 1);
    elements.progressTotal.textContent = String(runtime.definition.states.length);
    elements.previousButton.disabled = index === 0;
    elements.nextButton.disabled = index === runtime.definition.states.length - 1;
  }

  function activateStoryState(index, { scroll = false } = {}) {
    const nextIndex = normalizeStoryIndex(index, runtime.definition.states.length);
    if (runtime.active && runtime.currentIndex === nextIndex) return runtime.currentState;
    const state = runtime.goTo(nextIndex);
    updateUi(nextIndex);
    if (scroll) sections[nextIndex].scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center'
    });
    onActivate({ state, index: nextIndex, total: runtime.definition.states.length });
    return state;
  }

  function handlePrevious() {
    activateStoryState(adjacentStoryIndex(runtime.currentIndex, -1, runtime.definition.states.length), {
      scroll: true
    });
  }

  function handleNext() {
    activateStoryState(adjacentStoryIndex(runtime.currentIndex, 1, runtime.definition.states.length), {
      scroll: true
    });
  }

  function handleKeydown(event) {
    if (!active || isInteractiveStoryTarget(event.target)) return;
    const intent = storyNavigationIntent(event);
    if (!intent) return;
    event.preventDefault();
    if (intent === 'exit') {
      exit();
      return;
    }
    const direction = intent === 'next' ? 1 : -1;
    activateStoryState(adjacentStoryIndex(runtime.currentIndex, direction, runtime.definition.states.length), {
      scroll: true
    });
  }

  function exit() {
    if (!active) return;
    active = false;
    observer?.disconnect();
    observer = null;
    visibleEntries.clear();
    elements.previousButton.removeEventListener('click', handlePrevious);
    elements.nextButton.removeEventListener('click', handleNext);
    elements.exitButton.removeEventListener('click', exit);
    windowRef.removeEventListener('keydown', handleKeydown);
    runtime.deactivate();
    interactionPolicy.exit();
    documentRef.body.classList.remove('is-story-shell');
    elements.root.hidden = true;
    onExit();
  }

  function enter() {
    if (active) return;
    active = true;
    elements.root.hidden = false;
    documentRef.body.classList.add('is-story-shell');
    sections = renderStorySteps({
      container: elements.steps,
      states: runtime.definition.states,
      metrics,
      renderContent,
      documentRef
    });
    observer = observerFactory((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0) {
          visibleEntries.set(entry.target, entry);
        } else {
          visibleEntries.delete(entry.target);
        }
      }
      const selectedIndex = selectActiveStoryStep([...visibleEntries.values()], {
        viewportHeight: windowRef.innerHeight
      });
      if (selectedIndex !== null) activateStoryState(selectedIndex);
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    sections.forEach((section) => observer.observe(section));
    elements.previousButton.addEventListener('click', handlePrevious);
    elements.nextButton.addEventListener('click', handleNext);
    elements.exitButton.addEventListener('click', exit);
    windowRef.addEventListener('keydown', handleKeydown);
    interactionPolicy.enter();
    activateStoryState(0);
  }

  return {
    get active() { return active; },
    get sections() { return sections; },
    enter,
    exit,
    activateStoryState
  };
}
