const MIB = 1024 * 1024;

export const DATA_FILE_LIMITS = Object.freeze({
  maxFileBytes: 512 * MIB,
  maxAggregateBytes: 768 * MIB,
  maxFiles: 256,
  maxXmlBytes: 128 * MIB
});

export function assertDataFileSelection(files) {
  if (!Array.isArray(files) || !files.length) throw new TypeError('Choose at least one data file.');
  if (files.length > DATA_FILE_LIMITS.maxFiles) throw new TypeError(`Select no more than ${DATA_FILE_LIMITS.maxFiles} loose files.`);
  let total = 0;
  for (const input of files) {
    const size = Number(input?.size);
    if (!input?.name || !Number.isFinite(size) || size < 0 || typeof input.arrayBuffer !== 'function') {
      throw new TypeError('Selected data includes an invalid local file.');
    }
    if (size > DATA_FILE_LIMITS.maxFileBytes) throw new TypeError(`${input.name} is too large; the direct file limit is 512 MiB.`);
    total += size;
  }
  if (total > DATA_FILE_LIMITS.maxAggregateBytes) throw new TypeError('The selected loose files exceed the 768 MiB aggregate limit.');
}
