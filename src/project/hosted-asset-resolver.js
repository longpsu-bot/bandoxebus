const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function validatedOrigin(pmtilesOrigin) {
  let url;
  try {
    url = new URL(pmtilesOrigin);
  } catch {
    throw new TypeError('PMTiles origin must be an absolute HTTPS origin.');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new TypeError('PMTiles origin must be an absolute HTTPS origin.');
  }
  return url.origin;
}

function matchingSnapshots(manifest, assetId) {
  return (manifest?.capabilities ?? []).filter((capability) => (
    capability?.id === 'urban-context-v1'
    && capability.settings?.buildingSource === 'project-snapshot'
    && capability.settings.snapshot?.asset === assetId
  ));
}

export function createContentAddressedPmtilesResolver({ pmtilesOrigin }) {
  const origin = validatedOrigin(pmtilesOrigin);
  return (url, { id, descriptor, manifest } = {}) => {
    if (descriptor?.type !== 'pmtiles') return url;

    const snapshots = matchingSnapshots(manifest, id);
    if (snapshots.length !== 1) {
      throw new TypeError('A PMTiles asset must be referenced by exactly one project-snapshot declaration.');
    }
    if (!PROJECT_ID_PATTERN.test(manifest?.id ?? '')) {
      throw new TypeError('Project ID is invalid for a content-addressed PMTiles object.');
    }
    const sha256 = snapshots[0].settings.snapshot.sha256;
    if (!SHA256_PATTERN.test(sha256 ?? '')) {
      throw new TypeError('Project snapshot SHA-256 must be a lowercase 64-character hex digest.');
    }
    return new URL(`projects/${manifest.id}/${sha256}/overture-buildings.pmtiles`, `${origin}/`);
  };
}
