function providerFrom(instance) {
  return instance?.implementation?.sceneLayers;
}

function capabilityId(instance) {
  return instance?.entry?.descriptor?.id ?? 'unknown-capability';
}

export function createSceneLayerRegistry(instances = [], expectedIds = []) {
  const owners = new Map();
  const providers = [];

  for (const instance of instances) {
    const provider = providerFrom(instance);
    if (!provider) continue;
    if (!Array.isArray(provider.ids) || typeof provider.setVisible !== 'function' || typeof provider.reset !== 'function') {
      throw new TypeError(`${capabilityId(instance)} has an invalid Scene layer provider.`);
    }
    providers.push(provider);
    for (const id of provider.ids) {
      if (owners.has(id)) {
        throw new TypeError(`Duplicate Scene layer ownership for dataset ${id}.`);
      }
      owners.set(id, provider);
    }
  }

  const ids = expectedIds.length ? [...expectedIds] : [...owners.keys()];
  const seenExpected = new Set();
  for (const id of ids) {
    if (seenExpected.has(id)) throw new TypeError(`Duplicate expected Scene layer dataset ${id}.`);
    seenExpected.add(id);
    if (!owners.has(id)) throw new TypeError(`Scene layer dataset ${id} has no runtime provider.`);
  }

  function applySnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new TypeError('Scene layer snapshot must be an object.');
    }
    for (const key of Object.keys(snapshot)) {
      if (!seenExpected.has(key)) throw new TypeError(`Unexpected Scene layer dataset ${key}.`);
    }
    for (const id of ids) {
      if (!Object.hasOwn(snapshot, id)) throw new TypeError(`Scene layer snapshot is missing dataset ${id}.`);
      owners.get(id).setVisible(id, snapshot[id]);
    }
  }

  function reset() {
    for (const provider of new Set(providers)) provider.reset();
  }

  return Object.freeze({
    ids: Object.freeze(ids),
    applySnapshot,
    reset
  });
}
