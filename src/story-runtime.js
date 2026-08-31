function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createStoryRuntime({ definition, actionRunner, lifecycle = {} }) {
  if (!definition?.states?.length) throw new TypeError('A validated story definition is required.');
  if (!actionRunner?.run) throw new TypeError('A story action runner is required.');
  const beforeEnter = lifecycle.beforeEnter ?? (() => {});
  const afterExit = lifecycle.afterExit ?? (() => {});
  if (typeof beforeEnter !== 'function' || typeof afterExit !== 'function') {
    throw new TypeError('Story lifecycle hooks must be functions.');
  }

  let active = false;
  let currentIndex = 0;

  function resolveIndex(target = currentIndex) {
    if (typeof target === 'string') {
      const index = definition.states.findIndex(({ id }) => id === target);
      if (index === -1) throw new RangeError(`Unknown story state ID "${target}".`);
      return index;
    }

    const numericTarget = Number(target);
    if (!Number.isFinite(numericTarget)) throw new TypeError('Story state target must be an ID or finite index.');
    return clamp(Math.trunc(numericTarget), 0, definition.states.length - 1);
  }

  function contextFor(phase, fromState, toState, state, index, { animate = true } = {}) {
    return Object.freeze({ definition, phase, fromState, toState, state, index, animate });
  }

  function goTo(target, { animate = true } = {}) {
    const nextIndex = resolveIndex(target);
    const oldState = definition.states[currentIndex];
    const nextState = definition.states[nextIndex];
    const wasActive = active;

    if (active && nextIndex === currentIndex) return nextState;

    if (active) {
      const exitContext = contextFor('exit', oldState, nextState, oldState, currentIndex);
      actionRunner.run(oldState.map.exit, exitContext);
      afterExit(oldState, exitContext);
    }

    currentIndex = nextIndex;
    active = true;
    const enterContext = contextFor(
      'enter', wasActive ? oldState : null, nextState, nextState, currentIndex, { animate }
    );
    beforeEnter(nextState, enterContext);
    actionRunner.run(nextState.map.enter, enterContext);
    return nextState;
  }

  return Object.freeze({
    definition,
    get active() { return active; },
    get currentIndex() { return currentIndex; },
    get currentState() { return definition.states[currentIndex]; },
    get currentContent() { return definition.states[currentIndex].content; },
    activate(target = currentIndex, options) {
      return goTo(target, options);
    },
    deactivate() {
      const state = definition.states[currentIndex];
      if (!active) return state;
      const exitContext = contextFor('exit', state, null, state, currentIndex);
      actionRunner.run(state.map.exit, exitContext);
      afterExit(state, exitContext);
      active = false;
      return state;
    },
    next() {
      return goTo(currentIndex + 1);
    },
    previous() {
      return goTo(currentIndex - 1);
    },
    goTo
  });
}
