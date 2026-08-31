import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addTextEnvelope,
  alignEnvelopes,
  bringEnvelopeForward,
  commitEnvelopeFrame,
  deleteEnvelope,
  duplicateEnvelope,
  editTextEnvelope,
  sendEnvelopeBackward,
  setEnvelopeAppearance
} from '../editor/core/scene-commands.js';

function story() {
  return {
    schemaVersion: '1.2', id: 'main', title: 'Main',
    states: [{
      id: 'opening',
      content: {
        layout: 'freeform-16x9',
        blocks: [
          { id: 'left', frame: { x: 0.1, y: 0.2, width: 0.2, height: 0.2, z: 1 }, block: { type: 'paragraph', text: 'Left' } },
          { id: 'right', frame: { x: 0.6, y: 0.5, width: 0.25, height: 0.2, z: 2 }, block: { type: 'heading', text: 'Right' } }
        ]
      },
      map: {
        camera: { center: [0, 0], zoom: 2, pitch: 0, bearing: 0 },
        interaction: 'locked', transition: { type: 'ease', durationMs: 900 },
        layerVisibility: {}, enter: [], exit: []
      }
    }]
  };
}

function blockById(value, id) {
  return value.states[0].content.blocks.find((block) => block.id === id);
}

test('Heading and Body Text are ordinary Story 1.2 envelopes with stable IDs', () => {
  const source = story();
  const heading = addTextEnvelope(source, { sceneIndex: 0, kind: 'heading' });
  const headingBlock = heading.states[0].content.blocks.at(-1);
  assert.equal(headingBlock.id, 'heading');
  assert.deepEqual(headingBlock.block, { type: 'heading', text: 'Heading' });
  assert.equal(headingBlock.frame.z, 3);

  const body = addTextEnvelope(heading, { sceneIndex: 0, kind: 'body' });
  const bodyBlock = body.states[0].content.blocks.at(-1);
  assert.equal(bodyBlock.id, 'body-text');
  assert.deepEqual(bodyBlock.block, { type: 'paragraph', text: 'Body text' });
  assert.equal(source.states[0].content.blocks.length, 2);
});

test('plain-text edit and frame commit mutate clones only and bound the stored frame', () => {
  const source = story();
  const edited = editTextEnvelope(source, { sceneIndex: 0, id: 'left', text: '<b>Plain text</b>' });
  assert.equal(blockById(edited, 'left').block.text, '<b>Plain text</b>');
  assert.equal(blockById(source, 'left').block.text, 'Left');

  const framed = commitEnvelopeFrame(edited, {
    sceneIndex: 0,
    id: 'left',
    frame: { x: -0.2, y: 0.95, width: 0.4, height: 0.3, z: 10050 }
  });
  assert.deepEqual(blockById(framed, 'left').frame, {
    x: 0, y: 0.7, width: 0.4, height: 0.3, z: 9999
  });
});

test('duplicate and delete keep stable envelope identity without mutating the source', () => {
  const source = story();
  const duplicated = duplicateEnvelope(source, { sceneIndex: 0, id: 'left' });
  const copy = duplicated.states[0].content.blocks.at(-1);
  assert.equal(copy.id, 'left-copy');
  assert.equal(copy.block.text, 'Left');
  assert.equal(copy.frame.z, 3);
  assert.notEqual(copy, blockById(source, 'left'));

  const deleted = deleteEnvelope(duplicated, { sceneIndex: 0, id: 'left' });
  assert.deepEqual(deleted.states[0].content.blocks.map(({ id }) => id), ['right', 'left-copy']);
  assert.deepEqual(source.states[0].content.blocks.map(({ id }) => id), ['left', 'right']);
});

test('bring forward and send backward swap one deterministic z-order step', () => {
  const source = story();
  const forward = bringEnvelopeForward(source, { sceneIndex: 0, id: 'left' });
  assert.equal(blockById(forward, 'left').frame.z, 2);
  assert.equal(blockById(forward, 'right').frame.z, 1);

  const backward = sendEnvelopeBackward(source, { sceneIndex: 0, id: 'right' });
  assert.equal(blockById(backward, 'right').frame.z, 1);
  assert.equal(blockById(backward, 'left').frame.z, 2);
});

test('alignment uses selection bounds for edges and centers', () => {
  const source = story();
  const left = alignEnvelopes(source, { sceneIndex: 0, ids: ['left', 'right'], alignment: 'left' });
  assert.equal(blockById(left, 'left').frame.x, 0.1);
  assert.equal(blockById(left, 'right').frame.x, 0.1);

  const middle = alignEnvelopes(source, { sceneIndex: 0, ids: ['left', 'right'], alignment: 'middle' });
  const groupMiddle = (0.2 + 0.7) / 2;
  assert.equal(blockById(middle, 'left').frame.y, groupMiddle - 0.1);
  assert.equal(blockById(middle, 'right').frame.y, groupMiddle - 0.1);
});

test('appearance command exposes only bounded approved box and text properties', () => {
  const source = story();
  const next = setEnvelopeAppearance(source, {
    sceneIndex: 0,
    id: 'left',
    box: {
      fill: '#11223344', opacity: 2, borderColor: '#FFFFFFFF', borderWidth: 20,
      radius: 200, padding: 999
    },
    text: {
      fontFamily: 'georgia', fontSize: 2, bold: true, italic: true,
      color: '#AABBCC', align: 'center', lineHeight: 5
    }
  });
  assert.deepEqual(blockById(next, 'left').appearance, {
    box: {
      fill: '#11223344', opacity: 1, borderColor: '#FFFFFFFF', borderWidth: 16,
      radius: 128, padding: 160
    },
    text: {
      fontFamily: 'georgia', fontSize: 8, bold: true, italic: true,
      color: '#AABBCC', align: 'center', lineHeight: 2.5
    }
  });
  assert.throws(() => setEnvelopeAppearance(source, {
    sceneIndex: 0, id: 'left', text: { fontFamily: 'Comic Sans MS' }
  }), /font/i);
  assert.throws(() => setEnvelopeAppearance(source, {
    sceneIndex: 0, id: 'left', box: { fill: 'red' }
  }), /color|hex/i);
});
