const COMBINING_MARKS = /\p{M}+/gu;
const NON_ASCII_ID = /[^a-z0-9]+/g;

export function friendlyLabel(filename) {
  const leaf = String(filename ?? '').split(/[\\/]/).pop().trim();
  const withoutExtension = leaf.replace(/\.[^.]+$/, '').trim();
  return withoutExtension || 'Untitled data';
}

function baseImportId(label, prefix) {
  const normalized = String(label ?? '')
    .replace(/[đĐ]/g, (value) => value === 'đ' ? 'd' : 'D')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(NON_ASCII_ID, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) return prefix;
  return /^[a-z]/.test(normalized) ? normalized : `${prefix}-${normalized}`;
}

export function createImportId(label, usedIds = [], { prefix = 'data' } = {}) {
  const fallback = baseImportId(prefix, 'data');
  const base = baseImportId(label, fallback);
  const occupied = new Set(usedIds);
  if (!occupied.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
}
