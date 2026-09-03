import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOvertureFreezePlan, computeDeclaredPackageFingerprint } from '../editor/publish/freeze-plan.js';
import { loadProject } from '../src/project/project-loader.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../src/capabilities/installed-capabilities.js';
import * as freeze from '../scripts/lib/freeze-project.mjs';

const BOUNDS = [106.58, 11.1, 106.62, 11.15];
const SOURCE = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-08-19.0/buildings.pmtiles';
const METADATA = { name: 'Overture buildings', vector_layers: [{ id: 'building', fields: {} }, { id: 'building_part', fields: {} }] };
const HEADER = { tile_compression: 'gzip', tile_type: 'mvt', minzoom: 0, maxzoom: 14, bounds: BOUNDS, center: [106.6, 11.125, 11] };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SNAPSHOT_PATH = 'assets/context/overture-buildings.pmtiles';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'overture-freeze-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectDir = path.join(root, 'authoring');
  const outputDir = path.join(root, 'frozen');
  const planPath = path.join(root, 'freeze-plan.json');
  const manifest = JSON.parse(await fs.readFile(new URL('./fixtures/project-loader/minimal/project.json', import.meta.url)));
  manifest.capabilities = [{ id: 'urban-context-v1', settings: {
    adapter: 'route-61-2-current', buildingSource: 'overture-pmtiles', overtureRelease: '2026-08-19.0'
  } }];
  manifest.assets.photo = { type: 'image', src: './assets/photo.png', mediaType: 'image/png' };
  const story = JSON.parse(await fs.readFile(new URL('./fixtures/project-loader/minimal/stories/main.story.json', import.meta.url)));
  story.states[0].map.enter.push({ type: 'map.urban-context', mode: 'industrial-context' });
  const entries = [
    { path: 'project.json', bytes: Buffer.from(JSON.stringify(manifest)) },
    { path: 'stories/main.story.json', bytes: Buffer.from(JSON.stringify(story) + '\n') },
    { path: 'data/route.geojson', bytes: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[106.6, 11], [106.7, 11.1]] }
    }] })) },
    { path: 'assets/photo.png', bytes: Buffer.from([137, 80, 78, 71, 13, 10, 0, 255]) }
  ];
  for (const entry of entries) {
    await fs.mkdir(path.dirname(path.join(projectDir, entry.path)), { recursive: true });
    await fs.writeFile(path.join(projectDir, entry.path), entry.bytes);
  }
  await fs.writeFile(path.join(projectDir, 'review-notes.txt'), 'Not a declared resource');
  const plan = await createOvertureFreezePlan({ projectId: manifest.id,
    projectFingerprint: await computeDeclaredPackageFingerprint({ entries }), overtureRelease: '2026-08-19.0',
    profiles: [
      { id: 'desktop', width: 1920, height: 1080, scenes: [{ index: 0, id: 'opening', bounds: BOUNDS }] },
      { id: 'mobile', width: 390, height: 844, scenes: [{ index: 0, id: 'opening', bounds: BOUNDS }] }
    ], createdAt: '2026-09-03T00:00:00.000Z'
  });
  await fs.writeFile(planPath, JSON.stringify(plan));
  return { root, projectDir, outputDir, planPath, manifest, plan, entries };
}

function nativeBoundary(f, options = {}) {
  const calls = [];
  let ensured = 0;
  const ensureTool = async () => { ensured += 1; return path.join(f.root, 'verified-pmtiles'); };
  const runProcess = async (command, args) => {
    assert.equal(command, path.join(f.root, 'verified-pmtiles'));
    calls.push(args);
    if (options.beforeCommand) await options.beforeCommand(args);
    if (args[0] === 'extract') {
      if (args.includes('--dry-run')) return { code: 0, stdout: '', stderr:
        `2026/09/03 Extract transferred 12 MB (overfetch 0.05) for an archive size of ${options.predicted ?? '9.4 MB'}\n` };
      if (options.extractFails) return { code: 1, stdout: '', stderr: 'extract failed' };
      await fs.writeFile(args[2], Buffer.from('verified snapshot bytes'));
      if (options.actualBytes) await fs.truncate(args[2], options.actualBytes);
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'verify') return { code: options.verifyFails ? 1 : 0, stdout: '', stderr: options.verifyDiagnostic ?? '' };
    if (args[0] === 'show' && args[2] === '--header-json') {
      const header = args[1] === (options.source ?? SOURCE) ? options.sourceHeader ?? HEADER : options.header ?? HEADER;
      return { code: 0, stdout: JSON.stringify(header), stderr: '' };
    }
    if (args[0] === 'show' && args[2] === '--metadata') {
      const source = args[1] === (options.source ?? SOURCE);
      if (source && options.sourceMetadataFails) return { code: 1, stdout: '', stderr: 'metadata unavailable' };
      return { code: 0, stdout: options.invalidMetadata ? 'not JSON' : JSON.stringify(
        source ? options.sourceMetadata ?? METADATA : options.metadata ?? METADATA
      ), stderr: '' };
    }
    if (args[0] === 'show' && args.length === 2) return { code: 0, stdout: `pmtiles spec version: 3\nclustered: ${options.clustered ?? true}\n`, stderr: '' };
    assert.fail(`Unexpected native arguments ${JSON.stringify(args)}`);
  };
  return { calls, get ensured() { return ensured; }, ensureTool, runProcess,
    fetchImpl: async (url, request) => {
      assert.equal(String(url), SOURCE);
      assert.equal(request.method, 'HEAD');
      return new Response(null, { headers: { ETag: '"source-etag"', 'Content-Length': '123456' } });
    } };
}

async function previousPublication(f) {
  const prior = structuredClone(f.manifest);
  prior.capabilities[0].settings.buildingSource = 'project-snapshot';
  const archive = Buffer.from('previous publication');
  prior.assets['overture-buildings-snapshot'] = { type: 'pmtiles', src: `./${SNAPSHOT_PATH}`,
    mediaType: 'application/vnd.pmtiles', required: true, attribution: ['overture-maps'] };
  prior.attribution['overture-maps'] = { name: 'Overture Maps Foundation — Buildings', license: 'ODbL-1.0' };
  prior.capabilities[0].settings.snapshot = { asset: 'overture-buildings-snapshot', theme: 'buildings', bounds: BOUNDS,
    sha256: digest(archive), byteLength: archive.length, generator: 'go-pmtiles', generatorVersion: '1.31.2',
    generatedAt: '2026-09-03T00:00:00.000Z' };
  f.previousEntries = [
    ...f.entries.filter(({ path: relative }) => relative !== 'project.json'),
    { path: 'project.json', bytes: Buffer.from(JSON.stringify(prior)) },
    { path: SNAPSHOT_PATH, bytes: archive }
  ];
  for (const entry of f.previousEntries) {
    await fs.mkdir(path.dirname(path.join(f.outputDir, entry.path)), { recursive: true });
    await fs.writeFile(path.join(f.outputDir, entry.path), entry.bytes);
  }
  // Replacement/rollback fixtures themselves must be complete production-valid packages.
  await loadProject(pathToFileURL(path.join(f.outputDir, 'project.json')), {
    capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY,
    fetchImpl: async (url) => new Response(await fs.readFile(fileURLToPath(url)))
  });
  f.previousInventory = await directorySnapshot(f.outputDir);
}

async function updateManifest(f, mutate) {
  mutate(f.manifest);
  f.entries[0].bytes = Buffer.from(JSON.stringify(f.manifest));
  await fs.writeFile(path.join(f.projectDir, 'project.json'), f.entries[0].bytes);
  f.plan.projectFingerprint = await computeDeclaredPackageFingerprint({ entries: f.entries });
  await fs.writeFile(f.planPath, JSON.stringify(f.plan));
}

async function assertPreserved(f) {
  for (const entry of f.previousEntries) assert.deepEqual(await fs.readFile(path.join(f.outputDir, entry.path)), entry.bytes);
  assert.deepEqual(await directorySnapshot(f.outputDir), f.previousInventory);
  for (const entry of f.entries) assert.deepEqual(await fs.readFile(path.join(f.projectDir, entry.path)), entry.bytes);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['authoring', 'freeze-plan.json', 'frozen']);
}

test('human archive sizes distinguish decimal and IEC units and reject malformed sizes', () => {
  for (const [value, expected] of [
    ['0 B', 0], ['12 B', 12], ['1.5 kB', 1500], ['1.001 kB', 1001], ['9.4 MB', 9400000],
    ['2 GB', 2000000000], ['1 TB', 1000000000000], ['1 KiB', 1024],
    ['32 MiB', 33554432], ['1 GiB', 1073741824], ['1 TiB', 1099511627776]
  ]) assert.equal(freeze.parseHumanBytes(value), expected, value);
  for (const value of ['1 KB', '-1 MB', 'NaN B', '1', '1 PB', '1 MB garbage', '0.1 B']) {
    assert.throws(() => freeze.parseHumanBytes(value), /size|bytes/i, value);
  }
});

test('dry-run parser reads archive size, never transfer size, including native log prefixes', () => {
  assert.deepEqual(freeze.parsePmtilesDryRun(
    '2026/09/03 Extract transferred 12 MB (overfetch 0.05) for an archive size of 9.4 MB\n'
  ), { archiveBytes: 9400000 });
  assert.throws(() => freeze.parsePmtilesDryRun('Extract transferred 12 MB'), /archive size/i);
});

test('freeze writes a production-valid declared-only Folder and preserves authoring bytes', async (t) => {
  const f = await fixture(t);
  const native = nativeBoundary(f);
  const result = await freeze.freezeProject({ ...f, ...native });
  assert.equal(result.outputDir, f.outputDir);
  assert.equal(result.snapshotPath, path.join(f.outputDir, 'assets/context/overture-buildings.pmtiles'));
  assert.equal(result.snapshotSha256, digest('verified snapshot bytes'));
  assert.equal(result.snapshotBytes, 23);
  assert.deepEqual(result.bounds, BOUNDS);
  assert.equal(result.release, '2026-08-19.0');
  assert.equal(result.warning, null);
  assert.equal(result.sourceKind, 'official');
  assert.equal(result.sourceArchiveSha256, null);
  assert.equal(result.sourceEtag, '"source-etag"');
  assert.equal(result.sourceContentLength, 123456);
  const frozen = JSON.parse(await fs.readFile(path.join(f.outputDir, 'project.json')));
  assert.deepEqual(frozen.assets['overture-buildings-snapshot'], { type: 'pmtiles', src: './assets/context/overture-buildings.pmtiles',
    mediaType: 'application/vnd.pmtiles', required: true, attribution: ['overture-maps'] });
  assert.deepEqual(frozen.attribution['overture-maps'], { name: 'Overture Maps Foundation — Buildings', url: 'https://overturemaps.org/',
    license: 'ODbL-1.0', updated: '2026-08-19', notes: 'Frozen from Overture release 2026-08-19.0.' });
  const settings = frozen.capabilities[0].settings;
  assert.equal(settings.buildingSource, 'project-snapshot');
  assert.equal(settings.adapter, 'route-61-2-current');
  assert.equal(settings.overtureRelease, '2026-08-19.0');
  assert.deepEqual(settings.snapshot, { asset: 'overture-buildings-snapshot', theme: 'buildings', bounds: BOUNDS,
    sha256: result.snapshotSha256, byteLength: 23, generator: 'go-pmtiles', generatorVersion: '1.31.2',
    generatedAt: settings.snapshot.generatedAt, sourceContentLength: 123456, sourceEtag: '"source-etag"' });
  assert.ok(Number.isFinite(Date.parse(settings.snapshot.generatedAt)));
  for (const entry of f.entries) {
    assert.deepEqual(await fs.readFile(path.join(f.projectDir, entry.path)), entry.bytes);
    if (entry.path !== 'project.json') assert.deepEqual(await fs.readFile(path.join(f.outputDir, entry.path)), entry.bytes);
  }
  assert.deepEqual((await fs.readdir(f.outputDir)).sort(), ['assets', 'data', 'project.json', 'stories']);
  const temp = native.calls[0][2];
  assert.deepEqual(native.calls.slice(0, 5), [
    ['extract', SOURCE, temp, '--bbox=106.58,11.1,106.62,11.15', '--download-threads=4', '--overfetch=0.05', '--dry-run'],
    ['extract', SOURCE, temp, '--bbox=106.58,11.1,106.62,11.15', '--download-threads=4', '--overfetch=0.05'],
    ['verify', temp], ['show', temp, '--header-json'], ['show', temp, '--metadata']
  ]);
  assert.ok(native.calls.some((args) => args.join('|') === `show|${temp}`));
  assert.ok(native.calls.some((args) => args.join('|') === `show|${SOURCE}|--header-json`));
  assert.ok(native.calls.some((args) => args.join('|') === `show|${SOURCE}|--metadata`));
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['authoring', 'freeze-plan.json', 'frozen']);
});

for (const [name, mutate, pattern] of [
  ['kind', (p) => { p.kind = 'other'; }, /kind|plan/i],
  ['version', (p) => { p.version = 2; }, /version|plan/i],
  ['project id', (p) => { p.projectId = 'other'; }, /project.*id/i],
  ['fingerprint', (p) => { p.projectFingerprint = 'a'.repeat(64); }, /fingerprint/i],
  ['release', (p) => { p.overtureRelease = '2026-08-18.0'; }, /release/i],
  ['shrunk final bounds', (p) => { p.finalBounds = [106.59, 11.11, 106.61, 11.14]; }, /contain|bounds/i],
  ['forged required union', (p) => { p.requiredBounds = [106.59, 11.11, 106.61, 11.14]; }, /bounds|plan/i],
  ['wrong scene id', (p) => { for (const profile of p.profiles) profile.scenes[0].id = 'wrong'; }, /scene/i],
  ['wrong viewport', (p) => { p.profiles[0].width = 800; }, /profile/i],
  ['authored source URL', (p) => { p.sourceUrl = 'https://attacker.invalid/archive'; }, /plan/i]
]) test(`rejects stale/inconsistent plan ${name} before ensuring or invoking native tool`, async (t) => {
  const f = await fixture(t);
  mutate(f.plan);
  await fs.writeFile(f.planPath, JSON.stringify(f.plan));
  const native = nativeBoundary(f);
  await assert.rejects(freeze.freezeProject({ ...f, ...native }), pattern);
  assert.equal(native.ensured, 0);
  assert.equal(native.calls.length, 0);
});

for (const change of ['disk bytes', 'local-geojson', 'project-snapshot']) test(`rejects changed authoring ${change} before native invocation`, async (t) => {
  const f = await fixture(t);
  if (change === 'disk bytes') await fs.appendFile(path.join(f.projectDir, 'stories/main.story.json'), '\n');
  else {
    f.manifest.capabilities[0].settings.buildingSource = change;
    await fs.writeFile(path.join(f.projectDir, 'project.json'), JSON.stringify(f.manifest));
  }
  const native = nativeBoundary(f);
  await assert.rejects(freeze.freezeProject({ ...f, ...native }), /fingerprint|buildingSource|overture-pmtiles|snapshot building source/i);
  assert.equal(native.ensured, 0);
  assert.equal(native.calls.length, 0);
});

for (const [name, options, pattern] of [
  ['predicted oversize', { predicted: '65 MiB' }, /64 MiB|size/i],
  ['actual oversize', { actualBytes: 67108865 }, /64 MiB|size/i],
  ['extract failure', { extractFails: true }, /extract/i],
  ['verify failure', { verifyFails: true }, /verify/i],
  ['zero-exit native Invalid diagnostic', { verifyDiagnostic: '2026/09/03 Invalid: directory offset' }, /verify|invalid/i],
  ['non-MVT archive', { header: { ...HEADER, tile_type: 'png' } }, /MVT|tile/i],
  ['unclustered archive', { clustered: false }, /cluster/i],
  ['inexact bounds', { header: { ...HEADER, bounds: [106.57, 11.1, 106.62, 11.15] } }, /bounds/i],
  ['source zoom not preserved', { sourceHeader: { ...HEADER, minzoom: 1 } }, /zoom/i],
  ['insufficient minimum zoom', { header: { ...HEADER, minzoom: 12 } }, /zoom/i],
  ['insufficient maximum zoom', { header: { ...HEADER, maxzoom: 13 } }, /zoom/i],
  ['missing building layer', { metadata: { vector_layers: [{ id: 'building_part' }] } }, /building/i],
  ['changed source metadata', { sourceMetadata: { ...METADATA, name: 'different' } }, /metadata/i],
  ['unavailable source metadata', { sourceMetadataFails: true }, /metadata/i],
  ['malformed metadata', { invalidMetadata: true }, /JSON|metadata/i]
]) test(`transaction preserves old publication after ${name}`, async (t) => {
  const f = await fixture(t);
  await previousPublication(f);
  const native = nativeBoundary(f, options);
  await assert.rejects(freeze.freezeProject({ ...f, ...native }), pattern);
  if (name === 'predicted oversize') assert.equal(native.calls.filter(([command]) => command === 'extract').length, 1);
  await assertPreserved(f);
});

for (const [predicted, actualBytes, warning] of [
  ['32 MiB', null, null], ['33 MiB', null, 'large'], ['64 MiB', null, 'large'], ['1 MiB', 33554433, 'large']
]) test(`size warning uses independent preflight/actual gates (${predicted}/${actualBytes})`, async (t) => {
  const f = await fixture(t);
  const result = await freeze.freezeProject({ ...f, ...nativeBoundary(f, { predicted, actualBytes }) });
  assert.equal(result.warning, warning);
});

test('failed first extraction leaves output absent', async (t) => {
  const f = await fixture(t);
  await assert.rejects(freeze.freezeProject({ ...f, ...nativeBoundary(f, { extractFails: true }) }), /extract/i);
  await assert.rejects(fs.stat(f.outputDir), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['authoring', 'freeze-plan.json']);
});

test('staged production validation rejects corrupted resource before output replacement', async (t) => {
  const f = await fixture(t);
  await previousPublication(f);
  let corrupted = false;
  const faultFs = { ...fs, async writeFile(file, bytes, ...args) {
    if (file !== path.join(f.projectDir, 'stories/main.story.json') && file.endsWith(path.join('stories', 'main.story.json'))) {
      corrupted = true;
      return fs.writeFile(file, '{}', ...args);
    }
    return fs.writeFile(file, bytes, ...args);
  } };
  await assert.rejects(freeze.freezeProject({ ...f, ...nativeBoundary(f), fs: faultFs }), /Story|schemaVersion/i);
  assert.equal(corrupted, true);
  await assertPreserved(f);
});

test('swap failure restores previous publication and removes staging', async (t) => {
  const f = await fixture(t);
  await previousPublication(f);
  let failed = false;
  const faultFs = { ...fs, async rename(from, to) {
    if (to === f.outputDir && !failed) {
      failed = true;
      // Real asynchronous filesystem failure, without moving the staged package.
      return fs.rename(from, path.join(f.root, 'nonexistent-parent', 'output'));
    }
    return fs.rename(from, to);
  } };
  await assert.rejects(freeze.freezeProject({ ...f, ...nativeBoundary(f), fs: faultFs }), { code: 'ENOENT' });
  assert.equal(failed, true);
  await assertPreserved(f);
});

test('successful replacement waits for production validation and never eagerly reads snapshot via fileFetch', async (t) => {
  const f = await fixture(t);
  await previousPublication(f);
  let stagedStoryRead = false;
  let published = false;
  const observeFs = { ...fs,
    async readFile(file, ...args) {
      assert.equal(String(file).endsWith('.pmtiles'), false, 'PMTiles must be streamed for hash, not read by production fileFetch');
      if (String(file).endsWith(path.join('stories', 'main.story.json')) && String(file).startsWith(path.join(f.root, '.frozen.staging-'))) {
        stagedStoryRead = true;
        assert.equal(await fs.readFile(path.join(f.outputDir, SNAPSHOT_PATH), 'utf8'), 'previous publication');
      }
      return fs.readFile(file, ...args);
    },
    async open(file, ...args) {
      assert.notEqual(file, path.join(f.outputDir, SNAPSHOT_PATH), 'Prior archive must not be rehashed for classification');
      return fs.open(file, ...args);
    },
    async rename(from, to) {
      if (to === f.outputDir) { assert.equal(stagedStoryRead, true); published = true; }
      return fs.rename(from, to);
    }
  };
  await freeze.freezeProject({ ...f, ...nativeBoundary(f), fs: observeFs });
  assert.equal(published, true);
  assert.equal(await fs.readFile(path.join(f.outputDir, SNAPSHOT_PATH), 'utf8'), 'verified snapshot bytes');
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['authoring', 'freeze-plan.json', 'frozen']);
});

for (const mode of ['failure', 'missing', 'malformed']) test(`optional HEAD evidence ${mode} is non-fatal`, async (t) => {
  const f = await fixture(t);
  const fetchImpl = async () => {
    if (mode === 'failure') throw new Error('HEAD unavailable');
    return new Response(null, { headers: mode === 'malformed' ? { 'Content-Length': '-1' } : {} });
  };
  const result = await freeze.freezeProject({ ...f, ...nativeBoundary(f), fetchImpl });
  assert.equal(result.sourceEtag, null);
  assert.equal(result.sourceContentLength, null);
  const frozen = JSON.parse(await fs.readFile(path.join(f.outputDir, 'project.json')));
  assert.equal('sourceContentLength' in frozen.capabilities[0].settings.snapshot, false);
  assert.equal('sourceEtag' in frozen.capabilities[0].settings.snapshot, false);
});

for (const [name, archive, hash] of [
  ['archive only', 'local', null], ['hash only', null, 'a'.repeat(64)],
  ['mismatch', 'local', 'a'.repeat(64)], ['uppercase hash', 'local', 'A'.repeat(64)],
  ['URL', 'https://source.invalid/a.pmtiles', 'a'.repeat(64)],
  ['query', 'archive.pmtiles?download', 'a'.repeat(64)], ['fragment', 'archive.pmtiles#x', 'a'.repeat(64)]
]) test(`retained source ${name} rejects before native tool`, async (t) => {
  const f = await fixture(t);
  const sourceArchive = archive === 'local' ? path.join(f.root, 'retained.pmtiles') : archive;
  if (archive === 'local') await fs.writeFile(sourceArchive, 'exact retained source');
  const native = nativeBoundary(f);
  await assert.rejects(freeze.freezeProject({ ...f, ...native, sourceArchive, sourceSha256: hash }), /source|SHA|local|path/i);
  assert.equal(native.ensured, 0);
  assert.equal(native.calls.length, 0);
});

test('retained-source identity gates every native invocation and keeps release semantics', async (t) => {
  const f = await fixture(t);
  const sourceArchive = path.join(f.root, 'retained.pmtiles');
  await fs.writeFile(sourceArchive, 'exact retained source');
  const sourceSha256 = digest('exact retained source');
  const native = nativeBoundary(f, { source: sourceArchive });
  const result = await freeze.freezeProject({ ...f, ...native, sourceArchive, sourceSha256,
    fetchImpl: () => { assert.fail('Retained source must not make remote HEAD requests'); } });
  assert.equal(result.sourceKind, 'retained-local');
  assert.equal(result.sourceArchiveSha256, sourceSha256);
  assert.equal(result.sourceEtag, null);
  assert.equal(result.sourceContentLength, null);
  assert.ok(native.calls.some((args) => args.join('|') === `show|${sourceArchive}|--metadata`));
  assert.ok(native.calls.filter(([command]) => command === 'extract').every((args) => args[1] === sourceArchive));
  const frozenText = await fs.readFile(path.join(f.outputDir, 'project.json'), 'utf8');
  assert.equal(JSON.parse(frozenText).capabilities[0].settings.overtureRelease, '2026-08-19.0');
  assert.equal(frozenText.includes(sourceSha256), false);
  assert.equal(frozenText.includes('retained.pmtiles'), false);
  assert.equal(await fs.readFile(sourceArchive, 'utf8'), 'exact retained source');
});

for (const target of ['self', 'child', 'ancestor', 'root', 'home', 'workspace', 'unrelated']) test(`unsafe ${target} output is rejected without native work`, async (t) => {
  const f = await fixture(t);
  const outputDir = { self: f.projectDir, child: path.join(f.projectDir, 'frozen'), ancestor: f.root,
    root: path.parse(f.root).root, home: os.homedir(), workspace: process.cwd(), unrelated: path.join(f.root, 'unrelated') }[target];
  if (target === 'unrelated') {
    await fs.mkdir(outputDir);
    await fs.writeFile(path.join(outputDir, 'unrelated.txt'), 'keep');
  }
  const native = nativeBoundary(f);
  await assert.rejects(freeze.freezeProject({ ...f, ...native, outputDir }), /output|overlap|directory|publication/i);
  assert.equal(native.ensured, 0);
  for (const entry of f.entries) assert.deepEqual(await fs.readFile(path.join(f.projectDir, entry.path)), entry.bytes);
});

test('resolved directory symlink cannot send output inside authoring', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'alias');
  await fs.symlink(f.projectDir, alias, 'junction');
  const native = nativeBoundary(f);
  await assert.rejects(freeze.freezeProject({ ...f, ...native, outputDir: path.join(alias, 'frozen') }), /output|overlap/i);
  assert.equal(native.ensured, 0);
});

test('declared resource directory symlink escape is rejected before native work', async (t) => {
  const f = await fixture(t);
  await fs.rename(path.join(f.projectDir, 'data'), path.join(f.root, 'outside-data'));
  await fs.symlink(path.join(f.root, 'outside-data'), path.join(f.projectDir, 'data'), 'junction');
  const native = nativeBoundary(f);
  await assert.rejects(freeze.freezeProject({ ...f, ...native }), /resource|outside|escape/i);
  assert.equal(native.ensured, 0);
});

test('conflicting Overture provenance is rejected without overwriting authored attribution', async (t) => {
  const f = await fixture(t);
  f.manifest.attribution['overture-maps'] = { name: 'Different owner', license: 'MIT' };
  f.entries[0].bytes = Buffer.from(JSON.stringify(f.manifest));
  await fs.writeFile(path.join(f.projectDir, 'project.json'), f.entries[0].bytes);
  f.plan.projectFingerprint = await computeDeclaredPackageFingerprint({ entries: f.entries });
  await fs.writeFile(f.planPath, JSON.stringify(f.plan));
  const native = nativeBoundary(f);
  await assert.rejects(freeze.freezeProject({ ...f, ...native }), /attribution|provenance/i);
  assert.deepEqual(await fs.readFile(path.join(f.projectDir, 'project.json')), f.entries[0].bytes);
});

test('canonical reserved PMTiles asset is replaced without changing the original archive', async (t) => {
  const f = await fixture(t);
  const relative = 'assets/context/overture-buildings.pmtiles';
  const oldBytes = Buffer.from('previous archive');
  await fs.mkdir(path.dirname(path.join(f.projectDir, relative)), { recursive: true });
  await fs.writeFile(path.join(f.projectDir, relative), oldBytes);
  f.entries.push({ path: relative, bytes: oldBytes });
  await updateManifest(f, (manifest) => {
    manifest.assets['overture-buildings-snapshot'] = { type: 'pmtiles', src: './assets/context/overture-buildings.pmtiles',
      mediaType: 'application/vnd.pmtiles', required: true, attribution: ['overture-maps'] };
    manifest.attribution['overture-maps'] = { name: 'Overture Maps Foundation — Buildings', license: 'ODbL-1.0' };
  });
  await freeze.freezeProject({ ...f, ...nativeBoundary(f) });
  assert.deepEqual(await fs.readFile(path.join(f.projectDir, relative)), oldBytes);
  assert.equal(await fs.readFile(path.join(f.outputDir, relative), 'utf8'), 'verified snapshot bytes');
});

for (const collision of ['unrelated PMTiles', 'reserved ID image', 'reserved path image']) {
  test(`rejects ${collision} collision before native work`, async (t) => {
    const f = await fixture(t);
    const native = nativeBoundary(f);
    const relative = collision === 'reserved path image' ? 'assets/context/overture-buildings.pmtiles' : 'assets/other.pmtiles';
    await fs.mkdir(path.dirname(path.join(f.projectDir, relative)), { recursive: true });
    await fs.writeFile(path.join(f.projectDir, relative), 'unrelated bytes');
    f.entries.push({ path: relative, bytes: Buffer.from('unrelated bytes') });
    await updateManifest(f, (manifest) => {
      manifest.assets[collision === 'reserved ID image' ? 'overture-buildings-snapshot' : 'other'] = {
        type: collision === 'unrelated PMTiles' ? 'pmtiles' : 'image', src: `./${relative}`,
        mediaType: collision === 'unrelated PMTiles' ? 'application/vnd.pmtiles' : 'image/png'
      };
    });
    await assert.rejects(freeze.freezeProject({ ...f, ...native }), /reserved|PMTiles|conflict/i);
    assert.equal(native.ensured, 0);
    assert.equal(await fs.readFile(path.join(f.projectDir, relative), 'utf8'), 'unrelated bytes');
  });
}

test('CLI parses only exact option names, preserves path values, and emits JSON result', async () => {
  const cli = await import('../scripts/freeze-overture-snapshot.mjs');
  const argumentsList = ['--project=./authoring folder', '--plan=./plan.json', '--output=./frozen',
    '--source-archive=./retained.pmtiles', `--source-sha256=${'a'.repeat(64)}`];
  const expected = { projectDir: './authoring folder', planPath: './plan.json', outputDir: './frozen',
    sourceArchive: './retained.pmtiles', sourceSha256: 'a'.repeat(64) };
  assert.deepEqual(cli.parseFreezeArgs(argumentsList), expected);
  const lines = [];
  await cli.main(argumentsList, { freeze: async (input) => {
    assert.deepEqual(input, expected);
    return { outputDir: '/frozen', warning: 'large' };
  }, print: (line) => lines.push(line) });
  assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ outputDir: '/frozen', warning: 'large' }]);
  const required = argumentsList.slice(0, 3);
  for (const args of [[], required.slice(0, 2), [...required, '--project=duplicate'], [...required, '--unknown=x'],
    [...required, '--source-archive=local'], [...required, `--source-sha256=${'a'.repeat(64)}`],
    ['--project=', ...required.slice(1)], ['--project', 'folder', ...required.slice(1)]]) {
    assert.throws(() => cli.parseFreezeArgs(args), /option|argument|required|pair|empty/i);
  }
});

test('CLI executable fails concisely on unknown arguments without writing stdout', () => {
  const script = fileURLToPath(new URL('../scripts/freeze-overture-snapshot.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--unknown=x'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /unknown.*option/i);
  assert.equal(result.stderr.includes('node:internal'), false);
});

test('package freeze:overture script routes invalid arguments through the CLI', async () => {
  // Exercise the package-defined command, rather than grepping its source text.
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(typeof pkg.scripts['freeze:overture'], 'string');
  const [command, ...args] = pkg.scripts['freeze:overture'].split(' ');
  const result = spawnSync(command === 'node' ? process.execPath : command, [...args, '--unknown=x'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown.*option/i);
});

test('tool setup receives a repository-anchored cache instead of caller CWD defaults', async (t) => {
  const f = await fixture(t);
  const native = nativeBoundary(f);
  const repositoryCache = fileURLToPath(new URL('../.cache/map-story-tools/pmtiles', import.meta.url));
  await freeze.freezeProject({ ...f, ...native, ensureTool: async (options) => {
    assert.equal(options.cacheRoot, repositoryCache);
    return native.ensureTool();
  } });
});

test('tool cache falls back outside authoring when the normal cache resolves inside it', async (t) => {
  const f = await fixture(t);
  const native = nativeBoundary(f);
  const repositoryCache = fileURLToPath(new URL('../.cache/map-story-tools/pmtiles', import.meta.url));
  const observeFs = { ...fs, async realpath(target) {
    if (target === repositoryCache) return path.join(f.projectDir, '.cache');
    return fs.realpath(target);
  } };
  await freeze.freezeProject({ ...f, ...native, fs: observeFs, ensureTool: async (options) => {
    assert.equal(options.cacheRoot, path.join(await fs.realpath(os.tmpdir()), 'map-story-tools', 'pmtiles'));
    return native.ensureTool();
  } });
});

test('new unrelated output appearing during extraction is not replaced', async (t) => {
  const f = await fixture(t);
  const native = nativeBoundary(f, { beforeCommand: async (args) => {
    if (args[0] === 'extract' && !args.includes('--dry-run')) {
      await fs.mkdir(f.outputDir);
      await fs.writeFile(path.join(f.outputDir, 'unrelated.txt'), 'do not overwrite');
    }
  } });
  await assert.rejects(freeze.freezeProject({ ...f, ...native }), /output|publication|changed/i);
  assert.equal(await fs.readFile(path.join(f.outputDir, 'unrelated.txt'), 'utf8'), 'do not overwrite');
});

test('prior publication changed into an authoring alias during extraction is not moved', async (t) => {
  const f = await fixture(t);
  await previousPublication(f);
  const displaced = path.join(f.root, 'displaced');
  const native = nativeBoundary(f, { beforeCommand: async (args) => {
    if (args[0] === 'extract' && !args.includes('--dry-run')) {
      await fs.rename(f.outputDir, displaced);
      await fs.symlink(f.projectDir, f.outputDir, 'junction');
    }
  } });
  await assert.rejects(freeze.freezeProject({ ...f, ...native }), /output|publication|link|changed/i);
  assert.equal((await fs.lstat(f.outputDir)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(path.join(displaced, SNAPSHOT_PATH), 'utf8'), 'previous publication');
  for (const entry of f.entries) assert.deepEqual(await fs.readFile(path.join(f.projectDir, entry.path)), entry.bytes);
});

for (const input of ['plan', 'retained archive']) test(`output cannot encompass input ${input}`, async (t) => {
  const f = await fixture(t);
  await previousPublication(f);
  const native = nativeBoundary(f);
  let overrides;
  if (input === 'plan') {
    const planPath = path.join(f.outputDir, 'input-plan.json');
    await fs.copyFile(f.planPath, planPath);
    overrides = { planPath };
  } else {
    const sourceArchive = path.join(f.outputDir, 'retained.pmtiles');
    await fs.writeFile(sourceArchive, 'retained source');
    overrides = { sourceArchive, sourceSha256: digest('retained source') };
  }
  await assert.rejects(freeze.freezeProject({ ...f, ...native, ...overrides }), /output.*(plan|source|archive|unmanaged)/i);
  assert.equal(native.ensured, 0);
  assert.equal(await fs.readFile(path.join(f.outputDir, SNAPSHOT_PATH), 'utf8'), 'previous publication');
});

test('metadata object key order and absent vector_layers preserve native equality semantics', async (t) => {
  const f = await fixture(t);
  await freeze.freezeProject({ ...f, ...nativeBoundary(f, { metadata: { name: 'x', nested: { a: 1, b: 2 } },
    sourceMetadata: { nested: { b: 2, a: 1 }, name: 'x' } }) });
  assert.equal(await fs.readFile(path.join(f.outputDir, 'assets/context/overture-buildings.pmtiles'), 'utf8'), 'verified snapshot bytes');
});

test('output bbox accepts native E7 truncation inside the explicit tolerance', async (t) => {
  const f = await fixture(t);
  await freeze.freezeProject({ ...f, ...nativeBoundary(f, { header: { ...HEADER,
    bounds: [106.58000005, 11.10000005, 106.62000005, 11.15000005] } }) });
  assert.ok(await fs.stat(path.join(f.outputDir, 'project.json')));
});

test('omitted authoring release matches the existing C1 and Prepare Freeze default', async (t) => {
  const f = await fixture(t);
  await updateManifest(f, (manifest) => { delete manifest.capabilities[0].settings.overtureRelease; });
  const native = nativeBoundary(f);
  const result = await freeze.freezeProject({ ...f, ...native });
  assert.equal(result.release, '2026-08-19.0');
  const frozen = JSON.parse(await fs.readFile(path.join(f.outputDir, 'project.json')));
  assert.equal(frozen.capabilities[0].settings.overtureRelease, '2026-08-19.0');
  assert.equal(native.calls[0][1], SOURCE);
  assert.deepEqual(await fs.readFile(path.join(f.projectDir, 'project.json')), f.entries[0].bytes);
});

async function directorySnapshot(root, prefix = '') {
  const entries = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const file = path.join(root, relative);
    if (entry.isSymbolicLink()) entries.push([relative, 'link', await fs.readlink(file)]);
    else if (entry.isDirectory()) entries.push([relative, 'directory'], ...await directorySnapshot(root, relative));
    else entries.push([relative, 'file', await fs.readFile(file)]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

for (const invalid of ['marker-only', 'invalid snapshot', 'invalid Story', 'missing declared asset',
  'unmanaged file', 'unmanaged directory', 'unmanaged link', 'declared directory link']) {
  test(`prior output ${invalid} is preserved and rejected before tool setup`, async (t) => {
    const f = await fixture(t);
    if (invalid === 'marker-only') {
      await fs.mkdir(f.outputDir);
      await fs.writeFile(path.join(f.outputDir, 'project.json'), JSON.stringify({ id: f.manifest.id,
        capabilities: [{ id: 'urban-context-v1', settings: { buildingSource: 'project-snapshot' } }] }));
      await fs.writeFile(path.join(f.outputDir, 'unrelated.txt'), 'must survive');
    } else {
      await previousPublication(f);
      if (invalid === 'invalid snapshot') {
        const manifest = JSON.parse(await fs.readFile(path.join(f.outputDir, 'project.json')));
        delete manifest.capabilities[0].settings.snapshot;
        await fs.writeFile(path.join(f.outputDir, 'project.json'), JSON.stringify(manifest));
      } else if (invalid === 'invalid Story') await fs.writeFile(path.join(f.outputDir, 'stories/main.story.json'), '{}');
      else if (invalid === 'missing declared asset') await fs.unlink(path.join(f.outputDir, 'assets/photo.png'));
      else if (invalid === 'unmanaged file') await fs.writeFile(path.join(f.outputDir, '.private-notes'), 'must survive');
      else if (invalid === 'unmanaged directory') await fs.mkdir(path.join(f.outputDir, 'unrelated-empty'));
      else if (invalid === 'unmanaged link') await fs.symlink(f.projectDir, path.join(f.outputDir, 'unrelated-link'), 'junction');
      else {
        await fs.rename(path.join(f.outputDir, 'assets'), path.join(f.root, 'linked-assets'));
        await fs.symlink(path.join(f.root, 'linked-assets'), path.join(f.outputDir, 'assets'), 'junction');
      }
    }
    const before = await directorySnapshot(f.outputDir);
    const native = nativeBoundary(f);
    await assert.rejects(freeze.freezeProject({ ...f, ...native }), /output|publication|inventory/i);
    assert.equal(native.ensured, 0);
    assert.equal(native.calls.length, 0);
    assert.deepEqual(await directorySnapshot(f.outputDir), before);
    for (const entry of f.entries) assert.deepEqual(await fs.readFile(path.join(f.projectDir, entry.path)), entry.bytes);
  });
}

for (const change of ['unmanaged file', 'invalid Story']) test(`prior output ${change} introduced during extraction is preserved`, async (t) => {
  const f = await fixture(t);
  await previousPublication(f);
  let before;
  const native = nativeBoundary(f, { beforeCommand: async (args) => {
    if (args[0] === 'extract' && !args.includes('--dry-run')) {
      if (change === 'unmanaged file') await fs.writeFile(path.join(f.outputDir, 'do-not-delete.txt'), 'added during extraction');
      else await fs.writeFile(path.join(f.outputDir, 'stories/main.story.json'), '{}');
      before = await directorySnapshot(f.outputDir);
    }
  } });
  await assert.rejects(freeze.freezeProject({ ...f, ...native }), /output|publication|inventory/i);
  assert.equal(native.ensured, 1, 'initial production-valid output must pass the first classification');
  assert.deepEqual(await directorySnapshot(f.outputDir), before);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['authoring', 'freeze-plan.json', 'frozen']);
});
