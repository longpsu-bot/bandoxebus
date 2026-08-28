import manifestSchema from '../../data/schemas/project-manifest-v1.schema.json' with { type: 'json' };
import { validateSchema } from '../contracts/schema-validator.js';
import { projectError } from './project-error.js';

const RESERVED_CAPABILITIES = new Set(['core-content-v1', 'core-map-v1']);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const PROJECT_MANIFEST_SCHEMA_URL = new URL(
  '../../data/schemas/project-manifest-v1.schema.json',
  import.meta.url
);

export const PROJECT_MANIFEST_V1_SCHEMA = deepFreeze(manifestSchema);

function fail(path, message) {
  throw projectError('PROJECT_MANIFEST_INVALID', { path, message });
}

function validateStoryIds(items) {
  const seen = new Set();
  items.forEach(({ id }, index) => {
    if (seen.has(id)) fail(`$.stories.items[${index}].id`, `Duplicate Story ID: ${id}.`);
    seen.add(id);
  });
}

function validateReservedCapabilities(capabilities) {
  capabilities.forEach(({ id }, index) => {
    if (RESERVED_CAPABILITIES.has(id)) {
      fail(`$.capabilities[${index}].id`, `${id} is an implicit core capability and cannot be declared.`);
    }
  });
}

function validateInitialView(map) {
  const { center, zoom } = map.initialView;
  if (center.length !== 2) fail('$.map.initialView.center', 'Camera center must contain longitude and latitude.');
  if (center[0] < -180 || center[0] > 180) fail('$.map.initialView.center[0]', 'Longitude must be between -180 and 180.');
  if (center[1] < -90 || center[1] > 90) fail('$.map.initialView.center[1]', 'Latitude must be between -90 and 90.');
  if (map.minZoom !== undefined && (map.minZoom > map.maxZoom || zoom < map.minZoom)) {
    fail('$.map.minZoom', 'minZoom must not exceed maxZoom or the initial zoom.');
  }
  if (map.maxZoom !== undefined && zoom > map.maxZoom) {
    fail('$.map.maxZoom', 'maxZoom must contain the initial zoom.');
  }
}

export function validateProjectManifest(manifest) {
  const issues = validateSchema(manifest, PROJECT_MANIFEST_V1_SCHEMA);
  if (issues.length) throw projectError('PROJECT_MANIFEST_INVALID', issues[0]);
  validateStoryIds(manifest.stories.items);
  validateReservedCapabilities(manifest.capabilities);
  validateInitialView(manifest.map);
  return manifest;
}
