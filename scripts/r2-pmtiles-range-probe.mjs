import { pathToFileURL } from 'node:url';

const RANGE = 'bytes=0-16383';
const EXPECTED_BYTES = 16384;
const CONTENT_RANGE = /^bytes 0-16383\/\d+$/;

function partialContentError() {
  return new Error('PMTiles Range response lacks required partial-content semantics.');
}

async function cancel(reader) {
  try { await reader.cancel(); } catch {}
}

async function cancelResponseBody(response) {
  try { await response.body?.cancel?.(); } catch {}
}

async function readBoundedBody(response) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('PMTiles Range response has no readable body.');
  const bytes = new Uint8Array(EXPECTED_BYTES);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > EXPECTED_BYTES - offset) {
        await cancel(reader);
        throw new Error(`PMTiles Range response exceeds ${EXPECTED_BYTES} bytes.`);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock?.();
  }
  if (offset !== EXPECTED_BYTES) {
    throw new Error(`PMTiles Range response must contain exactly ${EXPECTED_BYTES} bytes.`);
  }
  return bytes.buffer;
}

export async function validatePmtilesRangeResponse(response) {
  const contentRange = response?.headers?.get?.('Content-Range') ?? '';
  if (response?.status !== 206 || !CONTENT_RANGE.test(contentRange)) {
    throw partialContentError();
  }
  const contentLength = response.headers.get('Content-Length');
  if (contentLength !== null && contentLength !== `${EXPECTED_BYTES}`) {
    await cancelResponseBody(response);
    throw new Error(`PMTiles Range response must declare exactly ${EXPECTED_BYTES} bytes.`);
  }
  const body = await readBoundedBody(response);
  if (new DataView(body).getUint16(0, true) !== 0x4d50) {
    throw new Error('PMTiles Range response does not begin with the PMTiles magic bytes.');
  }
  return {
    contentRange,
    byteLength: body.byteLength,
    etag: response.headers.get('ETag')
  };
}

export function parseProbeUrl(args = process.argv.slice(2)) {
  if (args.length !== 1 || !args[0].startsWith('--url=') || args[0].length === '--url='.length) {
    throw new TypeError('Expected exactly one --url=<absolute https URL> argument.');
  }
  let url;
  try {
    url = new URL(args[0].slice('--url='.length));
  } catch {
    throw new TypeError('Probe URL must be an absolute HTTPS URL without credentials.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('Probe URL must be an absolute HTTPS URL without credentials.');
  }
  return url;
}

async function run() {
  const url = parseProbeUrl();
  const response = await fetch(url, { headers: { Range: RANGE } });
  const result = await validatePmtilesRangeResponse(response);
  console.log(JSON.stringify({ url: url.href, status: response.status, ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => { process.exitCode = 1; });
}
