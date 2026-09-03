import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import * as freeze from '../editor/publish/freeze-plan.js';

test('context replay preserves omitted modes and applies prior exit before current enter', () => {
  const action = (mode, type = 'context.set-mode') => ({ type, mode });
  assert.deepEqual(freeze.contextActiveSceneIndices({ states: [
    { map: { enter: [action('industrial-context', 'map.urban-context')] } },
    { map: { exit: [action('off')] } },
    { map: {} },
    { map: { enter: [action('industrial-context')], exit: [action('off')] } },
    { map: { enter: [action('industrial-context')] } },
    { map: { enter: [action('off', 'unknown'), action('unknown')] } },
    { map: { enter: [action('off')] } }
  ] }), [0, 1, 3, 4, 5]);
  assert.deepEqual(freeze.contextActiveSceneIndices({ states: [{ map: {} }] }), []);
});

function packageSnapshot() {
  const entry = (path, value) => ({ path, bytes: new TextEncoder().encode(value) });
  return { entries: [
    entry('project.json', JSON.stringify({ stories: { items: [{ src: './story.json' }] }, datasets: { area: { type: 'geojson', src: './area.geojson' } } })),
    entry('story.json', '{}'), entry('area.geojson', '{"type":"FeatureCollection","features":[]}')
  ] };
}

test('fingerprint hashes sorted declared production bytes only with identical Node/browser material', async () => {
  const first = packageSnapshot();
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const expected = hash(first.entries.slice().sort((a, b) => a.path < b.path ? -1 : 1)
    .map(({ path, bytes }) => `${path}\0${hash(bytes)}\n`).join(''));
  const fingerprint = await freeze.computeDeclaredPackageFingerprint(first, { cryptoRef: webcrypto });
  assert.equal(fingerprint, expected);
  const reordered = { entries: [...first.entries].reverse().concat({ path: 'extra.json', bytes: new Uint8Array([7]) }) };
  assert.equal(await freeze.computeDeclaredPackageFingerprint(reordered), fingerprint);
  reordered.entries[0].bytes = new TextEncoder().encode('{"type":"FeatureCollection","features":[]}\n');
  assert.notEqual(await freeze.computeDeclaredPackageFingerprint(reordered), fingerprint);
  await assert.rejects(freeze.computeDeclaredPackageFingerprint({ entries: first.entries.slice(0, 2) }), /missing.*area.geojson/i);
});

test('fingerprint explicitly materializes a declared lazy File and ignores undeclared Files', async () => {
  const snapshot = packageSnapshot();
  snapshot.entries[0].bytes = new TextEncoder().encode(JSON.stringify({ assets: { tiles: {
    type: 'pmtiles', src: './tiles.pmtiles', mediaType: 'application/vnd.pmtiles'
  } } }));
  const file = new File(['archive'], 'tiles.pmtiles');
  let reads = 0;
  const arrayBuffer = file.arrayBuffer.bind(file);
  file.arrayBuffer = () => { reads += 1; return arrayBuffer(); };
  snapshot.entries.push({ path: 'tiles.pmtiles', file }, { path: 'unused.pmtiles', file });
  const actual = await freeze.computeDeclaredPackageFingerprint(snapshot);
  assert.equal(reads, 1);
  assert.equal(actual, await freeze.computeDeclaredPackageFingerprint({ entries: [
    snapshot.entries[0], { path: 'tiles.pmtiles', bytes: new TextEncoder().encode('archive') }
  ] }));
});

test('plan emits only the transient orchestration contract and unions both exact viewport profiles', async () => {
  const input = {
    projectId: 'my-project', projectFingerprint: 'a'.repeat(64), overtureRelease: '2026-08-19.0',
    profiles: [
      { id: 'desktop', width: 1920, height: 1080, scenes: [{ index: 1, id: 'context', bounds: [106.58, 11.12, 106.62, 11.15] }] },
      { id: 'mobile', width: 390, height: 844, scenes: [{ index: 1, id: 'context', bounds: [106.59, 11.11, 106.61, 11.16] }] }
    ], finalBounds: [106.5, 11, 106.7, 11.2], createdAt: '2026-09-03T00:00:00.000Z'
  };
  const plan = await freeze.createOvertureFreezePlan(input);
  assert.deepEqual(plan, { kind: 'overture-pmtiles-c2-freeze-plan', version: 1,
    projectId: 'my-project', projectFingerprint: 'a'.repeat(64), overtureRelease: '2026-08-19.0',
    requiredBounds: [106.58, 11.11, 106.62, 11.16], finalBounds: input.finalBounds,
    profiles: input.profiles, createdAt: input.createdAt });
  await assert.rejects(freeze.createOvertureFreezePlan({ ...input, finalBounds: [106.59, 11.12, 106.61, 11.14] }), /must contain/i);
  await assert.rejects(freeze.createOvertureFreezePlan({ ...input, profiles: [] }), /profiles/i);
});

test('bounds union and enlargement enforce ordered WGS84 bounds without clipping', () => {
  assert.deepEqual(freeze.unionBounds([
    [106.59, 11.12, 106.60, 11.13], [106.58, 11.11, 106.62, 11.15]
  ]), [106.58, 11.11, 106.62, 11.15]);
  const required = [106.58, 11.11, 106.62, 11.15];
  assert.throws(() => freeze.validateFreezeBounds(required, [106.59, 11.12, 106.61, 11.14]), /must contain/i);
  assert.deepEqual(freeze.validateFreezeBounds(required, [106, 11, 107, 12]), [106, 11, 107, 12]);
  assert.deepEqual(freeze.validateFreezeBounds(required, required), required);
  for (const bounds of [[-181, 0, 1, 1], [0, -91, 1, 1], [0, 0, 181, 1], [0, 0, 1, 91], [1, 0, 0, 1], [0, 1, 1, 1], [NaN, 0, 1, 1], ['0', 0, 1, 1], [0, 0, 1]]) {
    assert.throws(() => freeze.unionBounds([bounds]), /bounds/i);
    assert.throws(() => freeze.validateFreezeBounds(required, bounds), /bounds/i);
  }
  assert.throws(() => freeze.unionBounds([]), /bounds/i);
});
