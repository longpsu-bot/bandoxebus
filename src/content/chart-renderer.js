import { buildChartConfig } from './chart-config.js';

function element(documentRef, tag, className, text) { const node = documentRef.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function fallbackTable(block, table, documentRef, formatter) {
  const node = element(documentRef, 'table', 'content-chart__data'); node.setAttribute('aria-label', `${block.title} source data`);
  const head = element(documentRef, 'thead'); const hr = element(documentRef, 'tr');
  for (const field of [block.data.x, ...block.data.series.map(({ y }) => y)]) { const th = element(documentRef, 'th', '', table.columns.find(({ id }) => id === field)?.label ?? field); th.setAttribute('scope', 'col'); hr.append(th); } head.append(hr); node.append(head);
  const body = element(documentRef, 'tbody'); for (const row of table.rows) { const tr = element(documentRef, 'tr'); tr.append(element(documentRef, 'td', '', formatter.format(row[block.data.x], { type: typeof row[block.data.x] === 'number' ? 'decimal' : 'text' }))); for (const series of block.data.series) tr.append(element(documentRef, 'td', '', formatter.format(row[series.y], series.format ?? { type: 'decimal' }))); body.append(tr); } node.append(body); return node;
}

export function createChartRenderer({ Chart, documentRef = document, reducedMotion = false, formatter }) {
  const instances = new Set();
  return Object.freeze({
    render(block, context) {
      const wrapper = element(documentRef, 'figure', 'content-chart');
      const canvas = element(documentRef, 'canvas'); canvas.style.maxHeight = '220px'; canvas.setAttribute('role', 'img');
      const description = block.description ?? `Chart with ${context.table.rows.length} data rows.`;
      canvas.setAttribute('aria-label', `${block.title}. ${description}`); wrapper.append(canvas);
      const config = buildChartConfig(block, { table: context.table, formatter, reducedMotion });
      const instance = new Chart(canvas.getContext('2d'), structuredClone(config)); instances.add(instance);
      wrapper.append(fallbackTable(block, context.table, documentRef, formatter));
      if (block.source) wrapper.append(element(documentRef, 'small', 'content-source', context.attribution?.[block.source]?.name ?? block.source));
      return wrapper;
    },
    destroyAll() { for (const instance of instances) instance.destroy(); instances.clear(); }
  });
}
