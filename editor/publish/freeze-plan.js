import { collectDeclaredPackageEntries, normalizePackagePath } from '../core/package-store.js';

export const FREEZE_PLAN_KIND = 'overture-pmtiles-c2-freeze-plan';
export const FREEZE_PLAN_VERSION = 1;
export const FREEZE_VIEWPORT_PROFILES = Object.freeze([
  Object.freeze({ id: 'desktop', width: 1920, height: 1080 }),
  Object.freeze({ id: 'mobile', width: 390, height: 844 })
]);

export function contextActiveSceneIndices(story) {
  let mode = 'off';
  const indices = [];
  const replay = (actions = []) => {
    for (const action of actions) {
      if (['map.urban-context', 'context.set-mode'].includes(action.type)
        && ['industrial-context', 'off'].includes(action.mode)) mode = action.mode;
    }
  };
  for (const [index, state] of (story?.states ?? []).entries()) {
    if (index > 0) replay(story.states[index - 1].map?.exit);
    replay(state.map?.enter);
    if (mode === 'industrial-context') indices.push(index);
  }
  return indices;
}

function validBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
    || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -90 || bounds[3] > 90
    || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
    throw new TypeError('Freeze bounds must be ordered WGS84 [minLon, minLat, maxLon, maxLat].');
  }
  return bounds;
}

export function unionBounds(bounds) {
  if (!Array.isArray(bounds) || !bounds.length) throw new TypeError('Freeze bounds cannot be empty.');
  return bounds.map(validBounds).reduce((union, next) => [
    Math.min(union[0], next[0]), Math.min(union[1], next[1]),
    Math.max(union[2], next[2]), Math.max(union[3], next[3])
  ]);
}

export function validateFreezeBounds(requiredBounds, finalBounds) {
  validBounds(requiredBounds);
  validBounds(finalBounds);
  if (finalBounds[0] > requiredBounds[0] || finalBounds[1] > requiredBounds[1]
    || finalBounds[2] < requiredBounds[2] || finalBounds[3] < requiredBounds[3]) {
    throw new TypeError('Final bounds must contain the required bounds; only enlargement is allowed.');
  }
  return [...finalBounds];
}

export async function computeDeclaredPackageFingerprint(snapshot, { cryptoRef = globalThis.crypto } = {}) {
  const entries = new Map();
  for (const entry of snapshot.entries) {
    const path = normalizePackagePath(entry.path);
    if (entries.has(path)) throw new TypeError(`Duplicate fingerprint package path: ${path}`);
    entries.set(path, entry);
  }
  async function read(path) {
    const entry = entries.get(path);
    if (!entry) throw new TypeError(`Fingerprint package is missing ${path}.`);
    if (entry.bytes instanceof Uint8Array) return entry.bytes;
    if (entry.file?.arrayBuffer) return new Uint8Array(await entry.file.arrayBuffer());
    throw new TypeError(`Fingerprint package has no bytes for ${path}.`);
  }
  const manifest = JSON.parse(new TextDecoder().decode(await read('project.json')));
  const paths = [...new Set(['project.json', ...collectDeclaredPackageEntries(manifest).map(({ path }) => path)])].sort();
  const hash = async (bytes) => Array.from(new Uint8Array(await cryptoRef.subtle.digest('SHA-256', bytes)),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
  let material = '';
  for (const path of paths) material += `${path}\0${await hash(await read(path))}\n`;
  return hash(new TextEncoder().encode(material));
}

export async function createOvertureFreezePlan({ projectId, projectFingerprint, overtureRelease,
  profiles, finalBounds, createdAt = new Date().toISOString() }) {
  if (!Array.isArray(profiles) || profiles.length !== FREEZE_VIEWPORT_PROFILES.length
    || profiles.some((profile, index) => {
      const expected = FREEZE_VIEWPORT_PROFILES[index];
      return profile.id !== expected.id || profile.width !== expected.width || profile.height !== expected.height
        || !Array.isArray(profile.scenes) || !profile.scenes.length;
    })) throw new TypeError('Freeze profiles must be exact desktop and mobile viewports with captured Scenes.');
  const canonicalProfiles = profiles.map(({ id, width, height, scenes }) => ({
    id, width, height, scenes: scenes.map((scene, position) => {
      const first = profiles[0].scenes[position];
      if (!Number.isInteger(scene.index) || scene.index < 0 || typeof scene.id !== 'string' || !scene.id
        || (position > 0 && scene.index <= scenes[position - 1].index)
        || first?.index !== scene.index || first?.id !== scene.id
        || scenes.length !== profiles[0].scenes.length) throw new TypeError('Freeze profile Scenes must match in index order.');
      return { index: scene.index, id: scene.id, bounds: [...validBounds(scene.bounds)] };
    })
  }));
  const requiredBounds = unionBounds(canonicalProfiles.flatMap(({ scenes }) => scenes.map(({ bounds }) => bounds)));
  return {
    kind: FREEZE_PLAN_KIND, version: FREEZE_PLAN_VERSION,
    projectId, projectFingerprint, overtureRelease, requiredBounds,
    finalBounds: validateFreezeBounds(requiredBounds, finalBounds ?? requiredBounds),
    profiles: canonicalProfiles, createdAt
  };
}
