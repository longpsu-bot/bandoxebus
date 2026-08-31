import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistory } from '../editor/core/history.js';

function harness(initial = { value: 0 }, limit = 100) {
  let current = structuredClone(initial);
  const writes = [];
  const history = createHistory({
    limit,
    read: () => structuredClone(current),
    write(next) {
      current = structuredClone(next);
      writes.push(structuredClone(next));
    }
  });
  return { history, get current() { return structuredClone(current); }, writes };
}

test('history executes, undoes, and redoes production-data mutations', () => {
  const h = harness();
  h.history.execute((value) => ({ value: value.value + 1 }));
  h.history.execute((value) => ({ value: value.value + 1 }));
  assert.deepEqual(h.current, { value: 2 });
  assert.equal(h.history.canUndo, true);
  assert.equal(h.history.canRedo, false);

  h.history.undo();
  assert.deepEqual(h.current, { value: 1 });
  assert.equal(h.history.canRedo, true);
  h.history.redo();
  assert.deepEqual(h.current, { value: 2 });
});

test('new execution invalidates redo while no-op execution records nothing', () => {
  const h = harness();
  h.history.execute((value) => ({ value: value.value + 1 }));
  h.history.undo();
  assert.equal(h.history.canRedo, true);
  h.history.execute((value) => ({ value: value.value + 5 }));
  assert.deepEqual(h.current, { value: 5 });
  assert.equal(h.history.canRedo, false);
  const depth = h.history.undoDepth;
  h.history.execute((value) => value);
  assert.equal(h.history.undoDepth, depth);
});

test('history keeps only the newest 100 undo entries', () => {
  const h = harness({ value: 0 }, 100);
  for (let index = 0; index < 105; index += 1) {
    h.history.execute((value) => ({ value: value.value + 1 }));
  }
  assert.equal(h.history.undoDepth, 100);
  for (let index = 0; index < 100; index += 1) h.history.undo();
  assert.deepEqual(h.current, { value: 5 });
  assert.equal(h.history.canUndo, false);
});

test('markSaved does not clear undo or redo and UI-only state stays outside history', () => {
  const h = harness();
  let selectedId = null;
  let authoringMode = 'select';
  h.history.execute((value) => ({ value: value.value + 1 }));
  h.history.undo();
  const before = { undo: h.history.undoDepth, redo: h.history.redoDepth };

  h.history.markSaved();
  selectedId = 'title';
  authoringMode = 'map';

  assert.deepEqual({ undo: h.history.undoDepth, redo: h.history.redoDepth }, before);
  assert.equal(selectedId, 'title');
  assert.equal(authoringMode, 'map');
  h.history.redo();
  assert.deepEqual(h.current, { value: 1 });
});
