import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as defaultFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { collectDeclaredPackageEntries } from '../../editor/core/package-store.js';
import { computeDeclaredPackageFingerprint, contextActiveSceneIndices, createOvertureFreezePlan,
  FREEZE_PLAN_KIND, FREEZE_PLAN_VERSION } from '../../editor/publish/freeze-plan.js';
import { deriveOvertureBuildingsPmtilesUrl } from '../../src/overture-pmtiles.js';
import { loadProject } from '../../src/project/project-loader.js';
import { INSTALLED_CAPABILITY_REGISTRY } from '../../src/capabilities/installed-capabilities.js';
import { ensurePmtilesTool } from './pmtiles-tool.mjs';

const HEALTHY_MAX = 32 * 1024 * 1024;
const HARD_MAX = 64 * 1024 * 1024;
const SNAPSHOT_ID = 'overture-buildings-snapshot';
const SNAPSHOT_PATH = 'assets/context/overture-buildings.pmtiles';
const BYTE_UNITS = { B: 1, kB: 1000, MB: 1000 ** 2, GB: 1000 ** 3, TB: 1000 ** 4,
  KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };

export function parseHumanBytes(value) {
  const match = typeof value === 'string' && value.trim().match(/^(\d+(?:\.\d+)?)\s+(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)$/);
  if (!match) throw new TypeError(`Invalid human byte size: ${value}`);
  const precision = 10n ** BigInt(match[1].split('.')[1]?.length ?? 0);
  const scaled = BigInt(match[1].replace('.', '')) * BigInt(BYTE_UNITS[match[2]]);
  if (scaled % precision !== 0n || scaled / precision > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError(`Invalid human byte size: ${value}`);
  return Number(scaled / precision);
}

export function parsePmtilesDryRun(output) {
  const lines = String(output).split(/\r?\n/).filter((line) => /Extract transferred .* for an archive size of /.test(line));
  if (lines.length !== 1) throw new Error('Expected exactly one native dry-run archive size line.');
  return { archiveBytes: parseHumanBytes(lines[0].split(' for an archive size of ')[1]) };
}

function localPath(value, label) {
  if (typeof value !== 'string' || !value.trim() || /[?#\0]/.test(value)
    || /^[\\/]{2}/.test(value)
    || (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value))) {
    throw new TypeError(`${label} must be a local filesystem path without a URL, query, or fragment.`);
  }
  return path.resolve(value);
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function existingStat(fs, target) {
  try { return await fs.lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function safeOutput(fs, projectDir, requested, projectId) {
  const output = localPath(requested, 'outputDir');
  const parent = await fs.realpath(path.dirname(output));
  const outputDir = path.join(parent, path.basename(output));
  const stat = await existingStat(fs, outputDir);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('Output must be a real publication directory, not a link or file.');
  const protectedPaths = [projectDir, await fs.realpath(process.cwd()), await fs.realpath(os.homedir())];
  if (outputDir === path.parse(outputDir).root || protectedPaths.some((protectedPath) => contains(outputDir, protectedPath))
    || contains(projectDir, outputDir)) throw new Error('Unsafe output directory overlaps authoring, workspace, home, or a filesystem root.');
  if (stat) {
    let previous;
    try { previous = (await validateFolder(fs, outputDir)).manifest; }
    catch (error) { throw new Error(`Existing output is not a production-valid prior frozen publication: ${error.message}`, { cause: error }); }
    if (previous.id !== projectId || previous.capabilities.find(({ id }) => id === 'urban-context-v1')?.settings?.buildingSource !== 'project-snapshot') {
      throw new Error('Existing output must be a same-project frozen publication.');
    }
    await validatePublicationInventory(fs, outputDir, previous);
  }
  return { outputDir, parent, existed: Boolean(stat) };
}

async function validatePublicationInventory(fs, root, manifest) {
  const files = new Set(['project.json', ...collectDeclaredPackageEntries(manifest).map(({ path: relative }) => relative)]);
  const directories = new Set();
  for (const file of files) {
    const segments = file.split('/');
    while (segments.length > 1) { segments.pop(); directories.add(segments.join('/')); }
  }
  async function inspect(relative = '') {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Existing output contains a link: ${child}`);
      if (entry.isDirectory() && directories.has(child)) await inspect(child);
      else if (entry.isFile() && files.has(child)) files.delete(child);
      else throw new Error(`Existing output contains unmanaged or non-regular content: ${child}`);
    }
  }
  await inspect();
  if (files.size) throw new Error(`Existing output is missing declared inventory: ${[...files].join(', ')}`);
}

async function packageFile(fs, root, relative) {
  // Also exclude Windows alternate streams/aliases, even when running on Linux.
  if (relative.split('/').some((part) => /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Unsafe declared resource path: ${relative}`);
  }
  const resolved = await fs.realpath(path.join(root, relative));
  if (!contains(root, resolved) || !(await fs.stat(resolved)).isFile()) throw new Error(`Declared resource escapes the project or is not a regular file: ${relative}`);
  return resolved;
}

function fileFetch(fs, root, entries = null) {
  return async (input) => {
    const url = new URL(input);
    if (url.protocol !== 'file:' || url.search || url.hash) throw new Error('Production validation requires package-local file URLs.');
    const target = fileURLToPath(url);
    if (!contains(root, target)) throw new Error('Production resource URL escapes the package.');
    const relative = path.relative(root, target).split(path.sep).join('/');
    if (entries) {
      const bytes = entries.get(relative);
      return bytes ? new Response(bytes) : new Response(null, { status: 404 });
    }
    if (relative === SNAPSHOT_PATH) throw new Error('Production validation must not eagerly fetch the PMTiles asset.');
    try { return new Response(await fs.readFile(await packageFile(fs, root, relative))); }
    catch (error) { if (error.code === 'ENOENT') return new Response(null, { status: 404 }); throw error; }
  };
}

async function validateFolder(fs, root, entries = null) {
  return loadProject(new URL('project.json', pathToFileURL(root + path.sep)), {
    fetchImpl: fileFetch(fs, root, entries), capabilityRegistry: INSTALLED_CAPABILITY_REGISTRY
  });
}

async function readAuthoring(fs, root) {
  const manifestBytes = await fs.readFile(await packageFile(fs, root, 'project.json'));
  const manifest = JSON.parse(manifestBytes.toString());
  const declared = collectDeclaredPackageEntries(manifest);
  const entries = new Map([['project.json', manifestBytes]]);
  const pathKeys = new Map([['project.json', 'project.json']]);
  for (const { path: relative } of declared) {
    const key = relative.toLowerCase();
    if (pathKeys.has(key) && pathKeys.get(key) !== relative) throw new Error(`Conflicting declared resource paths: ${relative}`);
    if (relative === 'project.json') throw new Error('A declared resource cannot overwrite project.json.');
    pathKeys.set(key, relative);
    if (!entries.has(relative)) entries.set(relative, await fs.readFile(await packageFile(fs, root, relative)));
  }
  const project = await validateFolder(fs, root, entries);
  return { manifest, entries, project };
}

async function validatePlan(plan, manifest, entries, project) {
  if (plan?.kind !== FREEZE_PLAN_KIND || plan.version !== FREEZE_PLAN_VERSION) throw new Error('Freeze plan kind/version mismatch.');
  if (plan.projectId !== manifest.id) throw new Error('Freeze plan project id mismatch.');
  const settings = manifest.capabilities.find(({ id }) => id === 'urban-context-v1')?.settings;
  if (settings?.buildingSource !== 'overture-pmtiles') throw new Error('Freeze input buildingSource must be overture-pmtiles.');
  if (plan.overtureRelease !== (settings.overtureRelease ?? '2026-08-19.0')) throw new Error('Freeze plan release mismatch.');
  const fingerprint = await computeDeclaredPackageFingerprint({ entries: [...entries].map(([path, bytes]) => ({ path, bytes })) });
  if (plan.projectFingerprint !== fingerprint) throw new Error('Freeze project fingerprint mismatch; prepare a new plan from the saved Folder.');
  if (typeof plan.createdAt !== 'string' || !Number.isFinite(Date.parse(plan.createdAt))) throw new Error('Freeze plan createdAt must be a timestamp.');
  const canonical = await createOvertureFreezePlan(plan);
  if (!isDeepStrictEqual(canonical, plan)) throw new Error('Freeze plan is inconsistent with its canonical profiles/required bounds.');
  const expected = contextActiveSceneIndices(project.story).map((index) => ({ index, id: project.story.states[index].id }));
  if (!isDeepStrictEqual(plan.profiles[0].scenes.map(({ index, id }) => ({ index, id })), expected)) {
    throw new Error('Freeze plan Scenes do not match the production Story context-active Scenes.');
  }
  return settings;
}

function checkSnapshotDestination(manifest, entries) {
  const reserved = manifest.assets[SNAPSHOT_ID];
  const canonicalReserved = reserved && isDeepStrictEqual({ ...reserved, src: collectDeclaredPackageEntries({ assets: { reserved } })[0].path }, {
    type: 'pmtiles', src: SNAPSHOT_PATH, mediaType: 'application/vnd.pmtiles', required: true, attribution: ['overture-maps']
  });
  if ((reserved && !canonicalReserved) || Object.entries(manifest.assets).some(([id, descriptor]) => descriptor.type === 'pmtiles' && id !== SNAPSHOT_ID)) {
    throw new Error('Authoring input has an unrelated PMTiles asset or a conflicting reserved snapshot asset ID.');
  }
  const otherResources = collectDeclaredPackageEntries({ ...manifest,
    assets: Object.fromEntries(Object.entries(manifest.assets).filter(([id]) => id !== SNAPSHOT_ID)) });
  if (otherResources.some(({ path: relative }) => relative.toLowerCase() === SNAPSHOT_PATH)) {
    throw new Error('Reserved snapshot path belongs to another declared resource.');
  }
  for (const relative of entries.keys()) {
    const key = relative.toLowerCase();
    if (canonicalReserved && key === SNAPSHOT_PATH) continue;
    if (key === SNAPSHOT_PATH || key.startsWith(`${SNAPSHOT_PATH}/`) || SNAPSHOT_PATH.startsWith(`${key}/`)) {
      throw new Error(`Reserved snapshot path conflicts with declared resource: ${relative}`);
    }
  }
  const attribution = manifest.attribution['overture-maps'];
  if (attribution && (attribution.name !== 'Overture Maps Foundation — Buildings' || attribution.license !== 'ODbL-1.0')) {
    throw new Error('Existing overture-maps attribution has conflicting provenance.');
  }
}

async function sha256File(fs, file) {
  const handle = await fs.open(file, 'r');
  try {
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally { await handle.close(); }
}

async function resolveSource(fs, sourceArchive, sourceSha256, officialUrl) {
  if (sourceArchive === null && sourceSha256 === null) return { source: officialUrl, sourceKind: 'official', sourceArchiveSha256: null };
  if (sourceArchive === null || sourceSha256 === null) throw new Error('source-archive and source-sha256 are required as a pair.');
  if (typeof sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sourceSha256)) throw new Error('source-sha256 must be a lowercase SHA-256 hex digest.');
  const source = await fs.realpath(localPath(sourceArchive, 'source-archive'));
  if (!(await fs.stat(source)).isFile()) throw new Error('source-archive must be a regular local file.');
  if (await sha256File(fs, source) !== sourceSha256) throw new Error('Retained source archive SHA-256 mismatch.');
  return { source, sourceKind: 'retained-local', sourceArchiveSha256: sourceSha256 };
}

async function resolveLocation(fs, target) {
  try { return await fs.realpath(target); }
  catch (error) {
    if (error.code !== 'ENOENT' || target === path.dirname(target)) throw error;
    return path.join(await resolveLocation(fs, path.dirname(target)), path.basename(target));
  }
}

async function toolCacheRoot(fs, inputs) {
  const candidates = [fileURLToPath(new URL('../../.cache/map-story-tools/pmtiles', import.meta.url)),
    path.join(os.tmpdir(), 'map-story-tools', 'pmtiles')];
  for (const candidate of candidates) {
    const resolved = await resolveLocation(fs, candidate);
    if (inputs.every((input) => !contains(input, resolved) && !contains(resolved, input))) return resolved;
  }
  throw new Error('No safe native tool cache directory exists outside the authoring inputs and output.');
}

async function sourceEvidence(source, fetchImpl) {
  let sourceEtag = null;
  let sourceContentLength = null;
  try {
    const response = await fetchImpl(source, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      sourceEtag = response.headers.get('ETag');
      const value = response.headers.get('Content-Length');
      if (value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) sourceContentLength = Number(value);
    }
  } catch { /* Optional identity evidence must not block an otherwise valid extraction. */ }
  return { sourceEtag, sourceContentLength };
}

async function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
  });
}

function validateHeader(header, label) {
  if (header?.tile_type !== 'mvt') throw new Error(`${label} tile type must be MVT.`);
  if (!Number.isInteger(header.minzoom) || !Number.isInteger(header.maxzoom) || header.minzoom < 0
    || header.minzoom > 11 || header.maxzoom < 14 || header.maxzoom < header.minzoom) throw new Error(`${label} zoom range must cover zooms 11–14.`);
}

function frozenManifest(manifest, settings, plan, snapshotSha256, snapshotBytes, evidence) {
  const frozen = structuredClone(manifest);
  frozen.assets[SNAPSHOT_ID] = { type: 'pmtiles', src: `./${SNAPSHOT_PATH}`, mediaType: 'application/vnd.pmtiles',
    required: true, attribution: ['overture-maps'] };
  frozen.attribution['overture-maps'] = { name: 'Overture Maps Foundation — Buildings', url: 'https://overturemaps.org/',
    license: 'ODbL-1.0', updated: plan.overtureRelease.slice(0, 10), notes: `Frozen from Overture release ${plan.overtureRelease}.` };
  frozen.capabilities.find(({ id }) => id === 'urban-context-v1').settings = {
    adapter: settings.adapter, buildingSource: 'project-snapshot', overtureRelease: plan.overtureRelease,
    snapshot: { asset: SNAPSHOT_ID, theme: 'buildings', bounds: [...plan.finalBounds], sha256: snapshotSha256,
      byteLength: snapshotBytes, generator: 'go-pmtiles', generatorVersion: '1.31.2', generatedAt: new Date().toISOString(),
      ...(evidence.sourceContentLength === null ? {} : { sourceContentLength: evidence.sourceContentLength }),
      ...(evidence.sourceEtag === null ? {} : { sourceEtag: evidence.sourceEtag }) }
  };
  return frozen;
}

async function removeOwnedDirectory(fs, target, parent) {
  if (!target || !await existingStat(fs, target)) return;
  if (path.dirname(target) !== parent || await fs.realpath(target) !== target) throw new Error(`Unsafe temporary cleanup target: ${target}`);
  await fs.rm(target, { recursive: true, force: true });
}

/** Freeze one saved authoring Folder; only native/network/filesystem boundaries are injectable. */
export async function freezeProject({ projectDir, planPath, outputDir, sourceArchive = null, sourceSha256 = null,
  ensureTool = ensurePmtilesTool, runProcess: run = runProcess, fetchImpl = globalThis.fetch, fs = defaultFs }) {
  projectDir = await fs.realpath(localPath(projectDir, 'projectDir'));
  if (!(await fs.stat(projectDir)).isDirectory()) throw new Error('projectDir must be a Folder.');
  planPath = await fs.realpath(localPath(planPath, 'planPath'));
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  const { manifest, entries, project } = await readAuthoring(fs, projectDir);
  const settings = await validatePlan(plan, manifest, entries, project);
  checkSnapshotDestination(manifest, entries);
  const destination = await safeOutput(fs, projectDir, outputDir, manifest.id);
  outputDir = destination.outputDir;
  const { parent, existed } = destination;
  if (contains(outputDir, planPath)) throw new Error('Output directory must not contain the input Freeze plan.');
  const sourceInfo = await resolveSource(fs, sourceArchive, sourceSha256, deriveOvertureBuildingsPmtilesUrl(plan.overtureRelease));
  if (sourceInfo.sourceKind === 'retained-local' && contains(outputDir, sourceInfo.source)) throw new Error('Output directory must not contain the retained source archive.');
  // Every stale-plan, identity, and path check above precedes even tool setup/version execution.
  const cacheRoot = await toolCacheRoot(fs, [projectDir, outputDir, planPath,
    ...(sourceInfo.sourceKind === 'retained-local' ? [sourceInfo.source] : [])]);
  const executable = await ensureTool({ cacheRoot });
  const checked = async (args) => {
    const result = await run(executable, args);
    const combined = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
    if (result?.code !== 0 || (args[0] === 'verify' && /\binvalid\s*:/i.test(combined))) {
      throw new Error(`pmtiles ${args[0]} failed: ${combined.trim()}`);
    }
    return result;
  };
  const json = async (args) => {
    const result = await checked(args);
    try { const value = JSON.parse(result.stdout); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
    catch { throw new Error(`pmtiles ${args.join(' ')} did not return a JSON object.`); }
  };
  const evidence = sourceInfo.sourceKind === 'official'
    ? await sourceEvidence(sourceInfo.source, fetchImpl) : { sourceEtag: null, sourceContentLength: null };
  let workDir;
  let stagingDir;
  let backupDir;
  try {
    workDir = await fs.mkdtemp(path.join(parent, `.${path.basename(outputDir)}.freeze-`));
    const temporaryArchive = path.join(workDir, 'snapshot.pmtiles');
    const extractArgs = ['extract', sourceInfo.source, temporaryArchive, `--bbox=${plan.finalBounds.join(',')}`,
      '--download-threads=4', '--overfetch=0.05'];
    const dryRun = await checked([...extractArgs, '--dry-run']);
    const predicted = parsePmtilesDryRun(`${dryRun.stdout}\n${dryRun.stderr}`).archiveBytes;
    if (predicted > HARD_MAX) throw new Error('Predicted snapshot size exceeds 64 MiB.');
    await checked(extractArgs);
    const snapshotBytes = (await fs.stat(temporaryArchive)).size;
    if (snapshotBytes < 1 || snapshotBytes > HARD_MAX) throw new Error('Actual snapshot size must be positive and at most 64 MiB.');
    await checked(['verify', temporaryArchive]);
    const header = await json(['show', temporaryArchive, '--header-json']);
    const metadata = await json(['show', temporaryArchive, '--metadata']);
    validateHeader(header, 'Snapshot');
    if (!Array.isArray(header.bounds) || header.bounds.length !== 4 || header.bounds.some((value, index) =>
      !Number.isFinite(value) || Math.abs(value - plan.finalBounds[index]) > 1e-7)) throw new Error('Snapshot header bounds do not equal the requested bbox within 1e-7 degrees.');
    const shown = await checked(['show', temporaryArchive]);
    if (!/^clustered:\s*true\s*$/m.test(shown.stdout)) throw new Error('Snapshot archive must be clustered.');
    if (Object.hasOwn(metadata, 'vector_layers') && (!Array.isArray(metadata.vector_layers)
      || !metadata.vector_layers.some((layer) => layer?.id === 'building'))) throw new Error('Snapshot vector_layers must include building.');
    const sourceHeader = await json(['show', sourceInfo.source, '--header-json']);
    validateHeader(sourceHeader, 'Source');
    if (sourceHeader.minzoom !== header.minzoom || sourceHeader.maxzoom !== header.maxzoom) throw new Error('Snapshot must preserve the exact source min/max zoom range.');
    const sourceMetadata = await json(['show', sourceInfo.source, '--metadata']);
    if (!isDeepStrictEqual(metadata, sourceMetadata)) throw new Error('Snapshot metadata differs from source metadata.');
    const snapshotSha256 = await sha256File(fs, temporaryArchive);
    stagingDir = await fs.mkdtemp(path.join(parent, `.${path.basename(outputDir)}.staging-`));
    for (const [relative, bytes] of entries) {
      if (relative === 'project.json' || relative === SNAPSHOT_PATH) continue;
      const target = path.join(stagingDir, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    const stagedArchive = path.join(stagingDir, SNAPSHOT_PATH);
    await fs.mkdir(path.dirname(stagedArchive), { recursive: true });
    await fs.rename(temporaryArchive, stagedArchive);
    await fs.writeFile(path.join(stagingDir, 'project.json'), JSON.stringify(
      frozenManifest(manifest, settings, plan, snapshotSha256, snapshotBytes, evidence), null, 2) + '\n');
    await validateFolder(fs, stagingDir);
    const currentDestination = await safeOutput(fs, projectDir, outputDir, manifest.id);
    if (currentDestination.outputDir !== outputDir || currentDestination.existed !== existed) {
      throw new Error('Output directory changed while Freeze was running; refusing to replace it.');
    }
    if (existed) {
      backupDir = path.join(parent, `.${path.basename(outputDir)}.backup-${randomUUID()}`);
      await fs.rename(outputDir, backupDir);
    }
    try { await fs.rename(stagingDir, outputDir); stagingDir = null; }
    catch (error) {
      if (backupDir) { await fs.rename(backupDir, outputDir); backupDir = null; }
      throw error;
    }
    await removeOwnedDirectory(fs, backupDir, parent);
    backupDir = null;
    return { outputDir, snapshotPath: path.join(outputDir, SNAPSHOT_PATH), snapshotSha256, snapshotBytes,
      bounds: [...plan.finalBounds], release: plan.overtureRelease,
      warning: Math.max(predicted, snapshotBytes) > HEALTHY_MAX ? 'large' : null,
      ...evidence, sourceKind: sourceInfo.sourceKind, sourceArchiveSha256: sourceInfo.sourceArchiveSha256 };
  } finally {
    // A failed backup restore deliberately leaves that backup intact for recovery.
    await removeOwnedDirectory(fs, stagingDir, parent);
    await removeOwnedDirectory(fs, workDir, parent);
  }
}
