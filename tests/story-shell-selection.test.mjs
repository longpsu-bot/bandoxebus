import test from 'node:test';
import assert from 'node:assert/strict';
import * as shell from '../src/story-shell.js';

function entry(index, { ratio, top, bottom, intersecting = true }) {
  return {
    isIntersecting: intersecting,
    intersectionRatio: ratio,
    boundingClientRect: { top, bottom, height: bottom - top },
    target: { dataset: { storyStateIndex: String(index) } }
  };
}

test('POC query gate requires the exact storyShell=poc value', () => {
  assert.equal(shell.isStoryShellPocEnabled('?storyShell=poc'), true);
  assert.equal(shell.isStoryShellPocEnabled('?storyShell=poc&x=1'), true);
  assert.equal(shell.isStoryShellPocEnabled('?x=1&storyShell=poc'), true);
  assert.equal(shell.isStoryShellPocEnabled(''), false);
  assert.equal(shell.isStoryShellPocEnabled('?storyShell=legacy'), false);
});

test('story indices clamp without knowing state IDs', () => {
  assert.equal(shell.normalizeStoryIndex(-5, 3), 0);
  assert.equal(shell.normalizeStoryIndex(1.9, 3), 1);
  assert.equal(shell.normalizeStoryIndex(99, 3), 2);
  assert.equal(shell.adjacentStoryIndex(0, -1, 3), 0);
  assert.equal(shell.adjacentStoryIndex(2, 1, 3), 2);
  assert.equal(shell.adjacentStoryIndex(1, -1, 3), 0);
});

test('greatest visible ratio wins before activation-line distance', () => {
  const selected = shell.selectActiveStoryStep([
    entry(0, { ratio: 0.35, top: 200, bottom: 500 }),
    entry(1, { ratio: 0.72, top: 500, bottom: 800 })
  ], { viewportHeight: 1000 });
  assert.equal(selected, 1);
});

test('effectively tied ratios use center distance to the 45 percent activation line', () => {
  const selected = shell.selectActiveStoryStep([
    entry(0, { ratio: 0.605, top: 100, bottom: 500 }),
    entry(1, { ratio: 0.60, top: 300, bottom: 700 })
  ], { viewportHeight: 1000 });
  assert.equal(selected, 1);
});

test('an exact tie uses deterministic configuration order and ignores non-intersections', () => {
  const selected = shell.selectActiveStoryStep([
    entry(2, { ratio: 0.6, top: 250, bottom: 650 }),
    entry(1, { ratio: 0.6, top: 250, bottom: 650 }),
    entry(0, { ratio: 1, top: 0, bottom: 900, intersecting: false })
  ], { viewportHeight: 1000 });
  assert.equal(selected, 1);
  assert.equal(shell.selectActiveStoryStep([], { viewportHeight: 1000 }), null);
});

test('keyboard intent maps arrows and Space without story semantics', () => {
  for (const key of ['ArrowRight', 'ArrowDown', ' ']) {
    assert.equal(shell.storyNavigationIntent({ key }), 'next');
  }
  for (const key of ['ArrowLeft', 'ArrowUp']) {
    assert.equal(shell.storyNavigationIntent({ key }), 'previous');
  }
  assert.equal(shell.storyNavigationIntent({ key: 'Escape' }), 'exit');
  assert.equal(shell.storyNavigationIntent({ key: 'Enter' }), null);
});

test('editable and interactive targets are excluded', () => {
  for (const selector of ['input', 'textarea', 'select', 'button', 'a', '[contenteditable]']) {
    assert.equal(shell.isInteractiveStoryTarget({ closest: (value) => value.includes(selector) ? {} : null }), true);
  }
  assert.equal(shell.isInteractiveStoryTarget({ closest: () => null }), false);
});
