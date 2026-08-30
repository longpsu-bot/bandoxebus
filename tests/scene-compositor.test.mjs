import assert from 'node:assert/strict';
import test from 'node:test';

import { STORY_12_COMPOSITOR_DEFAULTS } from '../src/scene/scene-contract.js';
import { createSceneCompositor } from '../src/scene/scene-compositor.js';

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}
const documentRef = { createElement: (tag) => new Element(tag) };

function state(blocks) {
  return { id: 'scene-one', content: { layout: 'freeform-16x9', blocks } };
}
function envelope(id, block, frame = { x: 0.05, y: 0.08, width: 0.4, height: 0.17, z: 20 }, appearance) {
  return { id, frame, ...(appearance ? { appearance } : {}), block };
}

test('Scene compositor renders stable normalized wrappers in Story order', () => {
  const root = new Element('section');
  const rendered = [];
  const compositor = createSceneCompositor({
    root,
    documentRef,
    renderBlock(block) {
      rendered.push(block.type);
      const node = new Element('article');
      node.dataset.semanticType = block.type;
      return node;
    }
  });

  compositor.render(state([
    envelope('first', { type: 'heading', text: 'First' }, { x: 0.05, y: 0.08, width: 0.4, height: 0.17, z: 20 }),
    envelope('second', { type: 'paragraph', text: 'Second' }, { x: 0.5, y: 0.5, width: 0.4, height: 0.3, z: 20 })
  ]));

  assert.deepEqual(rendered, ['heading', 'paragraph']);
  assert.deepEqual(root.children.map(({ dataset }) => dataset.sceneOverlayId), ['first', 'second']);
  assert.equal(root.children[0].style.left, '5%');
  assert.equal(root.children[0].style.top, '8%');
  assert.equal(root.children[0].style.width, '40%');
  assert.equal(root.children[0].style.height, '17%');
  assert.equal(root.children[0].style.zIndex, '20');
  assert.equal(root.children[1].style.zIndex, '20');
});

test('Scene compositor resolves frozen defaults before bounded appearance overrides', () => {
  const root = new Element('section');
  const compositor = createSceneCompositor({
    root,
    documentRef,
    renderBlock() { return new Element('article'); }
  });
  compositor.render(state([
    envelope('default-heading', { type: 'heading', text: 'Default' }),
    envelope('styled', { type: 'paragraph', text: 'Styled' }, undefined, {
      box: { fill: '#07101CCC', opacity: 0.8, padding: 24, radius: 16 },
      text: { fontFamily: 'georgia', fontSize: 42, bold: true, italic: true, color: '#FFFFFFFF', align: 'center', lineHeight: 1.4 }
    })
  ]));

  const defaults = root.children[0];
  assert.equal(Object.isFrozen(STORY_12_COMPOSITOR_DEFAULTS), true);
  assert.equal(defaults.style.backgroundColor, STORY_12_COMPOSITOR_DEFAULTS.box.fill);
  assert.equal(defaults.style.color, STORY_12_COMPOSITOR_DEFAULTS.text.color);
  assert.equal(defaults.dataset.fontFamily, 'sans');
  assert.equal(defaults.dataset.designFontSize, '56');
  assert.equal(defaults.dataset.designPadding, '0');

  const styled = root.children[1];
  assert.equal(styled.style.backgroundColor, '#07101CCC');
  assert.equal(styled.style.opacity, '0.8');
  assert.equal(styled.dataset.fontFamily, 'georgia');
  assert.equal(styled.dataset.designFontSize, '42');
  assert.equal(styled.dataset.designPadding, '24');
  assert.equal(styled.style.textAlign, 'center');
  assert.equal(styled.style.fontStyle, 'italic');
  assert.equal(styled.style.fontWeight, '700');
});

test('all existing semantic block types flow through one renderBlock seam', () => {
  const root = new Element('section');
  const types = ['eyebrow', 'heading', 'paragraph', 'stat-group', 'callout', 'disclosure', 'table', 'chart', 'image', 'legend'];
  const seen = [];
  const compositor = createSceneCompositor({
    root,
    documentRef,
    renderBlock(block) { seen.push(block.type); return new Element('article'); }
  });
  compositor.render(state(types.map((type, index) => envelope(`block-${index}`, { type }))));
  assert.deepEqual(seen, types);
  assert.equal(root.children.length, types.length);
});

test('clear and destroy remove wrappers without interpreting semantic content', () => {
  const root = new Element('section');
  const compositor = createSceneCompositor({ root, documentRef, renderBlock: () => new Element('article') });
  compositor.render(state([envelope('title', { type: 'heading', text: 'Title' })]));
  compositor.clear();
  assert.equal(root.children.length, 0);
  compositor.render(state([envelope('title', { type: 'heading', text: 'Title' })]));
  compositor.destroy();
  assert.equal(root.children.length, 0);
});
