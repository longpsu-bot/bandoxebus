import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_PREFIXES = ['/stories/', '/data/', '/assets/'];
const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' });

function within(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveProjectRoot(requestUrl, { fixtureRoot, applicationRoot }) {
  const pathname = decodeURIComponent(requestUrl.split('?')[0]);
  const projectOwned = pathname === '/project.json'
    || (PROJECT_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !pathname.startsWith('/data/schemas/'));
  const root = projectOwned ? fixtureRoot : applicationRoot;
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  if (!within(root, candidate)) throw new TypeError(`Unsafe fixture request path: ${pathname}`);
  return candidate;
}

export function createFixtureServer({ fixtureRoot, applicationRoot = process.cwd() }) {
  return createServer(async (request, response) => {
    try {
      const filename = resolveProjectRoot(request.url ?? '/', { fixtureRoot, applicationRoot });
      const body = await readFile(filename);
      response.writeHead(200, { 'content-type': MIME[path.extname(filename).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === 'ENOENT' ? 404 : 400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error?.message ?? 'Request failed');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixtureRoot = path.resolve(process.argv[2] ?? 'tests/fixtures/well-rounded-template-v1');
  const port = Number(process.argv[3] ?? 8081);
  createFixtureServer({ fixtureRoot }).listen(port, '127.0.0.1', () => {
    process.stdout.write(`Fixture server listening at http://127.0.0.1:${port}\n`);
  });
}
