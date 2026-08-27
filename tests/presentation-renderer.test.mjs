import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPresentationContent } from '../src/presentation-renderer.js';

class TestElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.dataset = {};
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }
}

const testDocument = {
  createElement(tagName) {
    return new TestElement(tagName);
  }
};

function collectText(element) {
  return [element.textContent, ...element.children.flatMap((child) => collectText(child))]
    .filter(Boolean)
    .join(' ');
}

function fixtureState(heading = 'Các thay đổi chính') {
  return {
    id: 'arbitrary-id',
    content: {
      layout: 'metrics',
      presenterNote: 'Không hiển thị nội dung này.',
      blocks: [
        { type: 'eyebrow', step: '04', text: 'Phương án điều chỉnh' },
        { type: 'heading', text: heading, subtitle: 'Phụ đề', status: 'Trạng thái' },
        { type: 'paragraph', text: 'Đoạn một.\n\nĐoạn hai.' },
        { type: 'stat-group', items: [{ label: 'Bổ sung', metric: 'addedLengthMeters', format: 'signed-distance', tone: 'added' }] },
        { type: 'callout', items: [{ label: 'Lưu ý', text: 'Giá trị lấy từ kết quả so sánh.' }] },
        { type: 'disclosure', text: 'Nguồn hình học tuyến.' }
      ]
    }
  };
}

test('structured blocks render the existing presentation classes and runtime metric values', () => {
  const container = new TestElement('article');
  renderPresentationContent(container, fixtureState(), { addedLengthMeters: 400 }, testDocument);

  const text = collectText(container);
  assert.equal(container.className, 'presentation-content presentation-content--metrics');
  assert.equal(container.dataset.slideId, 'arbitrary-id');
  assert.match(text, /04 · PHƯƠNG ÁN ĐIỀU CHỈNH/);
  assert.match(text, /Các thay đổi chính/);
  assert.match(text, /Phụ đề/);
  assert.match(text, /Trạng thái/);
  assert.match(text, /Đoạn một.*Đoạn hai/);
  assert.match(text, /\+0,4 km/);
  assert.match(text, /Giá trị lấy từ kết quả so sánh/);
  assert.match(text, /Nguồn hình học tuyến/);
  assert.doesNotMatch(text, /Không hiển thị nội dung này/);
});

test('changing only configured heading changes rendered content', () => {
  const first = new TestElement('article');
  const second = new TestElement('article');
  renderPresentationContent(first, fixtureState('Heading A'), {}, testDocument);
  renderPresentationContent(second, fixtureState('Heading B'), {}, testDocument);
  assert.match(collectText(first), /Heading A/);
  assert.match(collectText(second), /Heading B/);
  assert.doesNotMatch(collectText(second), /Heading A/);
});

test('missing bound metric remains explicit instead of fabricating data', () => {
  const container = new TestElement('article');
  renderPresentationContent(container, fixtureState(), {}, testDocument);
  assert.match(collectText(container), /Bổ sung —/);
});
