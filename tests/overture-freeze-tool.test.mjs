import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { zipSync } from '../vendor/fflate/0.8.3/fflate.esm.js';
import { ensurePmtilesTool } from '../scripts/lib/pmtiles-tool.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bytes = (value) => new TextEncoder().encode(value);

function missing(pathname) {
  const error = new Error(`ENOENT: ${pathname}`);
  error.code = 'ENOENT';
  return error;
}

function memoryFilesystem() {
  const files = new Map();
  const normalize = (pathname) => path.resolve(pathname);
  const descendants = (pathname) => `${normalize(pathname)}${path.sep}`;
  return {
    files,
    async mkdir() {},
    async readFile(pathname) {
      const value = files.get(normalize(pathname));
      if (!value) throw missing(pathname);
      return Buffer.from(value);
    },
    async writeFile(pathname, value) {
      files.set(normalize(pathname), Buffer.from(value));
    },
    async rename(from, to) {
      const source = normalize(from);
      const destination = normalize(to);
      const copied = [...files.entries()].filter(([pathname]) => pathname === source || pathname.startsWith(descendants(source)));
      if (copied.length === 0) throw missing(from);
      for (const [pathname, value] of copied) {
        files.delete(pathname);
        files.set(`${destination}${pathname.slice(source.length)}`, value);
      }
    },
    async rm(pathname) {
      const source = normalize(pathname);
      for (const entry of [...files.keys()]) if (entry === source || entry.startsWith(descendants(source))) files.delete(entry);
    },
    async chmod() {}
  };
}

function zipTool(filename = 'pmtiles.exe', contents = bytes('verified pmtiles executable')) {
  return zipSync({ [`release/${filename}`]: contents });
}

function lockFor(archive, name = 'pmtiles.zip') {
  return {
    version: '1.31.2',
    releaseBase: 'https://release.example/go-pmtiles/',
    artifacts: { 'win32-x64': { name, sha256: hash(archive) } }
  };
}

function cachedPaths(cacheRoot, artifactName) {
  const root = path.resolve(cacheRoot, '1.31.2', 'win32-x64');
  return { archive: path.join(root, artifactName), executable: path.join(root, 'pmtiles.exe') };
}

function options(overrides = {}) {
  return {
    platform: 'win32', arch: 'x64', cacheRoot: 'tool-cache', randomId: () => 'test',
    ...overrides
  };
}

test('downloads the exact selected release artifact URL for a supported platform', async () => {
  const requested = [];
  await assert.rejects(ensurePmtilesTool(options({ fs: memoryFilesystem(),
    fetch: async (url) => { requested.push(String(url)); return { ok: true, arrayBuffer: async () => bytes('wrong archive').buffer }; },
    run: async () => ({ code: 0, stdout: 'pmtiles 1.31.2, test' })
  })), /SHA-256/i);
  assert.deepEqual(requested, ['https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Windows_x86_64.zip']);
});

test('reuses a cached executable only after archive material verification without downloading', async () => {
  const archive = zipTool();
  const lock = lockFor(archive);
  const fs = memoryFilesystem();
  const cached = cachedPaths('tool-cache', lock.artifacts['win32-x64'].name);
  await fs.writeFile(cached.archive, archive);
  await fs.writeFile(cached.executable, bytes('verified pmtiles executable'));
  let downloaded = false;
  const calls = [];
  const executable = await ensurePmtilesTool(options({ lock, fs,
    fetch: async () => { downloaded = true; throw new Error('download must not run'); },
    run: async (command, args) => { calls.push([command, args]); return { code: 0, stdout: 'pmtiles 1.31.2, test' }; }
  }));
  assert.equal(executable, cached.executable);
  assert.equal(downloaded, false);
  assert.deepEqual(calls, [[cached.executable, ['version']]]);
});

test('rejects an archive SHA mismatch before extraction or process execution', async () => {
  const fs = memoryFilesystem();
  let processCalls = 0;
  await assert.rejects(ensurePmtilesTool(options({ fs, lock: {
    version: '1.31.2', releaseBase: 'https://release.example/',
    artifacts: { 'win32-x64': { name: 'pmtiles.zip', sha256: '0'.repeat(64) } }
  }, fetch: async () => ({ ok: true, arrayBuffer: async () => bytes('tampered archive').buffer }),
  run: async () => { processCalls += 1; return { code: 0, stdout: 'pmtiles 1.31.2, test' }; }
  })), /SHA-256/i);
  assert.equal(processCalls, 0);
});

test('rejects a downloaded executable whose version output is not 1.31.2', async () => {
  const archive = zipTool();
  await assert.rejects(ensurePmtilesTool(options({ lock: lockFor(archive), fs: memoryFilesystem(),
    fetch: async () => ({ ok: true, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }),
    run: async () => ({ code: 0, stdout: 'pmtiles 1.31.1, test' })
  })), /pmtiles 1\.31\.2/i);
});

test('rejects unsupported platform and architecture without downloading', async () => {
  let downloaded = false;
  await assert.rejects(ensurePmtilesTool(options({ platform: 'freebsd', arch: 'riscv64', fs: memoryFilesystem(),
    fetch: async () => { downloaded = true; throw new Error('must not fetch'); }
  })), /Unsupported.*freebsd-riscv64/i);
  assert.equal(downloaded, false);
});

test('rejects a cached executable that differs from verified archive material before execution', async () => {
  const archive = zipTool();
  const lock = lockFor(archive);
  const fs = memoryFilesystem();
  const cached = cachedPaths('tool-cache', lock.artifacts['win32-x64'].name);
  await fs.writeFile(cached.archive, archive);
  await fs.writeFile(cached.executable, bytes('tampered executable that claims the same version'));
  let processCalls = 0;
  await assert.rejects(ensurePmtilesTool(options({ lock, fs,
    fetch: async () => { throw new Error('cache tampering must not trigger a replacement download'); },
    run: async () => { processCalls += 1; return { code: 0, stdout: 'pmtiles 1.31.2, test' }; }
  })), /does not match.*archive/i);
  assert.equal(processCalls, 0);
});

test('invokes only the verified absolute executable and never a PATH pmtiles command', async () => {
  const archive = zipTool();
  const lock = lockFor(archive);
  const fs = memoryFilesystem();
  const calls = [];
  const executable = await ensurePmtilesTool(options({ lock, fs,
    fetch: async () => ({ ok: true, arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) }),
    run: async (command, args) => { calls.push([command, args]); return { code: 0, stdout: 'pmtiles 1.31.2, test' }; }
  }));
  assert.deepEqual(calls, [[path.join(path.dirname(path.dirname(executable)), '.win32-x64.tmp-test', 'pmtiles.exe'), ['version']]]);
  assert.notEqual(calls[0][0], 'pmtiles');
});
