import { ProjectLoadError } from '../project/project-error.js';

function coordinates(value, output = []) {
  if (!Array.isArray(value)) return output;
  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) output.push([value[0], value[1]]);
  else for (const child of value) coordinates(child, output);
  return output;
}

function datasetBounds(ids, datasets, path) {
  const all = [];
  for (const id of ids) {
    const resource = datasets.get(id);
    if (!resource) throw new ProjectLoadError('FOCUS_DATASET_UNKNOWN', path, `Unknown focus dataset ID: ${id}.`);
    for (const feature of resource.value?.features ?? []) coordinates(feature.geometry?.coordinates, all);
  }
  if (!all.length) throw new ProjectLoadError('FOCUS_DATASET_EMPTY', path, 'Focus datasets contain no coordinates.');
  return all.reduce((bounds, [lng, lat]) => [
    [Math.min(bounds[0][0], lng), Math.min(bounds[0][1], lat)],
    [Math.max(bounds[1][0], lng), Math.max(bounds[1][1], lat)]
  ], [[Infinity, Infinity], [-Infinity, -Infinity]]);
}

function normalize(id, target, datasets, owner = 'project') {
  const base = { id, owner, ...structuredClone(target) };
  if (target.type === 'datasets') base.bounds = datasetBounds(target.datasets, datasets, `$.focusTargets.${id}.datasets`);
  return Object.freeze(base);
}

export function createFocusRegistry({ manifestTargets = {}, capabilityTargets = {}, datasets = new Map() } = {}) {
  const targets = new Map();
  for (const [id, target] of Object.entries(manifestTargets)) targets.set(id, normalize(id, target, datasets));
  const entries = capabilityTargets instanceof Map ? capabilityTargets : Object.entries(capabilityTargets);
  for (const [id, target] of entries) {
    if (targets.has(id)) throw new ProjectLoadError('FOCUS_TARGET_COLLISION', `$.focusTargets.${id}`, `Focus target collision: ${id}.`);
    targets.set(id, normalize(id, target, datasets, target.owner ?? 'capability'));
  }
  return Object.freeze({
    ids: Object.freeze([...targets.keys()]),
    has: (id) => targets.has(id),
    get(id) {
      const target = targets.get(id);
      if (!target) throw new ProjectLoadError('FOCUS_TARGET_UNKNOWN', `$.focusTargets.${id}`, `Unknown focus target ID: ${id}.`);
      return target;
    }
  });
}
