function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createStoryRuntime({ definition, actionRunner }) {
  if (!definition?.states?.length) throw new TypeError('A validated story definition is required.');
  if (!actionRunner?.run) throw new TypeError('A story action runner is required.');

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

  function contextFor(phase, fromState, toState, state, index) {
    return Object.freeze({ definition, phase, fromState, toState, state, index });
  }

  function goTo(target) {
    const nextIndex = resolveIndex(target);
    const oldState = definition.states[currentIndex];
    const nextState = definition.states[nextIndex];
    const wasActive = active;

    if (active && nextIndex === currentIndex) return nextState;

    if (active) {
      actionRunner.run(
        oldState.map.exit,
        contextFor('exit', oldState, nextState, oldState, currentIndex)
      );
    }

    currentIndex = nextIndex;
    active = true;
    actionRunner.run(
      nextState.map.enter,
      contextFor('enter', wasActive ? oldState : null, nextState, nextState, currentIndex)
    );
    return nextState;
  }

  return Object.freeze({
    definition,
    get active() { return active; },
    get currentIndex() { return currentIndex; },
    get currentState() { return definition.states[currentIndex]; },
    get currentContent() { return definition.states[currentIndex].content; },
    activate(target = currentIndex) {
      return goTo(target);
    },
    deactivate() {
      const state = definition.states[currentIndex];
      if (!active) return state;
      actionRunner.run(
        state.map.exit,
        contextFor('exit', state, null, state, currentIndex)
      );
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
