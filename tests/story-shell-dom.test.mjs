import test from 'node:test';
import assert from 'node:assert/strict';
import * as shell from '../src/story-shell.js';

class TestClassList {
  constructor(owner) { this.owner = owner; }
  add(...tokens) {
    const names = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    tokens.forEach((token) => names.add(token));
    this.owner.className = [...names].join(' ');
  }
}

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.classList = new TestClassList(this);
    this.dataset = {};
    this.attributes = {};
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

const documentRef = { createElement: (tagName) => new TestElement(tagName) };
const states = (ids) => ids.map((id) => ({ id, content: { layout: 'hero', blocks: [] } }));

function render(ids) {
  const calls = [];
  const container = new TestElement('div');
  const sections = shell.renderStorySteps({
    container,
    states: states(ids),
    metrics: { example: 1 },
    documentRef,
    renderContent(content, state, metrics, receivedDocument) {
      calls.push([state.id, metrics.example, receivedDocument]);
      content.dataset.renderedStateId = state.id;
    }
  });
  return { calls, container, sections };
}

test('three-state and five-state configurations produce matching section counts', () => {
  assert.equal(render(['alpha', 'banana', 'state-999']).sections.length, 3);
  assert.equal(render(['a', 'b', 'c', 'd', 'e']).sections.length, 5);
});

test('configuration order and arbitrary IDs become semantic section metadata', () => {
  const { calls, sections } = render(['state-999', 'alpha', 'banana']);
  assert.deepEqual(sections.map(({ tagName }) => tagName), ['section', 'section', 'section']);
  assert.deepEqual(sections.map(({ dataset }) => dataset.storyStateId), ['state-999', 'alpha', 'banana']);
  assert.deepEqual(sections.map(({ dataset }) => dataset.storyStateIndex), ['0', '1', '2']);
  assert.deepEqual(calls.map(([id]) => id), ['state-999', 'alpha', 'banana']);
  assert.equal(sections.every(({ attributes }) => attributes['aria-current'] === 'false'), true);
});
