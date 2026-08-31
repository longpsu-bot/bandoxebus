function clone(value) {
  return structuredClone(value);
}

function equivalent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createHistory({ read, write, limit = 100, onChange = () => {} } = {}) {
  if (typeof read !== 'function' || typeof write !== 'function') {
    throw new TypeError('History requires read and write functions.');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new TypeError('History limit must be an integer between 1 and 1000.');
  }
  if (typeof onChange !== 'function') throw new TypeError('History onChange must be a function.');

  const undoStack = [];
  const redoStack = [];
  let saved = clone(read());

  function status() {
    return Object.freeze({
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoDepth: undoStack.length,
      redoDepth: redoStack.length
    });
  }

  function notify() {
    onChange(status());
  }

  function boundedPush(stack, value) {
    stack.push(clone(value));
    if (stack.length > limit) stack.splice(0, stack.length - limit);
  }

  function execute(update) {
    if (typeof update !== 'function') throw new TypeError('History execution requires an update function.');
    const before = clone(read());
    const after = clone(update(clone(before)));
    if (equivalent(before, after)) return before;
    boundedPush(undoStack, before);
    redoStack.length = 0;
    write(clone(after));
    notify();
    return clone(after);
  }

  function undo() {
    if (!undoStack.length) return clone(read());
    const current = clone(read());
    const previous = undoStack.pop();
    boundedPush(redoStack, current);
    write(clone(previous));
    notify();
    return clone(previous);
  }

  function redo() {
    if (!redoStack.length) return clone(read());
    const current = clone(read());
    const next = redoStack.pop();
    boundedPush(undoStack, current);
    write(clone(next));
    notify();
    return clone(next);
  }

  function markSaved() {
    saved = clone(read());
    notify();
    return clone(saved);
  }

  function reset() {
    undoStack.length = 0;
    redoStack.length = 0;
    saved = clone(read());
    notify();
    return clone(saved);
  }

  return Object.freeze({
    execute,
    undo,
    redo,
    markSaved,
    reset,
    status,
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get undoDepth() { return undoStack.length; },
    get redoDepth() { return redoStack.length; }
  });
}
