import { ProjectLoadError } from '../project/project-error.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(code, id, message) {
  throw new ProjectLoadError(code, `$.metrics.${id}`, message);
}

function normalizeProvider(provider) {
  if (provider?.descriptor) return provider;
  const [id, compute] = Array.isArray(provider) ? provider : [];
  return { descriptor: { id, label: id, format: { type: 'decimal' } }, compute };
}

export async function createMetricRegistry({ staticMetrics = {}, providers = [], context } = {}) {
  const results = new Map();
  const diagnostics = [];
  for (const [id, metric] of Object.entries(staticMetrics)) {
    results.set(id, deepFreeze({ id, ...structuredClone(metric), status: metric.value === null ? 'unavailable' : 'available' }));
  }
  for (const authoredProvider of providers) {
    const provider = normalizeProvider(authoredProvider);
    const descriptor = provider.descriptor;
    if (!descriptor?.id) throw new TypeError('Metric provider descriptor requires an ID.');
    if (results.has(descriptor.id)) fail('METRIC_ID_COLLISION', descriptor.id, `Metric ID collision: ${descriptor.id}.`);
    let value = null;
    let status = 'unavailable';
    try {
      if (typeof provider.compute === 'function') {
        value = await provider.compute(context);
        status = value === null || value === undefined ? 'unavailable' : 'available';
        if (status === 'unavailable') value = null;
      }
    } catch (error) {
      diagnostics.push(deepFreeze({
        code: 'METRIC_COMPUTE_FAILED',
        path: `$.metrics.${descriptor.id}`,
        message: error?.message ?? String(error)
      }));
    }
    results.set(descriptor.id, deepFreeze({
      id: descriptor.id,
      label: descriptor.label,
      format: structuredClone(descriptor.format ?? { type: 'decimal' }),
      value,
      status,
      attribution: structuredClone(descriptor.attribution ?? [])
    }));
  }
  const resolve = (id) => results.get(id) ?? fail('METRIC_UNKNOWN', id, `Unknown metric ID: ${id}.`);
  return Object.freeze({
    has: (id) => results.has(id),
    resolve,
    catalog: () => deepFreeze([...results.values()].map(({ value: _value, status: _status, ...descriptor }) => structuredClone(descriptor))),
    diagnostics: deepFreeze(diagnostics)
  });
}
