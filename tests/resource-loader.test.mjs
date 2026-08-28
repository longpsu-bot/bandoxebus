import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectLoadError } from '../src/project/project-error.js';
import { loadJsonResource, loadProjectResources } from '../src/project/resource-loader.js';

function response(value, { ok = true, status = 200, jsonError } = {}) {
  return {
    ok,
    status,
    async json() {
      if (jsonError) throw jsonError;
      return structuredClone(value);
    }
  };
}

test('JSON loading reports deterministic HTTP and parse errors at the authored path', async () => {
  await assert.rejects(
    loadJsonResource('https://host/missing.json', {
      fetchImpl: async () => response(null, { ok: false, status: 404 }),
      path: '$.datasets.route.src'
    }),
    (error) => error.code === 'RESOURCE_HTTP_ERROR'
      && error.path === '$.datasets.route.src'
      && error.message === 'Resource request failed (404).'
  );

  const parseFailure = new SyntaxError('unexpected token');
  await assert.rejects(
    loadJsonResource('https://host/bad.json', {
      fetchImpl: async () => response(null, { jsonError: parseFailure }),
      path: '$.stories.items[0].src'
    }),
    (error) => error.code === 'RESOURCE_JSON_INVALID'
      && error.path === '$.stories.items[0].src'
      && error.cause === parseFailure
  );
});

test('validator errors retain their stable semantic path', async () => {
  const failure = new ProjectLoadError('GEOJSON_RESOURCE_INVALID', '$.datasets.route.features[0]', 'Invalid feature.');
  await assert.rejects(
    loadJsonResource('https://host/route.geojson', {
      fetchImpl: async () => response({ type: 'FeatureCollection', features: [] }),
      path: '$.datasets.route',
      validate() { throw failure; }
    }),
    (error) => error === failure
  );
});

test('optional unreferenced failures become warnings while referenced optional resources remain fatal', async () => {
  const optional = {
    id: 'optional-photo',
    url: new URL('https://host/photo.json'),
    path: '$.assets.optional-photo.src',
    required: false,
    referenced: false
  };
  const fetchImpl = async () => response(null, { ok: false, status: 503 });
  const result = await loadProjectResources([optional], { fetchImpl });
  assert.equal(result.values.size, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].path, optional.path);
  assert.equal(Object.isFrozen(result.warnings), true);

  await assert.rejects(
    loadProjectResources([{ ...optional, referenced: true }], { fetchImpl }),
    (error) => error.code === 'RESOURCE_HTTP_ERROR' && error.path === optional.path
  );
});

test('fatal resource failure aborts siblings and prevents validation after abort', async () => {
  let siblingAborted = false;
  let lateValidation = false;
  const fetchImpl = async (url, { signal }) => {
    if (String(url).endsWith('fatal.json')) return response(null, { ok: false, status: 500 });
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        siblingAborted = true;
        reject(signal.reason);
      }, { once: true });
      setTimeout(() => resolve(response({ late: true })), 25);
    });
  };

  await assert.rejects(
    loadProjectResources([
      { id: 'fatal', url: new URL('https://host/fatal.json'), path: '$.datasets.routes.src', required: true },
      {
        id: 'sibling',
        url: new URL('https://host/sibling.json'),
        path: '$.datasets.sibling.src',
        required: true,
        validate(value) { lateValidation = true; return value; }
      }
    ], { fetchImpl }),
    (error) => error.code === 'RESOURCE_HTTP_ERROR' && error.path === '$.datasets.routes.src'
  );
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(siblingAborted, true);
  assert.equal(lateValidation, false);
});

test('caller abort propagates without starting late work', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  let fetched = false;
  await assert.rejects(
    loadJsonResource('https://host/data.json', {
      fetchImpl: async () => { fetched = true; return response({}); },
      signal: controller.signal,
      path: '$.datasets.data.src'
    }),
    (error) => error.name === 'AbortError'
  );
  assert.equal(fetched, false);
});
