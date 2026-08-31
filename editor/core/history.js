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
  let known = clone(read());
  let saved = clone(known);

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

  function sync() {
    const current = clone(read());
    if (equivalent(current, known)) return false;
    undoStack.length = 0;
    redoStack.length = 0;
    known = clone(current);
    saved = clone(current);
    notify();
    return true;
  }

  function writeKnown(next) {
    known = clone(next);
    write(clone(next));
  }

  function execute(update) {
    if (typeof update !== 'function') throw new TypeError('History execution requires an update function.');
    sync();
    const before = clone(read());
    const after = clone(update(clone(before)));
    if (equivalent(before, after)) return before;
    boundedPush(undoStack, before);
    redoStack.length = 0;
    writeKnown(after);
    notify();
    return clone(after);
  }

  function undo() {
    sync();
    if (!undoStack.length) return clone(read());
    const current = clone(read());
    const previous = undoStack.pop();
    boundedPush(redoStack, current);
    writeKnown(previous);
    notify();
    return clone(previous);
  }

  function redo() {
    sync();
    if (!redoStack.length) return clone(read());
    const current = clone(read());
    const next = redoStack.pop();
    boundedPush(undoStack, current);
    writeKnown(next);
    notify();
    return clone(next);
  }

  function markSaved() {
    sync();
    saved = clone(read());
    known = clone(saved);
    notify();
    return clone(saved);
  }

  function reset() {
    undoStack.length = 0;
    redoStack.length = 0;
    known = clone(read());
    saved = clone(known);
    notify();
    return clone(saved);
  }

  return Object.freeze({
    execute,
    undo,
    redo,
    sync,
    markSaved,
    reset,
    status,
    get canUndo() { sync(); return undoStack.length > 0; },
    get canRedo() { sync(); return redoStack.length > 0; },
    get undoDepth() { return undoStack.length; },
    get redoDepth() { return redoStack.length; }
  });
}
