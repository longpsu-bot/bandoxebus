import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const REPORT_URL = new URL('./REPORT.md', import.meta.url);

test('Gate B report records the required project-runtime invariants', async () => {
  const report = await readFile(REPORT_URL, 'utf8');
  for (const marker of [
    'Manifest bootstrap: PASS',
    'Story 1.0 byte-identical: PASS',
    'Seven states unchanged: PASS',
    'Desktop/mobile lifecycle: PASS',
    'Legacy fallback: PASS',
    'One MapLibre instance: PASS',
    'Console clean: PASS',
    'Tests: 214/214 PASS'
  ]) assert.match(report, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const sustainedLow = Number(report.match(/Settled sustained-low FPS:\s*([\d.]+)/)?.[1]);
  assert.equal(Number.isFinite(sustainedLow), true);
  assert.ok(sustainedLow >= 30, `sustained-low FPS ${sustainedLow} is below the hard floor`);
});
