import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocaleFormatter } from '../src/metrics/locale-formatter.js';

test('formatter uses project locale across the approved numeric vocabulary', () => {
  const en = createLocaleFormatter('en-US');
  const vi = createLocaleFormatter('vi-VN');
  assert.equal(en.format(1234.5, { type: 'decimal', decimals: 1 }), '1,234.5');
  assert.equal(vi.format(1234.5, { type: 'decimal', decimals: 1 }), '1.234,5');
  assert.equal(en.format(0.64, { type: 'percentage', decimals: 0 }), '64%');
  assert.equal(en.format(999, { type: 'distance', decimals: 0 }), '999 m');
  assert.equal(en.format(1500, { type: 'distance', decimals: 1 }), '1.5 km');
  assert.match(en.format(12.5, { type: 'currency', currency: 'USD', decimals: 2 }), /\$12\.50|US\$12\.50/);
});

test('formatter handles text, unavailable values, and invalid locales without a DSL', () => {
  const fallback = createLocaleFormatter('not-a-real-locale');
  assert.equal(fallback.format(null, { type: 'integer' }), '—');
  assert.equal(fallback.format(true, { type: 'text' }), 'true');
  assert.equal(fallback.unavailableLabel, 'unavailable');
  assert.throws(() => fallback.format(1, { type: 'scientific' }), /unsupported metric format/i);
});
