import { validateTableData } from '../project/resource-schemas.js';
import { ProjectLoadError } from '../project/project-error.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function unknown(id) {
  throw new ProjectLoadError('TABLE_DATASET_UNKNOWN', `$.datasets.${id}`, `Unknown table dataset ID: ${id}.`);
}

export function createTableRegistry(datasetEntries = []) {
  const tables = new Map();
  for (const [id, authored] of datasetEntries) {
    const value = structuredClone(authored);
    validateTableData(value, { path: `$.datasets.${id}` });
    tables.set(id, deepFreeze(value));
  }
  const get = (id) => tables.get(id) ?? unknown(id);
  return Object.freeze({
    has: (id) => tables.has(id),
    get,
    columns: (id) => get(id).columns,
    rows: (id) => get(id).rows,
    catalog: () => deepFreeze([...tables].map(([id, table]) => ({ id, columns: structuredClone(table.columns) })))
  });
}
