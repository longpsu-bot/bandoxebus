import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadStoryDefinition,
  StoryValidationError,
  validateStoryDefinition
} from '../src/story-schema.js';

const supportedActionTypes = new Set(['map.mode']);

function validStory() {
  return {
    schemaVersion: '1.0',
    id: 'fixture-story',
    title: 'Fixture story',
    states: [
      {
        id: 'alpha',
        content: {
          layout: 'hero',
          blocks: [
            { type: 'eyebrow', text: 'Start', step: '01' },
            { type: 'heading', text: 'Alpha' },
            { type: 'paragraph', text: 'Opening state.' },
            { type: 'stat-group', items: [{ label: 'Value', metric: 'value', format: 'integer' }] },
            { type: 'callout', items: [{ text: 'Context' }] },
            { type: 'disclosure', text: 'Source note.' }
          ]
        },
        map: {
          enter: [{ type: 'map.mode', mode: 'difference' }],
          exit: []
        }
      }
    ]
  };
}

function assertInvalid(mutator, pattern) {
  const story = validStory();
  mutator(story);
  assert.throws(
    () => validateStoryDefinition(story, { supportedActionTypes }),
    (error) => error instanceof StoryValidationError && pattern.test(error.message)
  );
}

test('valid story definition is returned unchanged', () => {
  const story = validStory();
  assert.equal(validateStoryDefinition(story, { supportedActionTypes }), story);
});

test('missing and unsupported schema versions fail clearly', () => {
  assertInvalid((story) => { delete story.schemaVersion; }, /schemaVersion/);
  assertInvalid((story) => { story.schemaVersion = '2.0'; }, /unsupported schemaVersion/i);
});

test('state collection must be present and non-empty', () => {
  assertInvalid((story) => { story.states = []; }, /states.*non-empty/i);
  assertInvalid((story) => { delete story.states; }, /states.*non-empty/i);
});

test('state IDs must be stable unique strings', () => {
  assertInvalid((story) => { story.states[0].id = ''; }, /states\[0\]\.id/);
  assertInvalid((story) => { story.states.push(structuredClone(story.states[0])); }, /duplicate state id.*alpha/i);
});

test('malformed and unsupported content blocks are rejected', () => {
  assertInvalid((story) => { story.states[0].content.blocks[1] = { type: 'heading' }; }, /heading.*text/i);
  assertInvalid((story) => { story.states[0].content.blocks[1] = { type: 'html', text: '<b>No</b>' }; }, /unsupported content block.*html/i);
});

test('malformed and unsupported action descriptors are rejected', () => {
  assertInvalid((story) => { story.states[0].map.enter[0] = {}; }, /action.*type/i);
  assertInvalid((story) => { story.states[0].map.enter[0] = { type: 'callback', name: 'anything' }; }, /unsupported action type.*callback/i);
});

test('story loader fetches JSON and validates it before returning', async () => {
  const definition = validStory();
  const loaded = await loadStoryDefinition('/story.json', {
    supportedActionTypes,
    fetchImpl: async (url) => ({
      ok: true,
      async json() {
        assert.equal(url, '/story.json');
        return definition;
      }
    })
  });
  assert.equal(loaded, definition);
});

test('story loader reports HTTP failures clearly', async () => {
  await assert.rejects(
    loadStoryDefinition('/missing.json', {
      fetchImpl: async () => ({ ok: false, status: 404 })
    }),
    /could not load story.*404/i
  );
});
