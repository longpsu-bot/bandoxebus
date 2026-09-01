import { Unzip, UnzipInflate } from '../../vendor/fflate/0.8.3/fflate.esm.js';
import { normalizePackagePath } from './package-store.js';

const MIB = 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const SUPPORTED_COMPRESSION = new Set([0, 8]);
const utf8 = new TextDecoder();
const latin1 = new TextDecoder('windows-1252');

export const PROJECT_ZIP_LIMITS = Object.freeze({
  maxEntries: 2048,
  maxEntryBytes: 64 * MIB,
  maxTotalBytes: 256 * MIB,
  maxExpansionRatio: Infinity,
  ratioMinimumCompressedBytes: MIB
});

export const DATA_IMPORT_ZIP_LIMITS = Object.freeze({
  maxEntries: 2048,
  maxEntryBytes: 512 * MIB,
  maxTotalBytes: 1024 * MIB,
  maxExpansionRatio: 100,
  ratioMinimumCompressedBytes: MIB
});

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('ZIP input must be a Uint8Array or ArrayBuffer.');
}

function findEndRecord(view) {
  const minimum = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new TypeError('Invalid ZIP archive: end record was not found.');
}

function decodeName(bytes, utf8Encoded) {
  return (utf8Encoded ? utf8 : latin1).decode(bytes);
}

function normalizedArchivePath(name) {
  const directory = name.endsWith('/');
  const value = directory ? name.slice(0, -1) : name;
  if (!value) throw new TypeError('Invalid archive path: empty entry name.');
  try {
    return { path: normalizePackagePath(value), directory };
  } catch (error) {
    throw new TypeError(`Invalid archive path: ${error.message}`, { cause: error });
  }
}

function inspectEntries(bytes, limits, caseInsensitivePaths) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view);
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const diskEntries = view.getUint16(end + 8, true);
  const totalEntries = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new TypeError('Multi-disk ZIP archives are unsupported.');
  }
  if (totalEntries > limits.maxEntries) {
    throw new TypeError(`ZIP archive exceeds the security ceiling of ${limits.maxEntries} entries.`);
  }
  if (offset + centralSize > end || offset < 0) throw new TypeError('Invalid ZIP central directory bounds.');

  const entries = [];
  const seen = new Set();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new TypeError('Invalid ZIP central directory entry.');
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.length) throw new TypeError('Invalid ZIP entry metadata bounds.');
    if (flags & ENCRYPTED_FLAG) throw new TypeError('Encrypted archives are unsupported.');
    if (!SUPPORTED_COMPRESSION.has(compression)) {
      throw new TypeError(`Unsupported ZIP compression method: ${compression}.`);
    }
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new TypeError('Invalid ZIP local file header.');
    }
    if (view.getUint16(localOffset + 6, true) & ENCRYPTED_FLAG) {
      throw new TypeError('Encrypted archives are unsupported.');
    }

    const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength), Boolean(flags & UTF8_FLAG));
    const { path, directory } = normalizedArchivePath(name);
    const comparison = caseInsensitivePaths ? path.toLocaleLowerCase('en-US') : path;
    if (seen.has(comparison)) throw new TypeError(`Duplicate normalized package path in archive: ${path}`);
    seen.add(comparison);
    if (uncompressedSize > limits.maxEntryBytes) {
      throw new TypeError(`ZIP entry exceeds the ${limits.maxEntryBytes} byte decompressed ceiling: ${path}`);
    }
    if (compressedSize >= limits.ratioMinimumCompressedBytes
      && uncompressedSize / Math.max(1, compressedSize) > limits.maxExpansionRatio) {
      throw new TypeError(`ZIP entry exceeds the ${limits.maxExpansionRatio}:1 expansion ceiling: ${path}`);
    }
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalBytes) {
      throw new TypeError(`ZIP archive exceeds the ${limits.maxTotalBytes} byte total decompressed ceiling.`);
    }
    entries.push({ name, path, directory, compressedSize, uncompressedSize, compression });
    offset = next;
  }
  if (totalCompressed >= limits.ratioMinimumCompressedBytes
    && totalUncompressed / Math.max(1, totalCompressed) > limits.maxExpansionRatio) {
    throw new TypeError(`ZIP archive exceeds the ${limits.maxExpansionRatio}:1 expansion ceiling.`);
  }
  return entries;
}

function concatChunks(chunks, length) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function readSafeZipEntries(value, {
  limits = DATA_IMPORT_ZIP_LIMITS,
  caseInsensitivePaths = true
} = {}) {
  const bytes = asBytes(value);
  const metadata = inspectEntries(bytes, limits, caseInsensitivePaths);
  const byComparison = new Map(metadata.map((entry) => [
    caseInsensitivePaths ? entry.path.toLocaleLowerCase('en-US') : entry.path,
    entry
  ]));
  const staged = [];
  let totalActualBytes = 0;
  const unzip = new Unzip((file) => {
    const normalized = normalizedArchivePath(file.name);
    const comparison = caseInsensitivePaths ? normalized.path.toLocaleLowerCase('en-US') : normalized.path;
    const descriptor = byComparison.get(comparison);
    if (!descriptor) throw new TypeError(`ZIP local entry is missing from the central directory: ${normalized.path}`);
    const chunks = [];
    let entryBytes = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      entryBytes += chunk.length;
      totalActualBytes += chunk.length;
      if (entryBytes > limits.maxEntryBytes) throw new TypeError(`ZIP entry exceeds decompressed ceiling: ${descriptor.path}`);
      if (totalActualBytes > limits.maxTotalBytes) throw new TypeError('ZIP archive exceeds total decompressed ceiling.');
      if (!descriptor.directory) chunks.push(chunk.slice());
      if (final && !descriptor.directory) {
        if (entryBytes !== descriptor.uncompressedSize) throw new TypeError(`ZIP entry size mismatch: ${descriptor.path}`);
        staged.push({ ...descriptor, bytes: concatChunks(chunks, entryBytes) });
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(bytes, true);
  return staged.sort((left, right) => left.path.localeCompare(right.path));
}
