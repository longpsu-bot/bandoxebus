import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Chart.js is exactly 4.5.1 and loaded from the local vendor path', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const vendor = await readFile(new URL('../vendor/chart.js/4.5.1/chart.umd.min.js', import.meta.url), 'utf8');
  const license = await readFile(new URL('../vendor/chart.js/4.5.1/LICENSE.md', import.meta.url), 'utf8');
  assert.match(html, /\.\/vendor\/chart\.js\/4\.5\.1\/chart\.umd\.min\.js/);
  assert.doesNotMatch(html, /cdn[^\s"']*chart|unpkg[^\s"']*chart/i);
  assert.match(vendor.slice(0, 500), /v4\.5\.1/);
  assert.match(license, /MIT License/);
});
