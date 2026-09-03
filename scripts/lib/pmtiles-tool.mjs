import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as defaultFs from 'node:fs/promises';
import path from 'node:path';
import toolLock from '../tools/go-pmtiles-1.31.2.json' with { type: 'json' };
import { unzipSync } from '../../vendor/fflate/0.8.3/fflate.esm.js';

const VERSION_PATTERN = /^pmtiles 1\.31\.2,/;

function archiveHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function executableName(platform) {
  return platform === 'win32' ? 'pmtiles.exe' : 'pmtiles';
}

function selectedArtifact(lock, platform, arch) {
  const key = `${platform}-${arch}`;
  const artifact = lock.artifacts?.[key];
  if (!artifact) throw new Error(`Unsupported go-pmtiles platform/architecture: ${key}`);
  return { key, artifact };
}

function verifiedArchive(bytes, artifact) {
  const actual = archiveHash(bytes);
  if (actual !== artifact.sha256) {
    throw new Error(`go-pmtiles archive SHA-256 mismatch for ${artifact.name}: expected ${artifact.sha256}, got ${actual}`);
  }
}

async function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const output = [];
    const errors = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() }));
  });
}

async function runChecked(run, command, args, message) {
  let result;
  try {
    result = await run(command, args);
  } catch (error) {
    if (command === 'tar' && error?.code === 'ENOENT') throw new Error('System tar is required to extract go-pmtiles Linux archives.');
    throw error;
  }
  if (result?.code !== 0) throw new Error(`${message}${result?.stderr ? `: ${result.stderr}` : ''}`);
  return result;
}

function zipExecutable(bytes, name) {
  const entries = unzipSync(bytes);
  const matches = Object.entries(entries).filter(([entry]) => path.basename(entry) === name);
  if (matches.length !== 1) throw new Error(`go-pmtiles ZIP must contain exactly one ${name} executable.`);
  return Buffer.from(matches[0][1]);
}

async function findExecutable(fs, root, name) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const location = path.join(root, entry.name);
    if (entry.isDirectory()) matches.push(...await findExecutable(fs, location, name));
    else if (entry.isFile() && entry.name === name) matches.push(location);
  }
  return matches;
}

async function archiveExecutable({ bytes, archivePath, artifact, fs, run, extractRoot, platform }) {
  const name = executableName(platform);
  if (artifact.name.endsWith('.zip')) return zipExecutable(bytes, name);
  if (!artifact.name.endsWith('.tar.gz')) throw new Error(`Unsupported go-pmtiles archive format: ${artifact.name}`);
  await fs.mkdir(extractRoot, { recursive: true });
  await runChecked(run, 'tar', ['-xzf', archivePath, '-C', extractRoot], 'Unable to extract go-pmtiles archive with system tar');
  const matches = await findExecutable(fs, extractRoot, name);
  if (matches.length !== 1) throw new Error(`go-pmtiles tar archive must contain exactly one ${name} executable.`);
  return Buffer.from(await fs.readFile(matches[0]));
}

async function verifyVersion(run, executable) {
  const result = await runChecked(run, executable, ['version'], `Unable to run verified go-pmtiles executable: ${executable}`);
  if (!VERSION_PATTERN.test(`${result.stdout ?? ''}`)) {
    throw new Error(`Verified go-pmtiles executable did not report pmtiles 1.31.2: ${result.stdout ?? ''}`.trim());
  }
}

async function optionalFile(fs, pathname) {
  try {
    return Buffer.from(await fs.readFile(pathname));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function cachedExecutable({ fs, run, archivePath, executablePath, artifact, platform, verifyRoot }) {
  const archive = await optionalFile(fs, archivePath);
  const executable = await optionalFile(fs, executablePath);
  if (!archive || !executable) return null;
  verifiedArchive(archive, artifact);
  try {
    const expected = await archiveExecutable({ bytes: archive, archivePath, artifact, fs, run, extractRoot: verifyRoot, platform });
    if (!executable.equals(expected)) throw new Error('Cached go-pmtiles executable does not match verified pinned archive material.');
  } finally {
    await fs.rm(verifyRoot, { recursive: true, force: true });
  }
  await verifyVersion(run, executablePath);
  return executablePath;
}

/**
 * Resolve a verified go-pmtiles executable without consulting PATH.
 *
 * `fetch`, `fs`, and `run` are injectable to make the network, filesystem,
 * and process boundaries testable. `run(command, args)` must return
 * `{ code, stdout, stderr }`.
 */
export async function ensurePmtilesTool(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const lock = options.lock ?? toolLock;
  const fs = options.fs ?? defaultFs;
  const fetchAsset = options.fetch ?? globalThis.fetch;
  const run = options.run ?? runProcess;
  const randomId = options.randomId ?? randomUUID;
  const { key, artifact } = selectedArtifact(lock, platform, arch);
  const cacheRoot = path.resolve(options.cacheRoot ?? '.cache/map-story-tools/pmtiles');
  const cacheDirectory = path.join(cacheRoot, lock.version, key);
  const archivePath = path.join(cacheDirectory, artifact.name);
  const executablePath = path.join(cacheDirectory, executableName(platform));
  const verifyRoot = path.join(cacheRoot, lock.version, `.${key}.verify-${randomId()}`);

  const cached = await cachedExecutable({ fs, run, archivePath, executablePath, artifact, platform, verifyRoot });
  if (cached) return cached;
  if (typeof fetchAsset !== 'function') throw new Error('fetch is required to download go-pmtiles.');

  const response = await fetchAsset(new URL(artifact.name, lock.releaseBase));
  if (!response?.ok) throw new Error(`Unable to download go-pmtiles archive: HTTP ${response?.status ?? 'unknown'}`);
  const archive = Buffer.from(await response.arrayBuffer());
  verifiedArchive(archive, artifact);

  const temporaryDirectory = path.join(cacheRoot, lock.version, `.${key}.tmp-${randomId()}`);
  try {
    await fs.mkdir(path.dirname(temporaryDirectory), { recursive: true });
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    await fs.mkdir(temporaryDirectory, { recursive: true });
    const temporaryArchive = path.join(temporaryDirectory, artifact.name);
    const temporaryExecutable = path.join(temporaryDirectory, executableName(platform));
    await fs.writeFile(temporaryArchive, archive);
    const material = await archiveExecutable({
      bytes: archive, archivePath: temporaryArchive, artifact, fs, run,
      extractRoot: path.join(temporaryDirectory, 'extract'), platform
    });
    await fs.writeFile(temporaryExecutable, material);
    if (platform !== 'win32') await fs.chmod(temporaryExecutable, 0o755);
    await verifyVersion(run, temporaryExecutable);
    await fs.rm(cacheDirectory, { recursive: true, force: true });
    await fs.rename(temporaryDirectory, cacheDirectory);
  } catch (error) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return executablePath;
}
