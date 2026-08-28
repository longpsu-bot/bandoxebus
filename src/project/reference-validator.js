import { validateSchema } from '../contracts/schema-validator.js';
import { ProjectLoadError } from './project-error.js';

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const FOCUS_FIELDS = new Set(['datasets', 'center', 'zoom', 'bounds']);
const CAMERA_BOUNDS = Object.freeze({
  maxZoom: [0, 24],
  pitch: [0, 72],
  bearing: [-360, 360],
  padding: [0, 256]
});

function fail(path, message) {
  throw new ProjectLoadError('PROJECT_REFERENCE_INVALID', path, message);
}

function validateRegistryIds(manifest) {
  for (const registryName of ['datasets', 'assets', 'focusTargets', 'attribution']) {
    for (const id of Object.keys(manifest[registryName])) {
      if (!ID_PATTERN.test(id)) fail(`$.${registryName}.${id}`, `${registryName} ID must be a stable lowercase ID.`);
    }
  }
}

function validateProvenance(attribution) {
  for (const [id, entry] of Object.entries(attribution)) {
    const path = `$.attribution.${id}`;
    if (entry.updated !== undefined) {
      const issues = validateSchema(entry.updated, { type: 'string', format: 'date' }, { path: `${path}.updated` });
      if (issues.length) fail(`${path}.updated`, 'Provenance updated value must be a valid ISO date.');
    }
    if (entry.url !== undefined) {
      try {
        const url = new URL(entry.url);
        if (url.protocol !== 'https:') throw new TypeError('not HTTPS');
      } catch {
        fail(`${path}.url`, 'Provenance URL must be a valid external HTTPS URL.');
      }
    }
  }
}

function validatePrimaryStory(stories) {
  if (!stories.items.some(({ id }) => id === stories.primary)) {
    fail('$.stories.primary', 'Primary Story ID must resolve to a declared Story.');
  }
}

function validateAttributionList(references, attribution, path) {
  if (references === undefined) return;
  const seen = new Set();
  references.forEach((id, index) => {
    const itemPath = `${path}[${index}]`;
    if (seen.has(id)) fail(itemPath, `Duplicate attribution reference: ${id}.`);
    if (!Object.hasOwn(attribution, id)) fail(itemPath, `Unknown attribution ID: ${id}.`);
    seen.add(id);
  });
}

function validateAttributionReferences(manifest) {
  for (const [id, dataset] of Object.entries(manifest.datasets)) {
    validateAttributionList(dataset.attribution, manifest.attribution, `$.datasets.${id}.attribution`);
  }
  for (const [id, asset] of Object.entries(manifest.assets)) {
    validateAttributionList(asset.attribution, manifest.attribution, `$.assets.${id}.attribution`);
  }
}

function validateCoordinate(value, path) {
  if (!Array.isArray(value) || value.length !== 2) fail(path, 'Coordinate must contain longitude and latitude.');
  const [longitude, latitude] = value;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    fail(`${path}[0]`, 'Longitude must be finite and between -180 and 180.');
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    fail(`${path}[1]`, 'Latitude must be finite and between -90 and 90.');
  }
}

function validateCamera(camera, path) {
  if (camera === undefined) return;
  for (const [field, value] of Object.entries(camera)) {
    const bounds = CAMERA_BOUNDS[field];
    if (!bounds) fail(`${path}.${field}`, 'Unknown focus camera hint.');
    if (!Number.isFinite(value) || value < bounds[0] || value > bounds[1]) {
      fail(`${path}.${field}`, `${field} must be finite and bounded between ${bounds[0]} and ${bounds[1]}.`);
    }
  }
}

function rejectOtherForms(target, expectedField, path) {
  for (const field of FOCUS_FIELDS) {
    if (field !== expectedField && field !== 'zoom' && Object.hasOwn(target, field)) {
      fail(`${path}.${field}`, `${target.type} focus may contain only its exclusive ${expectedField} shape.`);
    }
  }
  if (target.type !== 'coordinate' && Object.hasOwn(target, 'zoom')) {
    fail(`${path}.zoom`, `${target.type} focus may contain only its exclusive ${expectedField} shape.`);
  }
}

function validateDatasetFocus(target, datasets, path) {
  rejectOtherForms(target, 'datasets', path);
  if (!Array.isArray(target.datasets) || target.datasets.length === 0) {
    fail(`${path}.datasets`, 'Datasets focus requires at least one dataset ID.');
  }
  target.datasets.forEach((id, index) => {
    if (!Object.hasOwn(datasets, id)) fail(`${path}.datasets[${index}]`, `Unknown focus dataset ID: ${id}.`);
  });
}

function validateCoordinateFocus(target, path) {
  rejectOtherForms(target, 'center', path);
  if (!Object.hasOwn(target, 'center')) fail(`${path}.center`, 'Coordinate focus center is required.');
  if (!Object.hasOwn(target, 'zoom')) fail(`${path}.zoom`, 'Coordinate focus zoom is required.');
  validateCoordinate(target.center, `${path}.center`);
  if (!Number.isFinite(target.zoom) || target.zoom < 0 || target.zoom > 24) {
    fail(`${path}.zoom`, 'Coordinate focus zoom must be finite and between 0 and 24.');
  }
}

function validateBoundsFocus(target, path) {
  rejectOtherForms(target, 'bounds', path);
  if (!Array.isArray(target.bounds) || target.bounds.length !== 2) {
    fail(`${path}.bounds`, 'Bounds focus requires southwest and northeast coordinates.');
  }
  validateCoordinate(target.bounds[0], `${path}.bounds[0]`);
  validateCoordinate(target.bounds[1], `${path}.bounds[1]`);
  const [southwest, northeast] = target.bounds;
  if (southwest[0] >= northeast[0] || southwest[1] >= northeast[1]) {
    fail(`${path}.bounds`, 'Bounds must be ordered southwest to northeast.');
  }
}

function validateFocusStructures(focusTargets, datasets) {
  for (const [id, target] of Object.entries(focusTargets)) {
    const path = `$.focusTargets.${id}`;
    if (target.type === 'datasets') validateDatasetFocus(target, datasets, path);
    else if (target.type === 'coordinate') validateCoordinateFocus(target, path);
    else if (target.type === 'bounds') validateBoundsFocus(target, path);
    else fail(`${path}.type`, 'Focus target type must be datasets, coordinate, or bounds.');
    validateCamera(target.camera, `${path}.camera`);
  }
}

export function validateManifestReferences(manifest) {
  validateRegistryIds(manifest);
  validateProvenance(manifest.attribution);
  validatePrimaryStory(manifest.stories);
  validateAttributionReferences(manifest);
  validateFocusStructures(manifest.focusTargets, manifest.datasets);
  return manifest;
}

export function validateResolvedReferences({ manifest }) {
  validateManifestReferences(manifest);
  return true;
}
