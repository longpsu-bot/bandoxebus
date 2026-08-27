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

test('content renderer creates one metrics layout with resolved runtime values', () => {
  const container = new TestElement('article');
  const slide = {
    id: 'route-changes',
    step: '04',
    content: {
      layout: 'metrics',
      eyebrow: 'Phương án điều chỉnh',
      title: 'Các thay đổi chính',
      narrative: 'Dữ liệu so sánh hình học.',
      metrics: [
        { label: 'Bổ sung', metric: 'addedLengthMeters', format: 'signed-distance', tone: 'added' }
      ],
      callouts: [{ label: 'Lưu ý', text: 'Giá trị lấy từ kết quả so sánh.' }],
      sourceNote: 'Nguồn hình học tuyến.',
      presenterNote: 'Không hiển thị nội dung này.'
    }
  };

  renderPresentationContent(container, slide, { addedLengthMeters: 400 }, testDocument);

  const text = collectText(container);
  assert.equal(container.className, 'presentation-content presentation-content--metrics');
  assert.equal(container.dataset.slideId, 'route-changes');
  assert.match(text, /04 · PHƯƠNG ÁN ĐIỀU CHỈNH/);
  assert.match(text, /\+0,4 km/);
  assert.match(text, /Nguồn hình học tuyến/);
  assert.doesNotMatch(text, /Không hiển thị nội dung này/);
});

test('content renderer gracefully shows a missing bound metric without fabricating data', () => {
  const container = new TestElement('article');
  const slide = {
    id: 'existing',
    step: '02',
    content: {
      layout: 'metrics',
      eyebrow: 'Hiện trạng',
      title: 'Tuyến hiện hữu',
      metrics: [{ label: 'Cự ly hiện hữu', metric: 'missing', format: 'distance' }]
    }
  };

  renderPresentationContent(container, slide, {}, testDocument);

  assert.match(collectText(container), /Cự ly hiện hữu —/);
});
