import { ProjectLoadError } from './project-error.js';

const EXECUTABLE_KINDS = new Set(['script', 'module', 'plugin']);
const PROVENANCE_KINDS = new Set(['attribution', 'provenance']);
const EXECUTABLE_EXTENSION = /\.(?:m?js)$/i;
const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function unsafe(path, message) {
  throw new ProjectLoadError('UNSAFE_RESOURCE_PATH', path, message);
}

function decodePath(value, path) {
  let decoded = value;
  try {
    for (let index = 0; index < 4; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    }
    return decoded;
  } catch {
    unsafe(path, 'Resource path contains invalid percent encoding.');
  }
}

function inspectAuthoredPath(authoredPath, kind, path) {
  if (typeof authoredPath !== 'string' || !authoredPath || authoredPath.trim() !== authoredPath) {
    unsafe(path, 'Resource path must be a non-empty package-relative string.');
  }
  if (EXECUTABLE_KINDS.has(kind)) unsafe(path, 'Executable resource kinds are not allowed.');
  if (authoredPath.startsWith('//')) unsafe(path, 'Protocol-relative resource paths are not allowed.');

  if (URL_SCHEME.test(authoredPath)) {
    if (PROVENANCE_KINDS.has(kind)) {
      const external = new URL(authoredPath);
      if (external.protocol === 'https:') return { external };
    }
    unsafe(path, 'Runtime resources must use package-relative paths.');
  }

  const decoded = decodePath(authoredPath, path);
  if (authoredPath.startsWith('/') || decoded.startsWith('/')) unsafe(path, 'Root-relative resource paths are not allowed.');
  if (authoredPath.includes('\\') || decoded.includes('\\')) unsafe(path, 'Backslashes are not allowed in resource paths.');
  if (authoredPath.includes('?') || authoredPath.includes('#') || decoded.includes('?') || decoded.includes('#')) {
    unsafe(path, 'Query strings and fragments are not allowed in resource paths.');
  }
  if (/%(?:2f|5c)/i.test(authoredPath)) unsafe(path, 'Encoded path separators are not allowed.');
  if (decoded.split('/').some((segment) => segment === '..')) unsafe(path, 'Path traversal is not allowed.');
  if (EXECUTABLE_EXTENSION.test(decoded)) unsafe(path, 'Executable JavaScript resources are not allowed.');
  return { decoded };
}

function packageDirectory(manifestUrl) {
  return new URL('.', manifestUrl).pathname;
}

function resolveAuthoredPath(manifestUrl, authoredPath, kind, path) {
  const inspected = inspectAuthoredPath(authoredPath, kind, path);
  if (inspected.external) return inspected.external;

  const manifest = new URL(manifestUrl, globalThis.location?.href ?? 'http://localhost/');
  const resolved = new URL(authoredPath, manifest);
  if (resolved.origin !== manifest.origin || !resolved.pathname.startsWith(packageDirectory(manifest))) {
    unsafe(path, 'Resource must stay inside the same-origin manifest package.');
  }
  return resolved;
}

export function resolvePackageUrl(manifestUrl, authoredPath, { kind = 'resource' } = {}) {
  return resolveAuthoredPath(manifestUrl, authoredPath, kind, '$.src');
}

export function validateManifestResourcePaths(manifest) {
  manifest.stories.items.forEach((story, index) => {
    inspectAuthoredPath(story.src, 'story', `$.stories.items[${index}].src`);
  });
  for (const [id, dataset] of Object.entries(manifest.datasets)) {
    inspectAuthoredPath(dataset.src, 'dataset', `$.datasets.${id}.src`);
  }
  for (const [id, asset] of Object.entries(manifest.assets)) {
    inspectAuthoredPath(asset.src, 'asset', `$.assets.${id}.src`);
  }
  if (manifest.metrics) inspectAuthoredPath(manifest.metrics.src, 'metrics', '$.metrics.src');
  return manifest;
}

function freezeRegistry(entries) {
  return Object.freeze(Object.fromEntries(entries));
}

export function resolveManifestResourceUrls(manifest, manifestUrl) {
  const stories = manifest.stories.items.map(({ id, src }, index) => [
    id,
    resolveAuthoredPath(manifestUrl, src, 'story', `$.stories.items[${index}].src`)
  ]);
  const datasets = Object.entries(manifest.datasets).map(([id, descriptor]) => [
    id,
    resolveAuthoredPath(manifestUrl, descriptor.src, 'dataset', `$.datasets.${id}.src`)
  ]);
  const assets = Object.entries(manifest.assets).map(([id, descriptor]) => [
    id,
    resolveAuthoredPath(manifestUrl, descriptor.src, 'asset', `$.assets.${id}.src`)
  ]);
  const metrics = manifest.metrics
    ? resolveAuthoredPath(manifestUrl, manifest.metrics.src, 'metrics', '$.metrics.src')
    : null;

  return Object.freeze({
    stories: freezeRegistry(stories),
    datasets: freezeRegistry(datasets),
    assets: freezeRegistry(assets),
    metrics
  });
}
