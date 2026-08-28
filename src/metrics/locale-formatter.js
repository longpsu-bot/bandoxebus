const TYPES = new Set(['integer', 'decimal', 'percentage', 'distance', 'currency', 'text']);

function resolvedLocale(locale) {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale])[0] ?? 'en';
  } catch {
    return 'en';
  }
}

function numberFormat(locale, decimals, extra = {}) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    ...extra
  });
}

export function createLocaleFormatter(locale = 'en') {
  const effectiveLocale = resolvedLocale(locale);
  const cache = new Map();
  const get = (key, factory) => {
    if (!cache.has(key)) cache.set(key, factory());
    return cache.get(key);
  };
  return Object.freeze({
    locale: effectiveLocale,
    unavailableLabel: 'unavailable',
    format(value, descriptor = { type: 'text' }) {
      const type = descriptor.type;
      if (!TYPES.has(type)) throw new TypeError(`Unsupported metric format: ${type}.`);
      if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return '—';
      if (type === 'text') return String(value);
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      const decimals = type === 'integer' ? 0 : descriptor.decimals ?? (type === 'decimal' ? 2 : 0);
      if (type === 'distance') {
        const kilometers = Math.abs(value) >= 1000;
        const scaled = kilometers ? value / 1000 : value;
        const unit = kilometers ? 'km' : 'm';
        const formatter = get(`${type}:${unit}:${decimals}`, () => numberFormat(effectiveLocale, decimals));
        return `${formatter.format(scaled)} ${unit}`;
      }
      const options = type === 'percentage' ? { style: 'percent' }
        : type === 'currency' ? { style: 'currency', currency: descriptor.currency }
          : {};
      const key = `${type}:${decimals}:${descriptor.currency ?? ''}`;
      return get(key, () => numberFormat(effectiveLocale, decimals, options)).format(value);
    }
  });
}
