const DEFAULT_PALETTE = Object.freeze(['#2BB7FF', '#8BE9FD', '#A78BFA', '#34D399']);
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }

export function buildChartConfig(block, { table, palette = DEFAULT_PALETTE, reducedMotion = false } = {}) {
  const labels = table.rows.map((row) => row[block.data.x]);
  const datasets = block.data.series.map((series, index) => ({
    label: series.label,
    data: table.rows.map((row) => row[series.y]),
    borderColor: series.color ?? palette[index % palette.length],
    backgroundColor: series.color ?? palette[index % palette.length],
    borderWidth: 2,
    fill: block.chartType === 'area',
    tension: block.chartType === 'bar' ? 0 : 0.2
  }));
  return deepFreeze({
    type: block.chartType === 'area' ? 'line' : block.chartType,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: reducedMotion ? false : { duration: 300 },
      plugins: { legend: { display: datasets.length > 1 }, title: { display: true, text: block.title } },
      scales: { x: { stacked: Boolean(block.stacked) }, y: { stacked: Boolean(block.stacked), beginAtZero: true } }
    }
  });
}
