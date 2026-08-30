import { STORY_10_CONTENT_TYPES } from '../../src/content/content-descriptors.js';
import { createStableId, moveArrayItem } from '../core/draft-store.js';
import { createContentActionEditor } from './content-actions.js';

const LAYOUTS = Object.freeze(['hero', 'metrics', 'narrative', 'map-focus']);

function clone(value) {
  return structuredClone(value);
}

export function createStory11({ id, title }) {
  return {
    schemaVersion: '1.1',
    id,
    title,
    states: [{
      id: 'opening',
      content: { layout: 'hero', blocks: [{ type: 'heading', text: title }] },
      map: { enter: [], exit: [] }
    }]
  };
}

export function updateSupportedStory10(story, { stateIndex, content }) {
  const next = clone(story);
  const preservedActions = clone(story.states[stateIndex].map);
  Object.assign(next.states[stateIndex].content, clone(content));
  next.states[stateIndex].map = preservedActions;
  return next;
}

function legacyActionModels(state) {
  return ['enter', 'exit'].flatMap((phase) => state.map[phase].map((action, index) => {
    const { type, ...parameters } = action;
    return Object.freeze({
      phase,
      index,
      type,
      parameters: JSON.stringify(parameters),
      readOnly: true,
      disabled: true
    });
  }));
}

export function createStoryEditor({
  manifest,
  stories,
  mutateManifest,
  writeStory,
  removeStory,
  announce = () => {},
  contentDescriptors = [],
  actionDescriptors = [],
  catalogs = {}
}) {
  function persist(id, next) {
    writeStory(id, clone(next));
    stories[id] = clone(next);
    return clone(next);
  }

  function story(id) {
    if (!stories[id]) throw new TypeError(`Unknown Story ID: ${id}`);
    const current = () => stories[id];
    function updateState(stateIndex, update) {
      const source = current();
      if (!source.states[stateIndex]) throw new TypeError(`Unknown state index: ${stateIndex}`);
      let next;
      if (source.schemaVersion === '1.0') {
        const content = clone(source.states[stateIndex].content);
        update(content);
        next = updateSupportedStory10(source, { stateIndex, content });
      } else {
        next = clone(source);
        update(next.states[stateIndex].content);
      }
      return persist(id, next);
    }
    return {
      id,
      layoutOptions: () => [...LAYOUTS],
      authoring() {
        if (current().schemaVersion !== '1.1') throw new TypeError('Canonical content/action authoring requires Story 1.1.');
        return createContentActionEditor({
          story: current(),
          contentDescriptors,
          actionDescriptors,
          catalogs,
          save(next) { persist(id, next); }
        });
      },
      legacyActions(stateIndex) {
        if (current().schemaVersion !== '1.0') return [];
        return legacyActionModels(current().states[stateIndex]);
      },
      command(name, options) {
        if (name === 'add-state') {
          const next = clone(current());
          const stateId = createStableId(options.title, next.states.map(({ id: used }) => used));
          const state = {
            id: stateId,
            content: { layout: 'narrative', blocks: [{ type: 'heading', text: options.title }] },
            map: { enter: [], exit: [] }
          };
          next.states.push(state);
          persist(id, next);
          return clone(state);
        }
        if (name === 'duplicate-state') {
          const next = clone(current());
          const source = next.states[options];
          if (!source) throw new TypeError(`Unknown state index: ${options}`);
          const duplicate = clone(source);
          duplicate.id = createStableId(`${source.id}-copy`, next.states.map(({ id: used }) => used));
          next.states.splice(options + 1, 0, duplicate);
          persist(id, next);
          return clone(duplicate);
        }
        if (name === 'delete-state') {
          const source = current();
          if (source.states.length === 1) throw new TypeError('A Story must contain at least one state.');
          const next = clone(source);
          next.states.splice(options, 1);
          return persist(id, next);
        }
        if (name === 'move-state') {
          const next = clone(current());
          next.states = moveArrayItem(next.states, options.from, options.to);
          persist(id, next);
          announce(`State moved to position ${options.to + 1}.`);
          return clone(next.states);
        }
        if (name === 'set-layout') {
          if (!LAYOUTS.includes(options.layout)) throw new TypeError(`Unsupported Story layout: ${options.layout}`);
          return updateState(options.stateIndex, (content) => { content.layout = options.layout; });
        }
        if (name === 'set-presenter-note') {
          return updateState(options.stateIndex, (content) => {
            if (options.note === '') delete content.presenterNote;
            else content.presenterNote = options.note;
          });
        }
        if (name === 'add-block') {
          const source = current();
          if (source.schemaVersion === '1.0' && !STORY_10_CONTENT_TYPES.includes(options.block.type)) {
            throw new TypeError(`${options.block.type} is a Story 1.1-only block.`);
          }
          return updateState(options.stateIndex, (content) => { content.blocks.push(clone(options.block)); });
        }
        throw new TypeError(`Unknown Story command: ${name}`);
      }
    };
  }

  return {
    story,
    list: () => clone(manifest.stories.items),
    command(name, options) {
      if (name === 'add-story') {
        const used = manifest.stories.items.map(({ id }) => id);
        const id = createStableId(options.title, used);
        const created = createStory11({ id, title: options.title });
        writeStory(id, clone(created), { create: true, path: `stories/${id}.story.json` });
        stories[id] = clone(created);
        mutateManifest((draft) => { draft.stories.items.push({ id, src: `./stories/${id}.story.json` }); });
        return clone(created);
      }
      if (name === 'remove-story') {
        if (manifest.stories.items.length === 1) throw new TypeError('A project must contain at least one Story.');
        const id = options;
        const item = manifest.stories.items.find((candidate) => candidate.id === id);
        if (!item) throw new TypeError(`Unknown Story ID: ${id}`);
        mutateManifest((draft) => {
          draft.stories.items = draft.stories.items.filter((candidate) => candidate.id !== id);
          if (draft.stories.primary === id) draft.stories.primary = draft.stories.items[0].id;
        });
        removeStory(id, item.src.replace(/^\.\//, ''));
        delete stories[id];
        return;
      }
      if (name === 'move-story') {
        mutateManifest((draft) => { draft.stories.items = moveArrayItem(draft.stories.items, options.from, options.to); });
        announce(`Story moved to position ${options.to + 1}.`);
        return clone(manifest.stories.items);
      }
      if (name === 'set-primary') {
        if (!manifest.stories.items.some(({ id }) => id === options)) throw new TypeError(`Unknown Story ID: ${options}`);
        mutateManifest((draft) => { draft.stories.primary = options; });
        return;
      }
      throw new TypeError(`Unknown Story collection command: ${name}`);
    }
  };
}
