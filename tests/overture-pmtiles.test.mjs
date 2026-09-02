import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('PMTiles 4.5.0 is pinned locally with verified executable and license provenance', async () => {
  const bundle = await readFile(new URL('vendor/pmtiles/4.5.0/pmtiles.js', root));
  const license = await readFile(new URL('vendor/pmtiles/4.5.0/LICENSE', root), 'utf8');
  const provenance = await readFile(new URL('vendor/pmtiles/THIRD-PARTY.md', root), 'utf8');

  assert.match(bundle.subarray(0, 4000).toString('utf8'), /PMTiles|Protocol/);
  assert.equal(
    createHash('sha256').update(bundle).digest('hex'),
    'caf981bc46f6327ee7e65d5dc964d89d38a69f60edca2bd4c5c890c21b554c6c'
  );
  assert.match(license, /The below license \(BSD-3\) applies to the reference implementations/);
  assert.match(license, /Redistribution and use in source and binary forms/);
  assert.equal(
    createHash('sha256').update(license).digest('hex'),
    '0371c38f338835f7fc13ed71176f3d92144e22c8b736a31cced57adbbeb647b3'
  );
  assert.match(provenance, /Version:\s*4\.5\.0/);
  assert.match(provenance, /License:\s*BSD-3-Clause/);
  assert.match(provenance, /23ae7c575578ad24cd579377d69c46550631da219e6f179997ec2cf3b8c937e5/);
  assert.match(provenance, /182d5b3cfdc2f5a6adbc54630c612da2f6086bdd/);
  assert.doesNotMatch(provenance, /cdn\.jsdelivr|unpkg\.com/i);
});
