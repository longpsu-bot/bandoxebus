import { createImportId } from './import-identifiers.js';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const INTEGER_TEXT = /^[+-]?(?:0|[1-9]\d*)$/;
const NUMBER_TEXT = /^[+-]?(?:(?:0|[1-9]\d*)\.\d+|(?:0|[1-9]\d*)(?:[eE][+-]?\d+)|(?:0|[1-9]\d*)\.\d+(?:[eE][+-]?\d+))$/;
const LEADING_ZERO = /^[+-]?0\d/;

function blank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function scalar(value) {
  return value === null || value === undefined || value instanceof Date
    || ['string', 'number', 'boolean'].includes(typeof value);
}

function validDateText(value) {
  if (value instanceof Date) return !Number.isNaN(value.valueOf());
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(?:true|false)$/i.test(value.trim())) return value.trim().toLowerCase() === 'true';
  return undefined;
}

function numericValue(value, integer) {
  if (typeof value === 'number') return Number.isFinite(value) && (!integer || Number.isInteger(value)) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (LEADING_ZERO.test(text)) return undefined;
  const pattern = integer ? INTEGER_TEXT : new RegExp(`(?:${INTEGER_TEXT.source})|(?:${NUMBER_TEXT.source})`);
  if (!pattern.test(text)) return undefined;
  const result = Number(text);
  return Number.isFinite(result) && (!integer || Number.isInteger(result)) ? result : undefined;
}

function inferType(state) {
  if (!state.present) return 'text';
  if (state.date) return 'date';
  if (state.boolean) return 'boolean';
  if (state.integer) return 'integer';
  if (state.number) return 'number';
  return 'text';
}

function dateValue(value) {
  if (typeof value === 'string') return value.trim();
  // Spreadsheet Date objects represent workbook calendar components. Reading
  // local components avoids shifting the authored day through UTC.
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function convertValue(value, type) {
  if (blank(value)) return null;
  if (type === 'date') return dateValue(value);
  if (type === 'boolean') return booleanValue(value);
  if (type === 'integer') return numericValue(value, true);
  if (type === 'number') return numericValue(value, false);
  return typeof value === 'string' ? value : String(value);
}

export function normalizeTableGrid(grid, { headerRow = 0 } = {}) {
  if (!Array.isArray(grid) || !grid.length || !Number.isInteger(headerRow) || headerRow < 0 || headerRow >= grid.length) {
    throw new TypeError('Table import requires a valid header row.');
  }
  if (grid.some((row) => !Array.isArray(row))) throw new TypeError('Table import requires a rectangular row array.');
  let width = grid[headerRow].length;
  for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex += 1) {
    if (grid[rowIndex].length > width) width = grid[rowIndex].length;
  }
  if (!width) throw new TypeError('Table import requires at least one column.');
  const labels = Array.from({ length: width }, (_, index) => {
    const value = grid[headerRow][index];
    return blank(value) ? `Column ${index + 1}` : String(value).trim();
  });
  const used = [];
  const ids = labels.map((label) => {
    const id = createImportId(label, used, { prefix: 'column' });
    used.push(id);
    return id;
  });
  const states = Array.from({ length: width }, () => ({
    present: false, date: true, boolean: true, integer: true, number: true
  }));
  for (let sourceRowIndex = headerRow + 1; sourceRowIndex < grid.length; sourceRowIndex += 1) {
    const row = grid[sourceRowIndex];
    const rowIndex = sourceRowIndex - headerRow - 1;
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const value = row[columnIndex];
      if (!scalar(value)) throw new TypeError(`Unsupported nested table value at row ${rowIndex + 1}, column ${columnIndex + 1}.`);
      if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`Non-finite table value at row ${rowIndex + 1}, column ${columnIndex + 1}.`);
      if (blank(value)) continue;
      const state = states[columnIndex];
      state.present = true;
      state.date &&= validDateText(value);
      state.boolean &&= booleanValue(value) !== undefined;
      state.integer &&= numericValue(value, true) !== undefined;
      state.number &&= numericValue(value, false) !== undefined;
    }
  }
  const types = states.map(inferType);
  const rows = [];
  for (let rowIndex = headerRow + 1; rowIndex < grid.length; rowIndex += 1) {
    const source = grid[rowIndex];
    const row = {};
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      row[ids[columnIndex]] = convertValue(source[columnIndex], types[columnIndex]);
    }
    rows.push(row);
  }
  return {
    schemaVersion: '1.0',
    columns: ids.map((id, index) => ({ id, label: labels[index], type: types[index] })),
    rows
  };
}

export function normalizeRecordArray(records) {
  if (!Array.isArray(records) || !records.length || records.some((record) => !record || typeof record !== 'object' || Array.isArray(record))) {
    throw new TypeError('Unsupported JSON data shape: expected a non-empty array of plain records.');
  }
  const headings = [];
  const seen = new Set();
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!scalar(value)) throw new TypeError(`Unsupported nested JSON table value in ${key}; only scalar values are supported.`);
      if (!seen.has(key)) {
        seen.add(key);
        headings.push(key);
      }
    }
  }
  return normalizeTableGrid([
    headings,
    ...records.map((record) => headings.map((heading) => Object.hasOwn(record, heading) ? record[heading] : null))
  ]);
}
