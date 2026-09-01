import { reprojectFeatureCollection } from './crs.js';
import { createImportId, friendlyLabel } from './import-identifiers.js';
import { normalizeSpatialSource } from './spatial-normalizer.js';
import { normalizeRecordArray, normalizeTableGrid } from './table-normalizer.js';
import { validateTableData } from '../../src/project/resource-schemas.js';

const decoder = new TextDecoder('utf-8', { fatal: true });

function clone(value) {
  return structuredClone(value);
}

function tableCandidate(value, { label, id, sourceFormat, warnings = [] }) {
  validateTableData(value);
  return Object.freeze({
    kind: 'table',
    label,
    id,
    value: clone(value),
    rowCount: value.rows.length,
    columns: value.columns.map(({ id: columnId, label: columnLabel, type }) => ({ id: columnId, label: columnLabel, type })),
    warnings: [...warnings],
    sourceFormat
  });
}

function oneItem(label, id) {
  return Object.freeze([{ id, label }]);
}

function checkedItem(sourceItems, itemId) {
  const item = sourceItems.find(({ id }) => id === itemId);
  if (!item) throw new TypeError(`Unknown source item: ${itemId}.`);
  return item;
}

function trimPapaTrailingBlankRows(grid) {
  const result = grid.map((row) => [...row]);
  while (result.length > 1 && result.at(-1).every((value) => value === '')) result.pop();
  return result;
}

function papaErrors(errors) {
  return (errors ?? []).filter(({ code }) => code !== 'UndetectableDelimiter').slice(0, 5);
}

function exactColumnIndex(headings, configured, axis) {
  const value = String(configured ?? '').trim().toLowerCase();
  const index = headings.findIndex((heading) => String(heading ?? '').trim().toLowerCase() === value);
  if (index < 0) throw new TypeError(`${axis} column ${configured || '(blank)'} is missing.`);
  return index;
}

function numericCoordinate(value, rowNumber, axis) {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const result = Number(String(value).trim());
  if (!Number.isFinite(result)) throw new TypeError(`${axis} coordinate at CSV row ${rowNumber} is not a finite number.`);
  return result;
}

export async function openCsvSource(file, { papa, usedIds = [] } = {}) {
  if (!papa || typeof papa.parse !== 'function') throw new TypeError('PapaParse is required for CSV import.');
  const text = decoder.decode(new Uint8Array(await file.arrayBuffer())).replace(/^\uFEFF/, '');
  const detection = papa.parse(text, {
    dynamicTyping: false,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', '\t', '|', ';']
  });
  const parsed = papa.parse(text, {
    dynamicTyping: false,
    skipEmptyLines: false,
    delimiter: detection.meta?.delimiter || ','
  });
  const errors = papaErrors(parsed.errors);
  if (errors.length) {
    const detail = errors.map(({ row, message }) => `row ${Number(row) + 1}: ${message}`).join('; ');
    throw new TypeError(`CSV parse failed: ${detail}`);
  }
  const grid = trimPapaTrailingBlankRows(parsed.data);
  if (!grid.length) throw new TypeError('CSV contains no rows.');
  const label = friendlyLabel(file.name);
  const id = createImportId(label, usedIds);
  const sourceItems = Object.freeze([Object.freeze({
    id,
    label,
    headings: [...(grid[0] ?? [])],
    suggestedXColumn: (grid[0] ?? []).find((heading) => /^(?:x|lon|lng|longitude|easting)$/i.test(String(heading).trim())),
    suggestedYColumn: (grid[0] ?? []).find((heading) => /^(?:y|lat|latitude|northing)$/i.test(String(heading).trim())),
    defaultSourceCrs: (grid[0] ?? []).some((heading) => /^(?:lon|lng|longitude|lat|latitude)$/i.test(String(heading).trim())) ? 'EPSG:4326' : undefined
  })]);
  return Object.freeze({
    sourceItems,
    async prepare(itemId, {
      mode = 'table', headerRow = 0, xColumn, yColumn, zColumn, sourceCrs = 'EPSG:4326', proj4
    } = {}) {
      checkedItem(sourceItems, itemId);
      if (mode === 'table') {
        return tableCandidate(normalizeTableGrid(grid, { headerRow }), { label, id, sourceFormat: 'CSV' });
      }
      if (mode !== 'points') throw new TypeError(`Unsupported CSV import mode: ${mode}.`);
      if (!Number.isInteger(headerRow) || headerRow < 0 || headerRow >= grid.length) throw new TypeError('CSV point import requires a valid header row.');
      const headings = grid[headerRow];
      const xIndex = exactColumnIndex(headings, xColumn, 'X');
      const yIndex = exactColumnIndex(headings, yColumn, 'Y');
      const zIndex = zColumn ? exactColumnIndex(headings, zColumn, 'Z') : -1;
      const features = [];
      let blankCoordinateRows = 0;
      for (const [offset, row] of grid.slice(headerRow + 1).entries()) {
        const rowNumber = headerRow + offset + 2;
        const x = numericCoordinate(row[xIndex], rowNumber, 'X');
        const y = numericCoordinate(row[yIndex], rowNumber, 'Y');
        if (x === undefined || y === undefined) {
          blankCoordinateRows += 1;
          continue;
        }
        const z = zIndex < 0 ? undefined : numericCoordinate(row[zIndex], rowNumber, 'Z');
        const coordinates = z === undefined ? [x, y] : [x, y, z];
        features.push({
          type: 'Feature',
          properties: Object.fromEntries(headings.map((heading, index) => [String(heading || `Column ${index + 1}`), row[index] === '' || row[index] === undefined ? null : row[index]])),
          geometry: { type: 'Point', coordinates }
        });
      }
      if (!features.length) throw new TypeError('CSV point import has no rows with complete coordinates.');
      const projected = reprojectFeatureCollection({ type: 'FeatureCollection', features }, { sourceCrs, proj4 });
      const candidates = normalizeSpatialSource(projected, { label, id, sourceFormat: 'CSV', sourceCrs, usedIds });
      if (!blankCoordinateRows) return candidates;
      return candidates.map((candidate) => Object.freeze({
        ...candidate,
        warnings: [...candidate.warnings, `${blankCoordinateRows} CSV ${blankCoordinateRows === 1 ? 'row had' : 'rows had'} blank coordinates and will not be imported.`]
      }));
    },
    dispose() {}
  });
}

export async function openJsonTableSource(detection, { usedIds = [] } = {}) {
  if (!detection || detection.format !== 'json' || !['normalized-table', 'records'].includes(detection.jsonKind)) {
    throw new TypeError('JSON source is not a supported table shape.');
  }
  const file = detection.files[0];
  const label = friendlyLabel(file.name);
  const id = createImportId(label, usedIds);
  const sourceItems = oneItem(label, id);
  return Object.freeze({
    sourceItems,
    async prepare(itemId) {
      checkedItem(sourceItems, itemId);
      const value = detection.jsonKind === 'records' ? normalizeRecordArray(detection.value) : clone(detection.value);
      return tableCandidate(value, { label, id, sourceFormat: 'JSON' });
    },
    dispose() {}
  });
}

function sheetGrid(sheet, sheetJs) {
  if (!sheet?.['!ref']) return [];
  const range = sheetJs.utils.decode_range(sheet['!ref']);
  range.s.r = 0;
  range.s.c = 0;
  return sheetJs.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range
  });
}

function suggestedHeader(grid) {
  const limit = Math.min(50, grid.length);
  for (let index = 0; index < limit; index += 1) {
    if (grid[index].some((value) => value !== null && value !== undefined && String(value).trim() !== '')) return index;
  }
  return 0;
}

export async function openXlsxSource(bytes, { sheetJs, usedIds = [] } = {}) {
  if (!sheetJs?.read || !sheetJs?.utils) throw new TypeError('SheetJS is required for XLSX import.');
  const workbook = sheetJs.read(bytes, {
    type: 'array',
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    dense: false
  });
  const occupied = [...usedIds];
  const sourceItems = workbook.SheetNames.map((label, index) => {
    const id = createImportId(label, occupied, { prefix: 'sheet' });
    occupied.push(id);
    const grid = sheetGrid(workbook.Sheets[label], sheetJs);
    return Object.freeze({ id, label, sheetName: label, sheetIndex: index, suggestedHeaderRow: suggestedHeader(grid), grid });
  });
  if (!sourceItems.length) throw new TypeError('XLSX workbook contains no sheets.');
  return Object.freeze({
    sourceItems,
    async prepare(itemId, { headerRow } = {}) {
      const item = checkedItem(sourceItems, itemId);
      const chosen = headerRow ?? item.suggestedHeaderRow;
      if (!Number.isInteger(chosen) || chosen < 0 || chosen >= Math.min(50, item.grid.length)) {
        throw new TypeError('Choose a header row from the first 50 rows of the selected sheet.');
      }
      return tableCandidate(normalizeTableGrid(item.grid, { headerRow: chosen }), {
        label: item.label,
        id: item.id,
        sourceFormat: 'XLSX'
      });
    },
    dispose() {}
  });
}
