export class StoryActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoryActionError';
  }
}

export function createStoryActionRunner(handlers) {
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) {
    throw new TypeError('Story action handlers must be an object.');
  }

  const registry = new Map(Object.entries(handlers));
  for (const [type, handler] of registry) {
    if (typeof handler !== 'function') {
      throw new TypeError(`Story action handler "${type}" must be a function.`);
    }
  }

  return Object.freeze({
    actionTypes: Object.freeze([...registry.keys()]),
    run(actions, context = {}) {
      if (!Array.isArray(actions)) throw new StoryActionError('Story actions must be an array.');
      for (const action of actions) {
        const handler = registry.get(action?.type);
        if (!handler) {
          throw new StoryActionError(`Unknown story action type "${action?.type ?? ''}".`);
        }
        handler(action, context);
      }
    }
  });
}
