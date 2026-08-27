import { resolvePresentationMetric } from './presentation-metrics.js';

function textElement(documentRef, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function appendEyebrow(container, block, _metrics, documentRef) {
  const prefix = block.step ? `${block.step} · ` : '';
  container.append(textElement(
    documentRef,
    'p',
    'presentation-content__eyebrow',
    `${prefix}${block.text.toLocaleUpperCase('vi-VN')}`
  ));
}

function appendHeading(container, block, _metrics, documentRef) {
  container.append(textElement(documentRef, 'h2', 'presentation-content__title', block.text));
  if (block.subtitle) container.append(textElement(documentRef, 'p', 'presentation-content__subtitle', block.subtitle));
  if (block.status) container.append(textElement(documentRef, 'p', 'presentation-content__status', block.status));
}

function appendParagraph(container, block, _metrics, documentRef) {
  const wrapper = documentRef.createElement('div');
  wrapper.className = 'presentation-content__narrative';
  block.text.split(/\n\s*\n/).filter(Boolean).forEach((paragraph) => {
    wrapper.append(textElement(documentRef, 'p', '', paragraph));
  });
  container.append(wrapper);
}

function appendStats(container, block, metrics, documentRef) {
  const grid = documentRef.createElement('div');
  grid.className = 'presentation-metrics';
  block.items.forEach((binding) => {
    const card = documentRef.createElement('article');
    card.className = `presentation-metric presentation-metric--${binding.tone ?? 'neutral'}`;
    card.append(
      textElement(documentRef, 'span', 'presentation-metric__label', binding.label),
      textElement(documentRef, 'strong', 'presentation-metric__value', resolvePresentationMetric(binding, metrics))
    );
    grid.append(card);
  });
  container.append(grid);
}

function appendCallouts(container, block, _metrics, documentRef) {
  const list = documentRef.createElement('ul');
  list.className = 'presentation-callouts';
  block.items.forEach((callout) => {
    const item = documentRef.createElement('li');
    item.className = `presentation-callout presentation-callout--${callout.tone ?? 'neutral'}`;
    if (callout.label) item.append(textElement(documentRef, 'strong', '', callout.label));
    item.append(textElement(documentRef, 'span', '', callout.text));
    list.append(item);
  });
  container.append(list);
}

const BLOCK_RENDERERS = Object.freeze({
  eyebrow: appendEyebrow,
  heading: appendHeading,
  paragraph: appendParagraph,
  'stat-group': appendStats,
  callout: appendCallouts,
  disclosure(container, block, _metrics, documentRef) {
    container.append(textElement(documentRef, 'small', 'presentation-content__source', block.text));
  }
});

export function findStoryContentBlock(state, type) {
  return state.content.blocks.find((block) => block.type === type);
}

export function renderPresentationContent(container, state, metrics, documentRef = document) {
  container.className = `presentation-content presentation-content--${state.content.layout}`;
  container.dataset.slideId = state.id;
  container.replaceChildren();

  state.content.blocks.forEach((block) => {
    BLOCK_RENDERERS[block.type](container, block, metrics, documentRef);
  });
}
