import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadStoryDefinition,
  StoryValidationError,
  validateStoryDefinition
} from '../src/story-schema.js';

const actionContracts = Object.freeze({
  'fixture.action': () => null
});

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
          enter: [{ type: 'fixture.action', value: 'difference' }],
          exit: []
        }
      }
    ]
  };
}

function validStory12() {
  return {
    schemaVersion: '1.2',
    id: 'fixture-story-12',
    title: 'Fixture Story 1.2',
    states: [{
      id: 'alpha',
      content: {
        layout: 'freeform-16x9',
        blocks: [{
          id: 'title',
          frame: { x: 0.05, y: 0.08, width: 0.4, height: 0.17, z: 20 },
          appearance: {
            box: { fill: '#07101CCC', opacity: 1, borderColor: '#FFFFFF22', borderWidth: 1, radius: 16, padding: 24 },
            text: { fontFamily: 'sans', fontSize: 50, bold: true, italic: false, color: '#F6F8FC', align: 'left', lineHeight: 1.1 }
          },
          block: { type: 'heading', text: 'Alpha' }
        }]
      },
      map: {
        camera: { center: [106.63, 11.06], zoom: 10.7, pitch: 46, bearing: -18 },
        interaction: 'locked',
        transition: { type: 'ease', durationMs: 900 },
        layerVisibility: {},
        enter: [{ type: 'fixture.action', value: 'special' }],
        exit: []
      }
    }]
  };
}

function assertInvalid(mutator, pattern) {
  const story = validStory();
  mutator(story);
  assert.throws(
    () => validateStoryDefinition(story, { actionContracts }),
    (error) => error instanceof StoryValidationError && pattern.test(error.message)
  );
}

function assertInvalid12(mutator, pattern) {
  const story = validStory12();
  mutator(story);
  assert.throws(
    () => validateStoryDefinition(story, { actionContracts }),
    (error) => error instanceof StoryValidationError && pattern.test(error.message)
  );
}

test('valid story definition is returned unchanged', () => {
  const story = validStory();
  assert.equal(validateStoryDefinition(story, { actionContracts }), story);
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

test('Story 1.2 accepts freeform envelopes and an empty Scene', () => {
  const story = validStory12();
  assert.equal(validateStoryDefinition(story, { actionContracts }), story);
  story.states[0].content.blocks = [];
  assert.equal(validateStoryDefinition(story, { actionContracts }), story);
});

test('Story 1.2 enforces unique bounded composition envelopes', () => {
  assertInvalid12((story) => {
    story.states[0].content.blocks.push(structuredClone(story.states[0].content.blocks[0]));
  }, /duplicate.*title/i);
  assertInvalid12((story) => { story.states[0].content.blocks[0].frame.x = -0.01; }, /frame.*x/i);
  assertInvalid12((story) => { story.states[0].content.blocks[0].frame.width = 0; }, /frame.*width/i);
  assertInvalid12((story) => { story.states[0].content.blocks[0].frame.x = 0.8; story.states[0].content.blocks[0].frame.width = 0.3; }, /x.*width|frame/i);
  assertInvalid12((story) => { story.states[0].content.blocks[0].frame.y = 0.9; story.states[0].content.blocks[0].frame.height = 0.2; }, /y.*height|frame/i);
  assertInvalid12((story) => { story.states[0].content.blocks[0].block = { type: 'html', text: '<b>No</b>' }; }, /unsupported content block.*html/i);
});

test('Story 1.2 enforces camera, interaction, and transition bounds', () => {
  assertInvalid12((story) => { story.states[0].map.camera.center = [180.01, 0]; }, /camera.*center|longitude/i);
  assertInvalid12((story) => { story.states[0].map.camera.center = [0, 90.01]; }, /camera.*center|latitude/i);
  assertInvalid12((story) => { story.states[0].map.camera.zoom = 24.01; }, /camera.*zoom/i);
  assertInvalid12((story) => { story.states[0].map.camera.pitch = 72.01; }, /camera.*pitch/i);
  assertInvalid12((story) => { story.states[0].map.camera.bearing = 360.01; }, /camera.*bearing/i);
  assertInvalid12((story) => { story.states[0].map.interaction = 'pan-only'; }, /interaction/i);
  assertInvalid12((story) => { story.states[0].map.transition = { type: 'instant', durationMs: 1 }; }, /instant|duration/i);
  assertInvalid12((story) => { story.states[0].map.transition = { type: 'ease', durationMs: 10001 }; }, /duration/i);
});

test('story loader fetches JSON and validates it before returning', async () => {
  const definition = validStory();
  const loaded = await loadStoryDefinition('/story.json', {
    actionContracts,
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
