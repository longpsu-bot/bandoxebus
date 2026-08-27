import { resolvePresentationMetric } from './presentation-metrics.js';

function textElement(documentRef, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function appendNarrative(container, narrative, documentRef) {
  if (!narrative) return;
  const wrapper = documentRef.createElement('div');
  wrapper.className = 'presentation-content__narrative';
  narrative.split(/\n\s*\n/).filter(Boolean).forEach((paragraph) => {
    wrapper.append(textElement(documentRef, 'p', '', paragraph));
  });
  container.append(wrapper);
}

function appendMetrics(container, bindings, metrics, documentRef) {
  if (!bindings?.length) return;
  const grid = documentRef.createElement('div');
  grid.className = 'presentation-metrics';
  bindings.forEach((binding) => {
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

function appendCallouts(container, callouts, documentRef) {
  if (!callouts?.length) return;
  const list = documentRef.createElement('ul');
  list.className = 'presentation-callouts';
  callouts.forEach((callout) => {
    const item = documentRef.createElement('li');
    item.className = `presentation-callout presentation-callout--${callout.tone ?? 'neutral'}`;
    if (callout.label) item.append(textElement(documentRef, 'strong', '', callout.label));
    item.append(textElement(documentRef, 'span', '', callout.text));
    list.append(item);
  });
  container.append(list);
}

export function renderPresentationContent(container, slide, metrics, documentRef = document) {
  const { content } = slide;
  container.className = `presentation-content presentation-content--${content.layout}`;
  container.dataset.slideId = slide.id;
  container.replaceChildren();

  container.append(textElement(
    documentRef,
    'p',
    'presentation-content__eyebrow',
    `${slide.step} · ${content.eyebrow.toLocaleUpperCase('vi-VN')}`
  ));
  container.append(textElement(documentRef, 'h2', 'presentation-content__title', content.title));
  if (content.subtitle) container.append(textElement(documentRef, 'p', 'presentation-content__subtitle', content.subtitle));
  if (content.status) container.append(textElement(documentRef, 'p', 'presentation-content__status', content.status));
  appendNarrative(container, content.narrative, documentRef);
  appendMetrics(container, content.metrics, metrics, documentRef);
  appendCallouts(container, content.callouts, documentRef);
  if (content.sourceNote) {
    container.append(textElement(documentRef, 'small', 'presentation-content__source', content.sourceNote));
  }
}
