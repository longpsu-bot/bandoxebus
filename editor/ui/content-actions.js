import { moveArrayItem } from '../core/draft-store.js';
import { renderSchemaControls } from '../core/descriptors.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function unsupported(message) {
  throw Object.assign(new Error(message), { code: 'GUI_SCHEMA_UNSUPPORTED' });
}

function catalogId(item) {
  return typeof item === 'string' ? item : item.id;
}

function first(catalog, label) {
  const value = catalog?.[0];
  if (!value) unsupported(`A declared ${label} is required to create this content block.`);
  return value;
}

function tableCatalog(catalogs, datasetId) {
  return catalogs.tables?.find((table) => table.id === datasetId);
}

function setPath(target, path, value) {
  const parts = path.split('.');
  const field = parts.pop();
  const parent = parts.reduce((current, part) => current[part], target);
  if (value === undefined) delete parent[field];
  else parent[field] = clone(value);
}

export function createContentBlock(type, catalogs = {}) {
  const descriptor = catalogs.descriptors?.find((item) => item.type === type);
  if (!descriptor) unsupported(`Unsupported content block: ${type}`);
  if (['eyebrow', 'heading', 'paragraph', 'disclosure'].includes(type)) return { type, text: '' };
  if (type === 'stat-group') {
    const metric = first(catalogs.metrics, 'metric');
    return { type, items: [{ label: metric.label ?? metric.id, metric: metric.id, format: clone(metric.format) }] };
  }
  if (type === 'callout') return { type, items: [{ text: '' }] };
  if (type === 'table') {
    const table = first(catalogs.tables, 'normalized table');
    const column = first(table.columns, 'table column');
    return { type, data: { dataset: table.id, columns: [{ field: column.id }] } };
  }
  if (type === 'chart') {
    const table = first(catalogs.tables, 'normalized table');
    const x = table.columns.find((column) => ['text', 'date', 'integer'].includes(column.type));
    const y = table.columns.find((column) => ['integer', 'number'].includes(column.type));
    if (!x || !y) unsupported('A chart requires a categorical x column and a numeric series column.');
    return {
      type,
      chartType: 'bar',
      title: '',
      data: { dataset: table.id, x: x.id, series: [{ y: y.id, label: y.label ?? y.id }] }
    };
  }
  if (type === 'image') {
    const asset = first(catalogs.assets, 'image asset');
    return { type, asset: catalogId(asset), alt: '', decorative: true };
  }
  if (type === 'legend') return { type, items: [{ label: '', sample: 'swatch', color: '#000000' }] };
  unsupported(`Unsupported content block: ${type}`);
}

export function createCanonicalAction(type, actionDescriptors, values = {}) {
  const descriptor = actionDescriptors.find((item) => item.type === type);
  if (!descriptor) unsupported(`Unsupported action: ${type}`);
  const canonicalType = descriptor.parameters?.properties?.type?.const;
  if (typeof canonicalType !== 'string') unsupported(`Action descriptor has no canonical type: ${type}`);
  return { type: canonicalType, ...clone(values) };
}

export function createContentActionEditor({
  story,
  contentDescriptors,
  actionDescriptors,
  catalogs = {},
  save
}) {
  let current = clone(story);
  const contentCatalogs = { descriptors: contentDescriptors, ...catalogs };
  function persist(next) {
    current = clone(next);
    save(clone(current));
    return clone(current);
  }
  function state(index) {
    const result = current.states[index];
    if (!result) throw new TypeError(`Unknown state index: ${index}`);
    return result;
  }
  function tableFor(block) {
    const table = tableCatalog(catalogs, block.data.dataset);
    if (!table) throw new TypeError(`Unknown normalized table: ${block.data.dataset}`);
    return table;
  }
  return {
    replaceStory(value) { current = clone(value); },
    contentTypes: () => contentDescriptors.map(({ type }) => type),
    actionTypes: () => actionDescriptors.map(({ type }) => type),
    chartTypeOptions: () => ['bar', 'line', 'area'],
    tableColumnOptions: (block) => tableFor(block).columns.map(({ id }) => id),
    chartXOptions: (block) => tableFor(block).columns.filter(({ type }) => ['text', 'date', 'integer'].includes(type)).map(({ id }) => id),
    chartSeriesOptions: (block) => tableFor(block).columns.filter(({ type }) => ['integer', 'number'].includes(type)).map(({ id }) => id),
    setChartStacked(block, stacked) {
      if (stacked && block.chartType !== 'bar') throw new TypeError('Stacking is supported only for bar charts.');
      if (stacked) block.stacked = true;
      else delete block.stacked;
      return block;
    },
    setImageDecorative(block, decorative) {
      if (decorative) {
        block.decorative = true;
        block.alt = '';
      } else delete block.decorative;
      return block;
    },
    setImageAlt(block, alt) {
      if (block.decorative && alt !== '') throw new TypeError('A decorative image must have empty alt text.');
      block.alt = alt;
      return block;
    },
    setLegendSample(item, sample) {
      item.sample = sample;
      if (sample === 'icon') {
        delete item.color;
        item.asset = catalogId(first(catalogs.assets, 'image asset'));
      } else {
        delete item.asset;
        item.color ??= '#000000';
      }
      return item;
    },
    actionControls(type, value = {}) {
      const descriptor = actionDescriptors.find((item) => item.type === type);
      if (!descriptor) return { supported: false, code: 'GUI_SCHEMA_UNSUPPORTED', path: '$.action', message: `Unsupported action: ${type}`, controls: [] };
      const result = renderSchemaControls(descriptor.parameters, {
        value: { type, ...value },
        path: '$.action',
        catalogs
      });
      if (!result.supported) return result;
      const targetControl = result.controls.find((control) => control.path.endsWith('.target'));
      if (targetControl && targetControl.kind !== 'select') {
        const safeTargets = catalogs.actionTargets?.[type];
        if (!Array.isArray(safeTargets)) {
          return {
            supported: false,
            code: 'GUI_SCHEMA_UNSUPPORTED',
            path: targetControl.path,
            message: `No trusted semantic target catalog is available for ${type}.`,
            controls: []
          };
        }
      }
      return {
        ...result,
        controls: result.controls.map((control) => {
          if (!control.path.endsWith('.target') || control.kind === 'select') return control;
          const options = catalogs.actionTargets[type].map((item) => ({
            value: catalogId(item), label: item.label ?? catalogId(item)
          }));
          return { ...control, kind: 'select', options };
        })
      };
    },
    command(name, options) {
      const next = clone(current);
      const selected = next.states[options.stateIndex];
      if (!selected) throw new TypeError(`Unknown state index: ${options.stateIndex}`);
      if (name === 'add-block') {
        selected.content.blocks.push(createContentBlock(options.type, contentCatalogs));
      } else if (name === 'edit-block') {
        const block = selected.content.blocks[options.blockIndex];
        if (!block) throw new TypeError(`Unknown content block index: ${options.blockIndex}`);
        setPath(block, options.path, options.value);
        if (block.type === 'chart' && block.stacked && block.chartType !== 'bar') {
          throw new TypeError('Stacking is supported only for bar charts.');
        }
        if (block.type === 'image' && block.decorative && block.alt !== '') {
          throw new TypeError('A decorative image must have empty alt text.');
        }
      } else if (name === 'duplicate-block') {
        const block = selected.content.blocks[options.blockIndex];
        if (!block) throw new TypeError(`Unknown content block index: ${options.blockIndex}`);
        selected.content.blocks.splice(options.blockIndex + 1, 0, clone(block));
      } else if (name === 'move-block') {
        selected.content.blocks = moveArrayItem(selected.content.blocks, options.from, options.to);
      } else if (name === 'delete-block') {
        if (selected.content.blocks.length === 1) throw new TypeError('A Story state must contain at least one block.');
        selected.content.blocks.splice(options.blockIndex, 1);
      } else if (name === 'add-action') {
        selected.map[options.phase].push(createCanonicalAction(options.type, actionDescriptors, options.values));
      } else if (name === 'edit-action') {
        const action = selected.map[options.phase][options.actionIndex];
        if (!action) throw new TypeError(`Unknown ${options.phase} action index: ${options.actionIndex}`);
        setPath(action, options.path, options.value);
      } else if (name === 'duplicate-action') {
        const action = selected.map[options.phase][options.actionIndex];
        if (!action) throw new TypeError(`Unknown ${options.phase} action index: ${options.actionIndex}`);
        selected.map[options.phase].splice(options.actionIndex + 1, 0, clone(action));
      } else if (name === 'move-action') {
        selected.map[options.phase] = moveArrayItem(selected.map[options.phase], options.from, options.to);
      } else if (name === 'delete-action') {
        selected.map[options.phase].splice(options.actionIndex, 1);
      } else throw new TypeError(`Unknown content/action command: ${name}`);
      return persist(next);
    }
  };
}
