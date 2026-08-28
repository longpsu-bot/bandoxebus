function element(documentRef, tag, className, text) {
  const node = documentRef.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;
}
function asset(context, id) {
  const value = context.assets?.get?.(id) ?? context.assets?.[id];
  if (!value) throw new TypeError(`Unknown image asset: ${id}.`);
  return value;
}
function sourceText(context, id) { return id ? context.attribution?.[id]?.name ?? id : undefined; }
function wrap(kind, child, documentRef) { const wrapper = element(documentRef, 'div', `content-${kind}`); wrapper.append(child); return wrapper; }

export function renderTableBlock(block, context) {
  const { documentRef } = context; const data = context.tables.get(block.data.dataset);
  const wrapper = element(documentRef, 'div', 'content-table');
  if (block.title) wrapper.append(element(documentRef, 'h3', 'content-table__title', block.title));
  const table = element(documentRef, 'table');
  if (block.caption) table.append(element(documentRef, 'caption', '', block.caption));
  const head = element(documentRef, 'thead'); const headRow = element(documentRef, 'tr');
  const columns = new Map(data.columns.map((column) => [column.id, column]));
  for (const selected of block.data.columns) {
    const th = element(documentRef, 'th', `align-${selected.align ?? 'start'}`, selected.header ?? columns.get(selected.field).label); th.setAttribute('scope', 'col'); headRow.append(th);
  }
  head.append(headRow); table.append(head);
  const body = element(documentRef, 'tbody');
  for (const row of data.rows) {
    const tr = element(documentRef, 'tr');
    for (const selected of block.data.columns) tr.append(element(documentRef, 'td', `align-${selected.align ?? 'start'}`, context.formatter.format(row[selected.field], selected.format ?? { type: columns.get(selected.field).type === 'text' ? 'text' : 'decimal' })));
    body.append(tr);
  }
  table.append(body); wrapper.append(table);
  const source = sourceText(context, block.source); if (source) wrapper.append(element(documentRef, 'small', 'content-source', source));
  return wrapper;
}

export function renderImageBlock(block, context) {
  const { documentRef } = context; const declared = asset(context, block.asset); const figure = element(documentRef, 'figure', 'content-image');
  if (block.title) figure.append(element(documentRef, 'h3', 'content-image__title', block.title));
  const image = element(documentRef, 'img'); image.setAttribute('src', String(declared.url ?? declared.src ?? declared.descriptor?.src)); image.setAttribute('alt', block.alt); image.setAttribute('loading', 'lazy'); figure.append(image);
  if (block.caption) figure.append(element(documentRef, 'figcaption', '', block.caption));
  const source = sourceText(context, block.source); if (source) figure.append(element(documentRef, 'small', 'content-source', source));
  return figure;
}

export function renderLegendBlock(block, context) {
  const { documentRef } = context; const section = element(documentRef, 'section', 'content-legend');
  if (block.title) section.append(element(documentRef, 'h3', 'content-legend__title', block.title));
  const list = element(documentRef, 'ul');
  for (const item of block.items) {
    const li = element(documentRef, 'li'); let sample;
    if (item.sample === 'icon') { const declared = asset(context, item.asset); sample = element(documentRef, 'img', 'content-legend__icon'); sample.setAttribute('src', String(declared.url ?? declared.src ?? declared.descriptor?.src)); sample.setAttribute('alt', ''); }
    else { sample = element(documentRef, 'span', `content-legend__${item.sample}`); sample.setAttribute('aria-hidden', 'true'); sample.style ??= {}; sample.style.backgroundColor = item.color; }
    li.append(sample, element(documentRef, 'span', '', item.label)); list.append(li);
  }
  section.append(list); return section;
}

export function createContentRendererRegistry(context) {
  const legacy = {
    eyebrow: (block) => element(context.documentRef, 'p', 'presentation-content__eyebrow', `${block.step ? `${block.step} · ` : ''}${block.text.toLocaleUpperCase(context.formatter.locale)}`),
    heading: (block) => { const group = element(context.documentRef, 'div'); group.append(element(context.documentRef, 'h2', 'presentation-content__title', block.text)); if (block.subtitle) group.append(element(context.documentRef, 'p', 'presentation-content__subtitle', block.subtitle)); if (block.status) group.append(element(context.documentRef, 'p', 'presentation-content__status', block.status)); return group; },
    paragraph: (block) => { const group = element(context.documentRef, 'div', 'presentation-content__narrative'); block.text.split(/\n\s*\n/).filter(Boolean).forEach((text) => group.append(element(context.documentRef, 'p', '', text))); return group; },
    'stat-group': (block) => { const group = element(context.documentRef, 'div', 'presentation-metrics'); for (const item of block.items) { const metric = context.metrics.resolve(item.metric); const card = element(context.documentRef, 'article', `presentation-metric presentation-metric--${item.tone ?? 'neutral'}`); card.append(element(context.documentRef, 'span', 'presentation-metric__label', item.label), element(context.documentRef, 'strong', 'presentation-metric__value', context.formatter.format(metric.value, item.format))); group.append(card); } return group; },
    callout: (block) => { const list = element(context.documentRef, 'ul', 'presentation-callouts'); for (const item of block.items) { const li = element(context.documentRef, 'li', `presentation-callout presentation-callout--${item.tone ?? 'neutral'}`); if (item.label) li.append(element(context.documentRef, 'strong', '', item.label)); li.append(element(context.documentRef, 'span', '', item.text)); list.append(li); } return list; },
    disclosure: (block) => element(context.documentRef, 'small', 'presentation-content__source', block.text)
  };
  const renderers = { ...legacy, table: (block) => renderTableBlock(block, context), chart: (block) => context.chartRenderer.render(block, { table: context.tables.get(block.data.dataset), attribution: context.attribution }), image: (block) => renderImageBlock(block, context), legend: (block) => renderLegendBlock(block, context) };
  return Object.freeze({
    types: Object.freeze(Object.keys(renderers)),
    renderBlock(block) { const renderer = renderers[block.type]; if (!renderer) throw new TypeError(`Unsupported content block: ${block.type}.`); return renderer(block); },
    render(container, state) { container.className = `presentation-content presentation-content--${state.content.layout}`; container.dataset.slideId = state.id; container.replaceChildren(); for (const block of state.content.blocks) container.append(this.renderBlock(block)); },
    destroy() { context.chartRenderer?.destroyAll?.(); }
  });
}
